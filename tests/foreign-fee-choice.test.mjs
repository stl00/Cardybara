// #661: a purchase in another currency is compared net of each card's recorded foreign transaction fee.
import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseCard} from '../src/cardDecision.js';
import {quickChoice} from '../src/purchaseChoice.js';
import {renderChoiceAnswer} from '../src/decisionAnswer.js';
import {cardProducts} from '../src/productCatalog.js';

// Synthetic wallet of public products. The fee rules were checked on 2026-11-26, so the wallet day is not earlier.
const DAY='2026-11-26';
const card=id=>{const p=cardProducts.find(p=>p.id===id);assert.ok(p,id);return {id:'t-'+id,productId:id,name:p.name,bank:p.bank,region:p.region,currency:'USD'};};
const WITH_FEE=card('chase-us-ink-business-cash-credit-card'),NO_FEE=card('chase-us-chase-freedom-flex-credit-card'),UNRECORDED=card('citi-us-citi-double-cash-card');
const pick=(args,cards)=>chooseCard(args,{cards,day:DAY});
const row=(r,c)=>r.rows.find(x=>x.card===c.name);
const eur={category:'other',amount:100,currency:'EUR'};

test('with equal earn rates the card without a foreign transaction fee wins, and the other row shows its fee',()=>{
 for(const cards of [[WITH_FEE,NO_FEE],[NO_FEE,WITH_FEE]]){
  const r=pick(eur,cards);
  assert.equal(row(r,WITH_FEE).earn.rate,row(r,NO_FEE).earn.rate);
  assert.equal(r.choice.card,NO_FEE.name);assert.equal(r.rows[0].card,NO_FEE.name);
  assert.equal(r.choice.foreignFee.rate,0);
  const fee=row(r,WITH_FEE);
  assert.equal(fee.foreignFee.status,'recorded');assert.equal(fee.foreignFee.rate,3);assert.equal(fee.foreignFee.applies,'yes');
  assert.equal(fee.netPercentAfterForeignFee,fee.earn.rate-3);
  assert.ok(!r.rows.some(x=>x.reasons.includes('foreign-fee-unknown')));
  assert.ok(!r.couldChange.some(c=>c.kind==='foreign-fee-unknown'));
  assert.match(r.foreignFeeNote,/unknown and not zero/);
 }
});
test('a card with no fee rule stays unknown and is not treated as zero',()=>{
 const r=pick(eur,[UNRECORDED,NO_FEE]);
 const unknown=row(r,UNRECORDED);
 assert.deepEqual(unknown.foreignFee,{status:'unknown'});assert.equal(unknown.netPercentAfterForeignFee,undefined);
 assert.ok(unknown.reasons.includes('foreign-fee-unknown'));
 // It earns more before fees, yet is not ranked as if its fee were zero; the answer says it could change the choice.
 assert.ok(unknown.earn.rate>row(r,NO_FEE).earn.rate);
 assert.equal(r.choice.card,NO_FEE.name);
 assert.ok(r.couldChange.some(c=>c.kind==='foreign-fee-unknown'&&c.card===UNRECORDED.name));
 // Against a card known to cost more than it returns, the unknown one comes first and is said to be unknown.
 const costly=pick(eur,[WITH_FEE,UNRECORDED]);
 assert.equal(costly.choice.card,UNRECORDED.name);assert.ok(costly.choice.reasons.includes('foreign-fee-unknown'));
});
test('a purchase in the billing currency is untouched, and abroad in it a fee is not assumed charged',()=>{
 const home=pick({...eur,currency:'USD'},[WITH_FEE,NO_FEE]);
 assert.ok(home.rows.every(x=>x.foreignFee===undefined));assert.equal(home.foreignFeeNote,undefined);
 const abroad=pick({...eur,currency:'USD',country:'FR'},[WITH_FEE,NO_FEE]);
 assert.equal(abroad.choice.card,NO_FEE.name);
 assert.equal(row(abroad,WITH_FEE).foreignFee.applies,'unconfirmed');assert.equal(row(abroad,WITH_FEE).netPercentAfterForeignFee,undefined);
 assert.ok(row(abroad,WITH_FEE).reasons.includes('foreign-fee-may-apply'));
 const noCurrency=pick({category:'other',country:'FR'},[WITH_FEE,NO_FEE]);
 assert.equal(row(noCurrency,WITH_FEE).foreignFee.applies,'yes');assert.ok(row(noCurrency,WITH_FEE).reasons.includes('foreign-currency-assumed'));
});
test('before the fee was checked it is unknown',()=>{
 const r=chooseCard(eur,{cards:[WITH_FEE,NO_FEE],day:'2026-11-05'});
 assert.ok(r.rows.every(x=>x.foreignFee.status==='unknown'));
});
test('the wallet entry and the code-written answer state the fee',()=>{
 const wallet=quickChoice(eur,{cards:[WITH_FEE,NO_FEE],day:DAY});
 assert.equal(wallet.card,NO_FEE.name);assert.equal(wallet.foreignFee.rate,0);
 assert.equal(wallet.others[0].foreignFee.rate,3);assert.equal(wallet.others[0].percent,wallet.others[0].rate-3);
 const only=pick(eur,[WITH_FEE]);
 assert.match(renderChoiceAnswer(only,'Which card?'),/charges a 3% foreign transaction fee\. After the fee that is about -2% of spend\./);
 assert.match(renderChoiceAnswer(only,'刷哪张卡？'),/外币手续费为 3%。扣除后约为消费的 -2%。/);
 assert.match(renderChoiceAnswer(pick(eur,[NO_FEE]),'Which card?'),/no foreign transaction fee/);
});
