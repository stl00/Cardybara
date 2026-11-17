// Gateway accounts (stl00/Cardybara#412): sign up and verify, sign in, wrong password, lockout, password reset revoking
// old sessions, code expiry and reuse, the wallet revision check (409), the document size cap, account deletion leaving
// 0 rows in every table, and log lines free of credentials and wallet content. D1 and Email Sending are the in-memory
// stand-ins of gateway/src/local.mjs, with the real migration file applied. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {ROUTES,ROUTE_TABLE} from '../gateway/src/gateway.js';
import {TABLES,CODE_TTL_SECONDS,SIGNIN_MAX_FAILURES,LOCK_SECONDS,CODE_SENDS_PER_HOUR,CODE_MAX_ATTEMPTS,hashPassword} from '../gateway/src/accounts.js';

const ORIGIN='https://app.cardybara.test';
const MIGRATION=readFileSync(new URL('../gateway/migrations/0001_accounts.sql',import.meta.url),'utf8');
const EMAIL='synthetic.user@example.test',OTHER='other.user@example.test';
const PASSWORD='synthetic-pass-0001',NEW_PASSWORD='synthetic-pass-0002';
const T0=Date.parse('2026-11-16T12:00:00Z');

async function setup({vars={}}={}){
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail(),logs=[];let clock=T0;
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>',...vars},bindings:{DB:db,EMAIL:mail},log:l=>logs.push(l),now:()=>clock});
 const call=(method,path,body,token)=>g.handle(new Request('https://gateway.test'+path,{method,headers:{Origin:ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
 const lastCode=to=>{const m=[...mail.sent].reverse().find(x=>x.to===to);return /\b(\d{6})\b/.exec(m?.text||'')?.[1]??null;};
 const advance=seconds=>{clock+=seconds*1000;};
 return {g,db,mail,logs,call,lastCode,advance};
}
const json=async r=>({status:r.status,body:await r.json()});
const codeOf=async r=>(await r.json()).error?.code;
async function account(t,email=EMAIL,password=PASSWORD){
 assert.equal((await t.call('POST',ROUTES.signUp,{email,password})).status,202);
 const r=await json(await t.call('POST',ROUTES.verify,{email,code:t.lastCode(email)}));
 assert.equal(r.status,200);
 return r.body.token;
}
const rowsFor=(db,userId,email)=>Object.fromEntries(TABLES.map(name=>[name,db.tables.get(name).filter(r=>
 Object.values(r).some(v=>v===userId||v===email)).length]));

test('the migration creates exactly the tables accounts.js knows',async()=>{
 const db=memoryD1();await db.exec(MIGRATION);
 assert.deepEqual([...db.tables.keys()].sort(),[...TABLES].sort());
});

test('sign up mails a 6-digit code; verify marks the email verified and returns a session',async()=>{
 const t=await setup();
 const r=await json(await t.call('POST',ROUTES.signUp,{email:'  Synthetic.User@Example.TEST ',password:PASSWORD}));
 assert.deepEqual(r,{status:202,body:{status:'code_sent'}});
 assert.equal(t.mail.sent.length,1);
 assert.equal(t.mail.sent[0].to,EMAIL,'the email is normalised');
 assert.match(t.mail.sent[0].from,/no-reply@/);
 const code=t.lastCode(EMAIL);assert.match(code,/^\d{6}$/);
 // Stored: a hash, never the code or the password.
 const user=t.db.tables.get('users')[0];
 assert.equal(user.verified,0);
 assert.notEqual(user.password_hash,PASSWORD);assert.equal(user.password_hash.length,64);
 assert.ok(!JSON.stringify([...t.db.tables.values()]).includes(code),'the code is stored only as a hash');
 // Not verified yet: sign-in with the right password says so.
 assert.equal(await codeOf(await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD})),'email_unverified');
 const v=await json(await t.call('POST',ROUTES.verify,{email:EMAIL,code}));
 assert.equal(v.status,200);assert.match(v.body.token,/^cbs_[A-Za-z0-9_-]{43}$/);
 assert.equal(v.body.expiresAt,Math.floor(T0/1000)+30*86400);
 assert.equal(t.db.tables.get('users')[0].verified,1);
 assert.ok(!JSON.stringify(t.db.tables.get('sessions')).includes(v.body.token),'only the token hash is stored');
 // The session works.
 assert.equal((await t.call('GET',ROUTES.wallet,undefined,v.body.token)).status,200);
});

test('a short password is refused; a second sign-up of a verified email changes nothing and mails a notice',async()=>{
 const t=await setup();
 assert.equal(await codeOf(await t.call('POST',ROUTES.signUp,{email:EMAIL,password:'short-pw1'})),'weak_password');
 assert.equal(await codeOf(await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD,extra:1})),'bad_request');
 assert.equal(await codeOf(await t.call('POST',ROUTES.signUp,{email:'not-an-email',password:PASSWORD})),'bad_request');
 await account(t);
 const hash=t.db.tables.get('users')[0].password_hash;
 const r=await json(await t.call('POST',ROUTES.signUp,{email:EMAIL,password:'attacker-pass-0001'}));
 assert.deepEqual(r,{status:202,body:{status:'code_sent'}},'same answer as a new email');
 assert.equal(t.db.tables.get('users')[0].password_hash,hash);
 assert.equal(t.lastCode(EMAIL),null,'the notice carries no code');
 assert.equal(t.db.tables.get('email_codes').length,0);
});

