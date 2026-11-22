// The whole wallet as one versioned document (stl00/Cardybara#411). Every wallet below is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DEVICE_ONLY,DOCUMENT_STORAGE,WALLET_FORMAT_VERSION,migrateWalletDocument,isNewerWalletDocument,readWalletDocument,writeWalletDocument,walletImportErrorKey} from '../src/walletDocument.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {cardProducts} from '../src/productCatalog.js';
import {valuationTable} from '../src/pointValues.js';

const memory=(init={})=>{const m=new Map(Object.entries(init));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),keys:()=>[...m.keys()]};};
const ledgers=()=>{const personal=[],cost=[];return {personal,cost,
 readBenefitEvents:async()=>[...personal],readCostEvents:async()=>[...cost],
 importBenefitEvents:async b=>{for(const e of b.events)if(!personal.some(x=>x.id===e.id))personal.push(e);},
 importCostEvents:async b=>{for(const e of b.events)if(!cost.some(x=>x.id===e.id))cost.push(e);}};};
const product=cardProducts[0];
const snapshotRows=()=>({cards:[{id:'snap-1',name:'Synthetic Snapshot Card',bank:product.bank,region:product.region}],rewards:[],transactions:[],offers:[],benefits:[],connections:[]});
const programme=[...(valuationTable.programmes||[])][0];
const fixtures={
 empty:()=>({formatVersion:1}),
 full:()=>({
  ...snapshotRows(),formatVersion:1,
  walletCards:{cards:[newWalletCard({bank:product.bank,name:'Synthetic Manual',tail:'1111'},'manual-1')],removed:[{id:'gone-1',bank:product.bank,tail:'2222'}]},
  cardEdits:{schema:1,edits:[]},
  cardProducts:{schema:1,choices:[{cardId:'manual-1',productId:product.id}]},
  paymentMarks:{schema:1,marks:[{key:'["manual-1","date","2026-12-01"]',at:'2026-11-01T00:00:00.000Z'}]},
  pointValues:{schema:1,values:programme?[{id:programme.id,cents:1.5,at:'2026-11-02T00:00:00.000Z'}]:[]},
  reminderSettings:{enabled:true,bills:true,credits:false,fees:true,billDays:7,creditDays:3,feeDays:1,showAmounts:false},
  favorites:['manual-1','snap-1'],
  personalBenefits:{schema:1,events:[]},costLedger:{schema:1,events:[]},
 }),
};
const deps=l=>({importBenefitEvents:l.importBenefitEvents,importCostEvents:l.importCostEvents,readBenefitEvents:l.readBenefitEvents,readCostEvents:l.readCostEvents});
async function roundTrip(raw){
 const storage=memory(),l=ledgers(),want=migrateWalletDocument(raw);
 await writeWalletDocument(raw,{storage,...deps(l)});
 return {got:await readWalletDocument({storage,...deps(l)}),want,storage};
}

for(const [name,make] of Object.entries(fixtures))test(`write then read gives an equal document: ${name}`,async()=>{
 const {got,want}=await roundTrip(make());
 assert.deepEqual(got,want);
 const again=await roundTrip(got);assert.deepEqual(again.got,got);
});

test('an old-format backup (no formatVersion) migrates and keeps what it had',async()=>{
 const old={...snapshotRows(),cardProducts:{schema:1,choices:[{cardId:'snap-1',productId:product.id}]},paymentMarks:{schema:1,marks:[]}};
 const doc=migrateWalletDocument(old);
 assert.equal(doc.formatVersion,WALLET_FORMAT_VERSION);
 assert.deepEqual(doc.cardProducts,old.cardProducts);
 assert.deepEqual(doc.favorites,[]);assert.deepEqual(doc.walletCards,{cards:[],removed:[]});
 assert.equal(doc.reminderSettings.enabled,false);
 assert.deepEqual(doc.cards,old.cards);
 const {got}=await roundTrip(old);assert.deepEqual(got,doc);
});

test('a newer formatVersion writes nothing and says so',async()=>{
 const storage=memory(),l=ledgers(),raw={...fixtures.full(),formatVersion:WALLET_FORMAT_VERSION+1};
 assert.ok(isNewerWalletDocument(raw));
 await assert.rejects(writeWalletDocument(raw,{storage,...deps(l)}),e=>e.message==='wallet_format_newer'&&e.version===WALLET_FORMAT_VERSION+1);
 assert.deepEqual(storage.keys(),[]);assert.equal(l.personal.length+l.cost.length,0);
});

