// Gateway accounts (stl00/Cardybara#412): sign up and verify, sign in, wrong password, lockout, password reset revoking
// old sessions, code expiry and reuse, the wallet revision check (409), the document size cap, account deletion leaving
// 0 rows in every table, and log lines free of credentials and wallet content. D1 and Email Sending are the in-memory
// stand-ins of gateway/src/local.mjs, with the real migration file applied. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {ROUTES,ROUTE_TABLE} from '../gateway/src/gateway.js';
import {readWalletDocument,migrateWalletDocument} from '../src/walletDocument.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {cardProducts} from '../src/productCatalog.js';
import {validWalletDocument} from '../gateway/src/walletSchema.js';
import {TABLES,CODE_TTL_SECONDS,SIGNIN_MAX_FAILURES,LOCK_SECONDS,CODE_SENDS_PER_HOUR,CODE_MAX_ATTEMPTS,hashPassword} from '../gateway/src/accounts.js';

const ORIGIN='https://app.cardybara.test';
const MIGRATION=['0001_accounts','0002_passkeys','0003_plaid'].map(f=>readFileSync(new URL(`../gateway/migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
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
 const big={cards:[1,2,3].map(()=>'x'.repeat(1000))};
 const r=await json(await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:big},token));
 assert.deepEqual(r,{status:413,body:{error:{code:'too_large'}}});
 // Far over the cap: the body itself is cut off while it is read.
 const huge=await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:['x'.repeat(20000)]}},token);
 assert.equal(huge.status,413);
 assert.equal(t.db.tables.get('wallets').length,0);
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:['x'.repeat(1000)]}},token)).status,200);
});

test('one user cannot read or write another user\'s wallet',async()=>{
 const t=await setup();
 const a=await account(t,EMAIL),b=await account(t,OTHER);
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{favorites:['a']}},a);
 assert.equal((await json(await t.call('GET',ROUTES.wallet,undefined,b))).body.document,null);
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{favorites:['b']}},b)).status,200);
 assert.deepEqual((await json(await t.call('GET',ROUTES.wallet,undefined,a))).body.document,{favorites:['a']});
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
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[{note:'synthetic-wallet-marker'}]}},token);
 await t.call('GET',ROUTES.wallet,undefined,token);
 await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-pass-0001'});
 const text=t.logs.join('\n');
 for(const secret of [EMAIL,'synthetic.user',PASSWORD,'wrong-pass-0001',code,token,'synthetic-wallet-marker'])assert.ok(!text.includes(secret),'log contains '+secret);
 const routes=t.logs.map(l=>JSON.parse(l).route);
 assert.ok(routes.includes('account_wallet')&&routes.includes('account_session'));
 for(const l of t.logs)for(const k of Object.keys(JSON.parse(l)))assert.ok(['at','route','status','error','user','size'].includes(k),'unexpected log field '+k);
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

// --- #413: per-user access, schema, export, delete, logs.
const DOC={cards:[{id:'card-synthetic-1',product:'synthetic-product',nickname:'synthetic-nick-A'}],favorites:['card-synthetic-1'],pointValues:{synthetic:1.5}};
const put=(t,doc,token,base=0)=>t.call('PUT',ROUTES.wallet,{baseRevision:base,formatVersion:1,document:doc},token);

test('no account route takes a user id from the client',async()=>{
 const t=await setup();
 const a=await account(t,EMAIL),b=await account(t,OTHER);
 const idB=t.db.tables.get('users').find(u=>u.email===OTHER).id;
 await put(t,{favorites:['b-only']},b);
 // A user id in the body, the path or the query string changes nothing: the session decides.
 assert.equal(await codeOf(await put(t,{favorites:['x']},a)),undefined);
 assert.equal(await codeOf(await t.call('PUT',ROUTES.wallet,{baseRevision:1,formatVersion:1,document:{},userId:idB},a)),'bad_request');
 assert.equal(await codeOf(await t.call('DELETE',ROUTES.account,{password:PASSWORD,userId:idB},a)),'bad_request');
 const viaQuery=await json(await t.call('GET',ROUTES.wallet+'?user='+idB+'&userId='+idB,undefined,a));
 assert.deepEqual(viaQuery.body.document,{favorites:['x']});
 assert.ok(!JSON.stringify(viaQuery).includes('b-only'));
 assert.equal(await codeOf(await t.call('GET',ROUTES.wallet+'/'+idB,undefined,a)),'not_found');
});

test('user A\'s session cannot read, overwrite or delete user B\'s blob',async()=>{
 const t=await setup();
 const a=await account(t,EMAIL),b=await account(t,OTHER);
 const idA=t.db.tables.get('users').find(u=>u.email===EMAIL).id,idB=t.db.tables.get('users').find(u=>u.email===OTHER).id;
 assert.equal((await put(t,{favorites:['b-secret']},b)).status,200);
 // Read: A sees only A's (empty) wallet, and export shows nothing of B's.
 assert.equal((await json(await t.call('GET',ROUTES.wallet,undefined,a))).body.document,null);
 assert.ok(!JSON.stringify((await json(await t.call('GET',ROUTES.export,undefined,a))).body).includes('b-secret'));
 // Overwrite: A writing at B's revision creates or changes A's row only.
 assert.equal((await put(t,{favorites:['a-doc']},a,1)).status,409);
 assert.equal((await put(t,{favorites:['a-doc']},a)).status,200);
 const rows=t.db.tables.get('wallets');
 assert.equal(rows.find(r=>r.user_id===idB).document,JSON.stringify({favorites:['b-secret']}));
 assert.equal(rows.find(r=>r.user_id===idA).document,JSON.stringify({favorites:['a-doc']}));
 // Delete: A deleting the account leaves B's blob, sessions and user row.
 assert.equal((await t.call('DELETE',ROUTES.account,{password:PASSWORD},a)).status,200);
 assert.deepEqual(rowsFor(t.db,idB,OTHER),{users:1,email_codes:0,sessions:1,wallets:1,auth_limits:0,passkeys:0,passkey_challenges:0,plaid_items:0,plaid_transactions:0,plaid_link_sessions:0});
 assert.deepEqual((await json(await t.call('GET',ROUTES.wallet,undefined,b))).body.document,{favorites:['b-secret']});
});

test('a document with a field outside the schema is refused and nothing is stored',async()=>{
 const t=await setup();const token=await account(t);
 const bad=[
  {...DOC,pageEvidence:'synthetic'},{...DOC,rawBankText:'synthetic'},{...DOC,extra:1},
  {cards:[{id:'c',evidence:{html:'<p>x</p>'}}]},{cards:[{nested:{deep:{rawText:'x'}}}]},
  {cards:{a:1}},{favorites:'x'},{cards:['x'.repeat(4001)]}
 ];
 for(const doc of bad){
  const r=await json(await put(t,doc,token));
  assert.deepEqual(r,{status:422,body:{error:{code:'invalid_document'}}},JSON.stringify(doc).slice(0,60));
 }
 assert.equal(t.db.tables.get('wallets').length,0);
 assert.equal((await put(t,DOC,token)).status,200);
 assert.equal(validWalletDocument({}),true);assert.equal(validWalletDocument(null),false);assert.equal(validWalletDocument([]),false);
});

test('export returns the stored document and everything else held for the user',async()=>{
 const t=await setup();const token=await account(t);const other=await account(t,OTHER);
 assert.equal(await codeOf(await t.call('GET',ROUTES.export)),'unauthorized');
 const empty=await json(await t.call('GET',ROUTES.export,undefined,token));
 assert.equal(empty.status,200);assert.equal(empty.body.wallet,null);
 await put(t,DOC,token);await put(t,{favorites:['b']},other);
 await t.call('POST',ROUTES.forgot,{email:EMAIL});
 const r=await json(await t.call('GET',ROUTES.export,undefined,token));
 assert.equal(r.status,200);
 assert.deepEqual(r.body.wallet,{revision:1,formatVersion:1,document:DOC,updatedAt:Math.floor(T0/1000)});
 assert.equal(r.body.account.email,EMAIL);assert.equal(r.body.account.verified,true);
 assert.equal(r.body.sessions.length,1);assert.equal(r.body.pendingEmailCodes.length,1);
 const text=JSON.stringify(r.body);
 assert.ok(!text.includes(OTHER)&&!text.includes('"b"'),'nothing of another user');
 assert.ok(!text.includes(t.db.tables.get('users')[0].password_hash),'the hash itself is not exported');
});

test('delete leaves 0 rows in every table, sessions and credentials included',async()=>{
 const t=await setup();const token=await account(t);
 await put(t,DOC,token);
 await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD});// a second session
 await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-pass-0001'});
 await t.call('POST',ROUTES.forgot,{email:EMAIL});
 assert.equal((await t.call('DELETE',ROUTES.account,{password:PASSWORD},token)).status,200);
 for(const name of TABLES)assert.equal(t.db.tables.get(name).length,0,name+' still has rows');
});

test('log lines carry route, status, a user hash and the blob size, and no wallet field value',async()=>{
 const t=await setup();const token=await account(t);
 const doc={cards:[{id:'card-synthetic-77',nickname:'synthetic-nickname-77',lastFour:'synthetic-4242'}],cardEdits:{x:{note:'synthetic-edit-88'}},
  productChoices:{p:'synthetic-product-99'},paymentStates:{a:'synthetic-paid-11'},pointValues:{mr:'synthetic-cpp-22'},
  reminders:{note:'synthetic-remind-33'},favorites:['synthetic-fav-44'],benefitEvents:[{note:'synthetic-benefit-55'}],costEvents:[{note:'synthetic-cost-66'}]};
 assert.equal((await put(t,doc,token)).status,200);
 await put(t,doc,token);// stale
 await put(t,{...doc,pageEvidence:'synthetic-evidence-00'},token,1);// refused
 await t.call('GET',ROUTES.wallet,undefined,token);
 await t.call('GET',ROUTES.export,undefined,token);
 await t.call('DELETE',ROUTES.account,{password:PASSWORD},token);
 const text=t.logs.join('\n');
 const values=[];const walk=v=>{if(typeof v==='string')values.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};
 walk(doc);values.push('synthetic-evidence-00');
 assert.ok(values.length>=10);
 for(const v of values)assert.ok(!text.includes(v),'log contains '+v);
 const idHash=t.logs.map(l=>JSON.parse(l)).filter(l=>l.route.startsWith('account')&&l.user);
 assert.ok(idHash.length>=5);
 for(const l of idHash)assert.match(l.user,/^[0-9a-f]{16}$/);
 assert.equal(new Set(idHash.map(l=>l.user)).size,1,'one user, one hash');
 const wlog=t.logs.map(l=>JSON.parse(l)).find(l=>l.route==='account_wallet'&&l.size);
 assert.equal(wlog.size,new TextEncoder().encode(JSON.stringify(doc)).byteLength);
});

// #449: the document the app itself writes (readWalletDocument, synthetic wallets) must be accepted.
const memStorage=(init={})=>{const m=new Map(Object.entries(init));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),keys:()=>[...m.keys()]};};
const appDocument=async(snapshot)=>{
 const product=cardProducts[0];
 const storage=memStorage({'cardybara-favorites':JSON.stringify(['manual-1'])});
 const doc=await readWalletDocument({storage,snapshot,readBenefitEvents:async()=>[],readCostEvents:async()=>[]});
 doc.walletCards={cards:[newWalletCard({bank:product.bank,name:'Synthetic Manual',tail:'0000'},'manual-1')],removed:[]};
 return doc;
};
test('a #411 wallet document from readWalletDocument passes the schema and PUT returns 200',async()=>{
 const t=await setup();const token=await account(t);
 const rows={cards:[{id:'snap-1',name:'Synthetic Snapshot Card'}],rewards:[],transactions:[],offers:[],benefits:[],connections:[],extraRows:[{id:'x'}]};
 for(const snapshot of [undefined,rows]){
  const doc=await appDocument(snapshot);
  assert.equal(validWalletDocument(doc),true);
  assert.equal(validWalletDocument(migrateWalletDocument({formatVersion:1})),true);
  assert.equal(validWalletDocument(migrateWalletDocument({})),true);
  const r=await t.call('PUT',ROUTES.wallet,{baseRevision:snapshot?1:0,formatVersion:1,document:doc},token);
  assert.equal(r.status,200);
 }
});
test('a #411 document with evidence or rawText at any depth, or a bad section type, is still refused',async()=>{
 const base=await appDocument(undefined);
 assert.equal(validWalletDocument({...base,rawText:{a:1}}),false);
 assert.equal(validWalletDocument({...base,walletCards:{...base.walletCards,cards:[{evidence:'x'}]}}),false);
 assert.equal(validWalletDocument({...base,costLedger:{schema:1,events:[{a:{b:{rawText:'x'}}}]}}),false);
 assert.equal(validWalletDocument({...base,favorites:{}}),false);
 assert.equal(validWalletDocument({...base,reminderSettings:[]}),false);
 assert.equal(validWalletDocument({...base,formatVersion:'1'}),false);
 assert.equal(validWalletDocument({...base,cards:{}}),false);
 assert.equal(validWalletDocument({...base,extraScalar:1}),false);
});

test('the per-client rate limiter runs on every /v2/account route before D1 or Email Sending is touched',async()=>{
 const t=await setup();const token=await account(t);
 const sent=t.mail.sent.length,users=t.db.tables.get('users').length,keys=[];
 let allow=false;t.g.env.RATE_LIMITER={limit:async({key})=>{keys.push(key);return {success:allow};}};
 const accountRoutes=ROUTE_TABLE.filter(r=>r.path.startsWith('/v2/account')&&!r.public&&!r.param);
 assert.ok(accountRoutes.length>=10,'every account route is listed');
 for(const r of accountRoutes){
  const body=r.method==='GET'||r.method==='DELETE'&&r.path!==ROUTES.account?undefined:{email:OTHER,password:PASSWORD};
  const res=await t.call(r.method,r.path,body,token);
  assert.equal(res.status,429,`${r.method} ${r.path}`);assert.equal(await codeOf(res),'rate_limited');
 }
 assert.equal(keys.length,accountRoutes.length,'one limiter call per request');
 assert.ok(keys.every(k=>/^c[0-9a-f]{32}$/.test(k)&&k===keys[0]),'keyed by the hashed client id, never the email');
 assert.equal(t.mail.sent.length,sent,'no mail once limited');assert.equal(t.db.tables.get('users').length,users,'no new user once limited');
 allow=true;assert.notEqual((await t.call('GET',ROUTES.wallet,undefined,token)).status,429,'allowed again when the limiter allows');
});

// Account metrics (stl00/Cardybara#571): one data point per account request, counts and codes only.
test('metrics: every account route writes one point with a fixed name, status, duration and an allow-listed error',async()=>{
 const points=[];
 const t=await setup({vars:{AGENT_METRICS:{writeDataPoint:p=>points.push(structuredClone(p))},CF_VERSION_METADATA:{id:'ver-acct-1'}}});
 const last=()=>points[points.length-1];
 const shape=(name,status,error='')=>{
  assert.deepEqual(last().indexes,['account']);
  assert.deepEqual(last().blobs,['account',name,error]);
  assert.equal(last().doubles.length,2);
  assert.equal(last().doubles[0],status);
  assert.ok(Number.isInteger(last().doubles[1])&&last().doubles[1]>=0);
 };
 assert.equal((await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD})).status,202);shape('signup',202);
 assert.equal((await t.call('POST',ROUTES.verify,{email:EMAIL,code:'000000'})).status,400);shape('code',400,'code_invalid');
 const v=await json(await t.call('POST',ROUTES.verify,{email:EMAIL,code:t.lastCode(EMAIL)}));shape('code',200);
 const token=v.body.token;
 assert.equal((await t.call('POST',ROUTES.session,{email:EMAIL,password:'wrong-password-9999'})).status,401);shape('signin',401,'invalid_credentials');
 assert.equal((await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD})).status,200);shape('signin',200);
 assert.equal((await t.call('GET',ROUTES.wallet,undefined,token)).status,200);shape('sync_pull',200);
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:5,formatVersion:1,document:{cards:[]}},token)).status,409);shape('sync_push',409,'stale_revision');
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[]}},token)).status,200);shape('sync_push',200);
 assert.equal((await t.call('GET',ROUTES.export,undefined,token)).status,200);shape('export',200);
 assert.equal((await t.call('POST',ROUTES.forgot,{email:EMAIL})).status,202);shape('forgot',202);
 assert.equal((await t.call('GET',ROUTES.passkeyStatus,undefined,token)).status,200);shape('passkey',200);
 assert.equal((await t.call('GET',ROUTES.wallet)).status,401);shape('sync_pull',401,'unauthorized');
 assert.equal((await t.call('DELETE',ROUTES.session,undefined,token)).status,200);shape('signout',200);
 const again=await json(await t.call('POST',ROUTES.session,{email:EMAIL,password:PASSWORD}));
 assert.equal((await t.call('DELETE',ROUTES.account,{password:PASSWORD},again.body.token)).status,200);shape('delete',200);
 // A credential id in the path is never a name; a path that is no account route is not metered.
 const before=points.length;
 await t.call('DELETE',ROUTES.passkeys+'/abc-credential-id',undefined,token);
 assert.equal(last().blobs[1],'passkey');assert.ok(!JSON.stringify(last()).includes('abc-credential-id'));
 await t.call('GET','/v2/account/nothing-here',undefined,token);
 assert.equal(points.length,before+1,'an unknown path writes no account point');
});

test('metrics: an account point holds no email, code, password, token or wallet content',async()=>{
 const points=[];
 const t=await setup({vars:{AGENT_METRICS:{writeDataPoint:p=>points.push(structuredClone(p))}}});
 await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD});
 const code=t.lastCode(EMAIL);
 const v=await json(await t.call('POST',ROUTES.verify,{email:EMAIL,code}));
 await t.call('POST',ROUTES.verify,{email:EMAIL,code:'123456'});
 await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[{id:'card-synthetic-9',nickname:'synthetic-nickname-9'}]}},v.body.token);
 await t.call('POST',ROUTES.session,{email:OTHER,password:NEW_PASSWORD});
 assert.ok(points.length>=5);
 const all=JSON.stringify(points);
 for(const secret of [EMAIL,OTHER,code,'123456',PASSWORD,NEW_PASSWORD,v.body.token,'synthetic-nickname-9','card-synthetic-9','example.test'])assert.ok(!all.includes(secret),'a data point carries '+secret);
 for(const p of points){
  assert.equal(p.blobs.length,3);
  assert.ok(p.blobs.every(b=>typeof b==='string'&&b.length<=24),'blobs are short fixed words');
 }
});

test('metrics: a missing or throwing binding changes nothing for the account caller',async()=>{
 for(const binding of [undefined,{},{writeDataPoint(){throw Error('binding exploded');}}]){
  const t=await setup({vars:{AGENT_METRICS:binding}});
  assert.equal((await t.call('POST',ROUTES.signUp,{email:EMAIL,password:PASSWORD})).status,202);
  const v=await json(await t.call('POST',ROUTES.verify,{email:EMAIL,code:t.lastCode(EMAIL)}));
  assert.equal(v.status,200);
  assert.equal((await t.call('GET',ROUTES.wallet,undefined,v.body.token)).status,200);
 }
});
