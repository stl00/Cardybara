// Card-year credits stay visible as "set the fee date" rows when the card has no fee date (stl00/Cardybara#273).
// Cards and dates are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {benefitProfiles} from '../src/benefitRules.js';
import {cardProducts} from '../src/productCatalog.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {creditTasks,feeDateNeededRows,taskStatus,activeTasks,dismissKey,validatePersonalEvent} from '../src/personalBenefits.js';

const DAY='2026-11-10';
const inForce=b=>['credit','promo'].includes(b.category)&&b.period==='account-anniversary'&&!b.applicability&&!(b.validFrom&&b.validFrom>DAY)&&!(b.validThrough&&b.validThrough<DAY);
const products=benefitProfiles.filter(p=>p.coverage!=='variant-unconfirmed'&&p.benefits.some(inForce)).map(p=>cardProducts.find(x=>x.id===p.productId)).filter(p=>p&&ACTIVE_BANKS.includes(p.bank));
const card=(product,i,extra={})=>({...newWalletCard({bank:product.bank,name:'Synthetic '+i,tail:String(1000+i)},'manual-'+i),productId:product.id,...extra});

test('there are synthetic products with card-year credits to test with',()=>assert.ok(products.length>=3));

test('a card with no fee date gets one needs-fee-date row per card-year credit, none dropped, none given a cycle',()=>{
 for(const [i,product] of products.entries()){
  const c=card(product,i),expected=benefitProfiles.find(p=>p.productId===product.id).benefits.filter(inForce);
  const rows=feeDateNeededRows([c],DAY);
  assert.equal(rows.length,expected.length,product.id);
  assert.deepEqual(rows.map(r=>r.ruleId).sort(),expected.map(b=>b.knowledgeRuleId).sort());
  assert.ok(rows.every(r=>r.state==='needs-fee-date'&&r.cardId===c.id&&!('period' in r)));
  // No calendar-year fallback: none of them is also a cycle task.
  const taskRules=new Set(creditTasks([c],DAY).map(t=>t.ruleId));
  assert.ok(rows.every(r=>!taskRules.has(r.ruleId)),'no guessed cycle');
 }
});

test('an unusable fee date (month only) counts as no fee date',()=>{
 const c=card(products[0],0,{feeDate:{month:5}});
 assert.equal(feeDateNeededRows([c],DAY).length,benefitProfiles.find(p=>p.productId===products[0].id).benefits.filter(inForce).length);
});

test('setting the fee date turns the rows into cycle tasks and keeps stop-reminding',()=>{
 const product=products[0],bare=card(product,0),rows=feeDateNeededRows([bare],DAY);
 const dismissed=[validatePersonalEvent({schema:1,id:'e1',key:dismissKey(bare.id,rows[0].ruleId),status:'dismissed',at:'2026-11-01T00:00:00.000Z'})];
 assert.equal(activeTasks(feeDateNeededRows([bare],DAY),dismissed).length,rows.length-1);
 const dated={...bare,feeDate:{month:5,day:20}};
 assert.deepEqual(feeDateNeededRows([dated],DAY),[]);
 const tasks=creditTasks([dated],DAY).filter(t=>rows.some(r=>r.ruleId===t.ruleId));
 assert.ok(tasks.length>0);
 assert.ok(tasks.every(t=>t.period.start==='2026-05-20'&&t.period.end==='2027-05-19'));
 // A mark on a cycle task is unchanged by recomputing; the dismissal still applies to the same credit.
 const t=tasks[0],marked=[{id:'e2',key:t.key,status:'used',at:'2026-11-02T00:00:00.000Z',revisionId:t.revisionId}];
 const again=creditTasks([{...dated}],DAY).find(x=>x.key===t.key);
 assert.equal(taskStatus(again,marked),'used');
 assert.equal(activeTasks(creditTasks([dated],DAY),dismissed).some(x=>x.ruleId===rows[0].ruleId),false);
});
