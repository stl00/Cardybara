// Wallet sync between devices (stl00/Cardybara#414). Every wallet, card and amount below is synthetic.
// The server is an in-memory stand-in with the gateway's /v2/account/wallet contract: GET gives {revision, formatVersion,
// document, updatedAt}; PUT {baseRevision, formatVersion, document} is stored only if baseRevision is the stored
// revision, else 409 stale_revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readWalletDocument,replaceWalletDocument,WALLET_FORMAT_VERSION} from '../src/walletDocument.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {cardProducts} from '../src/productCatalog.js';
import {validateCostEvent} from '../src/costTracking.js';
import {assertWalletBody} from './helpers/account-body.mjs';
import {SYNC_STATE_KEY,ACCOUNT_SESSION_KEY,CHANGE_EVENTS,createAccountTransport,createWalletSync,startWalletSync,mergeWalletDocuments,readSyncState,setSyncOn,stableJson} from '../src/walletSync.js';

const GATEWAY='https://gateway.example.test';
const TOKEN='cbs_'+'A'.repeat(43);
const bank=cardProducts[0].bank;
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

function fakeServer(nowSec){
 const s={revision:0,document:null,formatVersion:null,updatedAt:null,requests:[],clock:1_700_000_000,beforePut:null};
 s.fetch=async(url,init)=>{
  s.requests.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});
  assert.equal(url,GATEWAY+'/v2/account/wallet');
  assert.equal(init.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(init.credentials,'omit');
  const reply=(status,body)=>({ok:status<300,status,json:async()=>body});
  if(init.method==='GET')return reply(200,{revision:s.revision,formatVersion:s.formatVersion,document:s.document,updatedAt:s.updatedAt});
  if(s.beforePut){const f=s.beforePut;s.beforePut=null;f();}
  // Every captured PUT body must stay inside the sync boundary (PRIVACY.md, #410, #547).
  assertWalletBody(init.body,'PUT body');
  const b=JSON.parse(init.body);
  if(b.baseRevision!==s.revision)return reply(409,{error:{code:'stale_revision',revision:s.revision}});
  s.revision++;s.document=JSON.parse(JSON.stringify(b.document));s.formatVersion=b.formatVersion;s.updatedAt=nowSec?nowSec():++s.clock;
  return reply(200,{revision:s.revision,size:init.body.length});
 };
 return s;
}

function device(server,{on=true,signedIn=true,clock}={}){
 const storage=memory(),personal=[],cost=[];
 if(on)setSyncOn(storage,true);
 if(signedIn)storage.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token:TOKEN}));
 const ledgers={
  readBenefitEvents:async()=>[...personal],readCostEvents:async()=>[...cost],
  importBenefitEvents:async b=>{for(const e of b.events)if(!personal.some(x=>x.id===e.id))personal.push(e);},
  importCostEvents:async b=>{for(const e of b.events)if(!cost.some(x=>x.id===e.id))cost.push(e);},
 };
 const read=()=>readWalletDocument({storage,...ledgers});
 const statuses=[];
 let online=true;
 const fetchFn=(...a)=>{if(!online)return Promise.reject(new TypeError('Failed to fetch'));return server.fetch(...a);};
 const engine=createWalletSync({
  transport:createAccountTransport({gateway:GATEWAY,token:()=>JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)||'null')?.token,fetchFn}),
  readLocal:read,applyLocal:doc=>replaceWalletDocument(doc,{storage,...ledgers}),
  storage,isOn:()=>readSyncState(storage).on,now:clock||(()=>Date.now()),onStatus:s=>statuses.push(s),
  timers:{set:()=>0,clear:()=>{}},
 });
 const json=(k,f)=>{try{return JSON.parse(storage.getItem(k))??f}catch{return f}};
 return {storage,personal,cost,read,engine,statuses,json,set:(k,v)=>storage.setItem(k,JSON.stringify(v)),offline(){online=false;},online(){online=true;}};
}
const manual=(name,tail,id)=>newWalletCard({bank,name,tail},id);
const costEvent=(id,cardId,start)=>validateCostEvent({schema:1,id,cardId,kind:'fee',key:JSON.stringify(['fee',cardId,start]),at:'2026-11-01T00:00:00.000Z',value:{start,end:start.slice(0,4)+'-12-31',currency:'USD',listedFee:95,charged:95,refund:null,waiver:'none',note:''}});
const benefitEvent=id=>({schema:1,id,key:JSON.stringify(['card-x','rule.synthetic']),status:'dismissed',at:'2026-11-01T00:00:00.000Z',revisionId:null});
const tails=doc=>doc.walletCards.cards.map(c=>c.bank+':'+c.tail).sort();

