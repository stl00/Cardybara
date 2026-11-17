// Accounts and the server copy of the wallet (stl00/Cardybara#412, epic #410): email and password sign-up with a
// 6-digit email code, sign-in, password reset and change, bearer sessions (no cookies), one wallet document per user
// with a revision check, and account deletion. Storage is D1 (binding DB, schema gateway/migrations/0001_accounts.sql);
// mail goes through Cloudflare Email Sending (binding EMAIL). docs/GATEWAY.md "Accounts".
//
// What is stored: the normalised email, a verified flag, a PBKDF2-SHA256 hash and its salt; email codes only as an
// HMAC with a short expiry; sessions only as a SHA-256 of the token; the wallet document as JSON. Per-email counters
// for sign-in failures and code sends live in `auth_limits` under an HMAC of the email, never the email itself.
// Nothing here logs: the gateway's one log line per request carries route, status and error code only.
//
// This module imports nothing from gateway.js (no cycle): it throws AccountError codes and returns {status, body};
// gateway.js wraps the handlers as routes and turns the codes into its own refusals.

export class AccountError extends Error{constructor(code,extra={}){super(code);this.extra=extra;}}
const fail=(code,extra)=>{throw new AccountError(code,extra);};

// Every table that may hold a row for a user. Deleting an account empties each of them for that user (tested).
export const TABLES=['users','email_codes','sessions','wallets','auth_limits'];
export const PASSWORD_MIN=10;
export const PASSWORD_MAX=1024;
// Workers' WebCrypto refuses PBKDF2 above 100,000 iterations, so this is the most it allows. Each user row keeps its
// own count so a later raise can rehash on the next sign-in.
export const PBKDF2_ITERATIONS=100000;
export const CODE_TTL_SECONDS=10*60;
export const CODE_MAX_ATTEMPTS=5;
export const SESSION_TTL_SECONDS=30*86400;
// Sign-in: this many failures for one email within the window lock it for LOCK_SECONDS.
export const SIGNIN_MAX_FAILURES=5;
export const SIGNIN_WINDOW_SECONDS=15*60;
export const LOCK_SECONDS=15*60;
// Code sends (sign-up, resend, reset) per email per hour.
export const CODE_SENDS_PER_HOUR=5;
export const WALLET_MAX_BYTES_DEFAULT=524288;

const encoder=new TextEncoder();
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
const b64u=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const sec=ms=>Math.floor(ms/1000);

const validSecret=v=>typeof v==='string'&&v.length>=16;
/** ACCOUNT_SECRET keys the code and email-limit HMACs; a local run (LOCAL_DEV=1) falls back to a fixed key. */
function secretOf(env){return validSecret(env.ACCOUNT_SECRET)?env.ACCOUNT_SECRET:env.LOCAL_DEV==='1'?'local-account-secret':null;}
export function walletMaxBytes(env){const n=Number(env.WALLET_MAX_BYTES??WALLET_MAX_BYTES_DEFAULT);return Number.isInteger(n)&&n>0?n:WALLET_MAX_BYTES_DEFAULT;}
/** Accounts answer 503 account_unavailable until D1, the mail binding, the sender address and the secret are set. */
export function accountsConfigured(env){
 return !!(env.DB&&typeof env.DB.prepare==='function'&&env.EMAIL&&typeof env.EMAIL.send==='function'
  &&typeof env.ACCOUNT_EMAIL_FROM==='string'&&/@/.test(env.ACCOUNT_EMAIL_FROM)&&secretOf(env));
}

async function hmac(env,text){
 const key=await crypto.subtle.importKey('raw',encoder.encode('cardybara-account-v1:'+secretOf(env)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(text))));
}
const sha256=async text=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))));
const randomBytes=n=>crypto.getRandomValues(new Uint8Array(n));

export async function hashPassword(password,salt,iterations=PBKDF2_ITERATIONS){
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations},key,256);
 return hex(new Uint8Array(bits));
}
// Constant-time comparison of two hex strings of the same length.
function same(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}

/** A uniform 6-digit code (rejection sampling, no modulo bias). */
export function newCode(){
 for(;;){const n=crypto.getRandomValues(new Uint32Array(1))[0];if(n<4294000000)return String(n%1000000).padStart(6,'0');}
}

// --- Input. Every body is checked key by key; anything else is bad_request.
export function normalEmail(value){
 if(typeof value!=='string')fail('bad_request');
 const email=value.trim().toLowerCase();
 if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('bad_request');
 return email;
}
function password(value){
 if(typeof value!=='string'||value.length>PASSWORD_MAX)fail('bad_request');
 if([...value].length<PASSWORD_MIN)fail('weak_password');
 return value;
}
function code(value){if(typeof value!=='string'||!/^\d{6}$/.test(value))fail('code_invalid');return value;}
function body(b,keys){if(!exact(b,keys))fail('bad_request');return b;}

