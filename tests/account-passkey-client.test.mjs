// Passkey client (stl00/Cardybara#422, epic #410): the browser side of /v2/account/passkey against a stand-in gateway and a
// virtual authenticator (a fake navigator.credentials). Synthetic data only. Gateway-side tests live with the gateway work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountClient,decodePublicKeyOptions,encodeCredential,readAccount} from '../src/accountClient.js';

const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const u8=(...n)=>new Uint8Array(n).buffer;
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const PK={challenge:'AQID',rpId:'app.cardybara.test',user:{id:'BAUG',name:'a@example.test',displayName:'a'},excludeCredentials:[{id:'CgsM',type:'public-key'}]};
const cred={id:'abc',rawId:u8(1,2),type:'public-key',response:{clientDataJSON:u8(9),attestationObject:u8(8),getTransports:()=>['internal']}};

function setup({routes={},get=async()=>({...cred,response:{clientDataJSON:u8(1),authenticatorData:u8(2),signature:u8(3),userHandle:u8(4)}}),create=async()=>cred}={}){
 const storage=memory(),calls=[];
 const fetchFn=async(url,init)=>{
  const path=url.replace('https://gateway.test','');calls.push({method:init.method,path,body:init.body?JSON.parse(init.body):null,auth:init.headers.Authorization||null});
  const h=routes[init.method+' '+path];return h?h(init):json(404,{error:{code:'not_found'}});
 };
 const credentials={get,create};
 globalThis.PublicKeyCredential??=function(){};
 const client=createAccountClient({gateway:'https://gateway.test',storage,fetchFn,credentials,win:new EventTarget()});
 return {client,storage,calls};
}

test('options decode to ArrayBuffers and credentials encode to base64url',()=>{
 const o=decodePublicKeyOptions(PK);
 assert.deepEqual([...new Uint8Array(o.challenge)],[1,2,3]);
 assert.deepEqual([...new Uint8Array(o.user.id)],[4,5,6]);
 assert.deepEqual([...new Uint8Array(o.excludeCredentials[0].id)],[10,11,12]);
 const e=encodeCredential(cred);
 assert.equal(e.rawId,'AQI');assert.equal(e.response.attestationObject,'CA');assert.deepEqual(e.response.transports,['internal']);
});

test('passkeys are hidden until the gateway answers enabled',async()=>{
 assert.equal(await setup().client.passkeysAvailable(),false);
 assert.equal(await setup({routes:{'GET /v2/account/passkey/status':()=>json(200,{enabled:true})}}).client.passkeysAvailable(),true);
 const s=setup({routes:{'GET /v2/account/passkey/status':()=>json(200,{enabled:true})}});
 assert.equal(await createAccountClient({gateway:'https://gateway.test',storage:s.storage,fetchFn:async()=>json(200,{enabled:true}),credentials:null}).passkeysAvailable(),false);
});

test('sign in with a passkey keeps the session and sends the assertion',async()=>{
 const s=setup({routes:{
  'POST /v2/account/passkey/login/options':()=>json(200,{challengeId:'c1',publicKey:PK}),
  'POST /v2/account/passkey/login/verify':()=>json(200,{token:'t-1',expiresAt:4102444800,email:'a@example.test'}),
 }});
 const r=await s.client.signInWithPasskey({conditional:true});
 assert.deepEqual([r.ok,r.email],[true,'a@example.test']);
 assert.equal(readAccount(s.storage)?.email,'a@example.test');
 const v=s.calls.find(c=>c.path.endsWith('login/verify')).body;
 assert.equal(v.challengeId,'c1');assert.equal(v.credential.response.signature,'Aw');
 assert.equal('token' in r,false);
});

test('a cancelled prompt, a replayed challenge and a removed passkey sign nobody in',async()=>{
 const opts={'POST /v2/account/passkey/login/options':()=>json(200,{challengeId:'c1',publicKey:PK})};
 const a=setup({routes:opts,get:async()=>{throw new Error('NotAllowedError');}});
 assert.deepEqual(await a.client.signInWithPasskey(),{ok:false,code:'cancelled'});
 const b=setup({routes:{...opts,'POST /v2/account/passkey/login/verify':()=>json(400,{error:{code:'challenge_expired'}})}});
 assert.equal((await b.client.signInWithPasskey()).code,'challenge_expired');
 const c=setup({routes:{...opts,'POST /v2/account/passkey/login/verify':()=>json(401,{error:{code:'passkey_invalid'}})}});
 assert.equal((await c.client.signInWithPasskey()).code,'passkey_invalid');
 for(const x of [a,b,c])assert.equal(readAccount(x.storage),null);
});

test('add, list and remove need a session; email sign-in is untouched',async()=>{
 const s=setup({routes:{
  'POST /v2/account/passkey/register/options':()=>json(200,{challengeId:'r1',publicKey:PK}),
  'POST /v2/account/passkey/register/verify':()=>json(200,{id:'k1'}),
  'GET /v2/account/passkey':()=>json(200,{passkeys:[{id:'k1',name:'Phone'}]}),
  'DELETE /v2/account/passkey/k1':()=>json(200,{}),
  'POST /v2/account/session':()=>json(200,{token:'t-2',expiresAt:4102444800}),
 }});
 assert.equal((await s.client.addPasskey('x')).code,'unauthorized');
 assert.equal((await s.client.signIn('a@example.test','synthetic-pass-0001')).ok,true);
 assert.equal((await s.client.addPasskey(' Phone ')).ok,true);
 const reg=s.calls.find(c=>c.path.endsWith('register/verify'));
 assert.equal(reg.auth,'Bearer t-2');assert.equal(reg.body.name,'Phone');
 assert.equal((await s.client.listPasskeys()).passkeys[0].id,'k1');
 assert.equal((await s.client.removePasskey('k1')).ok,true);
});
