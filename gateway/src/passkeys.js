// Passkeys (WebAuthn) for account sign-in (stl00/Cardybara#461, epic #410). Handlers share accounts.js's session and
// D1 helpers and answer {status, body} or throw AccountError, so gateway.js wraps them like the other account routes.
//
// rpId is the hostname of PASSKEY_ORIGIN, the PWA's origin; a credential made there signs in only there (the extension
// signs in through the PWA, chrome.identity.launchWebAuthFlow). Challenges are 32 random bytes, stored with a purpose
// and a user, single use (deleted when read, before anything is verified) and good for 5 minutes. Attestation is not
// asked for and not checked ("none"): a passkey proves possession of a key for this site, nothing about the device.
// Keys: ES256 (-7) and RS256 (-257), stored as JWK. Stored per passkey: id, user, name, key, algorithm, signature counter.
import {AccountError,session,one,run,newSession,userById,b64u,randomBytes,sec} from './accounts.js';

const fail=(code,extra)=>{throw new AccountError(code,extra);};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const encoder=new TextEncoder();
export const CHALLENGE_TTL_SECONDS=5*60;
export const PASSKEYS_MAX=10;
const NAME_MAX=60;

const fromB64u=s=>{
 if(typeof s!=='string'||!/^[A-Za-z0-9_-]*$/.test(s))fail('passkey_invalid');
 const b=atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'='));
 return Uint8Array.from(b,c=>c.charCodeAt(0));
};
const sha256=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const equalBytes=(a,b)=>{if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;};

/** The relying party: {origin, rpId}, or null when PASSKEY_ORIGIN is not set to an https origin (http://localhost only for a local run). */
export function relyingParty(env){
 const v=env.PASSKEY_ORIGIN;
 if(typeof v!=='string')return null;
 let u;try{u=new URL(v);}catch{return null;}
 const local=env.LOCAL_DEV==='1'&&u.protocol==='http:'&&(u.hostname==='localhost'||u.hostname==='127.0.0.1');
 if((u.protocol!=='https:'&&!local)||u.origin!==v||!u.hostname)return null;
 return {origin:u.origin,rpId:u.hostname};
}
function rp(env){const r=relyingParty(env);if(!r)fail('passkey_unavailable');return r;}

// --- A small CBOR reader: unsigned and negative integers, byte and text strings, arrays and maps (definite lengths).
function cbor(bytes,start=0){
 let i=start;
 const read=()=>{
  if(i>=bytes.length)fail('passkey_invalid');
  const major=bytes[i]>>5,info=bytes[i]&31;i++;
  let n;
  if(info<24)n=info;
  else if(info===24){n=bytes[i];i+=1;}
  else if(info===25){n=(bytes[i]<<8)|bytes[i+1];i+=2;}
  else if(info===26){n=((bytes[i]*2**24)+(bytes[i+1]<<16)+(bytes[i+2]<<8)+bytes[i+3]);i+=4;}
  else fail('passkey_invalid');
  if(!Number.isFinite(n))fail('passkey_invalid');
  switch(major){
   case 0:return n;
   case 1:return -1-n;
   case 2:case 3:{if(i+n>bytes.length)fail('passkey_invalid');const v=bytes.slice(i,i+n);i+=n;return major===2?v:new TextDecoder().decode(v);}
   case 4:{if(n>64)fail('passkey_invalid');const a=[];for(let k=0;k<n;k++)a.push(read());return a;}
   case 5:{if(n>64)fail('passkey_invalid');const m=new Map();for(let k=0;k<n;k++){const key=read();m.set(key,read());}return m;}
   default:fail('passkey_invalid');
  }
 };
 const value=read();
 return {value,end:i};
}

// --- Public keys.
function coseToKey(cose){
 if(!(cose instanceof Map))fail('passkey_invalid');
 const kty=cose.get(1),alg=cose.get(3);
 if(kty===2&&alg===-7&&cose.get(-1)===1&&cose.get(-2) instanceof Uint8Array&&cose.get(-3) instanceof Uint8Array){
  return {alg:-7,jwk:{kty:'EC',crv:'P-256',x:b64u(cose.get(-2)),y:b64u(cose.get(-3))}};
 }
 if(kty===3&&alg===-257&&cose.get(-1) instanceof Uint8Array&&cose.get(-2) instanceof Uint8Array){
  return {alg:-257,jwk:{kty:'RSA',n:b64u(cose.get(-1)),e:b64u(cose.get(-2))}};
 }
 return fail('passkey_invalid');
}
// WebAuthn's ES256 signature is ASN.1 DER; WebCrypto wants r||s.
function derToRaw(der){
 let i=0;
 if(der[i++]!==0x30)fail('passkey_invalid');
 let len=der[i++];if(len&0x80){const n=len&0x7f;if(n<1||n>2)fail('passkey_invalid');len=0;for(let k=0;k<n;k++)len=(len<<8)|der[i++];}
 if(i+len!==der.length)fail('passkey_invalid');
 const out=new Uint8Array(64);
 for(let part=0;part<2;part++){
  if(der[i++]!==0x02)fail('passkey_invalid');
  let l=der[i++];if(!(l>0)||i+l>der.length)fail('passkey_invalid');
  let v=der.slice(i,i+l);i+=l;
  while(v.length>32&&v[0]===0)v=v.slice(1);
  if(v.length>32)fail('passkey_invalid');
  out.set(v,part*32+32-v.length);
 }
 return out;
}
async function signatureValid(key,signed,signature){
 try{
  if(key.alg===-7){
   const k=await crypto.subtle.importKey('jwk',key.jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
   return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},k,derToRaw(signature),signed);
  }
  const k=await crypto.subtle.importKey('jwk',{...key.jwk,alg:'RS256'},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',k,signature,signed);
 }catch(e){if(e instanceof AccountError)throw e;return false;}
}