test('conflict set: two devices edit offline, both reconnect, no edit is lost and no card is duplicated',async()=>{
 let t=Date.parse('2026-11-17T10:00:00Z');const clock=()=>t;
 const server=fakeServer(()=>Math.floor(t/1000));
 const A=device(server,{clock}),B=device(server,{clock});
 // A starts the wallet and syncs it; B signs in and pulls it.
 A.set('cardybara-wallet-cards-v1',[manual('Synthetic One','1111','card-1')]);
 A.set('cardybara-favorites',['card-1']);
 assert.equal(await A.engine.sync(),'synced');
 assert.equal(await B.engine.sync(),'synced');
 assert.deepEqual(tails(await B.read()),[bank+':1111']);

 // Offline on both.
 A.offline();B.offline();
 // A: renames card-1, adds a card ending 2222, marks a payment, sets a point value... and a reminder lead time.
 A.set('cardybara-wallet-cards-v1',[{...manual('Synthetic One Renamed','1111','card-1')},manual('Synthetic Two','2222','card-a2')]);
 A.set('cardybara-payment-handled-v1',[{key:JSON.stringify(['card-1','date','2026-12-01']),at:'2026-11-17T10:01:00.000Z'}]);
 A.set('cardybara-reminders-v1',{enabled:true,billDays:7});
 A.cost.push(costEvent('cost-a','card-1','2026-01-01'));
 A.engine.changed();
 // B: adds the same card ending 2222 under its own id, sets a fee date overlay on card-1, favourites the new card,
 // turns credit reminders off, records a benefit event.
 t+=1000;
 B.set('cardybara-wallet-cards-v1',[manual('Synthetic One','1111','card-1'),manual('Synthetic Two (B)','2222','card-b2')]);
 B.set('cardybara-card-edits-v1',[{cardId:'card-1',feeDate:{month:3,day:15}}]);
 B.set('cardybara-favorites',['card-1','card-b2']);
 B.set('cardybara-reminders-v1',{credits:false,billDays:1});
 B.personal.push(benefitEvent('benefit-b'));
 B.engine.changed();
 // While offline a sync fails softly and writes nothing.
 const rev=server.revision;
 assert.equal(await A.engine.sync(true),'offline');
 assert.equal(server.revision,rev);

 // A reconnects at the time of B's last edit, so B's edit is the newer one.
 // Both reconnect: A first, then B (whose push is stale, so it pulls, merges and pushes), then A pulls.
 A.online();B.online();
 assert.equal(await A.engine.sync(true),'synced');
 const before=server.requests.length;
 assert.equal(await B.engine.sync(true),'synced');
 assert.ok(server.requests.slice(before).some(r=>r.method==='PUT')&&server.requests.slice(before).some(r=>r.method==='GET'),'B pulled and pushed');
 assert.equal(await A.engine.sync(true),'synced');

 const a=await A.read(),b=await B.read();
 assert.equal(stableJson(a),stableJson(b),'both devices hold the same wallet');
 assert.equal(stableJson(a),stableJson(server.document),'and so does the server');
 // No duplicate card: one row per bank and tail.
 assert.deepEqual(tails(a),[bank+':1111',bank+':2222']);
 // Every edit is still there.
 assert.equal(a.walletCards.cards.find(c=>c.id==='card-1').name,'Synthetic One Renamed');
 assert.deepEqual(a.cardEdits.edits.find(e=>e.cardId==='card-1').feeDate,{month:3,day:15});
 assert.equal(a.paymentMarks.marks.length,1);
 assert.deepEqual(a.costLedger.events.map(e=>e.id),['cost-a']);
 assert.deepEqual(a.personalBenefits.events.map(e=>e.id),['benefit-b']);
 // B's favourite of its duplicate follows the card it was folded into.
 const kept=a.walletCards.cards.find(c=>c.tail==='2222').id;
 assert.deepEqual([...a.favorites].sort(),['card-1',kept].sort());
 // Settings: each side's own change is kept field by field; the field both changed (billDays) goes to the newer side, B.
 assert.equal(a.reminderSettings.enabled,true);
 assert.equal(a.reminderSettings.credits,false);
 assert.equal(a.reminderSettings.billDays,1);
});

