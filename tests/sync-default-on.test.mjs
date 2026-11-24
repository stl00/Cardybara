// Sync is on by default after sign-in (stl00/Cardybara#579, owner 2026-11-23). Every successful sign-in path (password, sign-up
// code, reset code, passkey, the extension's web sign-in) turns sync on and one pull follows; the switch off means no wallet
// request until the next sign-in; a signed-out wallet makes no wallet request at all. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {createAccountClient,setSync,syncIsOn,SYNC_CHANGE_EVENT} from '../src/accountClient.js';
import {startWalletSync} from '../src/walletSync.js';
import {readWalletDocument,replaceWalletDocument} from '../src/walletDocument.js';

const ORIGIN='https://app.cardybara.test',GATEWAY='https://gateway.test';
const MIGRATION=['0001_accounts','0002_passkeys','0003_plaid'].map(f=>readFileSync(new URL(`../gateway/migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
const EMAIL='synthetic.user@example.test',PASSWORD='synthetic-pass-0001',NEW_PASSWORD='synthetic-pass-0002';
const T0=Date.parse('2026-11-23T12:00:00Z');
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const ledgers={readBenefitEvents:async()=>[],readCostEvents:async()=>[],importBenefitEvents:async()=>{},importCostEvents:async()=>{}};

async function setup(){
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail();
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>'},bindings:{DB:db,EMAIL:mail},log:()=>{},now:()=>T0});
 const requests=[];
 const fetchFn=async(url,init)=>{requests.push({url,method:init.method});return g.handle(new Request(url,{method:init.method,body:init.body,headers:{Origin:ORIGIN,...init.headers}}));};
 const lastCode=to=>/\b(\d{6})\b/.exec([...mail.sent].reverse().find(x=>x.to===to)?.text||'')?.[1]??null;
 return {fetchFn,requests,lastCode};
}
function device(srv,extra={}){
 const storage=memory(),win=new EventTarget(),events=[];
 win.addEventListener(SYNC_CHANGE_EVENT,()=>events.push('sync-change'));
 const client=createAccountClient({gateway:GATEWAY,storage,fetchFn:srv.fetchFn,now:()=>T0,win,...extra});
 // What the page does on SYNC_CHANGE_EVENT: start the loop (it does nothing when sync is off or signed out).
 const startSync=()=>startWalletSync({gateway:GATEWAY,storage,win:new EventTarget(),doc:null,fetchFn:srv.fetchFn,readLocal:()=>readWalletDocument({storage,...ledgers}),applyLocal:d=>replaceWalletDocument(d,{storage,...ledgers}),onStatus:()=>{},interval:{set:()=>0,clear:()=>{}}});
 return {storage,win,events,client,startSync};
}
const walletGets=srv=>srv.requests.filter(r=>r.method==='GET'&&r.url.endsWith('/v2/account/wallet')).length;
const walletCalls=srv=>srv.requests.filter(r=>r.url.endsWith('/v2/account/wallet')).length;
async function settle(srv,n){const end=Date.now()+10000;while(walletGets(srv)<n&&Date.now()<end)await new Promise(r=>setTimeout(r,5));}

// Each path signs in on a fresh device where the account already exists.
const PATHS={
 'password sign-in':async(d)=>d.client.signIn(EMAIL,PASSWORD),
 'sign-up with the emailed code':async(d,srv,fresh)=>{await fresh.client.signUp('b.'+EMAIL,PASSWORD);return d.client.verify('b.'+EMAIL,srv.lastCode('b.'+EMAIL));},
 'password reset':async(d,srv)=>{await d.client.forgot(EMAIL);return d.client.reset(EMAIL,srv.lastCode(EMAIL),NEW_PASSWORD);},
 'extension web sign-in (passkey handoff)':async(d)=>d.client.signInWithPasskey(),
};
for(const [name,signIn] of Object.entries(PATHS)){
 test(`${name}: sync is on, the page is told, and one pull happens`,async()=>{
  const srv=await setup();
  const first=device(srv);
  await first.client.signUp(EMAIL,PASSWORD);await first.client.verify(EMAIL,srv.lastCode(EMAIL));
  const d=device(srv,name.startsWith('extension')?{webSignIn:async()=>({token:'cbs_synthetic',expiresAt:Math.floor(T0/1000)+3600,email:EMAIL})}:{});
  assert.equal(syncIsOn(d.storage),false,'a fresh device starts with sync off');
  const before=walletGets(srv);
  const r=await signIn(d,srv,first);
  assert.equal(r.ok,true,JSON.stringify(r));
  assert.equal(syncIsOn(d.storage),true,'sync is on after sign-in');
  assert.ok(d.events.includes('sync-change'),'the page is told to start the loop');
  const stop=d.startSync();
  await settle(srv,before+1);assert.equal(walletGets(srv)-before,1,'exactly one pull');
  stop();
 });
}

test('passkey sign-in (browser credentials) turns sync on',async()=>{
 const storage=memory(),win=new EventTarget();
 const u8=(...n)=>new Uint8Array(n).buffer;
 globalThis.PublicKeyCredential??=function(){};
 const json=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:{'Content-Type':'application/json'}});
 const fetchFn=async(url,init)=>url.endsWith('/login/options')?json(200,{challengeId:'c1',publicKey:{challenge:'AQID',rpId:'x'}}):json(200,{token:'cbs_synthetic',expiresAt:4102444800,email:EMAIL});
 const credentials={get:async()=>({id:'a',rawId:u8(1),type:'public-key',response:{clientDataJSON:u8(1),authenticatorData:u8(2),signature:u8(3),userHandle:u8(4)}})};
 const client=createAccountClient({gateway:GATEWAY,storage,fetchFn,credentials,win});
 assert.equal((await client.signInWithPasskey({conditional:true})).ok,true);
 assert.equal(syncIsOn(storage),true);
});

test('turning the switch off: no wallet request until the next sign-in, which turns it on again',async()=>{
 const srv=await setup();
 const first=device(srv);
 await first.client.signUp(EMAIL,PASSWORD);await first.client.verify(EMAIL,srv.lastCode(EMAIL));
 const d=device(srv);
 await d.client.signIn(EMAIL,PASSWORD);
 const stop=d.startSync();await settle(srv,1);stop();
 assert.equal(walletGets(srv),1);

 setSync(d.storage,false,d.win);
 const calls=walletCalls(srv);
 d.startSync()();
 assert.equal(walletCalls(srv),calls,'sync off: the loop makes no wallet request');
 assert.equal(syncIsOn(d.storage),false);

 await d.client.signIn(EMAIL,PASSWORD);
 assert.equal(syncIsOn(d.storage),true,'signing in again is the consent point and turns sync back on');
 const stop2=d.startSync();await settle(srv,2);stop2();
 assert.equal(walletGets(srv),2,'one more pull after the new sign-in');
});

test('a signed-out wallet makes no wallet-sync request, even with a stale on flag',async()=>{
 const srv=await setup();
 const d=device(srv);
 d.startSync()();
 setSync(d.storage,true,d.win);
 d.startSync()();
 assert.equal(walletCalls(srv),0);
 assert.equal(srv.requests.length,0);
});
