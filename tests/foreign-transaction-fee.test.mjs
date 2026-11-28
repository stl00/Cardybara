import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {benefitProfileView,getKnowledgeRule,queryKnowledge,validateForeignTransactionFee,validateKnowledge} from '../src/knowledge.js';
import {cardProducts} from '../src/productCatalog.js';

const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const stored=json('../src/data/knowledge/rules.json');
const rows=queryKnowledge({kind:'fee'}).rules.filter(r=>r.terms.period==='foreign-transaction');
const byProduct=new Map(rows.map(r=>[r.productIds[0],r]));
// Public pages that could not be read signed out, or did not state the fee, on 2026-11-26. Unknown, never copied
// from a sibling card.
const ids=(prefix,keys)=>keys.split(' ').map(k=>prefix+k);
const UNKNOWN=new Set([
 ...['','-green','-gold','-platinum','-cashback','-purchasing','-meeting'].map(k=>`amex-us-us-corporate${k}-card`),
 ...ids('amex-hk-hk-american-express-','corporate-card gold-corporate-card gold-business-card business-card classic-corporate-card elite-corporate-card'),
 ...ids('amex-ca-ca-','american-express-gold-rewards-card simplycash-card-from-american-express simplycash-preferred-card-from-american-express platinum-card'),
 'sc-hk-hk-simply-cash-visa-card','boa-us-allways-rewards-visa',
 ...ids('citi-us-','citi-double-cash-card citi-custom-cash-card citi-strata-card aadvantage-mileup-card citi-diamond-preferred-card citi-simplicity-card citi-secured-mastercard my-best-buy-credit-cards macys-credit-cards bloomingdales-credit-cards the-home-depot-consumer-credit-card pro-xtra-credit-card tsc-credit-cards l-l-bean-mastercard dillards-credit-cards wayfair-credit-cards goodyear-credit-card'),
 ...cardProducts.filter(p=>p.bank==='Discover').map(p=>p.id),
 // Barclays (2026-11-27): Gap Inc. and View pages state no fee; the name-only cards had no product page read.
 ...ids('barclays-us-','gap-encore-mastercard old-navy-encore-mastercard banana-republic-encore-mastercard athleta-encore-mastercard barclays-view-mastercard aadvantage-aviator-red-world-elite-mastercard aadvantage-aviator-world-elite-business-mastercard hawaiian-airlines-world-elite-mastercard hawaiian-airlines-world-elite-business-mastercard frontier-airlines-business-mastercard holland-america-line-rewards-visa-card princess-cruises-rewards-visa-card priceline-rewards-visa-card priceline-vip-rewards-visa-card'),
 ...cardProducts.filter(p=>p.bank==='U.S. Bank'&&!p.id.includes('altitude-connect')).map(p=>p.id),
]);

test('every catalogue card has one foreign transaction fee rule or is a named unknown',()=>{
 assert.equal(rows.length,byProduct.size,'one rule per card');
 for(const p of cardProducts)assert.equal(byProduct.has(p.id),!UNKNOWN.has(p.id),p.id);
 for(const r of rows){
  const p=cardProducts.find(x=>x.id===r.productIds[0]);
  assert.equal(r.productIds.length,1);assert.equal(r.category,'fee');assert.equal(r.terms.amount,null);assert.equal(r.terms.cardholderRole,undefined);
  assert.equal(r.original.lang,`en-${p.region}`);assert.ok(r.content.summary);assert.equal(r.market.country,p.region);assert.equal(r.market.issuer,p.bank);
 }
});
test('stated rates keep the issuer figure and "None" is zero',()=>{
 const rate=id=>byProduct.get(id).terms.rate;
 assert.equal(rate('chase-us-sapphire-reserve'),0);assert.equal(rate('chase-us-freedom-unlimited'),3);
 assert.equal(rate('amex-us-us-the-platinum-card'),0);assert.equal(rate('amex-us-us-blue-cash-preferred-card'),2.7);
 assert.equal(rate('capital-one-us-platinum-credit-card'),0);assert.equal(rate('wells-fargo-us-active-cash-card'),3);
 assert.equal(rate('boa-us-bankamericard-credit-card'),3);assert.equal(rate('hsbc-hk-hk-red-credit-card'),1.95);
 assert.equal(rate('hsbc-hk-hk-unionpay-dual-currency-card'),1);assert.equal(rate('sc-hk-hk-standard-chartered-smart-credit-card'),0);
 assert.equal(rate('amex-hk-hk-the-platinum-card'),2);assert.equal(rate('amex-ca-ca-american-express-cobalt-card'),2.5);
});
test('no free-text "no foreign transaction fee" benefit remains, and earlier knowledge still sees it',()=>{
 assert.deepEqual(queryKnowledge({kind:'benefit'}).rules.filter(r=>r.id.endsWith('.no-foreign-fee')),[]);
 const id='rule.wells-fargo-us-autograph-card.no-foreign-fee';
 assert.ok(getKnowledgeRule(id,{asOf:'2026-11-24'}));
 for(const r of stored.filter(r=>r.id.endsWith('.no-foreign-fee')&&r.status==='withdrawn'))
  assert.equal(r.terms.replacedByRuleId,r.id.replace(/no-foreign-fee$/,'foreign-transaction-fee'));
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
test('a Hong Kong "waived" line states zero, but an unrelated waiver does not',()=>{
 const smart=stored.find(r=>r.id==='rule.sc-hk-hk-standard-chartered-smart-credit-card.foreign-transaction-fee');
 const check=text=>validateForeignTransactionFee({...smart,original:{...smart.original,quotes:[{...smart.original.quotes[0],text}]}}).join();
 assert.equal(check(smart.original.quotes[0].text),'');
 assert.match(check('Annual fee: Waived.'),/rate not stated/);
});