test('a malformed section is refused before anything is written',async()=>{
 const storage=memory(),l=ledgers();
 for(const bad of [{cardProducts:{schema:1,choices:'x'}},{favorites:[1]},{walletCards:{cards:[],removed:[{id:1}]}},{paymentMarks:{schema:2,marks:[]}}])
  await assert.rejects(writeWalletDocument({...fixtures.full(),...bad},{storage,...deps(l)}));
 assert.deepEqual(storage.keys(),[]);
});

test('importing merges with what the device already has instead of replacing it',async()=>{
 const storage=memory(),l=ledgers();
 await writeWalletDocument({...fixtures.full()},{storage,...deps(l)});
 await writeWalletDocument({formatVersion:1,favorites:['other']},{storage,...deps(l)});
 const got=await readWalletDocument({storage,...deps(l)});
 assert.deepEqual(got.favorites,['manual-1','snap-1','other']);
 assert.equal(got.cardProducts.choices.length,1);
});

test('importing a backup without reminder settings leaves this device\'s reminders unchanged',async()=>{
 const storage=memory(),l=ledgers();
 await writeWalletDocument({...fixtures.full()},{storage,...deps(l)});
 const before=(await readWalletDocument({storage,...deps(l)})).reminderSettings;
 assert.equal(before.enabled,true);
 await writeWalletDocument({...snapshotRows()},{storage,...deps(l)});
 await writeWalletDocument({formatVersion:1,favorites:['x']},{storage,...deps(l)});
 assert.deepEqual((await readWalletDocument({storage,...deps(l)})).reminderSettings,before);
});

// Every cardybara-* name in the source is either carried by the document, device-only, or not storage at all.
const NOT_STORAGE=new Set([
 // events and message channels
 'cardybara-account-change','cardybara-card-edits-change','cardybara-card-products-change','cardybara-cost-change','cardybara-bank-live-change','cardybara-cost-ledger','cardybara-payment-marks-change',
 'cardybara-personal-change','cardybara-plaid-change','cardybara-point-values-change','cardybara-product-suggestions-change','cardybara-reminder-settings-change',
 'cardybara-dashboard','cardybara-extension','cardybara-legacy-dashboard','cardybara-legacy-extension',
 // secrets: only model-client.js may name them, and they never enter a document
 'cardybara-model-key','cardybara-dev-own-key',
 // files, notification and alarm ids, DOM ids, build scope, hosts, report kinds
 'cardybara-snapshot','cardybara-credit-reminders','cardybara-extension-standalone','cardybara-extension-records','cardybara-test','cardybara-reminder',
 'cardybara-bank-guide','cardybara-scope','cardybara-gateway','cardybara-app','cardybara-problem-report','cardybara-sync-change','cardybara-sync-status','cardybara.svg','cardybara.workers','cardybara.dev',
]);
const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):/\.(js|jsx|mjs)$/.test(n)?[p]:[]});
test('no cardybara-* storage key is missing from the document and the device-only list',()=>{
 const root=new URL('..',import.meta.url).pathname;
 const found=new Set();
 for(const dir of ['src','extension-next'])for(const file of walk(join(root,dir)))
  for(const m of readFileSync(file,'utf8').matchAll(/cardybara[-.][A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/g))found.add(m[0].replace(/-$/,''));
 const known=new Set([...Object.keys(DOCUMENT_STORAGE),...Object.keys(DEVICE_ONLY),...NOT_STORAGE]);
 const prefixes=['cardybara-problem-report-'];
 const missing=[...found].filter(k=>!known.has(k)&&!prefixes.some(p=>k.startsWith(p.slice(0,-1))));
 assert.deepEqual(missing,[],'decide for each: document section, DEVICE_ONLY with a reason, or NOT_STORAGE in this test');
 for(const k of Object.keys(DOCUMENT_STORAGE))assert.ok(!(k in DEVICE_ONLY),k);
});

test('every import error code maps to a translated message in all languages',()=>{
 const i18n=JSON.parse(readFileSync(new URL('../src/i18n/app.json',import.meta.url),'utf8'));
 const src=readFileSync(new URL('../src/walletDocument.js',import.meta.url),'utf8');
 const codes=[...new Set([...src.matchAll(/throw Error\('([a-z_]+)'\)/g)].map(m=>m[1]))].filter(c=>c!=='wallet_format_newer');
 assert.ok(codes.length>=6);
 for(const c of codes){const key=walletImportErrorKey(c);assert.ok(key,`no message for ${c}`);for(const lang of ['en-US','zh-TW'])assert.ok(i18n[lang][key],`${c} missing in ${lang}`);}
 assert.equal(walletImportErrorKey('something_else'),null);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.ok(main.includes('t(key):err.message'));
});
