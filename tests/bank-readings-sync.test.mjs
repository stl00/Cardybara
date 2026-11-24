// Bank readings in the synced wallet (stl00/Cardybara#416, epic #410). The extension reads banks in the user's own
// browser; only the amounts and read times join the wallet document, so a second device (the PWA) shows them after one
// sync. Cross-device run against the gateway's real account code (in-memory D1 and mail); synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway,memoryD1,memoryMail} from '../gateway/src/local.mjs';
import {createAccountClient,setSync} from '../src/accountClient.js';
import {startWalletSync,mergeWalletDocuments,ACCOUNT_SESSION_KEY} from '../src/walletSync.js';
import {readWalletDocument,replaceWalletDocument,writeWalletDocument,migrateWalletDocument,DEVICE_ONLY,DOCUMENT_STORAGE} from '../src/walletDocument.js';
import {readingsFromLive,mergeBankReadings,readBankReadings,storeBankReadings,lastBankRead,emptyReadings} from '../src/bankReadings.js';
import {applyLive,mergeBankResult,LIVE_KEY} from '../src/live.js';
import {mergeWalletCards,newWalletCard} from '../src/walletRegistry.js';
import {guardWalletPuts} from './helpers/account-body.mjs';
import {validWalletDocument} from '../gateway/src/walletSchema.js';

const ORIGIN='https://app.cardybara.test',GATEWAY='https://gateway.test';
const MIGRATION=['0001_accounts','0002_passkeys','0003_plaid'].map(f=>readFileSync(new URL(`../gateway/migrations/${f}.sql`,import.meta.url),'utf8')).join('\n');
const EMAIL='synthetic.user@example.test',PASSWORD='synthetic-pass-0001';
const T0=Date.parse('2026-11-17T12:00:00Z');
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),keys:()=>[...m.keys()]};};
const ledgers={readBenefitEvents:async()=>[],readCostEvents:async()=>[],importBenefitEvents:async()=>{},importCostEvents:async()=>{}};

const patch=(id,fields,at='2026-11-17T10:00:00Z',extra={})=>({id,capturedAt:at,fields,locale:'en-US',...extra});
const live=(...patches)=>({'Amex US':{attemptedAt:'2026-11-17T10:00:00Z',status:'updated',tabId:42,receivedCount:patches.length,patches}});

async function setup(){
 const db=memoryD1();await db.exec(MIGRATION);
 const mail=memoryMail();let clock=T0;
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,ACCOUNT_EMAIL_FROM:'Cardybara <no-reply@mail.cardybara.test>'},bindings:{DB:db,EMAIL:mail},log:()=>{},now:()=>clock});
 const requests=[];
 const fetchFn=async(url,init)=>{requests.push({url,method:init.method,body:init.body??null});return g.handle(new Request(url,{method:init.method,body:init.body,headers:{Origin:ORIGIN,...init.headers}}));};
 const lastCode=to=>/\b(\d{6})\b/.exec([...mail.sent].reverse().find(x=>x.to===to)?.text||'')?.[1]??null;
 return {db,requests,fetchFn:guardWalletPuts(fetchFn),lastCode};
}
function device(srv){
 const storage=memory(),win=new EventTarget();
 const client=createAccountClient({gateway:GATEWAY,storage,fetchFn:srv.fetchFn,now:()=>T0,win});
 const read=()=>readWalletDocument({storage,...ledgers});
 const start=()=>{const statuses=[];const stop=startWalletSync({gateway:GATEWAY,storage,win:new EventTarget(),doc:null,fetchFn:srv.fetchFn,readLocal:read,applyLocal:doc=>replaceWalletDocument(doc,{storage,...ledgers}),onStatus:s=>statuses.push(s)});return {statuses,stop};};
 const settle=async s=>{const end=Date.now()+10000;while(!s.statuses.includes('synced')&&Date.now()<end)await new Promise(r=>setTimeout(r,5));};
 const syncOnce=async()=>{const s=start();await settle(s);s.stop();return s;};
 const registry=cards=>storage.setItem('cardybara-wallet-cards-v1',JSON.stringify(cards));
 const shown=()=>{const cards=JSON.parse(storage.getItem('cardybara-wallet-cards-v1')||'[]');return applyLive({cards,connections:[]},JSON.parse(storage.getItem(LIVE_KEY)||'{}')).cards;};
 return {storage,win,client,read,syncOnce,registry,shown};
}
const bankCard=(id,tail)=>({id,bank:'Amex US',name:'Synthetic Bank Card',tail,region:'US',currency:'USD',identitySource:'bank-page'});

