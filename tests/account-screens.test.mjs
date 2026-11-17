// Account screens (stl00/Cardybara#415, epic #410): the client behind them against the gateway's real account code (in-memory
// D1 and mail stand-ins). Two fresh profiles share nothing but the email and password: create account -> sync on ->
// the second profile signs in and gets the same wallet; delete account leaves 0 server rows and the local wallet.
// Synthetic data only. The phone-width layout of the screens is in tests/account-phone.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {TABLES} from '../gateway/src/accounts.js';
import {validWalletDocument} from '../gateway/src/walletSchema.js';
import {createAccountClient,readAccount,setSync,syncIsOn,emailLooksValid,passwordLongEnough,SYNC_CHANGE_EVENT} from '../src/accountClient.js';
import {startWalletSync,readSyncState,ACCOUNT_SESSION_KEY,SYNC_STATE_KEY} from '../src/walletSync.js';
import {readWalletDocument,replaceWalletDocument} from '../src/walletDocument.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {cardProducts} from '../src/productCatalog.js';

const ORIGIN='https://app.cardybara.test',GATEWAY='https://gateway.test';
const MIGRATION=readFileSync(new URL('../gateway/migrations/0001_accounts.sql',import.meta.url),'utf8');
const EMAIL='synthetic.user@example.test',PASSWORD='synthetic-pass-0001',NEW_PASSWORD='synthetic-pass-0002';
const T0=Date.parse('2026-11-17T12:00:00Z');
const bank=cardProducts[0].bank;
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),keys:()=>[...m.keys()]};};

async function setup(){
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail(),logs=[];let clock=T0;
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>'},bindings:{DB:db,EMAIL:mail},log:l=>logs.push(l),now:()=>clock});
 const requests=[];
 const fetchFn=async(url,init)=>{requests.push({url,method:init.method,body:init.body??null});return g.handle(new Request(url,{method:init.method,body:init.body,headers:{Origin:ORIGIN,...init.headers}}));};
 const lastCode=to=>{const m=[...mail.sent].reverse().find(x=>x.to===to);return /\b(\d{6})\b/.exec(m?.text||'')?.[1]??null;};
 return {db,mail,requests,fetchFn,lastCode,advance:s=>{clock+=s*1000;}};
}
// A fresh browser profile: its own storage, its own event target, its own client.
function profile(srv){
 const storage=memory(),win=new EventTarget(),events=[];
 win.addEventListener(SYNC_CHANGE_EVENT,()=>events.push('sync-change'));
 const client=createAccountClient({gateway:GATEWAY,storage,fetchFn:srv.fetchFn,now:()=>T0,win});
 const ledgers={readBenefitEvents:async()=>[],readCostEvents:async()=>[],importBenefitEvents:async()=>{},importCostEvents:async()=>{}};
 const read=()=>readWalletDocument({storage,...ledgers});
 const startSync=()=>{const statuses=[];const stop=startWalletSync({gateway:GATEWAY,storage,win:new EventTarget(),doc:null,fetchFn:srv.fetchFn,readLocal:read,applyLocal:doc=>replaceWalletDocument(doc,{storage,...ledgers}),onStatus:s=>statuses.push(s),interval:{set:()=>0,clear:()=>{}}});return {stop,statuses};};
 const addCard=(name,tail,id)=>storage.setItem('cardybara-wallet-cards-v1',JSON.stringify([...JSON.parse(storage.getItem('cardybara-wallet-cards-v1')||'[]'),newWalletCard({bank,name,tail},id)]));
 return {storage,win,events,client,read,startSync,addCard};
}
// A document the gateway's schema accepts today, written straight to the server so a row exists to be kept or deleted.
async function putServerCopy(srv,p){
 const token=JSON.parse(p.storage.getItem(ACCOUNT_SESSION_KEY)).token;
 const r=await srv.fetchFn(GATEWAY+'/v2/account/wallet',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({baseRevision:0,formatVersion:1,document:{cards:[]}})});
 assert.equal(r.status,200);
}
// The gateway's wallet schema still names the sections of an older draft, so it refuses the real wallet document
// (#449). The cross-device test below runs by itself once the schema accepts what readWalletDocument writes.
const gatewayAcceptsWallet=validWalletDocument(await readWalletDocument({storage:memory(),readBenefitEvents:async()=>[],readCostEvents:async()=>[]}));
const tails=doc=>doc.walletCards.cards.map(c=>c.name+':'+c.tail).sort();
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};