// --- Challenges.
async function newChallenge(env,purpose,userId,now){
 await run(env.DB,'DELETE FROM passkey_challenges WHERE expires_at <= ?',now);
 const id='pc_'+b64u(randomBytes(16)),challenge=b64u(randomBytes(32));
 await run(env.DB,'INSERT INTO passkey_challenges (id, purpose, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',id,purpose,userId,challenge,now+CHALLENGE_TTL_SECONDS);
 return {id,challenge};
}
/** One use: the row is deleted before anything else is checked, so a replay, a retry and a wrong answer all need a new challenge. */
async function takeChallenge(env,id,purpose,userId,now){
 if(typeof id!=='string'||id.length>64)fail('challenge_expired');
 const row=await one(env.DB,'SELECT purpose, user_id, challenge, expires_at FROM passkey_challenges WHERE id = ?',id);
 if(!row)fail('challenge_expired');
 await run(env.DB,'DELETE FROM passkey_challenges WHERE id = ?',id);
 if(row.expires_at<=now)fail('challenge_expired');
 if(row.purpose!==purpose||row.user_id!==userId)fail('passkey_invalid');
 return row.challenge;
}

// --- Checks shared by both ceremonies.
function clientData(response,type,challenge,origin){
 const raw=fromB64u(response?.clientDataJSON);
 let d;try{d=JSON.parse(new TextDecoder().decode(raw));}catch{fail('passkey_invalid');}
 if(!plain(d)||d.type!==type||d.challenge!==challenge||d.origin!==origin||d.crossOrigin===true)fail('passkey_invalid');
 return raw;
}
async function checkAuthData(auth,rpId){
 if(auth.length<37||!equalBytes(auth.slice(0,32),await sha256(encoder.encode(rpId)))||!(auth[32]&0x01))fail('passkey_invalid');
 return {flags:auth[32],count:((auth[33]*2**24)+(auth[34]<<16)+(auth[35]<<8)+auth[36])};
}
const credentialShape=(c,keys)=>{if(!plain(c)||c.type!=='public-key'||typeof c.id!=='string'||c.id.length>1024||!plain(c.response))fail('passkey_invalid');};

/** GET /v2/account/passkey/status: {enabled}. The PWA hides its passkey controls until this says true. */
export async function status({env}){return {status:200,body:{enabled:!!relyingParty(env)}};}

/** POST /v2/account/passkey/register/options (bearer) {}: a challenge and creation options for this user. */
export async function registerOptions({env,body:b,token,now:ms,audit}){
 const {origin,rpId}=rp(env),now=sec(ms),{userId}=await session(env,token,now,audit);
 if(!exact(b,[]))fail('bad_request');
 const user=await userById(env,userId);
 const existing=(await env.DB.prepare('SELECT id FROM passkeys WHERE user_id = ?').bind(userId).all()).results;
 if(existing.length>=PASSKEYS_MAX)fail('bad_request');
 const c=await newChallenge(env,'register',userId,now);
 return {status:200,body:{challengeId:c.id,publicKey:{
  challenge:c.challenge,rp:{id:rpId,name:'Cardybara'},
  user:{id:b64u(encoder.encode(userId)),name:user.email,displayName:user.email},
  pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
  timeout:300000,attestation:'none',
  authenticatorSelection:{residentKey:'required',requireResidentKey:true,userVerification:'preferred'},
  excludeCredentials:existing.map(r=>({type:'public-key',id:r.id}))}}};
}

