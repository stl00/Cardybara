// Gateway passkeys (stl00/Cardybara#461, epic #410): register, sign in, a replayed or expired challenge, a wrong origin or
// rpId, a clone-looking counter, a removed passkey, another user's passkey, and account deletion leaving no passkey rows.
// A software authenticator (tests/helpers/virtual-authenticator.mjs) stands in for the browser; D1 and mail are the in-memory
// stand-ins with the real migrations applied. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {ROUTES} from '../gateway/src/gateway.js';
import {TABLES} from '../gateway/src/accounts.js';
import {CHALLENGE_TTL_SECONDS,PASSKEYS_MAX,relyingParty} from '../gateway/src/passkeys.js';
import {createAccountClient} from '../src/accountClient.js';
import {virtualAuthenticator,toB64u} from './helpers/virtual-authenticator.mjs';

const ORIGIN='https://app.cardybara.test';
const MIGRATION=['0001_accounts','0002_passkeys'].map(f=>readFileSync(new URL(`../gateway/migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
const EMAIL='synthetic.user@example.test',OTHER='other.user@example.test',PASSWORD='synthetic-pass-0001';
const T0=Date.parse('2026-11-17T12:00:00Z');
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

async function setup({vars={}}={}){
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail(),logs=[];let clock=T0;
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,PASSKEY_ORIGIN:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>',...vars},bindings:{DB:db,EMAIL:mail},log:l=>logs.push(l),now:()=>clock});
 const call=(method,path,body,token)=>g.handle(new Request('https://gateway.test'+path,{method,headers:{Origin:ORIGIN,...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)}));
 const lastCode=to=>{const m=[...mail.sent].reverse().find(x=>x.to===to);return /\b(\d{6})\b/.exec(m?.text||'')?.[1]??null;};
 return {g,db,logs,call,lastCode,advance:s=>{clock+=s*1000;},fetchFn:(url,init)=>g.handle(new Request(url,{method:init.method,body:init.body,headers:{Origin:ORIGIN,...init.headers}}))};
}
const json=async r=>({status:r.status,body:await r.json()});
const codeOf=async r=>(await r.json()).error?.code;
async function account(t,email=EMAIL){
 assert.equal((await t.call('POST',ROUTES.signUp,{email,password:PASSWORD})).status,202);
 const r=await json(await t.call('POST',ROUTES.verify,{email,code:t.lastCode(email)}));
 assert.equal(r.status,200);return r.body.token;
}
const P=ROUTES.passkeys;
// Walks one registration through the routes; `mutate` may change the credential before it is sent.
async function register(t,token,auth,{name='Synthetic phone',mutate,originOverride}={}){
 const o=await json(await t.call('POST',ROUTES.passkeyRegisterOptions,{},token));
 assert.equal(o.status,200);
 const pk={...o.body.publicKey,challenge:Buffer.from(o.body.publicKey.challenge,'base64url'),user:{...o.body.publicKey.user,id:Buffer.from(o.body.publicKey.user.id,'base64url')}};
 const cred=await auth.create(pk,{originOverride});
 const enc=toWire(cred);mutate?.(enc);
 return {o,pk,enc,res:await t.call('POST',ROUTES.passkeyRegisterVerify,{challengeId:o.body.challengeId,credential:enc,name},token)};
}
const toWire=c=>({id:c.id,rawId:toB64u(c.rawId),type:c.type,response:Object.fromEntries(Object.entries(c.response).map(([k,v])=>[k,toB64u(v)]))});
async function login(t,auth,{mutate,challengeId,originOverride}={}){
 const o=await json(await t.call('POST',ROUTES.passkeyLoginOptions,{}));
 assert.equal(o.status,200);
 const cred=await auth.get({...o.body.publicKey,challenge:Buffer.from(o.body.publicKey.challenge,'base64url')},{originOverride});
 const enc=toWire(cred);mutate?.(enc);
 return {o,enc,res:await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:challengeId??o.body.challengeId,credential:enc})};
}

test('status is enabled only when PASSKEY_ORIGIN is a valid https origin',async()=>{
 assert.deepEqual(await json(await (await setup()).call('GET',ROUTES.passkeyStatus)),{status:200,body:{enabled:true}});
 assert.deepEqual(await json(await (await setup({vars:{PASSKEY_ORIGIN:''}})).call('GET',ROUTES.passkeyStatus)),{status:200,body:{enabled:false}});
 assert.equal(relyingParty({PASSKEY_ORIGIN:'http://app.example.test'}),null,'plain http is refused');
 assert.equal(relyingParty({PASSKEY_ORIGIN:'https://app.example.test/path'}),null,'an origin has no path');
 assert.equal(relyingParty({PASSKEY_ORIGIN:'http://localhost:5173',LOCAL_DEV:'1'}).rpId,'localhost');
 assert.equal(relyingParty({PASSKEY_ORIGIN:'http://localhost:5173'}),null,'http localhost only in a local run');
 const t=await setup({vars:{PASSKEY_ORIGIN:''}});const token=await account(t);
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyRegisterOptions,{},token)),'passkey_unavailable');
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyLoginOptions,{})),'passkey_unavailable');
});

test('register, list, sign in: a passkey gives a session for the same account and wallet',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 const token=await account(t);
 const {o,res}=await register(t,token,auth);
 assert.equal(o.body.publicKey.rp.id,'app.cardybara.test');
 assert.equal(o.body.publicKey.authenticatorSelection.residentKey,'required');
 const added=await json(res);assert.equal(added.status,200);assert.equal(added.body.id,[...auth.keys.keys()][0]);
 assert.deepEqual((await json(await t.call('GET',P,undefined,token))).body,{passkeys:[{id:added.body.id,name:'Synthetic phone'}]});
 // The wallet written under the password session is read back under the passkey session.
 assert.equal((await t.call('PUT',ROUTES.wallet,{baseRevision:0,formatVersion:1,document:{cards:[]}},token)).status,200);
 const {res:lr}=await login(t,auth);
 const s=await json(lr);
 assert.equal(s.status,200);assert.match(s.body.token,/^cbs_[A-Za-z0-9_-]{43}$/);assert.equal(s.body.email,EMAIL);assert.ok(s.body.expiresAt>T0/1000);
 const w=await json(await t.call('GET',ROUTES.wallet,undefined,s.body.token));
 assert.equal(w.status,200);assert.equal(w.body.revision,1);
 // Stored: the public key and counter, no private material; the log line has no credential or token.
 const row=t.db.tables.get('passkeys')[0];assert.equal(row.sign_count,1);assert.deepEqual(Object.keys(JSON.parse(row.public_key)).sort(),['crv','kty','x','y']);
 const logged=t.logs.join('\n');assert.ok(!logged.includes(s.body.token)&&!logged.includes(added.body.id)&&!logged.includes(EMAIL));
});

test('register routes need a session; the user is the session\'s, and a name is trimmed and capped',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyRegisterOptions,{})),'unauthorized');
 assert.equal(await codeOf(await t.call('GET',P)),'unauthorized');
 assert.equal(await codeOf(await t.call('DELETE',P+'/abc')),'unauthorized');
 const token=await account(t);
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyRegisterOptions,{userId:'u_x'},token)),'bad_request');
 const {res}=await register(t,token,auth,{name:'  '+'n'.repeat(100)+'  '});
 assert.equal(res.status,200);assert.equal(t.db.tables.get('passkeys')[0].name.length,60);
});

test('a replayed login challenge is rejected, and so is an unknown or expired one',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 await register(t,await account(t),auth);
 const first=await login(t,auth);assert.equal(first.res.status,200);
 const replay=await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:first.o.body.challengeId,credential:first.enc});
 assert.equal(await codeOf(replay),'challenge_expired');
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:'pc_nope',credential:first.enc})),'challenge_expired');
 // Expired: asked for, then answered after the TTL.
 const o=await json(await t.call('POST',ROUTES.passkeyLoginOptions,{}));
 const cred=toWire(await auth.get({...o.body.publicKey,challenge:Buffer.from(o.body.publicKey.challenge,'base64url')}));
 t.advance(CHALLENGE_TTL_SECONDS+1);
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:o.body.challengeId,credential:cred})),'challenge_expired');
 assert.equal(t.db.tables.get('passkey_challenges').length,0,'a used or expired challenge leaves no row');
});

test('a failed attempt burns its challenge; a registration challenge cannot be used to sign in, nor another user\'s to register',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 const token=await account(t),other=await account(t,OTHER);
 await register(t,token,auth);
 const bad=await login(t,auth,{mutate:c=>{c.response.signature=c.response.signature.slice(0,-4)+'AAAA';}});
 assert.equal(await codeOf(bad.res),'passkey_invalid');
 const retry=await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:bad.o.body.challengeId,credential:bad.enc});
 assert.equal(await codeOf(retry),'challenge_expired','the challenge was used up by the failed try');
 // Purpose and user are bound to the challenge.
 const reg=await json(await t.call('POST',ROUTES.passkeyRegisterOptions,{},token));
 const cred=toWire(await auth.get({rpId:'app.cardybara.test',challenge:Buffer.from(reg.body.publicKey.challenge,'base64url')}));
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:reg.body.challengeId,credential:cred})),'passkey_invalid');
 const reg2=await json(await t.call('POST',ROUTES.passkeyRegisterOptions,{},token));
 const auth2=virtualAuthenticator();
 const c2=toWire(await auth2.create({challenge:Buffer.from(reg2.body.publicKey.challenge,'base64url'),rp:{id:'app.cardybara.test'},user:{id:Buffer.from('x')}}));
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyRegisterVerify,{challengeId:reg2.body.challengeId,credential:c2,name:'x'},other)),'passkey_invalid');
});

test('a wrong origin, a wrong rpId, a tampered challenge or a missing user-presence flag fails',async()=>{
 const t=await setup(),auth=virtualAuthenticator(),token=await account(t);
 assert.equal(await codeOf((await register(t,token,auth,{originOverride:'https://evil.example.test'})).res),'passkey_invalid');
  const t2=await setup(),a2=virtualAuthenticator(),tok2=await account(t2);
 const o=await json(await t2.call('POST',ROUTES.passkeyRegisterOptions,{},tok2));
 const cred=toWire(await a2.create({challenge:Buffer.from(o.body.publicKey.challenge,'base64url'),rp:{id:'evil.example.test'},user:{id:Buffer.from('x')}}));
 assert.equal(await codeOf(await t2.call('POST',ROUTES.passkeyRegisterVerify,{challengeId:o.body.challengeId,credential:cred,name:'x'},tok2)),'passkey_invalid','rpIdHash for another site');
 const t3=await setup(),a3=virtualAuthenticator(),tok3=await account(t3);
 await register(t3,tok3,a3);
 assert.equal(await codeOf((await login(t3,a3,{originOverride:'https://evil.example.test'})).res),'passkey_invalid');
 const flip=await login(t3,a3,{mutate:c=>{const cd=JSON.parse(Buffer.from(c.response.clientDataJSON,'base64url'));cd.challenge='AAAA';c.response.clientDataJSON=toB64u(Buffer.from(JSON.stringify(cd)));}});
 assert.equal(await codeOf(flip.res),'passkey_invalid');
 const noUp=await login(t3,a3,{mutate:c=>{const ad=Buffer.from(c.response.authenticatorData,'base64url');ad[32]=0;c.response.authenticatorData=toB64u(ad);}});
 assert.equal(await codeOf(noUp.res),'passkey_invalid');
});

test('a credential the gateway does not know cannot sign in; a counter that does not rise is refused',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 await register(t,await account(t),auth);
 const stranger=virtualAuthenticator();
 const o=await json(await t.call('POST',ROUTES.passkeyLoginOptions,{}));
 const pk={...o.body.publicKey,challenge:Buffer.from(o.body.publicKey.challenge,'base64url')};
 await stranger.create({challenge:pk.challenge,rp:{id:'app.cardybara.test'},user:{id:Buffer.from('x')}});
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyLoginVerify,{challengeId:o.body.challengeId,credential:toWire(await stranger.get(pk))})),'passkey_invalid');
 assert.equal((await login(t,auth)).res.status,200);
 const stored=t.db.tables.get('passkeys')[0];assert.equal(stored.sign_count,1);
 auth.keys.get(stored.id).count=0;// a cloned authenticator that starts counting again
 assert.equal(await codeOf((await login(t,auth)).res),'passkey_invalid');
 // An authenticator that keeps no counter always sends 0, and is allowed.
 const t2=await setup(),flat=virtualAuthenticator({counter:false});
 await register(t2,await account(t2),flat);
 assert.equal((await login(t2,flat)).res.status,200);assert.equal((await login(t2,flat)).res.status,200);
});

test('a removed passkey cannot sign in; only its owner can remove it; the same credential cannot be registered twice',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 const token=await account(t),other=await account(t,OTHER);
 const id=(await json((await register(t,token,auth)).res)).body.id;
 assert.equal(await codeOf(await t.call('DELETE',P+'/'+id,undefined,other)),'not_found');
 assert.equal(t.db.tables.get('passkeys').length,1,'another user\'s delete changed nothing');
 assert.deepEqual((await json(await t.call('GET',P,undefined,other))).body,{passkeys:[]});
 assert.equal((await login(t,auth)).res.status,200);
 assert.equal((await t.call('DELETE',P+'/'+id,undefined,token)).status,200);
 assert.equal(t.db.tables.get('passkeys').length,0);
 assert.equal(await codeOf((await login(t,auth)).res),'passkey_invalid');
 assert.equal(await codeOf(await t.call('DELETE',P+'/'+id,undefined,token)),'not_found');
 // Replaying a registration (same credential id) is refused.
 const dup=await register(t,token,auth);assert.equal(dup.res.status,200);
 const again=await json(await t.call('POST',ROUTES.passkeyRegisterOptions,{},other));
 const same=dup.enc,sent=await t.call('POST',ROUTES.passkeyRegisterVerify,{challengeId:again.body.challengeId,credential:same,name:'x'},other);
 assert.equal(await codeOf(sent),'passkey_invalid');
});

test('at most PASSKEYS_MAX passkeys per account',async()=>{
 const t=await setup(),token=await account(t);
 for(let i=0;i<PASSKEYS_MAX;i++)assert.equal((await register(t,token,virtualAuthenticator())).res.status,200);
 assert.equal(await codeOf(await t.call('POST',ROUTES.passkeyRegisterOptions,{},token)),'bad_request');
});

test('deleting the account removes its passkeys and challenges; export lists them without keys',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 const token=await account(t),other=await account(t,OTHER),otherAuth=virtualAuthenticator();
 await register(t,token,auth);await register(t,other,otherAuth);
 await t.call('POST',ROUTES.passkeyRegisterOptions,{},token);// a pending challenge of the user
 const userId=t.db.tables.get('users').find(u=>u.email===EMAIL).id;
 assert.equal(t.db.tables.get('passkey_challenges').filter(r=>r.user_id===userId).length,1);
 const exp=await json(await t.call('GET',ROUTES.export,undefined,token));
 assert.deepEqual(exp.body.passkeys.map(p=>Object.keys(p).sort()),[['createdAt','name']]);
 assert.equal((await t.call('DELETE',ROUTES.account,{password:PASSWORD},token)).status,200);
 for(const n of ['passkeys','passkey_challenges'])assert.equal(t.db.tables.get(n).filter(r=>r.user_id===userId).length,0,n);
 assert.equal(t.db.tables.get('passkeys').length,1,'the other user\'s passkey stays');
 assert.equal(await codeOf((await login(t,auth)).res),'passkey_invalid','the deleted account\'s passkey is gone');
 assert.equal((await login(t,otherAuth)).res.status,200);
 assert.ok(TABLES.includes('passkeys')&&TABLES.includes('passkey_challenges'));
});

test('an unverified account cannot sign in with a passkey',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 const token=await account(t);await register(t,token,auth);
 t.db.tables.get('users')[0].verified=0;
 assert.equal(await codeOf((await login(t,auth)).res),'passkey_invalid');
});

test('the account client and the gateway work together through the browser API shape',async()=>{
 const t=await setup(),auth=virtualAuthenticator();
 globalThis.PublicKeyCredential??=function(){};
 const mk=()=>createAccountClient({gateway:'https://gateway.test',storage:memory(),fetchFn:t.fetchFn,credentials:auth.credentials,win:new EventTarget()});
 const A=mk(),B=mk();
 assert.equal(await A.passkeysAvailable(),true);
 await A.signUp(EMAIL,PASSWORD);
 assert.equal((await A.verify(EMAIL,t.lastCode(EMAIL))).ok,true);
 const added=await A.addPasskey('Synthetic laptop');assert.equal(added.ok,true);
 assert.deepEqual((await A.listPasskeys()).passkeys.map(p=>p.name),['Synthetic laptop']);
 const signed=await B.signInWithPasskey();
 assert.equal(signed.ok,true);assert.equal(signed.email,EMAIL);
 assert.equal((await B.removePasskey(added.id)).ok,true);
 assert.equal((await B.signInWithPasskey()).code,'passkey_invalid');
});