test('what leaves the live store is the allow-listed amounts and read times, nothing else',()=>{
 const dirty=live(patch('card-a',{balance:123.45,minimum:25,due:'2026-12-01',note:'text'},'2026-11-17T10:00:00Z',{
  fieldSources:{balance:'summary',minimum:'<script>x</script>'},evidence:'raw page text',html:'<b>',cookies:'c=1',pageText:'secret'}));
 dirty['Amex US'].evidence='page evidence';dirty['Amex US'].liveTabId=7;
 const out=readingsFromLive(dirty);
 assert.deepEqual(Object.keys(out),['schema','banks']);
 const e=out.banks['Amex US'];
 assert.deepEqual(Object.keys(e).sort(),['attemptedAt','patches','status']);
 assert.deepEqual(e.patches,[{id:'card-a',capturedAt:'2026-11-17T10:00:00Z',fields:{balance:123.45,minimum:25},fieldCapturedAt:{balance:'2026-11-17T10:00:00Z',minimum:'2026-11-17T10:00:00Z'},fieldSources:{balance:'summary'}}]);
 const text=JSON.stringify(out);
 for(const bad of ['evidence','raw page','cookies','pageText','secret','script','tabId','2026-12-01','note'])assert.ok(!text.includes(bad),bad);
 assert.equal(validWalletDocument({formatVersion:1,bankReadings:out}),true,'the gateway schema accepts the section as it is');
 // Missing amounts stay missing: a NaN or absent field is never turned into a number.
 assert.deepEqual(readingsFromLive(live(patch('card-a',{balance:NaN,minimum:null}))),emptyReadings());
 assert.deepEqual(readingsFromLive(null),emptyReadings());
});

test('the later reading of each field wins, whichever side holds it; a removed card loses its readings',()=>{
 const a=readingsFromLive(live(patch('card-a',{balance:100,minimum:10},'2026-11-17T10:00:00Z'),patch('card-b',{balance:5},'2026-11-10T10:00:00Z')));
 const b=readingsFromLive(live(patch('card-a',{balance:90,statement:40},'2026-11-17T11:00:00Z')));
 const m=mergeBankReadings(a,b),p=m.banks['Amex US'].patches;
 assert.deepEqual(p.map(x=>x.id),['card-a','card-b']);
 assert.deepEqual(p[0].fields,{balance:90,minimum:10,statement:40},'the 11:00 balance beats the 10:00 one; the other fields join');
 assert.equal(p[0].fieldCapturedAt.minimum,'2026-11-17T10:00:00Z');
 assert.deepEqual(mergeBankReadings(b,a).banks['Amex US'].patches[0].fields,{balance:90,minimum:10,statement:40},'either order');
 assert.deepEqual(m,mergeBankReadings(m,m),'merging again changes nothing');
 const dropped=mergeBankReadings(a,b,id=>id==='card-a'?null:id).banks['Amex US'].patches;
 assert.deepEqual(dropped.map(x=>x.id),['card-b']);
});

test('stored readings show on the card through the wallet\'s own applyLive, with the time they were read',()=>{
 const s=memory();
 storeBankReadings(s,readingsFromLive(live(patch('card-a',{balance:321.5,minimum:25},'2026-11-17T10:00:00Z'))));
 const [c]=applyLive({cards:[bankCard('card-a','1111')],connections:[]},JSON.parse(s.getItem(LIVE_KEY))).cards;
 assert.equal(c.balance,321.5);assert.equal(c.minimum,25);
 assert.equal(lastBankRead(c),'2026-11-17T10:00:00Z');
 assert.equal(lastBankRead({}),null);
 // A device that holds extra local fields keeps them for the cards that stay; replace drops a removed card's readings.
 s.setItem(LIVE_KEY,JSON.stringify(live(patch('card-a',{balance:1,due:5}),patch('card-gone',{balance:2}))));
 storeBankReadings(s,readingsFromLive(live(patch('card-a',{balance:7},'2026-11-18T10:00:00Z'))),{replace:true});
 const kept=JSON.parse(s.getItem(LIVE_KEY))['Amex US'].patches;
 assert.deepEqual(kept.map(p=>p.id),['card-a']);assert.equal(kept[0].fields.balance,7);assert.equal(kept[0].fields.due,5);
});

test('the live store moved from device-only to a document section, and an older document reads as no readings',()=>{
 assert.ok(!(LIVE_KEY in DEVICE_ONLY));assert.ok(LIVE_KEY in DOCUMENT_STORAGE);
 const doc=migrateWalletDocument({cards:[],rewards:[],transactions:[],offers:[],benefits:[],connections:[]});
 assert.deepEqual(doc.bankReadings,emptyReadings());
 const merged=mergeWalletDocuments({base:null,local:migrateWalletDocument({formatVersion:1}),remote:migrateWalletDocument({formatVersion:1}),localNewer:true});
 assert.deepEqual(merged.bankReadings,emptyReadings());
});

test('a card removed on one device takes its readings with it in the merged document',()=>{
 const local=migrateWalletDocument({formatVersion:1,bankReadings:readingsFromLive(live(patch('card-a',{balance:1}),patch('card-b',{balance:2})))});
 const remote=migrateWalletDocument({formatVersion:1,walletCards:{cards:[],removed:[{id:'card-a',bank:'Amex US',tail:'1111'}]},bankReadings:readingsFromLive(live(patch('card-a',{balance:1})))});
 const m=mergeWalletDocuments({base:null,local,remote,localNewer:false});
 assert.deepEqual(m.bankReadings.banks['Amex US'].patches.map(p=>p.id),['card-b']);
});