test('sign in, sign out; a wrong password and an unknown email get the same answer',async()=>{
 const t=await setup();await account(t);
 const ok=await json(await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD}));
 assert.equal(ok.status,200);assert.match(ok.body.token,/^cbs_/);
 const wrong=await json(await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-pass-0001'}));
 const unknown=await json(await t.call('POST',ROUTES.session,{email:'nobody@example.test',password:'wrong-pass-0001'}));
 assert.deepEqual(wrong,{status:401,body:{error:{code:'invalid_credentials'}}});
 assert.deepEqual(unknown,wrong);
 assert.equal((await t.call('DELETE',ROUTES.session,undefined,ok.body.token)).status,200);
 assert.equal(await codeOf(await t.call('GET',ROUTES.wallet,undefined,ok.body.token)),'unauthorized');
 assert.equal(await codeOf(await t.call('GET',ROUTES.wallet)),'unauthorized');
 assert.equal(await codeOf(await t.call('GET',ROUTES.wallet,undefined,'cbs_'+'A'.repeat(43))),'unauthorized');
});

test('repeated failures lock the email, even for the right password, until the lock ends',async()=>{
 const t=await setup();await account(t);
 for(let i=0;i<SIGNIN_MAX_FAILURES;i++)assert.equal(await codeOf(await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-pass-000'+i})),'invalid_credentials');
 const locked=await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD});
 assert.equal(locked.status,429);
 assert.equal(locked.headers.get('Retry-After'),String(LOCK_SECONDS));
 assert.equal((await locked.json()).error.code,'account_locked');
 // An email with no account locks the same way, so a lock reveals nothing.
 for(let i=0;i<SIGNIN_MAX_FAILURES;i++)await t.call('POST',ROUTES.session,{email:'nobody@example.test',password:'wrong-pass-0001'});
 assert.equal(await codeOf(await t.call('POST',ROUTES.session,{email:'nobody@example.test',password:'wrong-pass-0001'})),'account_locked');
 // The limits table holds no email.
 assert.ok(!JSON.stringify(t.db.tables.get('auth_limits')).includes('example.test'));
 t.advance(LOCK_SECONDS+1);
 assert.equal((await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD})).status,200);
});