test('create account, sync on, a second fresh profile signs in with the same email and password and gets the same wallet',{skip:gatewayAcceptsWallet?false:'blocked by #449: the gateway wallet schema refuses the real wallet document'},async()=>{
 const srv=await setup();
 const A=profile(srv),B=profile(srv);
 A.addCard('Synthetic One','1111','card-1');A.addCard('Synthetic Two','2222','card-2');
 assert.equal(readAccount(A.storage),null,'signed out by default');
 assert.equal(syncIsOn(A.storage),false,'and sync is off');

 const up=await A.client.signUp(' Synthetic.User@Example.TEST ',PASSWORD);
 assert.equal(up.ok,true);
 assert.equal(readAccount(A.storage),null,'the code has not been entered yet');
 const v=await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 assert.equal(v.ok,true);
 assert.equal(readAccount(A.storage).email,EMAIL);
 assert.equal(JSON.stringify(v).includes('cbs_'),false,'the token is not handed to the screen');
 assert.equal(readSyncState(A.storage).on,false,'signing in does not turn sync on by itself');

 setSync(A.storage,true,A.win);
 assert.ok(A.events.includes('sync-change'),'the page is told to start the sync loop');
 const a=A.startSync();await settle();a.stop();
 assert.ok(a.statuses.includes('synced'));
 assert.equal(srv.db.tables.get('wallets').length,1);

 // B: nothing in common but the email and password.
 assert.equal((await B.client.signIn(EMAIL,'wrong-password-1')).code,'invalid_credentials');
 assert.equal(readAccount(B.storage),null);
 assert.equal((await B.client.signIn(EMAIL,PASSWORD)).ok,true);
 setSync(B.storage,true,B.win);
 const b=B.startSync();await settle();b.stop();
 assert.ok(b.statuses.includes('synced'));
 assert.deepEqual(tails(await B.read()),['Synthetic One:1111','Synthetic Two:2222']);
 assert.deepEqual(tails(await A.read()),tails(await B.read()));
 for(const r of srv.requests)assert.ok(r.url.startsWith(GATEWAY+'/v2/account'),'only the account routes are called: '+r.url);
});

test('delete account: server rows gone, the local wallet is still there, sync is off',async()=>{
 const srv=await setup();
 const A=profile(srv);
 A.addCard('Synthetic One','1111','card-1');
 await A.client.signUp(EMAIL,PASSWORD);await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 setSync(A.storage,true,A.win);
 await putServerCopy(srv,A);
 assert.equal(srv.db.tables.get('wallets').length,1);

 assert.equal((await A.client.deleteAccount('not-the-password')).code,'invalid_credentials');
 assert.ok(readAccount(A.storage),'a wrong password deletes nothing and keeps the session');
 assert.equal((await A.client.deleteAccount(PASSWORD)).ok,true);
 for(const name of TABLES)assert.equal(srv.db.tables.get(name).length,0,name+' is empty');
 assert.equal(readAccount(A.storage),null);
 assert.equal(readSyncState(A.storage).on,false);
 assert.equal(A.storage.getItem(SYNC_STATE_KEY)!=null&&readSyncState(A.storage).base,null,'the last synced copy is forgotten');
 assert.deepEqual(tails(await A.read()),['Synthetic One:1111'],'the wallet on this device is untouched');
 // The deleted account cannot sign in any more.
 assert.equal((await profile(srv).client.signIn(EMAIL,PASSWORD)).code,'invalid_credentials');
});

test('sign out keeps the local wallet, drops the session and turns sync off; the server copy stays',async()=>{
 const srv=await setup();
 const A=profile(srv);
 A.addCard('Synthetic One','1111','card-1');
 await A.client.signUp(EMAIL,PASSWORD);await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 setSync(A.storage,true,A.win);
 await putServerCopy(srv,A);
 const r=await A.client.signOut();
 assert.deepEqual(r,{ok:true,serverSignedOut:true});
 assert.equal(A.storage.getItem(ACCOUNT_SESSION_KEY),null);
 assert.equal(syncIsOn(A.storage),false);
 assert.deepEqual(tails(await A.read()),['Synthetic One:1111']);
 assert.equal(srv.db.tables.get('wallets').length,1,'signing out does not delete the server copy');
 assert.equal(srv.db.tables.get('sessions').length,0,'the session is gone on the server too');
 // Signed out with no way to reach the server still signs out here.
 const B=profile(srv);
 await B.client.signIn(EMAIL,PASSWORD);
 const off=createAccountClient({gateway:GATEWAY,storage:B.storage,fetchFn:()=>Promise.reject(new TypeError('x')),win:B.win});
 assert.deepEqual(await off.signOut(),{ok:true,serverSignedOut:false});
 assert.equal(readAccount(B.storage),null);
});

test('signing in as another account on a device never carries over the last account\'s sync state',async()=>{
 const srv=await setup();
 const A=profile(srv);
 await A.client.signUp(EMAIL,PASSWORD);await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 setSync(A.storage,true,A.win);
 A.storage.setItem(SYNC_STATE_KEY,JSON.stringify({on:true,revision:7,base:{x:1},changedAt:null}));
 await A.client.signIn(EMAIL,PASSWORD);
 assert.deepEqual(readSyncState(A.storage),{on:false,revision:0,base:null,changedAt:null});
});

