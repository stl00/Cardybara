import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {matchCardProduct,cardProducts} from '../src/productCatalog.js';
import {queryKnowledge,knowledgeSources,validateKnowledge} from '../src/knowledge.js';
import {profileForCard} from '../src/benefitRules.js';
import {runWalletTool} from '../src/walletAgent.js';
const dir=new URL('../docs/knowledge/card-batches/',import.meta.url);
const read=name=>JSON.parse(readFileSync(new URL(name,dir),'utf8'));
const batches=readdirSync(dir).filter(n=>n.startsWith('batch-')).map(read),cards=batches.flatMap(b=>b.cards),selection=read('selection.json');
// Each batch is checked on its own day; its facts are known from then.
const checkedOn=card=>batches.find(b=>b.cards.includes(card)).checkedAt;
const product=id=>cardProducts.find(p=>p.id===id);
const call=(name,args)=>({id:'t',type:'function',function:{name,arguments:JSON.stringify(args)}});
test('batches are valid and every batch card is on the recorded selection list once',()=>{
 assert.deepEqual(validateKnowledge().errors,[]);
 const listed=selection.cards.map(c=>c.id);assert.equal(new Set(listed).size,listed.length);
 for(const card of cards)assert.ok(listed.includes(card.id),card.id);
 assert.match(selection.method,/CC BY-NC-ND/);
});
test('each card is matched by the wallet from its name and every alias, without ambiguity',()=>{
 for(const card of cards){const p=product(card.id);assert.ok(p,card.id);for(const name of [p.name,...p.aliases]){const m=matchCardProduct({bank:p.bank,region:p.region,name});assert.equal(m.status,'matched',`${card.id}: ${name}`);assert.equal(m.product.id,card.id);}}
});
test('each recorded fact has an official source, a date and the issuer wording',()=>{
 for(const card of cards){const rows=queryKnowledge({productId:card.id,asOf:checkedOn(card)}).rules.filter(r=>r.id.startsWith(`rule.${card.id}.`));assert.ok(rows.length,card.id);
  for(const r of rows){assert.ok(knowledgeSources(r.evidence.sourceIds).every(s=>s.authority==='official'&&[card.url,...Object.values(card.extraSources||{}).map(x=>x.url)].includes(s.url)),r.id);assert.equal(r.evidence.checkedAt,checkedOn(card));assert.ok(r.content.sourceText,r.id);assert.equal(r.personalState,'not-in-public-knowledge');}
  if(card.fee){const fee=rows.find(r=>r.kind==='fee'&&r.terms.cardholderRole==='primary');assert.equal(fee.terms.amount,card.fee.amount);assert.equal(fee.terms.actualCharge,null);}
 }
});
test('the assistant answers a listed card with its official source',()=>{
 for(const card of cards){
assert.ok(card.fee,`${card.id} has no annual fee`);
  const p=product(card.id);const result=runWalletTool(call('get_card_rules',{kind:'fee'}),{cards:[{id:'x',bank:p.bank,region:p.region,name:p.name}],events:[],day:checkedOn(card)});assert.ok(result.rules.length,card.id);// The fee cites the page its batch names: the product page, or the extra source the fee points to.
  assert.ok(JSON.stringify(result).includes(card.fee.source?card.extraSources[card.fee.source].url:card.url),card.id);}
});
test('a held listed card gets a profile that marks personal state unverified',()=>{
 for(const card of cards){const p=product(card.id),profile=profileForCard({bank:p.bank,region:p.region,name:p.name});assert.ok(profile,card.id);assert.ok(profile.knowledgeGaps.length,card.id);for(const b of profile.benefits)assert.equal(b.accountState,'unverified');}
});
test('a transfer link reaches the programme rules; no link gets no partner row',()=>{
 for(const card of cards){const rows=queryKnowledge({kind:'transfer-relationship',productId:card.id}).rules;
  if(product(card.id).transferProgrammeId)assert.ok(rows.length>0,card.id);else assert.equal(rows.length,0,card.id);}
 assert.equal(queryKnowledge({kind:'transfer-relationship',productId:'chase-us-ink-business-cash-credit-card'}).count,0,'a cash back page gives no transfer evidence');
});
test('what a page does not structure stays unknown',()=>{
 const hotel=queryKnowledge({productId:'amex-us-us-the-platinum-card'}).rules.find(r=>r.id.endsWith('.hotel-credit'));assert.equal(hotel.terms.period,null,'the page does not say how the half-years divide');
 const clear=queryKnowledge({productId:'amex-us-us-the-platinum-card'}).rules.find(r=>r.id.endsWith('.clear'));assert.equal(clear.terms.requiresEnrollment,undefined);
 assert.equal(queryKnowledge({productId:'chase-us-chase-sapphire-preferred-credit-card',requiresEnrollment:false}).count,0);
});
test('dated and capped terms from issuer pages are kept',()=>{
 const rule=(productId,key)=>queryKnowledge({productId,asOf:'2026-11-04'}).rules.find(r=>r.id===`rule.${productId}.${key}`);
 assert.equal(rule('chase-us-sapphire-reserve-for-business-credit-card','ziprecruiter').validity.effectiveThrough,'2027-12-31');
 assert.equal(rule('amex-us-us-business-platinum-card','earning-1').terms.spendCap.amount,2000000);
 assert.equal(rule('amex-us-us-the-platinum-card','lululemon').terms.requiresEnrollment,true);
 const m=matchCardProduct({bank:'Amex US',region:'US',name:'Platinum Card'});assert.equal(m.status,'unknown','a bare name could be another Platinum product');
});
test('new products ship card art only with a recorded issuer source',()=>{
 // Art for a new product must come from its issuer's own page; tests/card-art-sources.test.mjs checks the record.
 for(const card of cards.filter(c=>c.new)){const art=product(card.id).art;if(art!==null)assert.ok(art.verification==='issuer-asset'&&art.pageUrl&&art.checkedAt&&art.terms,card.id);}
});
test('batch 12 records what the Bank of America pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-12'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const cash='boa-us-bank-of-america-unlimited-cash-rewards',ascent='boa-us-atmos-rewards-ascent-visa-signature';
 assert.equal(find(cash,'fee-primary').terms.amount,0);assert.equal(find(cash,'earning-0').terms.multiplier,1.5);assert.equal(find(cash,'earning-0').terms.unit,'cashback-percent');
 assert.equal(find(cash,'bofa-rewards-bonus').terms.amount,null,'the page gives no bonus rate');
 assert.equal(find(ascent,'fee-primary').terms.amount,95);assert.deepEqual([0,1,2].map(i=>find(ascent,`earning-${i}`).terms.multiplier),[3,2,1]);
 const fare=find(ascent,'companion-fare');assert.equal(fare.category,'spend-unlock');assert.equal(fare.terms.period,'account-anniversary');assert.match(fare.original.quotes.map(q=>q.text).join(' '),/\$6,000/);
 assert.equal(product(ascent).transferProgrammeId,undefined,'the page names no transfer partners');
 assert.ok(selection.cards.find(c=>c.id==='skip-amex-green').skip,'Amex Green stays skipped until its page can be read');
});
