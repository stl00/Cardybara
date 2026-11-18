// The card merge engine wired into the wallet (stl00/Cardybara#457): planning on discovery, saving what changed, undo for one
// sync cycle, declined pairs, and the stores' rewrite call. All cards, tails and dates are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cardProducts} from '../src/productCatalog.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {WALLET_CARDS_KEY} from '../src/walletRegistry.js';
import {CARD_EDITS_KEY,readCardEdits} from '../src/cardEdits.js';
import {CARD_PRODUCT_KEY} from '../src/cardProductChoice.js';
import {runCardMerges,answerMerge,undoMerge,endSyncCycle,readMergeState,readDeclined,MERGE_DECLINED_KEY,MERGE_STATE_KEY,mergeDeclinedPairs} from '../src/cardMergeFlow.js';
import {DOCUMENT_STORAGE,DEVICE_ONLY,readWalletDocument,writeWalletDocument,replaceWalletDocument} from '../src/walletDocument.js';
import {mergeWalletDocuments} from '../src/walletSync.js';

const A=(()=>{for(const p of cardProducts)if(ACTIVE_BANKS.includes(p.bank))return p;})();
const card=(id,source,tail)=>({id,bank:A.bank,region:A.region,name:A.name,currency:'USD',identitySource:source,...(tail?{tail}:{})});
const store=init=>{const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const fee=cardId=>({schema:1,id:'e1',kind:'fee',cardId,key:JSON.stringify(['fee',cardId,'2026-01-01']),value:{start:'2026-01-01',end:'2026-12-31',currency:'USD',listedFee:95,charged:95,refund:0,waiver:'none',note:'',deleted:false},at:'2026-02-01T00:00:00.000Z'});
const used=cardId=>({schema:1,id:'b1',key:JSON.stringify([cardId,'rule','2026-01-01','2026-12-31']),status:'used',revisionId:'r',at:'2026-02-02T00:00:00.000Z'});
function world({registry,edits=[],choices=[],cost=[],benefit=[],cost_fails=false}){
 const storage=store({[WALLET_CARDS_KEY]:JSON.stringify(registry),[CARD_EDITS_KEY]:JSON.stringify(edits),[CARD_PRODUCT_KEY]:JSON.stringify(choices)});
 const ledgers={cost:[...cost],benefit:[...benefit],rewrites:0};
 const io={readCostEvents:async()=>ledgers.cost.map(e=>({...e})),readBenefitEvents:async()=>ledgers.benefit.map(e=>({...e})),
  rewriteCostEvents:async rows=>{if(cost_fails&&rows.length)throw Error('overlapping_fee_cycles');ledgers.rewrites++;for(const r of rows){const i=ledgers.cost.findIndex(e=>e.id===r.id);ledgers.cost[i]=r;}},
  rewriteBenefitEvents:async rows=>{for(const r of rows){const i=ledgers.benefit.findIndex(e=>e.id===r.id);ledgers.benefit[i]=r;}}};
 return {storage,io,ledgers,registry:()=>JSON.parse(storage.getItem(WALLET_CARDS_KEY))};
}

test('discovery merges the unambiguous pair: one card, user fields, bank readings, ledgers moved',async()=>{
 const w=world({registry:[card('m1','manual','1234'),card('b1','bank-page','1234')],edits:[{cardId:'m1',feeDate:{month:3,day:15}}],cost:[fee('m1')],benefit:[used('m1')]});
 const r=await runCardMerges(w);
 assert.equal(r.applied.length,1);assert.deepEqual(r.open,[]);
 assert.deepEqual(w.registry().map(c=>c.id),['b1']);
 assert.equal(readCardEdits(w.storage).find(e=>e.cardId==='b1').feeDate.month,3);
 assert.equal(w.ledgers.cost[0].cardId,'b1');assert.equal(JSON.parse(w.ledgers.cost[0].key)[1],'b1');
 assert.equal(JSON.parse(w.ledgers.benefit[0].key)[0],'b1');
 assert.equal(readMergeState(w.storage).undos.length,1);
 // Running again changes nothing: still one card.
 const again=await runCardMerges(w);assert.equal(again.applied.length,0);assert.equal(w.registry().length,1);
});

test('two stored manual cards with the same digits: nothing merges and one question is asked; answering merges the chosen one',async()=>{
 const w=world({registry:[card('m1','manual','1234'),card('m2','manual','1234'),card('b1','bank-page','1234')]});
 const r=await runCardMerges(w);
 assert.equal(r.applied.length,0);assert.equal(w.registry().length,3);
 assert.equal(r.open.length,1);assert.deepEqual(r.open[0].manual.map(c=>c.id).sort(),['m1','m2']);
 await answerMerge({...w,bankId:'b1',manualId:'m2',candidates:['m1','m2']});
 assert.deepEqual(w.registry().map(c=>c.id).sort(),['b1','m1']);
});

test('answering "none of them" stores the declined pairs and the question does not come back',async()=>{
 const w=world({registry:[card('m1','manual','1234'),card('m2','manual','1234'),card('b1','bank-page','1234')]});
 await answerMerge({...w,bankId:'b1',manualId:null,candidates:['m1','m2']});
 assert.equal(readDeclined(w.storage).length,2);
 const r=await runCardMerges(w);assert.deepEqual(r.open,[]);assert.equal(w.registry().length,3);
});

test('undo restores the manual card, the user fields and the ledgers, and the pair is declined',async()=>{
 const w=world({registry:[card('m1','manual','1234'),card('b1','bank-page','1234')],edits:[{cardId:'m1',feeDate:{month:3,day:15}}],cost:[fee('m1')],benefit:[used('m1')]});
 await runCardMerges(w);
 const manual=await undoMerge({...w,bankId:'b1',manualId:'m1'});
 assert.equal(manual.id,'m1');
 assert.deepEqual(w.registry().map(c=>c.id).sort(),['b1','m1']);
 assert.equal(readCardEdits(w.storage).some(e=>e.cardId==='m1'&&e.feeDate),true);
 assert.equal(w.ledgers.cost[0].cardId,'m1');assert.equal(JSON.parse(w.ledgers.benefit[0].key)[0],'m1');
 assert.deepEqual(readMergeState(w.storage).undos,[]);
 // The undone pair is not offered again.
 assert.equal((await runCardMerges(w)).applied.length,0);assert.equal(w.registry().length,2);
});

test('undo lasts until the sync cycle after the merge has ended',async()=>{
 const w=world({registry:[card('m1','manual','1234'),card('b1','bank-page','1234')]});
 endSyncCycle(w.storage,'run-1');
 await runCardMerges(w);                         // merged during the run that is under way
 assert.equal(endSyncCycle(w.storage,'run-2').undos.length,1);   // that run ended: undo still there
 assert.equal(endSyncCycle(w.storage,'run-2').undos.length,1);   // the same run counted once
 assert.equal(endSyncCycle(w.storage,'run-3').undos.length,0);   // the next cycle ended: gone
 await assert.rejects(undoMerge({...w,bankId:'b1',manualId:'m1'}),/merge_undo_expired/);
});

test('a merge the ledger refuses leaves both cards and every store as it was',async()=>{
 const w=world({registry:[card('m1','manual','1234'),card('b1','bank-page','1234')],cost:[fee('m1')],cost_fails:true});
 const before=w.storage.getItem(WALLET_CARDS_KEY);
 const r=await runCardMerges(w);
 assert.equal(r.applied.length,0);assert.equal(w.storage.getItem(WALLET_CARDS_KEY),before);assert.equal(w.ledgers.cost[0].cardId,'m1');
});

test('storage keys: declined pairs travel in the document, undo state stays on the device',()=>{
 assert.equal(DOCUMENT_STORAGE[MERGE_DECLINED_KEY],'cardMerges');assert.ok(MERGE_STATE_KEY in DEVICE_ONLY);assert.ok(!(MERGE_STATE_KEY in DOCUMENT_STORAGE));
});

test('declined pairs round-trip through a backup, replace and sync, and a bad section is refused',async()=>{
 const pairs=[{manualId:'m1',bankId:'b1'}];
 const src=store({[MERGE_DECLINED_KEY]:JSON.stringify({schema:1,declined:pairs})});
 const doc=await readWalletDocument({storage:src,readBenefitEvents:async()=>[],readCostEvents:async()=>[]});
 assert.deepEqual(doc.cardMerges,{schema:1,declined:pairs});
 const dst=store();const noop={importBenefitEvents:async()=>{},importCostEvents:async()=>{},knownCard:()=>true};
 await writeWalletDocument(doc,{storage:dst,...noop});assert.deepEqual(readDeclined(dst),pairs);
 const rep=store();await replaceWalletDocument(doc,{storage:rep,...noop});assert.deepEqual(readDeclined(rep),pairs);
 const merged=mergeWalletDocuments({base:null,local:doc,remote:{...doc,cardMerges:{schema:1,declined:[{manualId:'m2',bankId:'b1'}]}},localNewer:true});
 assert.equal(merged.cardMerges.declined.length,2);
 assert.throws(()=>mergeDeclinedPairs([],{schema:1,declined:[{manualId:1}]}),/invalid_card_merges_backup/);
 // An older backup without the section leaves this device's pairs alone.
 const old=store({[MERGE_DECLINED_KEY]:JSON.stringify({schema:1,declined:pairs})});
 await writeWalletDocument({formatVersion:1,walletCards:{cards:[],removed:[]}},{storage:old,...noop});assert.deepEqual(readDeclined(old),pairs);
});

test('the two ledger stores have a rewrite call that keeps ids and the wallet shows the merge flow',()=>{
 for(const [file,fn] of [['costStore.js','rewriteCostEvents'],['personalStore.js','rewriteBenefitEvents']]){
  const src=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  assert.match(src,new RegExp('export async function '+fn));assert.match(src,/\.put\(/);
 }
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 for(const needle of ['runCardMerges','endSyncCycle','CardMergeQuestions','CardMergeUndo'])assert.ok(main.includes(needle),needle);
});

test('a manual card needs digits, so the engine has no digitless candidate to ask about (#460)',async()=>{
 const {newWalletCard}=await import('../src/walletRegistry.js');
 for(const tail of [undefined,'','123'])assert.throws(()=>newWalletCard({bank:A.bank,name:A.name,tail}),/invalid_card/);
 const w=world({registry:[{...card('m1','manual'),tail:undefined},card('b1','bank-page','1234')]});
 const r=await runCardMerges(w);
 assert.equal(r.applied.length,0);assert.deepEqual(r.open,[]);assert.equal(w.registry().length,2);
});
