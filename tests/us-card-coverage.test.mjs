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
test('a card states its annual fee or says it is unknown, never both and never neither',()=>{
 for(const card of cards){
  assert.notEqual(Boolean(card.fee),card.feeUnknown===true,card.id);
  if(card.feeUnknown){
   assert.equal(queryKnowledge({productId:card.id,asOf:checkedOn(card)}).rules.filter(r=>r.kind==='fee'&&r.terms.cardholderRole==='primary').length,0,card.id);
   assert.equal(profileForCard({bank:product(card.id).bank,region:product(card.id).region,name:product(card.id).name}).fees.primaryAnnual,null,`${card.id}: unknown is not zero`);
   assert.ok(card.unknown.some(u=>u.zh.includes('年费')),`${card.id} does not say the fee is unknown`);
  }
 }
});
test('the assistant answers a listed card with its official source',()=>{
 for(const card of cards.filter(c=>c.fee)){
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
 const hotel=queryKnowledge({productId:'amex-us-us-the-platinum-card'}).rules.find(r=>r.id.endsWith('.hotel-credit'));assert.equal(hotel.terms.period,'calendar-half-year','the page states semi-annual credits capped per calendar year');
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
 const fare=find(ascent,'companion-fare');assert.equal(fare.category,'spend-unlock');assert.equal(fare.terms.period,'account-anniversary');assert.equal(fare.terms.spendThreshold,6000);assert.match(fare.original.quotes.map(q=>q.text).join(' '),/\$6,000/);
 assert.equal(product(ascent).transferProgrammeId,undefined,'the page names no transfer partners');
 // Claims with no quote behind them stay out: reward expiry on the cash card, local transit and rideshare on the 2x tier.
 assert.doesNotMatch(JSON.stringify(find(cash,'earning-0')),/expire|过期/);assert.doesNotMatch(JSON.stringify(find(ascent,'earning-1')),/transit|rideshare|交通|网约车/);
});
test('batch 13 records what the Citi pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-24'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const strata='citi-us-citi-strata-card',costco='citi-us-costco-anywhere-visa-card-by-citi';
 assert.deepEqual([0,1,2,3,4,5].map(i=>find(strata,`earning-${i}`).terms.multiplier),[5,3,3,3,2,1]);
 assert.deepEqual([0,1,2,3,4].map(i=>find(costco,`earning-${i}`).terms.multiplier),[5,4,3,2,1]);
 assert.equal(find(costco,'earning-0').terms.spendCap.amount,7000);assert.equal(find(costco,'earning-0').terms.afterCapPercent,1);
 assert.equal(find(costco,'car-rental').terms.amount,null,'the page gives only the name');
 for(const id of ['citi-us-citi-simplicity-card','citi-us-citi-diamond-preferred-card'])assert.equal(rules(id).filter(r=>r.kind==='earning-rate').length,0,id);
 // Each Costco rate quotes its own number, and the gas tiers quote the cap, so a --pages run checks them.
 for(const id of [costco,'citi-us-costco-anywhere-visa-business-card-by-citi']){
  const quotes=[0,1,2,3,4].map(i=>find(id,`earning-${i}`).content.sourceText);
  [5,4,3,2,1].forEach((rate,i)=>assert.ok(quotes[i].includes(`${rate}%`),`${id}: ${quotes[i]}`));
  for(const quote of quotes.slice(0,2))assert.ok(quote.includes('$7,000'),`${id}: ${quote}`);
 }
});
test('batch 13 records the AAdvantage Globe and Business rates and benefits while the annual fee stays unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-24'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const globe='citi-us-citi-aadvantage-globe-card',business='citi-us-citi-aadvantage-business-card';
 assert.deepEqual([0,1,2,3,4].map(i=>find(globe,`earning-${i}`).terms.multiplier),[3,6,2,2,1]);
 assert.deepEqual([0,1,2,3].map(i=>find(business,`earning-${i}`).terms.multiplier),[2,2,2,1]);
 assert.equal(find(globe,'turo').terms.amount,240);assert.equal(find(globe,'turo').terms.period,null,'the page does not say which year');
 assert.equal(find(business,'companion-certificate').terms.spendThreshold,30000);
 assert.equal(find(business,'fee-additional').terms.amount,0);
 for(const id of [globe,business]){
  assert.equal(find(id,'fee-primary'),undefined,id);
  const p=product(id),result=runWalletTool(call('find_benefits',{cardName:p.name,query:'checked bag'}),{cards:[{id:'x',bank:p.bank,region:p.region,name:p.name}],events:[],day:'2026-11-24'});
  assert.ok(JSON.stringify(result).includes(p.sourceUrl),`${id}: ${JSON.stringify(result).slice(0,600)}`);
 }
});
test('batch 14 records what the Bank of America pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-24'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const elite='boa-us-bank-of-america-premium-rewards-elite-credit-card',plain='boa-us-bankamericard-credit-card',choice='boa-us-business-advantage-customized-cash-rewards-mastercard',af='boa-us-air-france-klm-visa-signature-credit-card';
 assert.equal(find(elite,'fee-primary').terms.amount,550);assert.equal(find(elite,'airline-incidental').terms.period,null,'the page says annually without naming the year');assert.equal(find(elite,'global-entry').terms.period,'rolling-four-years');
 assert.equal(rules(plain).filter(r=>r.kind==='earning-rate').length,0,'the page lists no rewards programme');
 assert.equal(find(choice,'earning-0').terms.spendCap.amount,50000);assert.equal(find(choice,'earning-0').terms.afterCapPercent,1);
 assert.equal(find(af,'xp-25000').terms.spendThreshold,25000);assert.equal(product(af).transferProgrammeId,undefined,'the page names no transfer partners');
 assert.equal(find('boa-us-bank-of-america-travel-rewards-credit-card','rewards-bonus').terms.amount,null,'the page gives no bonus rate');
});
test('batch 15 records what the Capital One and Wells Fargo pages state and leaves the rest unknown',()=>{
 const find=(productId,key)=>queryKnowledge({productId,asOf:'2026-11-24'}).rules.find(r=>r.id===`rule.${productId}.${key}`);
 const fees={'capital-one-us-quicksilver-rewards-credit-card':0,'capital-one-us-savorone-rewards-credit-card':39,'capital-one-us-ventureone-rewards-credit-card':0,'capital-one-us-venture-business-credit-card':95,'wells-fargo-us-active-cash-card':0,'wells-fargo-us-autograph-card':0,'wells-fargo-us-reflect-card':0};
 for(const [id,amount] of Object.entries(fees))assert.equal(find(id,'fee-primary').terms.amount,amount,id);
 assert.equal(find('wells-fargo-us-reflect-card','earning-0'),undefined,'the Reflect page publishes no earning rate');
 assert.equal(find('wells-fargo-us-reflect-card','rental'),undefined,'the Reflect page lists no rental cover');
 assert.equal(find('wells-fargo-us-active-cash-card','earning-0').terms.multiplier,2);
 assert.equal(find('wells-fargo-us-active-cash-card','cell-phone').terms.amount,null,'a claim cap is not a credit');
 assert.equal(find('wells-fargo-us-autograph-card','rental').terms.coverage.basis,'secondary');
 assert.equal(find('capital-one-us-venture-business-credit-card','travel').terms.period,'account-anniversary');
 assert.equal(product('wells-fargo-us-autograph-card').transferProgrammeId,undefined,'the page names no transfer partners');
});
test('batch 16 records what the Discover pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-24'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const miles='discover-us-discover-it-miles-credit-card',chrome='discover-us-discover-it-chrome-gas-restaurants-credit-card',transfer='discover-us-discover-it-balance-transfer-credit-card';
 for(const id of [miles,chrome,transfer]){
  assert.equal(find(id,'fee-primary').terms.amount,0,id);
  assert.equal(find(id,'ssn-alerts').terms.requiresEnrollment,true,id);
  assert.equal(find(id,'no-foreign-fee'),undefined,'the product page does not mention a foreign transaction fee');
 }
 assert.equal(find(miles,'earning-0').terms.multiplier,1.5);assert.equal(find(miles,'earning-0').terms.unit,'miles-per-USD');assert.equal(product(miles).transferProgrammeId,undefined,'the page names no transfer partners');
 assert.deepEqual([0,1].map(i=>find(chrome,`earning-${i}`).terms.multiplier),[2,1]);
 assert.deepEqual(find(chrome,'earning-0').terms.spendCap,{amount:1000,currency:'USD',period:'calendar-quarter'});
 assert.deepEqual([0,1].map(i=>find(transfer,`earning-${i}`).terms.multiplier),[5,1]);
 assert.equal(find(transfer,'earning-0').terms.spendCap,null,'the page states no quarterly maximum amount');
 assert.equal(find(transfer,'redemption'),undefined,'the page does not describe redemption');
});
test('batch 17 records what the U.S. Bank pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-24'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const smartly='us-bank-us-smartly-visa-signature-card',connect='us-bank-us-altitude-connect-visa-signature-card',shield='us-bank-us-shield-visa-card',triple='us-bank-us-triple-cash-rewards-visa-business-card',business='us-bank-us-business-altitude-connect-visa-signature-card';
 for(const id of [smartly,connect,shield,triple])assert.equal(find(id,'fee-primary').terms.amount,0,id);
 assert.equal(find(business,'fee-primary'),undefined,'the page shows no fee after the intro year');
 for(const id of [business,triple])assert.equal(find(id,'fee-additional').terms.amount,0,id);
 const earning=id=>rules(id).filter(r=>r.kind==='earning-rate').sort((a,b)=>a.id.localeCompare(b.id)).map(r=>r.terms.multiplier);
 assert.deepEqual(earning(smartly),[2],'the balance bonus is not a general earning rate');
 assert.deepEqual(earning(connect),[5,4,4,2,1]);assert.deepEqual(earning(shield),[4],'the page states no rate outside the Travel Center');
 assert.deepEqual(earning(triple),[5,3,1]);assert.deepEqual(earning(business),[5,4,2,1]);
 assert.deepEqual(find(connect,'earning-2').terms.spendCap,{amount:1000,currency:'USD',period:'calendar-quarter'});
 assert.equal(find(connect,'earning-2').terms.afterCapPercent,undefined,'the page states no rate past the gas cap');
 assert.deepEqual(find(business,'earning-1').terms.spendCap,{amount:150000,currency:'USD',period:'calendar-year'});assert.equal(find(business,'earning-1').terms.afterCapPercent,1);
 assert.equal(find(connect,'global-entry').terms.amount,null,'the page gives no credit amount');
 assert.equal(find(shield,'annual-credit').terms.amount,20);assert.equal(find(triple,'software').terms.amount,100);assert.equal(find(business,'rideshare').terms.amount,25);
 assert.equal(find(shield,'cell-phone').terms.amount,null,'a claim cap is not a credit');
 assert.equal(find(business,'priority-pass').terms.quantity,4);assert.equal(find(connect,'priority-pass').terms.quantity,undefined,'the page states no visit count');
 for(const id of [smartly,shield,triple])assert.equal(find(id,'no-foreign-fee'),undefined,'the product page does not mention a foreign transaction fee');
 assert.equal(find(business,'rental-car').terms.coverage.basis,null);
});
test('batch 18 records what the Capital One and Wells Fargo Signify pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-25'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const venture='capital-one-us-ventureone-business-credit-card',platinum='capital-one-us-platinum-credit-card',signify='wells-fargo-us-signify-business-cash-card';
 for(const id of [venture,platinum,signify])assert.equal(find(id,'fee-primary').terms.amount,0,id);
 assert.equal(find(venture,'fee-additional').terms.amount,0);
 assert.equal(find(signify,'fee-additional'),undefined,'the card terms page states no employee card fee');
 const earning=id=>rules(id).filter(r=>r.kind==='earning-rate').sort((a,b)=>a.id.localeCompare(b.id)).map(r=>r.terms.multiplier);
 assert.deepEqual(earning(venture),[5,1.5]);assert.deepEqual(earning(platinum),[],'the Platinum page publishes no rewards');assert.deepEqual(earning(signify),[2]);
 assert.equal(find(signify,'no-foreign-fee'),undefined,'the Signify terms list a foreign transaction fee');
 for(const id of [venture,platinum])assert.ok(find(id,'no-foreign-fee'),id);
 assert.equal(product(venture).transferProgrammeId,'programme.capital-one-miles');
 assert.equal(find(venture,'rental-car').terms.coverage.basis,null);
 assert.equal(find(signify,'rental-car').terms.coverage.basis,'primary');
 assert.equal(find(signify,'baggage-delay').terms.amount,null,'a claim cap is not a credit');
 assert.equal(find(signify,'priority-pass').terms.requiresEnrollment,true);
});
test('batch 19 records what the three U.S. Bank business pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-25'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const essentials='us-bank-us-business-essentials-visa-card',plus='us-bank-us-business-essentials-plus-visa-signature-card',shield='us-bank-us-business-shield-visa-card';
 assert.deepEqual([essentials,plus,shield].map(id=>find(id,'fee-primary').terms.amount),[0,295,0]);
 assert.equal(find(shield,'fee-additional').terms.amount,0);
 for(const id of [essentials,plus])assert.equal(find(id,'fee-additional'),undefined,'the product page states no employee card fee');
 const earning=id=>rules(id).filter(r=>r.kind==='earning-rate').sort((a,b)=>a.id.localeCompare(b.id)).map(r=>r.terms.multiplier);
 assert.deepEqual(earning(essentials),[6,2],'the balance bonus is not a general earning rate');
 assert.deepEqual(earning(plus),[10,5,2]);assert.deepEqual(earning(shield),[5],'the page states no rate outside the Travel Center');
 assert.deepEqual(find(plus,'earning-1').terms.spendCap,{amount:200000,currency:'USD',period:'account-anniversary'});assert.equal(find(plus,'earning-1').terms.afterCapPercent,2);
 const credit=find(shield,'annual-credit').terms;
 assert.deepEqual([credit.amount,credit.spendThreshold,credit.spendScope,credit.period],[50,5000,'category','account-anniversary']);
 assert.equal(find(shield,'purchase-security').terms.coverage.basis,null);
 for(const id of [essentials,plus,shield])assert.equal(find(id,'no-foreign-fee'),undefined,'the product page does not mention a foreign transaction fee');
});
test('batch 20 records what the three Capital One Spark pages state and leaves the rest unknown',()=>{
 const rules=productId=>queryKnowledge({productId,asOf:'2026-11-25'}).rules,find=(productId,key)=>rules(productId).find(r=>r.id===`rule.${productId}.${key}`);
 const cash='capital-one-us-spark-2-cash-credit-card',select='capital-one-us-spark-1-5-cash-select-credit-card',classic='capital-one-us-spark-1-classic-credit-card';
 for(const [id,fee] of [[cash,95],[select,0],[classic,0]]){assert.equal(find(id,'fee-primary').terms.amount,fee,id);assert.equal(find(id,'fee-additional').terms.amount,0,id);assert.equal(product(id).transferProgrammeId,undefined,id);}
 const earning=id=>rules(id).filter(r=>r.kind==='earning-rate').sort((a,b)=>a.id.localeCompare(b.id)).map(r=>r.terms.multiplier);
 assert.deepEqual(earning(cash),[5,2]);assert.deepEqual(earning(select),[5,1.5]);assert.deepEqual(earning(classic),[1],'the Classic page states no travel rate');
 assert.equal(find(cash,'no-foreign-fee'),undefined,'the 2% Cash page does not mention a foreign transaction fee');
 assert.equal(find(cash,'roadside'),undefined,'the 2% Cash page does not mention roadside assistance');
 for(const id of [select,classic]){assert.ok(find(id,'no-foreign-fee'),id);assert.equal(find(id,'roadside').terms.coverage.type,'roadside',id);}
 for(const id of [cash,select,classic])assert.equal(find(id,'extended-warranty').terms.coverage.basis,null,id);
});
