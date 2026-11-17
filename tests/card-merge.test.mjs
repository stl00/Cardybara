// Merging a bank-read card into the manual card of the same product (stl00/Cardybara#417). All cards, tails and dates are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardProducts} from '../src/productCatalog.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {planCardMerges,applyCardMerge,undoCardMerge,undoAvailable,remapLedgers} from '../src/cardMerge.js';
import {applyCardEdits} from '../src/cardEdits.js';
import {applyCardProductChoices} from '../src/cardProductChoice.js';
import {mergeWalletCards} from '../src/walletRegistry.js';

// Two products of one active bank and region, found from the catalogue so no product is named here.
const [A,B]=(()=>{
 for(const p of cardProducts){
  if(!ACTIVE_BANKS.includes(p.bank))continue;
  const other=cardProducts.find(q=>q.id!==p.id&&q.bank===p.bank&&q.region===p.region&&q.name!==p.name&&!q.aliases.includes(p.name));
  if(other)return [p,other];
 }
})();
const card=(p,id,source,tail)=>({id,bank:p.bank,region:p.region,name:p.name,currency:'USD',identitySource:source,...(tail?{tail}:{})});
const manual=(p,id,tail)=>card(p,id,'manual',tail),bank=(p,id,tail)=>({...card(p,id,'bank-page',tail),balance:111.11,statement:222.22,minimum:25,due:'2026-12-01'});
const empty={registry:[],edits:[],choices:[],costEvents:[],benefitEvents:[]};
const fee={schema:1,id:'e1',kind:'fee',cardId:'m1',key:JSON.stringify(['fee','m1','2026-01-01']),value:{},at:'2026-02-01T00:00:00.000Z'};
const used={schema:1,id:'b1',key:JSON.stringify(['m1','rule','2026-01-01','2026-12-31']),status:'used'};
const withUser=m=>({...empty,registry:[m],edits:[{cardId:m.id,feeDate:'03-15',hidden:true}],choices:[{cardId:m.id,productId:A.id}],costEvents:[fee],benefitEvents:[used]});

test('fixture: exact match with tail merges, no duplicate, user fields kept', () => {
 const m=manual(A,'m1','1234'),b=bank(A,'b1','1234');
 const plan=planCardMerges({manual:[m],bank:[b]});
 assert.deepEqual(plan,{merges:[{manualId:'m1',bankId:'b1'}],ambiguous:[]});
 const {state}=applyCardMerge(withUser(m),'m1',b,0);
 assert.equal(state.registry.length,0);
 const shown=applyCardProductChoices(applyCardEdits([b],state.edits),state.choices);
 assert.equal(shown.length,1);
 assert.equal(shown[0].feeDate,'03-15');assert.equal(shown[0].hidden,true);assert.equal(shown[0].productId,A.id);
 assert.equal(shown[0].balance,111.11);assert.equal(shown[0].statement,222.22);assert.equal(shown[0].due,'2026-12-01');
 assert.equal(state.costEvents[0].cardId,'b1');assert.equal(JSON.parse(state.costEvents[0].key)[1],'b1');
 assert.equal(JSON.parse(state.benefitEvents[0].key)[0],'b1');
});

test('fixture: manual card without digits merges with the one bank card of its product', () => {
 const plan=planCardMerges({manual:[manual(A,'m1')],bank:[bank(A,'b1','9876')]});
 assert.deepEqual(plan.merges,[{manualId:'m1',bankId:'b1'}]);assert.deepEqual(plan.ambiguous,[]);
});

test('fixture: two digitless manual cards of one product are ambiguous, never guessed', () => {
 const plan=planCardMerges({manual:[manual(A,'m1'),manual(A,'m2')],bank:[bank(A,'b1','9876')]});
 assert.deepEqual(plan.merges,[]);
 assert.deepEqual(plan.ambiguous,[{bankId:'b1',manualIds:['m1','m2']}]);
});

test('fixture: a manual card with other digits, or another product, is not merged', () => {
 assert.deepEqual(planCardMerges({manual:[manual(A,'m1','1111')],bank:[bank(A,'b1','2222')]}),{merges:[],ambiguous:[]});
 assert.deepEqual(planCardMerges({manual:[manual(B,'m1','1234')],bank:[bank(A,'b1','1234')]}),{merges:[],ambiguous:[]});
});