test('a deletion on one device is honoured when the other did not touch it',async()=>{
 const server=fakeServer(),A=device(server),B=device(server);
 A.set('cardybara-wallet-cards-v1',[manual('Synthetic One','1111','card-1'),manual('Synthetic Two','2222','card-2')]);
 A.set('cardybara-favorites',['card-1','card-2']);
 await A.engine.sync();await B.engine.sync();
 // A removes card-2 (as the wallet's remove does: out of the registry, into the removed list) and unfavourites it.
 A.set('cardybara-wallet-cards-v1',[manual('Synthetic One','1111','card-1')]);
 A.set('cardybara-wallet-removed-v1',[{id:'card-2',bank,tail:'2222'}]);
 A.set('cardybara-favorites',['card-1']);
 // B meanwhile adds an unrelated favourite only.
 B.set('cardybara-favorites',['card-1','card-2','card-1x']);
 await A.engine.sync(true);await B.engine.sync(true);await A.engine.sync(true);
 for(const d of [await A.read(),await B.read()]){
  assert.deepEqual(d.walletCards.cards.map(c=>c.id),['card-1']);
  assert.deepEqual(d.walletCards.removed.map(r=>r.id),['card-2']);
  assert.deepEqual([...d.favorites].sort(),['card-1','card-1x']);
 }
});

test('a manual row wins over a bank-read copy of the same card, and the overlay moves with it',()=>{
 const doc=over=>({formatVersion:1,walletCards:{cards:[],removed:[]},cardEdits:{schema:1,edits:[]},cardProducts:{schema:1,choices:[]},paymentMarks:{schema:1,marks:[]},pointValues:{schema:1,values:[]},reminderSettings:{},favorites:[],personalBenefits:{schema:1,events:[]},costLedger:{schema:1,events:[]},...over});
 const local=doc({walletCards:{cards:[{...manual('Synthetic Read','3333','read-1'),identitySource:'bank-page'}],removed:[]},cardEdits:{schema:1,edits:[{cardId:'read-1',feeDate:{month:4,day:1}}]}});
 const remote=doc({walletCards:{cards:[manual('Synthetic Hand','3333','hand-1')],removed:[]}});
 const m=mergeWalletDocuments({base:null,local,remote,localNewer:true});
 assert.deepEqual(m.walletCards.cards.map(c=>[c.id,c.identitySource]),[['hand-1','manual']]);
 assert.deepEqual(m.cardEdits.edits,[{cardId:'hand-1',feeDate:{month:4,day:1}}]);
});

test('both devices change the same field: the newer side wins; payment marks keep their later-mark rule',()=>{
 const base={formatVersion:1,walletCards:{cards:[manual('Synthetic','4444','c')],removed:[]},cardEdits:{schema:1,edits:[]},cardProducts:{schema:1,choices:[]},paymentMarks:{schema:1,marks:[]},pointValues:{schema:1,values:[]},reminderSettings:{billDays:3},favorites:[],personalBenefits:{schema:1,events:[]},costLedger:{schema:1,events:[]}};
 const key=JSON.stringify(['c','date','2026-12-01']);
 const local={...base,walletCards:{cards:[manual('Local name','4444','c')],removed:[]},reminderSettings:{billDays:7},paymentMarks:{schema:1,marks:[{key,at:'2026-11-02T00:00:00.000Z'}]}};
 const remote={...base,walletCards:{cards:[manual('Remote name','4444','c')],removed:[]},reminderSettings:{billDays:1},paymentMarks:{schema:1,marks:[{key,at:'2026-11-03T00:00:00.000Z'}]}};
 const newerLocal=mergeWalletDocuments({base,local,remote,localNewer:true});
 const newerRemote=mergeWalletDocuments({base,local,remote,localNewer:false});
 assert.equal(newerLocal.walletCards.cards[0].name,'Local name');assert.equal(newerLocal.reminderSettings.billDays,7);
 assert.equal(newerRemote.walletCards.cards[0].name,'Remote name');assert.equal(newerRemote.reminderSettings.billDays,1);
 for(const m of [newerLocal,newerRemote])assert.equal(m.paymentMarks.marks[0].at,'2026-11-03T00:00:00.000Z');
});

test('a write that lands between pull and push (409) is merged in, not overwritten',async()=>{
 const server=fakeServer(),A=device(server),B=device(server);
 A.set('cardybara-wallet-cards-v1',[manual('Synthetic One','1111','card-1')]);
 await A.engine.sync();await B.engine.sync();
 B.set('cardybara-favorites',['card-1']);
 // Just before B's push, another device writes a cost event to the server copy.
 server.beforePut=()=>{server.document={...server.document,costLedger:{schema:1,events:[costEvent('cost-x','card-1','2026-01-01')]}};server.revision++;};
 assert.equal(await B.engine.sync(true),'synced');
 const b=await B.read();
 assert.deepEqual(b.favorites,['card-1']);
 assert.deepEqual(b.costLedger.events.map(e=>e.id),['cost-x']);
 assert.equal(stableJson(b),stableJson(server.document));
});

