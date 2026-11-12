// #252: the free nights on four Chase hotel cards, added to cards that already had rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getKnowledgeRule,inspectRuleRequirements,knowledgeSources,queryKnowledge,ruleRevisions,validateKnowledge} from '../src/knowledge.js';
import {profileForCard} from '../src/benefitRules.js';
import {cardProducts} from '../src/productCatalog.js';

const DAY='2026-11-12';
const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const BOUNDLESS='chase-us-marriott-bonvoy-boundless-credit-card',HYATT='chase-us-world-of-hyatt-credit-card';
const SELECT='chase-us-ihg-one-rewards-premier-select-credit-card',BUSINESS='chase-us-ihg-one-rewards-business-credit-card';
// card: [batch, programme, anniversary point cap, [spend threshold, its point cap]].
const CARDS={[BOUNDLESS]:[4,'programme.marriott-bonvoy',35000,null],[HYATT]:[4,'programme.world-of-hyatt',null,[15000,null]],[SELECT]:[5,'programme.ihg-one-rewards',60000,[40000,60000]],[BUSINESS]:[5,'programme.ihg-one-rewards',50000,[60000,50000]]};
const batchCard=(number,id)=>read(`docs/knowledge/card-batches/batch-0${number}.json`).cards.find(c=>c.id===id);
const en=read('src/i18n/knowledge.json')['en-US'],zhTW=read('src/i18n/knowledge.json')['zh-TW'];

test('each card has its anniversary free night, with the issuer wording and source',()=>{
 assert.deepEqual(validateKnowledge().errors,[]);
 for(const [id,[number,programme,cap]] of Object.entries(CARDS)){
  const card=batchCard(number,id),rule=getKnowledgeRule(`rule.${id}.anniversary-free-night`,{asOf:DAY});
  assert.equal(rule.revision,1,id);assert.equal(rule.kind,'benefit');assert.equal(rule.category,'hotel-service');
  assert.equal(rule.terms.period,'account-anniversary',id);assert.equal(rule.terms.quantity,1,id);assert.equal(rule.terms.awardPoints,cap??undefined,id);
  // A free night is not money: no amount is invented for it.
  assert.equal(rule.terms.amount,null,id);assert.equal(rule.terms.spendThreshold,undefined,id);assert.deepEqual(rule.conditions.all,[],id);
  assert.deepEqual(rule.programmeIds,[programme]);assert.deepEqual(rule.scenarioIds,['hotel-stay']);
  assert.equal(rule.evidence.checkedAt,DAY);assert.equal(rule.personalState,'not-in-public-knowledge');
  assert.ok(knowledgeSources(rule.evidence.sourceIds).every(s=>s.authority==='official'&&s.url===card.url&&s.checkedAt===DAY),id);
  // The point cap, where the page gives one, is in the issuer's words; Hyatt states a hotel category instead.
  const quotes=rule.original.quotes.map(q=>q.text);assert.equal(quotes[0],rule.content.sourceText);
  if(cap)assert.ok(quotes.some(q=>q.includes(cap.toLocaleString('en-US')+' points')),id);else assert.ok(quotes.some(q=>q.includes('Category 1–4')),id);
  assert.ok(quotes.some(q=>/12 months/.test(q)),`${id}: how long it lasts`);
  for(const q of quotes)assert.ok(q.split(/\s+/).length<=22,q);
  // Three languages.
  for(const text of [rule.content.title,rule.content.summary]){assert.ok(en[text],text);assert.ok(zhTW[text],text);}
  assert.match(rule.content.summary,/未核实/);
 }
});

test('the extra free night after calendar-year spend carries its threshold',()=>{
 for(const [id,[, ,,spend]] of Object.entries(CARDS)){
  const ruleId=`rule.${id}.spend-free-night`;
  if(!spend){assert.equal(ruleRevisions(ruleId).length,0,'the Boundless page states no spend-unlocked night');continue;}
  const [amount,cap]=spend,rule=getKnowledgeRule(ruleId,{asOf:DAY});
  assert.equal(rule.category,'spend-unlock');assert.equal(rule.terms.period,'calendar-year');assert.equal(rule.terms.spendThreshold,amount,id);
  assert.equal(rule.terms.spendScope,undefined,id);assert.equal(rule.terms.awardPoints,cap??undefined,id);
  assert.ok(rule.original.quotes.some(q=>q.text.includes('$'+amount.toLocaleString('en-US'))),id);
  assert.deepEqual(rule.conditions.all,[{field:'account.eligibleCalendarYearSpend',op:'gte',value:amount,currency:'USD',timeScope:'current-or-earned-year-needs-account-proof'}],id);
  assert.equal(inspectRuleRequirements(ruleId,{account:{eligibleCalendarYearSpend:amount-1}},{asOf:DAY}).result,'requirements-not-met',id);
  assert.match(rule.content.summary,/是否达标未核实/);
 }
});

test('the free nights are known from the day they were read, not from the batch day',()=>{
 for(const [id,[number]] of Object.entries(CARDS)){
  const before=read(`docs/knowledge/card-batches/batch-0${number}.json`).checkedAt;assert.ok(before<DAY);
  const ids=asOf=>queryKnowledge({productId:id,asOf}).rules.map(r=>r.id).filter(r=>r.endsWith('free-night'));
  assert.deepEqual(ids(before),[],id);assert.ok(ids(DAY).includes(`rule.${id}.anniversary-free-night`),id);
 }
});

test('the cards no longer list the free night as a gap, and keep their other gaps',()=>{
 for(const [id,[number]] of Object.entries(CARDS)){
  const card=batchCard(number,id),p=cardProducts.find(x=>x.id===id),profile=profileForCard({bank:p.bank,region:p.region,name:p.name});
  for(const gap of [...card.unknown.map(u=>u.zh),...profile.knowledgeGaps])assert.doesNotMatch(gap,/免费房晚|額外房晚|额外房晚/,id);
  assert.deepEqual(profile.knowledgeGaps.slice(0,-1),card.unknown.map(u=>u.zh),id);
  const shown=profile.benefits.find(b=>b.knowledgeRuleId===`rule.${id}.anniversary-free-night`);assert.ok(shown,id);assert.equal(shown.accountState,'unverified',id);
 }
 assert.match(batchCard(4,HYATT).unknown[0].zh,/Tier Qualifying Night/);assert.match(batchCard(5,SELECT).unknown[0].zh,/200美元航空抵扣/);assert.match(batchCard(5,BUSINESS).unknown[0].zh,/Platinum Elite/);
 const coverage=readFileSync(new URL('../docs/knowledge/US_CARD_COVERAGE.md',import.meta.url),'utf8');
 for(const row of coverage.split('\n').filter(l=>/Boundless|World of Hyatt \||Premier Select|IHG One Rewards Business/.test(l)))assert.doesNotMatch(row,/免费房晚/,row);
});