// --- D1 helpers.
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const changes=r=>r?.meta?.changes??0;

// --- Per-email limits, keyed by an HMAC of the email (also for emails with no account, so the answer is the same).
const limitKey=async(env,kind,email)=>kind+':'+(await hmac(env,'limit|'+email)).slice(0,40);
async function readLimit(db,key){return await one(db,'SELECT count, window_start, locked_until FROM auth_limits WHERE key = ?',key);}
async function writeLimit(db,key,{count,window_start,locked_until}){
 await run(db,'INSERT OR REPLACE INTO auth_limits (key, count, window_start, locked_until) VALUES (?, ?, ?, ?)',key,count,window_start,locked_until);
}
async function checkLocked(env,email,now){
 const row=await readLimit(env.DB,await limitKey(env,'signin',email));
 if(row&&row.locked_until>now)fail('account_locked',{retryAfter:row.locked_until-now});
}
async function recordFailure(env,email,now){
 const key=await limitKey(env,'signin',email);
 const row=await readLimit(env.DB,key);
 let count=row&&now-row.window_start<SIGNIN_WINDOW_SECONDS?row.count:0,window_start=row&&now-row.window_start<SIGNIN_WINDOW_SECONDS?row.window_start:now;
 count++;
 if(count>=SIGNIN_MAX_FAILURES){await writeLimit(env.DB,key,{count:0,window_start:now,locked_until:now+LOCK_SECONDS});return;}
 await writeLimit(env.DB,key,{count,window_start,locked_until:0});
}
async function clearFailures(env,email){await run(env.DB,'DELETE FROM auth_limits WHERE key = ?',await limitKey(env,'signin',email));}
/** Counts one code send for the email; refuses past CODE_SENDS_PER_HOUR. */
async function countSend(env,email,now){
 const key=await limitKey(env,'send',email);
 const row=await readLimit(env.DB,key);
 const fresh=row&&now-row.window_start<3600;
 const count=(fresh?row.count:0)+1;
 if(count>CODE_SENDS_PER_HOUR)fail('too_many_codes',{retryAfter:row.window_start+3600-now});
 await writeLimit(env.DB,key,{count,window_start:fresh?row.window_start:now,locked_until:0});
}

// --- Email codes.
async function issueCode(env,email,purpose,userId,now){
 const value=newCode();
 await run(env.DB,'INSERT OR REPLACE INTO email_codes (email, purpose, user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, ?, ?)',
  email,purpose,userId,await hmac(env,'code|'+purpose+'|'+email+'|'+value),now+CODE_TTL_SECONDS,0);
 return value;
}
/** One use: a right code is deleted; a wrong one counts, and the code is deleted after CODE_MAX_ATTEMPTS. */
async function useCode(env,email,purpose,value,now){
 const row=await one(env.DB,'SELECT code_hash, expires_at, attempts FROM email_codes WHERE email = ? AND purpose = ?',email,purpose);
 if(!row)fail('code_invalid');
 if(row.expires_at<=now){await run(env.DB,'DELETE FROM email_codes WHERE email = ? AND purpose = ?',email,purpose);fail('code_expired');}
 if(!same(row.code_hash,await hmac(env,'code|'+purpose+'|'+email+'|'+value))){
  if(row.attempts+1>=CODE_MAX_ATTEMPTS)await run(env.DB,'DELETE FROM email_codes WHERE email = ? AND purpose = ?',email,purpose);
  else await run(env.DB,'UPDATE email_codes SET attempts = ? WHERE email = ? AND purpose = ?',row.attempts+1,email,purpose);
  fail('code_invalid');
 }
 await run(env.DB,'DELETE FROM email_codes WHERE email = ? AND purpose = ?',email,purpose);
}

const MAIL={
 verify:c=>({subject:'Your Cardybara code',text:`Your Cardybara sign-up code is ${c}. It expires in 10 minutes. If you did not sign up, ignore this email.`}),
 reset:c=>({subject:'Your Cardybara password reset code',text:`Your Cardybara password reset code is ${c}. It expires in 10 minutes. If you did not ask for it, ignore this email; your password is unchanged.`}),
 exists:()=>({subject:'Your Cardybara account',text:'Someone tried to create a Cardybara account with this email, which already has one. If it was you, sign in, or use "Forgot password". Otherwise ignore this email.'}),
};
/** Sends one mail. A failure is mail_failed; neither the address nor the code is ever logged or returned. */
async function mail(env,to,kind,value){
 try{await env.EMAIL.send({to,from:env.ACCOUNT_EMAIL_FROM,...MAIL[kind](value)});}
 catch{fail('mail_failed');}
}