/** POST /v2/account/passkey/register/verify (bearer) {challengeId, credential, name}: stores the new passkey. */
export async function registerVerify({env,body:b,token,now:ms,audit}){
 const {origin,rpId}=rp(env),now=sec(ms),{userId}=await session(env,token,now,audit);
 if(!exact(b,['challengeId','credential','name'])||typeof b.name!=='string')fail('bad_request');
 const name=[...b.name.trim()].slice(0,NAME_MAX).join('')||'Passkey';
 const challenge=await takeChallenge(env,b.challengeId,'register',userId,now);
 const cred=b.credential;credentialShape(cred);
 clientData(cred.response,'webauthn.create',challenge,origin);
 const att=cbor(fromB64u(cred.response.attestationObject)).value;
 const authData=att instanceof Map?att.get('authData'):null;
 if(!(authData instanceof Uint8Array))fail('passkey_invalid');
 const {flags}=await checkAuthData(authData,rpId);
 if(!(flags&0x40)||authData.length<55)fail('passkey_invalid');
 const idLen=(authData[53]<<8)|authData[54];
 if(idLen<1||idLen>1023||55+idLen>authData.length)fail('passkey_invalid');
 const credId=b64u(authData.slice(55,55+idLen));
 if(credId!==cred.id||(cred.rawId!==undefined&&cred.rawId!==credId))fail('passkey_invalid');
 const key=coseToKey(cbor(authData,55+idLen).value);
 if((await env.DB.prepare('SELECT id FROM passkeys WHERE user_id = ?').bind(userId).all()).results.length>=PASSKEYS_MAX)fail('bad_request');
 // A credential id is one passkey for one account: registering it again is refused, whoever holds it.
 if(await one(env.DB,'SELECT id FROM passkeys WHERE id = ?',credId))fail('passkey_invalid');
 await run(env.DB,'INSERT INTO passkeys (id, user_id, name, public_key, alg, sign_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',credId,userId,name,JSON.stringify(key.jwk),key.alg,0,now);
 return {status:200,body:{id:credId}};
}

/** GET /v2/account/passkey (bearer): the user's passkeys, id and name only. */
export async function list({env,token,now:ms,audit}){
 const {userId}=await session(env,token,sec(ms),audit);
 const rows=(await env.DB.prepare('SELECT id, name, created_at FROM passkeys WHERE user_id = ?').bind(userId).all()).results;
 return {status:200,body:{passkeys:rows.sort((a,b)=>a.created_at-b.created_at).map(r=>({id:r.id,name:r.name}))}};
}

/** DELETE /v2/account/passkey/:id (bearer): removes one of the user's own passkeys; another user's id is the same as no such id. */
export async function remove({env,token,now:ms,audit,params}){
 const {userId}=await session(env,token,sec(ms),audit);
 const r=await run(env.DB,'DELETE FROM passkeys WHERE id = ? AND user_id = ?',String(params?.id||''),userId);
 if(!(r?.meta?.changes>0))fail('not_found');
 return {status:200,body:{status:'removed'}};
}

/** POST /v2/account/passkey/login/options {}: a challenge for a discoverable credential (no email asked). */
export async function loginOptions({env,body:b,now:ms}){
 const {rpId}=rp(env);
 if(!exact(b,[]))fail('bad_request');
 const c=await newChallenge(env,'login','',sec(ms));
 return {status:200,body:{challengeId:c.id,publicKey:{challenge:c.challenge,rpId,timeout:300000,userVerification:'preferred',allowCredentials:[]}}};
}

/** POST /v2/account/passkey/login/verify {challengeId, credential}: a session for the passkey's user. */
export async function loginVerify({env,body:b,now:ms}){
 const {origin,rpId}=rp(env),now=sec(ms);
 if(!exact(b,['challengeId','credential']))fail('bad_request');
 const challenge=await takeChallenge(env,b.challengeId,'login','',now);
 const cred=b.credential;credentialShape(cred);
 const row=await one(env.DB,'SELECT id, user_id, public_key, alg, sign_count FROM passkeys WHERE id = ?',cred.id);
 if(!row)fail('passkey_invalid');
 const raw=clientData(cred.response,'webauthn.get',challenge,origin);
 const auth=fromB64u(cred.response.authenticatorData);
 const {count}=await checkAuthData(auth,rpId);
 if(cred.response.userHandle!==undefined&&cred.response.userHandle!==null&&cred.response.userHandle!==''&&cred.response.userHandle!==b64u(encoder.encode(row.user_id)))fail('passkey_invalid');
 const signed=new Uint8Array(auth.length+32);signed.set(auth);signed.set(await sha256(raw),auth.length);
 if(!(await signatureValid({alg:row.alg,jwk:JSON.parse(row.public_key)},signed,fromB64u(cred.response.signature))))fail('passkey_invalid');
 // A counter that does not go up means a cloned authenticator; authenticators that keep none always send 0.
 if((count!==0||row.sign_count!==0)&&count<=row.sign_count)fail('passkey_invalid');
 const user=await userById(env,row.user_id);
 if(!user||!user.verified)fail('passkey_invalid');
 await run(env.DB,'UPDATE passkeys SET sign_count = ? WHERE id = ?',count,row.id);
 return {status:200,body:{...(await newSession(env,user.id,now)),email:user.email}};
}