test('code sends are limited per email per hour',async()=>{
 const t=await setup();
 for(let i=0;i<CODE_SENDS_PER_HOUR;i++)assert.equal((await t.call('POST',ROUTES.forgot,{email:EMAIL})).status,202);
 const r=await t.call('POST',ROUTES.forgot,{email:EMAIL});
 assert.equal(r.status,429);assert.equal((await r.json()).error.code,'too_many_codes');
 assert.equal(t.mail.sent.length,0,'no mail for an email without an account');
 t.advance(3601);
 assert.equal((await t.call('POST',ROUTES.forgot,{email:EMAIL})).status,202);
});

test('a code expires, works once, and dies after too many wrong tries',async()=>{
 const t=await setup();
 await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD});
 const first=t.lastCode(EMAIL);
 t.advance(CODE_TTL_SECONDS+1);
 assert.equal(await codeOf(await t.call('POST',ROUTES.verify,{email:EMAIL,code:first})),'code_expired');
 // Resend: the new code works once; the reuse fails.
 await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD});
 const second=t.lastCode(EMAIL);
 assert.equal((await t.call('POST',ROUTES.verify,{email:EMAIL,code:second})).status,200);
 assert.equal(await codeOf(await t.call('POST',ROUTES.verify,{email:EMAIL,code:second})),'code_invalid');
 // Reset code: wrong tries count, and after the last one the right code no longer works.
 await t.call('POST',ROUTES.forgot,{email:EMAIL});
 const reset=t.lastCode(EMAIL),wrong=reset==='000000'?'111111':'000000';
 for(let i=0;i<CODE_MAX_ATTEMPTS;i++)assert.equal(await codeOf(await t.call('POST',ROUTES.reset,{email:EMAIL,code:wrong,password:NEW_PASSWORD})),'code_invalid');
 assert.equal(await codeOf(await t.call('POST',ROUTES.reset,{email:EMAIL,code:reset,password:NEW_PASSWORD})),'code_invalid');
 assert.equal(await codeOf(await t.call('POST',ROUTES.verify,{email:EMAIL,code:'12345'})),'code_invalid');
});

test('password reset sets the new password and revokes every old session',async()=>{
 const t=await setup();
 const a=await account(t);
 const b=(await json(await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD}))).body.token;
 assert.equal((await t.call('POST',ROUTES.forgot,{email:EMAIL})).status,202);
 assert.match(t.mail.sent.at(-1).subject,/reset/i);
 const r=await json(await t.call('POST',ROUTES.reset,{email:EMAIL,code:t.lastCode(EMAIL),password:NEW_PASSWORD}));
 assert.equal(r.status,200);
 for(const old of [a,b])assert.equal(await codeOf(await t.call('GET',ROUTES.wallet,undefined,old)),'unauthorized');
 assert.equal((await t.call('GET',ROUTES.wallet,undefined,r.body.token)).status,200);
 assert.equal(t.db.tables.get('sessions').length,1);
 assert.equal(await codeOf(await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD})),'invalid_credentials');
 assert.equal((await t.call('POST',ROUTES.session,{email:EMAIL,password:NEW_PASSWORD})).status,200);
});

test('change password keeps this session and revokes the others',async()=>{
 const t=await setup();
 const a=await account(t);
 const b=(await json(await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD}))).body.token;
 assert.equal(await codeOf(await t.call('POST',ROUTES.password,{currentPassword:'wrong-pass-0001',newPassword:NEW_PASSWORD},a)),'invalid_credentials');
 assert.equal(await codeOf(await t.call('POST',ROUTES.password,{currentPassword:PASSWORD,newPassword:NEW_PASSWORD})),'unauthorized');
 assert.equal((await t.call('POST',ROUTES.password,{currentPassword:PASSWORD,newPassword:NEW_PASSWORD},a)).status,200);
 assert.equal((await t.call('GET',ROUTES.wallet,undefined,a)).status,200);
 assert.equal(await codeOf(await t.call('GET',ROUTES.wallet,undefined,b)),'unauthorized');
 assert.equal((await t.call('POST',ROUTES.session,{email:EMAIL,password:NEW_PASSWORD})).status,200);
});