// --- Sessions: 32 random bytes; only their SHA-256 is stored.
async function newSession(env,userId,now){
 const token='cbs_'+b64u(randomBytes(32));
 await run(env.DB,'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',await sha256(token),userId,now,now+SESSION_TTL_SECONDS);
 return {token,expiresAt:now+SESSION_TTL_SECONDS};
}
export function bearer(request){
 const m=/^Bearer (cbs_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization')||'');
 return m?m[1]:null;
}
/** The signed-in user for a bearer token, or unauthorized. The user id never comes from the client. */
async function session(env,token,now){
 if(!token)fail('unauthorized');
 const hash=await sha256(token);
 const row=await one(env.DB,'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',hash);
 if(!row)fail('unauthorized');
 if(row.expires_at<=now){await run(env.DB,'DELETE FROM sessions WHERE token_hash = ?',hash);fail('unauthorized');}
 return {userId:row.user_id,hash};
}

const userByEmail=(env,email)=>one(env.DB,'SELECT id, email, verified, password_hash, password_salt, password_iterations FROM users WHERE email = ?',email);
const userById=(env,id)=>one(env.DB,'SELECT id, email, verified, password_hash, password_salt, password_iterations FROM users WHERE id = ?',id);
async function setPassword(env,userId,value){
 const salt=b64u(randomBytes(16));
 await run(env.DB,'UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?',await hashPassword(value,salt),salt,PBKDF2_ITERATIONS,userId);
}
// Spent on an unknown email so its answer takes as long as a wrong password.
const DUMMY_SALT='cardybara-no-such-user';
async function passwordMatches(user,value){
 if(!user){await hashPassword(value,DUMMY_SALT);return false;}
 return same(user.password_hash,await hashPassword(value,user.password_salt,user.password_iterations));
}

// --- Handlers. Each gets {env, body, token, now (ms)} and returns {status, body}.

/** POST /v2/account/signup {email,password}: always 202 code_sent, whether or not the email has an account. */
export async function signUp({env,body:b,now:ms}){
 body(b,['email','password']);
 const email=normalEmail(b.email),pw=password(b.password),now=sec(ms);
 await countSend(env,email,now);
 const user=await userByEmail(env,email);
 if(user?.verified){await mail(env,email,'exists');return {status:202,body:{status:'code_sent'}};}
 let id=user?.id;
 if(!id){
  id='u_'+b64u(randomBytes(16));
  await run(env.DB,'INSERT INTO users (id, email, verified, password_hash, password_salt, password_iterations, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',id,email,'','',PBKDF2_ITERATIONS,now);
 }
 // An unverified sign-up may be started again: the latest password and code win.
 await setPassword(env,id,pw);
 await mail(env,email,'verify',await issueCode(env,email,'verify',id,now));
 return {status:202,body:{status:'code_sent'}};
}

/** POST /v2/account/verify {email,code}: marks the email verified and signs in. */
export async function verify({env,body:b,now:ms}){
 body(b,['email','code']);
 const email=normalEmail(b.email),value=code(b.code),now=sec(ms);
 await useCode(env,email,'verify',value,now);
 const user=await userByEmail(env,email);
 if(!user)fail('code_invalid');
 await run(env.DB,'UPDATE users SET verified = 1 WHERE id = ?',user.id);
 return {status:200,body:await newSession(env,user.id,now)};
}

/** POST /v2/account/session {email,password}: sign in. Unknown email and wrong password give the same answer. */
export async function signIn({env,body:b,now:ms}){
 body(b,['email','password']);
 const email=normalEmail(b.email),now=sec(ms);
 if(typeof b.password!=='string'||b.password.length>PASSWORD_MAX)fail('bad_request');
 await checkLocked(env,email,now);
 const user=await userByEmail(env,email);
 if(!(await passwordMatches(user,b.password))){await recordFailure(env,email,now);fail('invalid_credentials');}
 if(!user.verified)fail('email_unverified');
 await clearFailures(env,email);
 return {status:200,body:await newSession(env,user.id,now)};
}

/** DELETE /v2/account/session: signs this session out. */
export async function signOut({env,token,now:ms}){
 const {hash}=await session(env,token,sec(ms));
 await run(env.DB,'DELETE FROM sessions WHERE token_hash = ?',hash);
 return {status:200,body:{status:'signed_out'}};
}

/** POST /v2/account/password/forgot {email}: always 202; a code is mailed only if the account exists. */
export async function forgotPassword({env,body:b,now:ms}){
 body(b,['email']);
 const email=normalEmail(b.email),now=sec(ms);
 await countSend(env,email,now);
 const user=await userByEmail(env,email);
 if(user)await mail(env,email,'reset',await issueCode(env,email,'reset',user.id,now));
 return {status:202,body:{status:'code_sent'}};
}

/** POST /v2/account/password/reset {email,code,password}: new password, every session revoked, a new one issued. */
export async function resetPassword({env,body:b,now:ms}){
 body(b,['email','code','password']);
 const email=normalEmail(b.email),value=code(b.code),pw=password(b.password),now=sec(ms);
 await useCode(env,email,'reset',value,now);
 const user=await userByEmail(env,email);
 if(!user)fail('code_invalid');
 await setPassword(env,user.id,pw);
 // The code reached the mailbox, so the email is proven too.
 await run(env.DB,'UPDATE users SET verified = 1 WHERE id = ?',user.id);
 await run(env.DB,'DELETE FROM sessions WHERE user_id = ?',user.id);
 await clearFailures(env,email);
 return {status:200,body:await newSession(env,user.id,now)};
}

/** POST /v2/account/password {currentPassword,newPassword}: every other session is revoked; this one stays. */
export async function changePassword({env,body:b,token,now:ms}){
 const now=sec(ms),{userId,hash}=await session(env,token,now);
 body(b,['currentPassword','newPassword']);
 const pw=password(b.newPassword);
 if(typeof b.currentPassword!=='string'||b.currentPassword.length>PASSWORD_MAX)fail('bad_request');
 const user=await userById(env,userId);
 if(!(await passwordMatches(user,b.currentPassword)))fail('invalid_credentials');
 await setPassword(env,userId,pw);
 await run(env.DB,'DELETE FROM sessions WHERE user_id = ? AND token_hash != ?',userId,hash);
 return {status:200,body:{status:'changed'}};
}

/** GET /v2/account/wallet: the stored document, or revision 0 and no document. */
export async function getWallet({env,token,now:ms}){
 const {userId}=await session(env,token,sec(ms));
 const row=await one(env.DB,'SELECT revision, document, format_version, updated_at FROM wallets WHERE user_id = ?',userId);
 if(!row)return {status:200,body:{revision:0,formatVersion:null,document:null,updatedAt:null}};
 return {status:200,body:{revision:row.revision,formatVersion:row.format_version,document:JSON.parse(row.document),updatedAt:row.updated_at}};
}

/**
 * PUT /v2/account/wallet {baseRevision,formatVersion,document}: stored only if baseRevision is the stored revision
 * (0 for none); otherwise 409 stale_revision with the current revision. The document's schema is #413's.
 */
export async function putWallet({env,body:b,token,now:ms}){
 const now=sec(ms),{userId}=await session(env,token,now);
 body(b,['baseRevision','formatVersion','document']);
 if(!Number.isInteger(b.baseRevision)||b.baseRevision<0||!Number.isInteger(b.formatVersion)||b.formatVersion<1||!plain(b.document))fail('bad_request');
 const text=JSON.stringify(b.document),size=encoder.encode(text).byteLength;
 if(size>walletMaxBytes(env))fail('too_large');
 const next=b.baseRevision+1;
 const r=b.baseRevision===0
  ?await run(env.DB,'INSERT OR IGNORE INTO wallets (user_id, revision, document, format_version, size, updated_at) VALUES (?, ?, ?, ?, ?, ?)',userId,next,text,b.formatVersion,size,now)
  :await run(env.DB,'UPDATE wallets SET revision = ?, document = ?, format_version = ?, size = ?, updated_at = ? WHERE user_id = ? AND revision = ?',next,text,b.formatVersion,size,now,userId,b.baseRevision);
 if(!changes(r)){
  const cur=await one(env.DB,'SELECT revision FROM wallets WHERE user_id = ?',userId);
  fail('stale_revision',{revision:cur?.revision??0});
 }
 return {status:200,body:{revision:next,size}};
}

/** DELETE /v2/account {password}: removes every row of the user in every table. */
export async function deleteAccount({env,body:b,token,now:ms}){
 const now=sec(ms),{userId}=await session(env,token,now);
 body(b,['password']);
 if(typeof b.password!=='string'||b.password.length>PASSWORD_MAX)fail('bad_request');
 const user=await userById(env,userId);
 if(!(await passwordMatches(user,b.password)))fail('invalid_credentials');
 const st=(sql,...args)=>env.DB.prepare(sql).bind(...args);
 await env.DB.batch([
  st('DELETE FROM wallets WHERE user_id = ?',userId),
  st('DELETE FROM sessions WHERE user_id = ?',userId),
  st('DELETE FROM email_codes WHERE user_id = ?',userId),
  st('DELETE FROM email_codes WHERE email = ?',user.email),
  st('DELETE FROM auth_limits WHERE key = ?',await limitKey(env,'signin',user.email)),
  st('DELETE FROM auth_limits WHERE key = ?',await limitKey(env,'send',user.email)),
  st('DELETE FROM users WHERE id = ?',userId),
 ]);
 return {status:200,body:{status:'deleted'}};
}

