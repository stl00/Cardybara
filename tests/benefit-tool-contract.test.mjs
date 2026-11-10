import test from 'node:test';
import assert from 'node:assert/strict';
import {runWalletTool,agentTools} from '../src/walletAgent.js';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import {cardProducts} from '../src/productCatalog.js';
import {SYSTEM} from '../src/chatProtocol.js';

const card=id=>{const p=cardProducts.find(x=>x.id===id);return {id:'t-'+id,productId:id,name:p.name,bank:p.bank,region:p.region,currency:'USD'};};
const wallet={cards:['amex-us-us-delta-skymiles-reserve-card','chase-us-united-quest','amex-us-us-marriott-bonvoy-brilliant-card'].map(card),events:[],day:'2026-11-09'};
const find=args=>runWalletTool({id:'c1',function:{name:'find_benefits',arguments:JSON.stringify(args)}},wallet);

test('the tool and the prompt ask for a scenario or category and Chinese keywords, but not for a whole card', () => {
 const tool=agentTools.find(t=>t.function.name==='find_benefits').function;
 assert.match(tool.description,/set the closest scenarioId or category whenever the question points to a use/);
 assert.match(tool.description,/For a whole card or all benefits, leave scenarioId and category empty/);
 assert.match(tool.description,/Simplified Chinese/);
 assert.match(SYSTEM,/When calling find_benefits, set the closest scenarioId or category whenever/);
 assert.match(SYSTEM,/still answering in the user's language/);
});

test('a programme filter accepts a Chinese name or an alias', () => {
 for(const programme of ['万豪','萬豪','Bonvoy','Marriott']){
  const ids=find({query:'会籍',programme}).rules.map(r=>r.revision);
  assert.ok(ids.some(id=>id.startsWith('rule.amex-us-us-marriott-bonvoy-brilliant-card.platinum-elite@')),programme);
 }
 assert.equal(find({query:'会籍',programme:'洲际'}).rules.length,0);
});

test('no match returns suggested scenarios, not an empty answer', () => {
 const none=find({query:'租车 保障',scenarioId:'fitness'});
 assert.equal(none.rules.length,0);
 assert.ok(none.suggestions.scenarios.length>0);
 assert.ok(none.suggestions.scenarios.every(s=>s.matches>0));
 assert.equal(find({query:'Delta Stays'}).suggestions,undefined);
});

test('a wrong scenario returns the rule the words name, and suggestions only when no word matches', () => {
 const premium={cards:['amex-us-us-the-platinum-card','chase-us-sapphire-reserve'].map(card),events:[],day:'2026-11-09'};
 const call=args=>runWalletTool({id:'c2',function:{name:'find_benefits',arguments:JSON.stringify(args)}},premium);
 const r=call({query:'租车 保障',scenarioId:'fitness'});
 assert.ok(r.rules.some(x=>x.revision.startsWith('rule.chase-us-sapphire-reserve.rental@')));
 assert.equal(r.suggestions,undefined);
 const none=call({query:'高尔夫',scenarioId:'fitness'});
 assert.ok(none.rules.every(x=>x.title.includes('Peloton')));
 assert.match(none.suggestions.basis,/without scenarioId|held cards/);
});

test('suggestion counts are not citable numbers', async () => {
 const {answerGrounding}=await import('../src/answerGrounding.js');
 const evidence=[{rules:[],suggestions:{basis:'held cards, any query',scenarios:[{scenarioId:'dining',matches:7}]}}];
 assert.ok(answerGrounding('You get 7 USD back',evidence).issues.some(i=>i.code==='unsupported_number'));
});

test('a partner word asks across every card, not for the card named after the partner', () => {
 const cards=['chase-us-world-of-hyatt-credit-card','chase-us-sapphire-reserve','chase-us-united-quest'].map(card);
 const ids=searchBenefitKnowledge('Hyatt perks',cards,'2026-11-09').rules.map(r=>r.id);
 assert.ok(ids.includes('rule.chase-us-sapphire-reserve.hyatt-explorist'));
});

test('words such as the, card and credit do not pick a card', () => {
 const amex=['amex-us-us-the-platinum-card','amex-us-us-american-express-gold-card','amex-us-us-delta-skymiles-reserve-card'].map(card);
 const owners=q=>new Set(searchBenefitKnowledge(q,amex,'2026-11-09').rules.map(r=>r.productIds[0]));
 assert.equal(owners('What are the Amex perks').size,3);
 assert.deepEqual([...owners('What are the Delta perks?')],['amex-us-us-delta-skymiles-reserve-card']);
 const chase=['chase-us-chase-sapphire-preferred-credit-card','amex-us-us-the-platinum-card','chase-us-sapphire-reserve'].map(card);
 assert.equal(new Set(searchBenefitKnowledge('What credit card benefits do I have?',chase,'2026-11-09').rules.map(r=>r.productIds[0])).size>1,true);
});

test('a short programme filter does not match inside other names', async () => {
 const {programmesForFilter}=await import('../src/benefitVocabulary.js');
 assert.deepEqual(programmesForFilter('one'),[]);
 assert.deepEqual(programmesForFilter('万豪'),['programme.marriott-bonvoy']);
 assert.ok(programmesForFilter('Marr').includes('programme.marriott-bonvoy'));
});

test('a whole-card question lists that card, and only that card', () => {
 const ids=searchBenefitKnowledge('What Delta perks do I have?',wallet.cards,wallet.day).rules.map(r=>r.id);
 assert.deepEqual([...new Set(ids.map(id=>id.split('.')[1]))],['amex-us-us-delta-skymiles-reserve-card']);
 assert.ok(ids.length>=4);
});

test('a neighbouring scenario no longer hides the rule the words point to', () => {
 const premium=['amex-us-us-the-platinum-card','chase-us-sapphire-reserve'].map(card);
 const ids=searchBenefitKnowledge('Global Entry 申请费 报销',premium,'2026-11-09',{scenarioId:'travel',category:'credit'}).rules.map(r=>r.id);
 assert.ok(ids.includes('rule.chase-us-sapphire-reserve.global-entry'));
 const bag=searchBenefitKnowledge('行李延误 baggage delayed',premium,'2026-11-09',{scenarioId:'airport'}).rules.map(r=>r.id);
 assert.ok(bag.includes('rule.chase-us-sapphire-reserve.baggage-delay'));
});

test('rules in the chosen scenario still come first, and a named brand stays strict', () => {
 const premium=['amex-us-us-the-platinum-card','chase-us-sapphire-reserve','amex-us-us-hilton-honors-aspire-card'].map(card);
 const r=searchBenefitKnowledge('休息室',premium,'2026-11-09',{category:'lounge'}).rules;
 assert.ok(r.slice(0,3).every(x=>x.category==='lounge'));
 const marriott=searchBenefitKnowledge('万豪 会籍',[card('amex-hk-hk-the-platinum-card')].map(c=>({...c,region:'HK'})),'2026-11-09',{scenarioId:'hotel-stay'}).rules.map(r=>r.id);
 assert.ok(marriott.includes('rule.amex-hk-hk-the-platinum-card.marriott'));
 assert.ok(marriott.every(id=>!/hilton|radisson|accor|hyatt/.test(id)),marriott.join());
});

test('a rule outside the chosen scenario competes on its own words only, without category boosts', () => {
 const cards=['amex-us-us-the-platinum-card','chase-us-sapphire-reserve','amex-us-us-hilton-honors-aspire-card','amex-us-us-delta-skymiles-reserve-card','amex-us-us-marriott-bonvoy-brilliant-card'].map(card);
 const scoreOf=(filters,id)=>searchBenefitKnowledge('航空 会籍 status',cards,'2026-11-09',filters).rules.find(r=>r.id===id)?.retrieval.score;
 const diamond='rule.amex-us-us-hilton-honors-aspire-card.diamond';
 assert.ok(scoreOf({},diamond)>scoreOf({scenarioId:'travel'},diamond),'the membership boost is for rules inside the filter');
 const r=searchBenefitKnowledge('航空 会籍 status',cards,'2026-11-09',{scenarioId:'travel'}).rules;
 assert.ok(r[0].scenarioIds.includes('travel'));
 // A single body word is not enough outside the filter.
 assert.equal(searchBenefitKnowledge('使用',cards,'2026-11-09',{scenarioId:'fitness'}).rules.filter(x=>!x.scenarioIds.includes('fitness')).length,0);
});

// #157: a product the wallet doesn't hold returns no rules, says so, and suggests no other searches.
test('a named product the wallet does not hold returns no benefits and says so', () => {
 for(const query of ['Sapphire Titanium card lounge access','Marriott Bonvoy Bold card free night','钛晶卡的贵宾室','Amex Aurora hotel credit']){
  const r=find({query});
  assert.equal(r.rules.length,0,query);assert.equal(r.suggestions,undefined,query);
  assert.match(r.unheldProduct.note,/not among their cards/,query);
 }
 const byName=find({query:'lounge',cardName:'No Such Card'});
 assert.equal(byName.rules.length,0);assert.equal(byName.unheldProduct.named,'No Such Card');
});
test('a held product, a programme card or a kind of card named the same way still searches', () => {
 for(const query of ['Delta Reserve card lounge','Marriott Bonvoy Brilliant card free night','United card checked bag','Priority Pass card','海外签账卡手续费','碌卡有冇回赠','续卡送什么'])
  assert.equal(find({query}).unheldProduct,undefined,query);
});
test('a question about something no benefit record mentions returns nothing, with no suggested searches', () => {
 for(const query of ['反重力滑板的年度礼遇','quantum hoverboard annual perks']){
  const r=find({query});
  assert.equal(r.rules.length,0,query);assert.equal(r.suggestions,undefined,query);assert.match(r.unknownSubject.note,/do not offer unrelated benefits/,query);
 }
 // Kind-of-benefit words alone ask about everything, not about an unknown thing.
 assert.equal(find({query:'我有哪些会员优惠'}).unknownSubject,undefined);
});