test('a backup carries the readings and an import only adds or updates them',async()=>{
 const A=memory(),B=memory();
 A.setItem(LIVE_KEY,JSON.stringify(live(patch('card-a',{balance:50},'2026-11-17T10:00:00Z'))));
 B.setItem(LIVE_KEY,JSON.stringify(live(patch('card-a',{balance:60},'2026-11-18T10:00:00Z'),patch('card-b',{balance:3}))));
 const doc=await readWalletDocument({storage:A,...ledgers});
 await writeWalletDocument(doc,{storage:B,...ledgers});
 const p=readBankReadings(B).banks['Amex US'].patches;
 assert.deepEqual(p.map(x=>[x.id,x.fields.balance]),[['card-a',60],['card-b',3]],'the newer local reading stays, the other card stays');
});

test('cross-device: PWA with two manual cards; the extension signs in and reads fixture banks; the PWA shows the bank amounts after one sync',async()=>{
 const srv=await setup();
 const pwa=device(srv),ext=device(srv);
 // The PWA: two manual cards, signed in and syncing.
 pwa.registry([newWalletCard({bank:'Chase',name:'Synthetic Manual One',tail:'1111'},'manual-1'),newWalletCard({bank:'Chase',name:'Synthetic Manual Two',tail:'2222'},'manual-2')]);
 await pwa.client.signUp(EMAIL,PASSWORD);await pwa.client.verify(EMAIL,srv.lastCode(EMAIL));
 setSync(pwa.storage,true,pwa.win);
 assert.equal((await pwa.syncOnce()).statuses.at(-1),'synced');

 // The extension: signs in with the same email and password, has bank-read cards with amounts (a fixture read).
 assert.equal((await ext.client.signIn(EMAIL,PASSWORD)).ok,true);
 ext.registry([bankCard('bank-1','3333'),bankCard('bank-2','4444')]);
 const result={bank:'Amex US',status:'updated',attemptedAt:'2026-11-17T10:00:00Z',tabId:9,patches:[
  patch('bank-1',{balance:1234.56,minimum:35,statement:1200},'2026-11-17T10:00:00Z',{evidence:'raw page text'}),
  patch('bank-2',{balance:78.9},'2026-11-17T10:00:00Z')]};
 ext.storage.setItem(LIVE_KEY,JSON.stringify({'Amex US':mergeBankResult(undefined,result)}));
 setSync(ext.storage,true,ext.win);
 assert.equal((await ext.syncOnce()).statuses.at(-1),'synced');

 // One sync on the PWA.
 assert.equal((await pwa.syncOnce()).statuses.at(-1),'synced');
 const cards=pwa.shown();
 assert.deepEqual(cards.map(c=>c.name).sort(),['Synthetic Bank Card','Synthetic Bank Card','Synthetic Manual One','Synthetic Manual Two']);
 const one=cards.find(c=>c.id==='bank-1'),two=cards.find(c=>c.id==='bank-2');
 assert.equal(one.balance,1234.56);assert.equal(one.minimum,35);assert.equal(two.balance,78.9);
 assert.equal(one.identitySource,'bank-page','the PWA can tell which cards came from the bank');
 assert.equal(lastBankRead(one),'2026-11-17T10:00:00Z','and when they were last read');
 assert.equal(cards.find(c=>c.id==='manual-1').balance??null,null,'a manual card gets no amount it was never given');
 // And the extension kept its own two cards and gained the manual ones.
 assert.equal(ext.shown().length,4);

 // A later read on the extension reaches the PWA on the next sync; an older copy never overwrites a newer one.
 ext.storage.setItem(LIVE_KEY,JSON.stringify({'Amex US':mergeBankResult(JSON.parse(ext.storage.getItem(LIVE_KEY))['Amex US'],{status:'updated',attemptedAt:'2026-11-18T09:00:00Z',patches:[patch('bank-1',{balance:1000},'2026-11-18T09:00:00Z')]})}));
 await ext.syncOnce();await pwa.syncOnce();
 assert.equal(pwa.shown().find(c=>c.id==='bank-1').balance,1000);
 assert.equal(pwa.shown().find(c=>c.id==='bank-1').minimum,35,'fields the later read did not carry keep their own date');

 // What the server holds has the amounts and read times, and none of the page text, tab ids or credentials.
 const stored=JSON.stringify([...srv.db.tables.get('wallets')]);
 assert.ok(stored.includes('1000'));
 for(const bad of ['raw page text','tabId','evidence',PASSWORD])assert.ok(!stored.includes(bad),bad);
 for(const r of srv.requests)assert.ok(r.url.startsWith(GATEWAY+'/v2/account'),'only the account routes are called: '+r.url);
 for(const r of srv.requests)if(r.body)assert.ok(!r.body.includes('raw page text')&&!r.body.includes('tabId'));
 assert.ok(pwa.storage.getItem(ACCOUNT_SESSION_KEY));
});