test('a digit match wins over a digitless card of the same product', () => {
 const plan=planCardMerges({manual:[manual(A,'m1','1234'),manual(A,'m2')],bank:[bank(A,'b1','1234')]});
 assert.deepEqual(plan.merges,[{manualId:'m1',bankId:'b1'}]);
});

test('one digitless manual card claimed by two bank cards asks instead of picking', () => {
 const plan=planCardMerges({manual:[manual(A,'m1')],bank:[bank(A,'b1','1111'),bank(A,'b2','2222')]});
 assert.deepEqual(plan.merges,[]);assert.equal(plan.ambiguous.length,2);
});

test('the product choice of a manual card decides when its name is not recognised', () => {
 const m={...manual(A,'m1','1234'),name:'My daily card'};
 assert.deepEqual(planCardMerges({manual:[m],bank:[bank(A,'b1','1234')]}).merges,[]);
 assert.deepEqual(planCardMerges({manual:[m],bank:[bank(A,'b1','1234')],choices:[{cardId:'m1',productId:A.id}]}).merges,[{manualId:'m1',bankId:'b1'}]);
});

test('the user name is kept and bank readings are not touched', () => {
 const m={...manual(A,'m1','1234'),name:'Travel card'},b=bank(A,'b1','1234');
 const {state}=applyCardMerge({...empty,registry:[m],choices:[{cardId:'m1',productId:A.id}]},'m1',b,0);
 const shown=applyCardEdits([b],state.edits)[0];
 assert.equal(shown.name,'Travel card');assert.equal(shown.balance,111.11);assert.equal(shown.minimum,25);
});

test('merge refuses a bank card as the manual side and a manual card as the bank side', () => {
 assert.throws(()=>applyCardMerge({...empty,registry:[bank(A,'b1','1')]},'b1',bank(A,'b2','2'),0),/merge_no_manual_card/);
 assert.throws(()=>applyCardMerge({...empty,registry:[manual(A,'m1','1234')]},'m1',manual(A,'m2','1234'),0),/merge_not_bank_card/);
});

test('undo restores the manual card and its records within the sync cycle, and the pair is declined', () => {
 const m=manual(A,'m1','1234'),b=bank(A,'b1','1234'),before=withUser(m);
 const {state,undo}=applyCardMerge(before,'m1',b,3);
 assert.equal(undoAvailable(undo,3),true);assert.equal(undoAvailable(undo,4),false);
 assert.throws(()=>undoCardMerge(state,undo,4),/merge_undo_expired/);
 const back=undoCardMerge(state,undo,3);
 assert.deepEqual(back.state.registry,[m]);
 assert.deepEqual(back.state.edits,before.edits);assert.deepEqual(back.state.choices,before.choices);
 assert.deepEqual(back.state.costEvents,before.costEvents);assert.deepEqual(back.state.benefitEvents,before.benefitEvents);
 assert.deepEqual(planCardMerges({manual:[m],bank:[b],declined:[back.declined]}),{merges:[],ambiguous:[]});
});

test('undo keeps records added to the bank card after the merge', () => {
 const m=manual(A,'m1','1234'),b=bank(A,'b1','1234');
 const {state,undo}=applyCardMerge(withUser(m),'m1',b,0);
 const later={...fee,id:'e2',cardId:'b1',key:JSON.stringify(['fee','b1','2027-01-01'])};
 const back=undoCardMerge({...state,costEvents:[...state.costEvents,later]},undo,0);
 assert.equal(back.state.costEvents.find(e=>e.id==='e2').cardId,'b1');
 assert.equal(back.state.costEvents.find(e=>e.id==='e1').cardId,'m1');
});

test('remapLedgers leaves other cards alone', () => {
 const other={...fee,id:'e3',cardId:'x',key:JSON.stringify(['fee','x','2026-01-01'])};
 const r=remapLedgers({costEvents:[fee,other],benefitEvents:[used]},'m1','b1');
 assert.deepEqual(r.moved.sort(),['b1','e1']);assert.equal(r.costEvents[1],other);
});

test('merge does not change how a same-digit discovery is already kept out of the registry', () => {
 const m=manual(A,'m1','1234'),found=bank(A,'b1','1234');
 assert.equal(mergeWalletCards({cards:[m],connections:[]},[found]).cards.length,1);
});