test('forgot password: a code sets a new password, signs in, and the old password stops working',async()=>{
 const srv=await setup();
 const A=profile(srv);
 await A.client.signUp(EMAIL,PASSWORD);await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 const B=profile(srv);
 assert.equal((await B.client.forgot(EMAIL)).ok,true);
 assert.equal((await B.client.reset(EMAIL,'000000',NEW_PASSWORD)).code,'code_invalid');
 const r=await B.client.reset(EMAIL,srv.lastCode(EMAIL),NEW_PASSWORD);
 assert.equal(r.ok,true);assert.equal(readAccount(B.storage).email,EMAIL);
 assert.equal((await profile(srv).client.signIn(EMAIL,PASSWORD)).code,'invalid_credentials');
 assert.equal((await profile(srv).client.signIn(EMAIL,NEW_PASSWORD)).ok,true);
});

test('change password needs the current one and signs the other devices out',async()=>{
 const srv=await setup();
 const A=profile(srv),B=profile(srv);
 await A.client.signUp(EMAIL,PASSWORD);await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 await B.client.signIn(EMAIL,PASSWORD);
 assert.equal((await A.client.changePassword('wrong-password-1',NEW_PASSWORD)).code,'invalid_credentials');
 assert.equal((await A.client.changePassword(PASSWORD,NEW_PASSWORD)).ok,true);
 assert.equal((await profile(srv).client.signIn(EMAIL,NEW_PASSWORD)).ok,true);
 assert.equal(srv.db.tables.get('sessions').length>=1,true);
 // B's session was revoked: its next sync is told it is signed out.
 B.storage.setItem(SYNC_STATE_KEY,JSON.stringify({on:true,revision:0,base:null,changedAt:null}));
 const b=B.startSync();
 for(let i=0;i<100&&!b.statuses.includes('signed_out');i++)await new Promise(r=>setTimeout(r,50));
 b.stop();
 assert.ok(b.statuses.includes('signed_out'));
});

test('an unverified email is told so, and errors map to codes the screens have a message for',async()=>{
 const srv=await setup();
 const A=profile(srv);
 await A.client.signUp(EMAIL,PASSWORD);
 assert.equal((await A.client.signIn(EMAIL,PASSWORD)).code,'email_unverified');
 assert.equal((await A.client.verify(EMAIL,'123456')).code,'code_invalid');
 assert.equal((await A.client.signUp('not-an-email',PASSWORD)).code,'bad_request');
 assert.equal((await A.client.signUp('x@example.test','short')).code,'weak_password');
 // Lockout carries retryAfter.
 for(let i=0;i<5;i++)await A.client.signIn(EMAIL,'wrong-password-'+i);
 const locked=await A.client.signIn(EMAIL,PASSWORD);
 assert.equal(locked.code,'account_locked');assert.ok(locked.retryAfter>0);
 // No network, and a server answering with something unexpected.
 const offline=createAccountClient({gateway:GATEWAY,storage:memory(),fetchFn:()=>Promise.reject(new TypeError('x')),win:new EventTarget()});
 assert.equal((await offline.signIn(EMAIL,PASSWORD)).code,'offline');
 const odd=createAccountClient({gateway:GATEWAY,storage:memory(),fetchFn:async()=>({ok:false,status:500,json:async()=>{throw Error('html')}}),win:new EventTarget()});
 assert.equal((await odd.signIn(EMAIL,PASSWORD)).code,'error');
 // An authenticated call with no session makes no request.
 let called=0;
 const none=createAccountClient({gateway:GATEWAY,storage:memory(),fetchFn:async()=>{called++;return {ok:true,status:200,json:async()=>({})};},win:new EventTarget()});
 assert.equal((await none.changePassword('a','b')).code,'unauthorized');assert.equal(called,0);
});

test('the screens never write the password or code anywhere, and an expired session reads as signed out',async()=>{
 const srv=await setup();
 const A=profile(srv);
 await A.client.signUp(EMAIL,PASSWORD);await A.client.verify(EMAIL,srv.lastCode(EMAIL));
 for(const k of A.storage.keys())assert.ok(!A.storage.getItem(k).includes(PASSWORD),k+' holds no password');
 const s=JSON.parse(A.storage.getItem(ACCOUNT_SESSION_KEY));
 assert.ok(readAccount(A.storage,(s.expiresAt-10)*1000));
 assert.equal(readAccount(A.storage,(s.expiresAt+10)*1000),null);
 assert.equal(readAccount(memory()),null);
 assert.ok(emailLooksValid('a@b.co')&&!emailLooksValid('a@b')&&!emailLooksValid(''));
 assert.ok(passwordLongEnough('0123456789')&&!passwordLongEnough('012345678'));
});