test('a server copy from a newer build writes nothing here and stops sync until reload',async()=>{
 const server=fakeServer(),A=device(server);
 server.revision=5;server.formatVersion=WALLET_FORMAT_VERSION+1;server.document={formatVersion:WALLET_FORMAT_VERSION+1};server.updatedAt=1;
 A.set('cardybara-favorites',['keep']);
 const before=stableJson(await A.read());
 assert.equal(await A.engine.sync(),'newer');
 assert.equal(stableJson(await A.read()),before);
 assert.equal(server.requests.filter(r=>r.method==='PUT').length,0);
 const n=server.requests.length;
 assert.equal(await A.engine.sync(true),'off');
 assert.equal(server.requests.length,n);
});

test('a signed-out session (401) stops quietly and writes nothing',async()=>{
 const A=device({fetch:async()=>({ok:false,status:401,json:async()=>({})})});
 A.set('cardybara-favorites',['keep']);
 assert.equal(await A.engine.sync(),'signed_out');
 assert.deepEqual(A.json('cardybara-favorites'),['keep']);
});

test('sync off: no request to /v2/account is made, and no listener is added',async()=>{
 const calls=[];
 const fetchFn=async(...a)=>{calls.push(a);throw Error('must not be called');};
 const listeners=[];
 const win={addEventListener:(...a)=>listeners.push(a),removeEventListener(){}};
 const doc={visibilityState:'visible',addEventListener:(...a)=>listeners.push(a),removeEventListener(){}};
 const interval={set:()=>{listeners.push('interval');return 1;},clear(){}};
 const readLocal=async()=>{throw Error('must not read');};
 // Never turned on; turned on but signed out; signed in but turned off; no gateway.
 const cases=[
  memory(),
  (()=>{const s=memory();setSyncOn(s,true);return s;})(),
  (()=>{const s=memory();s.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token:TOKEN}));setSyncOn(s,true);setSyncOn(s,false);return s;})(),
 ];
 for(const storage of cases){
  const stop=startWalletSync({gateway:GATEWAY,storage,win,doc,fetchFn,readLocal,applyLocal:readLocal,interval});
  for(const ev of CHANGE_EVENTS)assert.ok(!listeners.some(l=>l[0]===ev));
  stop();
 }
 const on=memory();on.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token:TOKEN}));setSyncOn(on,true);
 startWalletSync({gateway:null,storage:on,win,doc,fetchFn,readLocal,applyLocal:readLocal,interval})();
 // The engine itself with sync off: every entry point is a no-op.
 const off=memory();off.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token:TOKEN}));
 const engine=createWalletSync({transport:createAccountTransport({gateway:GATEWAY,token:()=>TOKEN,fetchFn}),readLocal,applyLocal:readLocal,storage:off,isOn:()=>readSyncState(off).on,timers:{set:f=>{f();return 1;},clear(){}}});
 assert.equal(await engine.sync(true),'off');
 engine.changed();assert.equal(await engine.check(),false);
 await new Promise(r=>setTimeout(r,0));
 assert.equal(calls.length,0);
 assert.equal(listeners.length,0);
 assert.equal(off.getItem(SYNC_STATE_KEY),null);
});

test('sync on: start pulls once and registers its listeners; stop removes them',async()=>{
 const server=fakeServer(),storage=memory();
 storage.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token:TOKEN}));setSyncOn(storage,true);
 const added=new Map(),win={addEventListener:(e,f)=>added.set(e,f),removeEventListener:e=>added.delete(e)};
 const doc={visibilityState:'visible',addEventListener:(e,f)=>added.set(e,f),removeEventListener:e=>added.delete(e)};
 let cleared=false;
 const empty={formatVersion:1};
 const stop=startWalletSync({gateway:GATEWAY,storage,win,doc,fetchFn:server.fetch,readLocal:async()=>empty,applyLocal:async()=>{},interval:{set:()=>7,clear:id=>{cleared=id===7;}}});
 for(const e of ['focus','online','visibilitychange',...CHANGE_EVENTS])assert.ok(added.has(e),e);
 await new Promise(r=>setTimeout(r,10));
 assert.equal(server.requests[0].method,'GET');
 assert.equal(readSyncState(storage).revision,1);
 stop();
 assert.equal(added.size,0);assert.ok(cleared);
});

test('the sync boundary check is live: a PUT body with a stray section or a credential-like key fails the stand-in server',async()=>{
 const server=fakeServer();
 const put=document=>server.fetch(GATEWAY+'/v2/account/wallet',{method:'PUT',headers:{Authorization:'Bearer '+TOKEN},credentials:'omit',body:JSON.stringify({baseRevision:0,formatVersion:1,document})});
 await assert.rejects(put({walletCards:{cards:[]},bankSnapshot:{}}),/leaves the wallet document/);
 await assert.rejects(put({walletCards:{cards:[{id:'a',cookie:'x'}]}}),/leaves the wallet document/);
 assert.equal((await put({walletCards:{cards:[]}})).status,200);
});