test('wallet: first write, read back, stale revision answers 409 with the current revision',async()=>{
 const t=await setup();const token=await account(t);
 assert.deepEqual((await json(await t.call('GET',ROUTES.wallet,undefined,token))).body,{revision:0,formatVersion:null,document:null,updatedAt:null});
 const doc={cards:[{id:'card-synthetic-1',product:'synthetic-product'}]};
 const w1=await json(await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:doc},token));
 assert.equal(w1.status,200);assert.equal(w1.body.revision,1);
 const got=(await json(await t.call('GET',ROUTES.wallet,undefined,token))).body;
 assert.deepEqual(got,{revision:1,formatVersion:1,document:doc,updatedAt:Math.floor(T0/1000)});
 // A second first-write and a write from revision 0 again are stale.
 const stale=await json(await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[]}},token));
 assert.deepEqual(stale,{status:409,body:{error:{code:'stale_revision',revision:1}}});
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:1,formatVersion:1,document:{cards:[]}},token)).status,200);
 const again=await json(await t.call('PUT',ROUTES.wallet,{baseRevision:1,formatVersion:1,document:doc},token));
 assert.deepEqual(again,{status:409,body:{error:{code:'stale_revision',revision:2}}});
 assert.deepEqual((await json(await t.call('GET',ROUTES.wallet,undefined,token))).body.document,{cards:[]});
 assert.equal(await codeOf(await t.call('PUT',ROUTES.wallet,{baseRevision:2,formatVersion:0,document:doc},token)),'bad_request');
 assert.equal(await codeOf(await t.call('PUT',ROUTES.wallet,{baseRevision:2,formatVersion:1,document:[1]},token)),'bad_request');
});

test('wallet: a document over the size cap is refused and nothing is stored',async()=>{
 const t=await setup({vars:{WALLET_MAX_BYTES:'2048'}});const token=await account(t);
 const big={notes:'x'.repeat(3000)};
 const r=await json(await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:big},token));
 assert.deepEqual(r,{status:413,body:{error:{code:'too_large'}}});
 // Far over the cap: the body itself is cut off while it is read.
 const huge=await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{notes:'x'.repeat(20000)}},token);
 assert.equal(huge.status,413);
 assert.equal(t.db.tables.get('wallets').length,0);
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{notes:'x'.repeat(1000)}},token)).status,200);
});

test('one user cannot read or write another user\'s wallet',async()=>{
 const t=await setup();
 const a=await account(t,EMAIL),b=await account(t,OTHER);
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{owner:'a'}},a);
 assert.equal((await json(await t.call('GET',ROUTES.wallet,undefined,b))).body.document,null);
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{owner:'b'}},b)).status,200);
 assert.deepEqual((await json(await t.call('GET',ROUTES.wallet,undefined,a))).body.document,{owner:'a'});
});

test('delete account leaves 0 rows for that user in every table and keeps the other user',async()=>{
 const t=await setup();
 const token=await account(t);const keep=await account(t,OTHER);
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[]}},token);
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[]}},keep);
 await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-pass-0001'});// an auth_limits row
 await t.call('POST',ROUTES.forgot,{email:EMAIL});// an email_codes row and a send counter
 const userId=t.db.tables.get('users').find(u=>u.email===EMAIL).id;
 const before=t.db.tables.get('auth_limits').length;assert.ok(before>=2);
 assert.equal(await codeOf(await t.call('DELETE',ROUTES.account,{password:'wrong-pass-0001'},token)),'invalid_credentials');
 const r=await json(await t.call('DELETE',ROUTES.account,{password:PASSWORD},token));
 assert.deepEqual(r,{status:200,body:{status:'deleted'}});
 assert.deepEqual(rowsFor(t.db,userId,EMAIL),Object.fromEntries(TABLES.map(n=>[n,0])));
 // The limit rows are keyed by an HMAC of the email: all of this user's are gone, the other user's are kept.
 assert.equal(t.db.tables.get('auth_limits').length,before-2);
 assert.equal(t.db.tables.get('users').length,1);assert.equal(t.db.tables.get('wallets').length,1);
 assert.equal(await codeOf(await t.call('GET',ROUTES.wallet,undefined,token)),'unauthorized');
 assert.equal((await t.call('GET',ROUTES.wallet,undefined,keep)).status,200);
 // The email can sign up again from scratch.
 assert.equal((await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD})).status,202);
});

