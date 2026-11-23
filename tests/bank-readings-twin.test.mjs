// Desktop readings reach the phone even when the phone holds a Plaid-added twin of the same card (stl00/Cardybara#580,
// extends the cross-device run of #416/#452). Gateway account code runs in memory; synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {createAccountClient,setSync} from '../src/accountClient.js';
import {startWalletSync,readSyncState,setSyncOn} from '../src/walletSync.js';
import {readWalletDocument,replaceWalletDocument} from '../src/walletDocument.js';
import {lastBankRead} from '../src/bankReadings.js';
import {applyLive,mergeBankResult,LIVE_KEY} from '../src/live.js';
import {newWalletCard} from '../src/walletRegistry.js';

const ORIGIN='https://app.cardybara.test',GATEWAY='https://gateway.test';
const MIGRATION=['0001_accounts','0002_passkeys','0003_plaid'].map(f=>readFileSync(new URL(`../gateway/migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
const EMAIL='synthetic.user@example.test',PASSWORD='synthetic-pass-0001';
const T0=Date.parse('2026-11-17T12:00:00Z');
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
const ledgers={readBenefitEvents:async()=>[],readCostEvents:async()=>[],importBenefitEvents:async()=>{},importCostEvents:async()=>{}};
const READ_AT='2026-11-17T10:00:00Z';

async function setup(){
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail();
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>'},bindings:{DB:db,EMAIL:mail},log:()=>{},now:()=>T0});
 const fetchFn=async(url,init)=>g.handle(new Request(url,{method:init.method,body:init.body,headers:{Origin:ORIGIN,...init.headers}}));
 const lastCode=to=>/\b(\d{6})\b/.exec([...mail.sent].reverse().find(x=>x.to===to)?.text||'')?.[1]??null;
 return {fetchFn,lastCode};
}
function device(srv){
 const storage=memory(),win=new EventTarget();
 const client=createAccountClient({gateway:GATEWAY,storage,fetchFn:srv.fetchFn,now:()=>T0,win});
 const read=()=>readWalletDocument({storage,...ledgers});
 const syncOnce=async()=>{
  const statuses=[];
  const stop=startWalletSync({gateway:GATEWAY,storage,win:new EventTarget(),doc:null,fetchFn:srv.fetchFn,readLocal:read,applyLocal:doc=>replaceWalletDocument(doc,{storage,...ledgers}),onStatus:s=>statuses.push(s)});
  const end=Date.now()+10000;while(!statuses.includes('synced')&&Date.now()<end)await new Promise(r=>setTimeout(r,5));
  stop();return statuses;
 };
 const registry=cards=>storage.setItem('cardybara-wallet-cards-v1',JSON.stringify(cards));
 const shown=()=>applyLive({cards:JSON.parse(storage.getItem('cardybara-wallet-cards-v1')||'[]'),connections:[]},JSON.parse(storage.getItem(LIVE_KEY)||'{}')).cards;
 return {storage,win,client,syncOnce,registry,shown};
}
const bankCard=(id,tail)=>({id,bank:'Chase',name:'Synthetic Bank Card',tail,region:'US',currency:'USD',identitySource:'bank-page'});
const readIt=(d,id,fields)=>d.storage.setItem(LIVE_KEY,JSON.stringify({Chase:mergeBankResult(undefined,{bank:'Chase',status:'updated',attemptedAt:READ_AT,tabId:9,patches:[{id,capturedAt:READ_AT,fields,locale:'en-US'}]})}));
async function signedIn(srv,d,first){
 if(first){await d.client.signUp(EMAIL,PASSWORD);await d.client.verify(EMAIL,srv.lastCode(EMAIL));}
 else assert.equal((await d.client.signIn(EMAIL,PASSWORD)).ok,true);
 setSync(d.storage,true,d.win);
}

for(const order of ['extension first','web first']){
 test(`a Plaid-added twin on the web shows the desktop readings with their dates (${order})`,async()=>{
  const srv=await setup(),ext=device(srv),web=device(srv);
  ext.registry([bankCard('bank-1','1111')]);
  readIt(ext,'bank-1',{balance:250.5,statement:200,minimum:35});
  web.registry([newWalletCard({bank:'Chase',name:'Synthetic Plaid Name',tail:'1111'},'plaid-1')]);
  await signedIn(srv,ext,true);await signedIn(srv,web,false);
  if(order==='extension first'){await ext.syncOnce();}
  else{await web.syncOnce();await ext.syncOnce();}
  assert.equal((await web.syncOnce()).at(-1),'synced');
  const cards=web.shown().filter(c=>c.tail==='1111');
  assert.equal(cards.length,1,'one card for the bank and digits');
  assert.equal(cards[0].balance,250.5);assert.equal(cards[0].statement,200);assert.equal(cards[0].minimum,35);
  assert.equal(lastBankRead(cards[0]),READ_AT,'with the day they were read');
 });
}

test('without a twin the readings reach the web card after one sync',async()=>{
 const srv=await setup(),ext=device(srv),web=device(srv);
 ext.registry([bankCard('bank-1','1111')]);readIt(ext,'bank-1',{balance:90});
 await signedIn(srv,ext,true);await signedIn(srv,web,false);
 await ext.syncOnce();await web.syncOnce();
 const c=web.shown().find(x=>x.id==='bank-1');
 assert.equal(c.balance,90);assert.equal(lastBankRead(c),READ_AT);
});

test('a bank page that shows five digits and a Plaid-added card with the last four are one card in the merged wallet',async()=>{
 const srv=await setup(),ext=device(srv),web=device(srv);
 ext.registry([bankCard('bank-1','01111')]);readIt(ext,'bank-1',{balance:42});
 web.registry([newWalletCard({bank:'Chase',name:'Synthetic Plaid Name',tail:'1111'},'plaid-1')]);
 await signedIn(srv,ext,true);await signedIn(srv,web,false);
 await ext.syncOnce();await web.syncOnce();
 const cards=web.shown();
 assert.equal(cards.length,1,'not two rows for one card');
 assert.equal(cards[0].balance,42);assert.equal(lastBankRead(cards[0]),READ_AT);
});

test('two five-digit cards that share their last four stay two cards',async()=>{
 const srv=await setup(),ext=device(srv),web=device(srv);
 ext.registry([bankCard('bank-1','01111'),bankCard('bank-2','91111')]);
 web.registry([]);
 await signedIn(srv,ext,true);await signedIn(srv,web,false);
 await ext.syncOnce();await web.syncOnce();
 assert.equal(web.shown().length,2);
});

test('the sync state remembers when a sync last finished, and forgets it when sync is turned off',async()=>{
 const srv=await setup(),web=device(srv);
 web.registry([newWalletCard({bank:'Chase',name:'Synthetic',tail:'1111'},'m-1')]);
 await signedIn(srv,web,true);
 assert.equal(readSyncState(web.storage).syncedAt,undefined,'never synced yet');
 const before=Date.now();await web.syncOnce();
 assert.ok(readSyncState(web.storage).syncedAt>=before);
 setSyncOn(web.storage,false);
 assert.equal(readSyncState(web.storage).syncedAt,undefined);
});
