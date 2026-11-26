import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {benefitProfileView,queryKnowledge,validateKnowledge} from '../src/knowledge.js';
import {cardProducts} from '../src/productCatalog.js';

const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const stored=json('../src/data/knowledge/rules.json');
const rows=queryKnowledge({kind:'fee'}).rules.filter(r=>r.terms.period==='foreign-transaction');
const byProduct=new Map(rows.map(r=>[r.productIds[0],r]));
const products=cardProducts.filter(p=>p.bank==='Chase'||p.bank==='Amex US');
// Public pages that could not be read signed out on 2026-11-26. Unknown, never copied from a sibling card.
const UNKNOWN=['','-green','-gold','-platinum','-cashback','-purchasing','-meeting'].map(k=>`amex-us-us-corporate${k}-card`);

test('every Amex US and Chase card has one foreign transaction fee rule or is a named unknown',()=>{
 assert.equal(rows.length,byProduct.size,'one rule per card');
 for(const p of products)assert.equal(byProduct.has(p.id),!UNKNOWN.includes(p.id),p.id);
 for(const r of rows){
  assert.equal(r.productIds.length,1);assert.equal(r.category,'fee');assert.equal(r.terms.amount,null);assert.equal(r.terms.cardholderRole,undefined);
  assert.equal(r.original.lang,'en-US');assert.ok(r.content.summary);assert.equal(r.market.country,'US');
 }
});
test('stated rates keep the issuer figure and "None" is zero',()=>{
 const rate=id=>byProduct.get(id).terms.rate;
 assert.equal(rate('chase-us-sapphire-reserve'),0);assert.equal(rate('chase-us-freedom-unlimited'),3);
 assert.equal(rate('amex-us-us-the-platinum-card'),0);assert.equal(rate('amex-us-us-blue-cash-preferred-card'),2.7);
});
test('no free-text "no foreign transaction fee" benefit remains for these issuers',()=>{
 assert.deepEqual(queryKnowledge({kind:'benefit'}).rules.filter(r=>['Chase','Amex US'].includes(r.market.issuer)&&r.id.endsWith('.no-foreign-fee')),[]);
});
test('the wallet still reads annual fees from annual-fee rules only',()=>{
 for(const profile of benefitProfileView({asOf:'2026-11-26'}).filter(p=>byProduct.has(p.productId))){
  const annual=queryKnowledge({productId:profile.productId,kind:'fee',asOf:'2026-11-26',includeInactive:true}).rules.find(r=>r.terms.cardholderRole==='primary');
  assert.equal(profile.fees.primaryAnnual,annual?.terms.amount??null,profile.productId);
 }
});
test('validation rejects an unquoted rate, a fixed amount and the period on another kind',()=>{
 const source=stored.find(r=>r.id==='rule.chase-us-freedom-unlimited.foreign-transaction-fee');
 const errors=change=>{const records=structuredClone(stored),r=records.find(x=>x.revisionId===source.revisionId);change(r);return validateKnowledge(records).errors.join('\n');};
 assert.equal(errors(()=>{}),'');
 assert.match(errors(r=>{r.terms.rate=0;}),/rate not stated/);
 assert.match(errors(r=>{r.terms.rate=2.7;}),/rate not stated/);
 assert.match(errors(r=>{r.terms.rate=null;}),/rate must be a percent/);
 assert.match(errors(r=>{r.terms.amount=5;}),/amount must be null/);
 assert.match(errors(r=>{r.terms.cardholderRole='primary';}),/belongs to annual fees/);
 assert.match(errors(r=>{r.kind='benefit';}),/unknown period/);
});