test('log lines carry no email, password, code, token or wallet content',async()=>{
 const t=await setup();
 const token=await account(t);
 const code=t.mail.sent.map(m=>/\d{6}/.exec(m.text)?.[0]).find(Boolean);
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{note:'synthetic-wallet-marker'}},token);
 await t.call('GET',ROUTES.wallet,undefined,token);
 await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-pass-0001'});
 const text=t.logs.join('\n');
 for(const secret of [EMAIL,'synthetic.user',PASSWORD,'wrong-pass-0001',code,token,'synthetic-wallet-marker'])assert.ok(!text.includes(secret),'log contains '+secret);
 const routes=t.logs.map(l=>JSON.parse(l).route);
 assert.ok(routes.includes('account_wallet')&&routes.includes('account_session'));
 for(const l of t.logs)for(const k of Object.keys(JSON.parse(l)))assert.ok(['at','route','status','error'].includes(k),'unexpected log field '+k);
});

test('without D1, mail or a sender the account routes answer 503 and the /v1 routes are unchanged',async()=>{
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN}});
 const r=await g.handle(new Request('https://gateway.test'+ROUTES.signUp,{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD})}));
 assert.equal(r.status,503);assert.equal((await r.json()).error.code,'account_unavailable');
 const inv=await g.handle(new Request('https://gateway.test'+ROUTES.invite,{method:'POST',headers:{Origin:ORIGIN}}));
 assert.deepEqual(await inv.json(),{status:'active'});
 for(const p of ['/v1/chat/completions','/v1/chat','/v1/invite','/v1/push','/v1/push/key'])assert.ok(ROUTE_TABLE.some(x=>x.path===p),p);
 // Production without ACCOUNT_SECRET is not configured.
 const db=memoryD1();await db.exec(MIGRATION);
 const prod=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,LOCAL_DEV:'0',CLIENT_SALT:'s'.repeat(16),ACCOUNT_EMAIL_FROM:'no-reply@mail.cardybara.test'},bindings:{DB:db,EMAIL:memoryMail()}});
 const p=await prod.handle(new Request('https://gateway.test'+ROUTES.signUp,{method:'POST',headers:{Origin:ORIGIN,'CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD})}));
 assert.equal((await p.json()).error.code,'account_unavailable');
});

test('a failed mail send is reported and the CORS preflight allows the bearer header',async()=>{
 const t=await setup();t.mail.fail=true;
 assert.equal(await codeOf(await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD})),'mail_failed');
 const pre=await t.g.handle(new Request('https://gateway.test'+ROUTES.wallet,{method:'OPTIONS',headers:{Origin:ORIGIN}}));
 assert.equal(pre.status,204);
 assert.match(pre.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 assert.equal(pre.headers.get('Access-Control-Allow-Methods'),'GET, PUT');
});

test('passwords are PBKDF2-SHA256 with a per-user salt',async()=>{
 const t=await setup();await account(t,EMAIL);await account(t,OTHER);
 const [a,b]=t.db.tables.get('users');
 assert.notEqual(a.password_salt,b.password_salt);
 assert.equal(a.password_iterations,100000);
 assert.equal(a.password_hash,await hashPassword(PASSWORD,a.password_salt,a.password_iterations));
});
