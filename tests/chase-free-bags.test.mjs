// #253: the free first checked bag on five Southwest Rapid Rewards cards and Air Canada Aeroplan, added to cards that already had rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getKnowledgeRule,knowledgeSources,queryKnowledge,validateKnowledge} from '../src/knowledge.js';
import {profileForCard} from '../src/benefitRules.js';
import {cardProducts} from '../src/productCatalog.js';

const DAY='2026-11-12';
const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'));
const SW=['chase-us-southwest-rapid-rewards-plus-credit-card','chase-us-southwest-rapid-rewards-priority-credit-card','chase-us-southwest-rapid-rewards-premier-credit-card','chase-us-southwest-rapid-rewards-premier-business-credit-card','chase-us-southwest-rapid-rewards-performance-business-credit-card'];
const AC='chase-us-air-canada-aeroplan-card',UNITED='chase-us-united-explorer-card';
const BATCH={[SW[0]]:4,[SW[1]]:4,[SW[2]]:4,[SW[3]]:5,[SW[4]]:5,[AC]:4};
const batchCard=id=>read(`docs/knowledge/card-batches/batch-0${BATCH[id]}.json`).cards.find(c=>c.id===id);
// The title is shared with other cards' bag rules and lives in knowledge-rules.json; the long summaries in knowledge.json.
const catalogue=lang=>({...read('src/i18n/knowledge-rules.json')[lang],...read('src/i18n/knowledge.json')[lang]});
const en=catalogue('en-US'),zhTW=catalogue('zh-TW');
const ruleOf=id=>getKnowledgeRule(`rule.${id}.first-bag`,{asOf:DAY});

test('each card has its free first checked bag rule with source, quote and three languages',()=>{
 assert.deepEqual(validateKnowledge().errors,[]);
 for(const id of Object.keys(BATCH)){
  const card=batchCard(id),rule=ruleOf(id);
  assert.equal(rule.revision,1,id);assert.equal(rule.kind,'benefit');assert.equal(rule.category,'membership');
  assert.equal(rule.terms.period,'per-trip',id);assert.equal(rule.terms.amount,null,id);assert.deepEqual(rule.conditions.all,[],id);
  assert.deepEqual(rule.programmeIds,[id===AC?'programme.air-canada-aeroplan':'programme.southwest-rapid-rewards']);
  assert.ok(rule.scenarioIds.includes('airport'),id);
  assert.equal(rule.evidence.checkedAt,DAY);assert.equal(rule.personalState,'not-in-public-knowledge');
  assert.ok(knowledgeSources(rule.evidence.sourceIds).every(s=>s.authority==='official'&&s.url===card.url&&s.checkedAt===DAY),id);
  const quotes=rule.original.quotes.map(q=>q.text);assert.equal(quotes[0],rule.content.sourceText);
  for(const q of quotes)assert.ok(q.split(/\s+/).length<=22,q);
  for(const text of [rule.content.title,rule.content.summary]){assert.ok(en[text],text);assert.ok(zhTW[text],text);}
  assert.match(rule.content.summary,/未核实/);
 }
});

test('Southwest: primary cardmember plus up to eight passengers, Rapid Rewards number, no card-purchase condition invented',()=>{
 for(const id of SW){
  const rule=ruleOf(id),quotes=rule.original.quotes.map(q=>q.text);
  assert.ok(quotes[0].includes('up to eight Passengers traveling on the same reservation'),id);
  assert.ok(quotes.some(q=>q.includes('must include their Rapid Rewards number')),id);
  assert.ok(quotes.some(q=>q.includes('partner carrier')),id);
  assert.match(rule.content.summary,/最多8名乘客/);assert.match(rule.content.summary,/Rapid Rewards 号码/);assert.match(rule.content.summary,/合作航司/);
  // The pages do not say the ticket must be bought with the card, so the rule does not.
  assert.doesNotMatch(rule.content.summary,/本卡购票/,id);
 }
});

test('Aeroplan: cardmember plus up to eight others, 50lb, Air Canada check-in',()=>{
 const rule=ruleOf(AC),quotes=rule.original.quotes.map(q=>q.text);
 assert.ok(rule.content.sourceText.includes('free first checked bag up to 50lb'));
 assert.ok(quotes.some(q=>q.includes('up to eight (8) other passengers')));
 assert.ok(quotes.some(q=>q.includes('checking in with Air Canada')));
 assert.match(rule.content.summary,/50磅/);assert.match(rule.content.summary,/登机口/);
});

test('the bags are known from the day they were read, not from the batch day',()=>{
 for(const id of Object.keys(BATCH)){
  const before=read(`docs/knowledge/card-batches/batch-0${BATCH[id]}.json`).checkedAt;assert.ok(before<DAY);
  const ids=asOf=>queryKnowledge({productId:id,asOf}).rules.map(r=>r.id);
  assert.ok(!ids(before).includes(`rule.${id}.first-bag`),id);assert.ok(ids(DAY).includes(`rule.${id}.first-bag`),id);
 }
});

test('the cards no longer list the free checked bag as a gap, keep their other gaps, and United Explorer is unchanged',()=>{
 for(const id of Object.keys(BATCH)){
  const card=batchCard(id),p=cardProducts.find(x=>x.id===id),profile=profileForCard({bank:p.bank,region:p.region,name:p.name});
  for(const gap of [...card.unknown.map(u=>u.zh),...profile.knowledgeGaps,...card.unknown.map(u=>u.en)])assert.doesNotMatch(gap,/免费托运行李|free checked bag/i,id);
  assert.deepEqual(profile.knowledgeGaps.slice(0,-1),card.unknown.map(u=>u.zh),id);
  assert.ok(card.unknown.length>0,`${id}: its other gaps stay`);
  const shown=profile.benefits.find(b=>b.knowledgeRuleId===`rule.${id}.first-bag`);assert.ok(shown,id);assert.equal(shown.accountState,'unverified',id);
 }
 assert.match(batchCard(SW[3]).unknown[0].zh,/TQP/);assert.match(batchCard(AC).unknown[0].zh,/FLY15OFF/);
 const coverage=readFileSync(new URL('../docs/knowledge/US_CARD_COVERAGE.md',import.meta.url),'utf8');
 for(const row of coverage.split('\n').filter(l=>/Southwest Rapid Rewards|Air Canada Aeroplan/.test(l)&&l.startsWith('| ')))assert.doesNotMatch(row,/免费托运行李/,row);
 // United Explorer kept its 2026-11-04 rule; this change did not revise it.
 assert.equal(getKnowledgeRule(`rule.${UNITED}.first-bag`,{asOf:DAY}).revision,1);
 assert.equal(getKnowledgeRule(`rule.${UNITED}.first-bag`,{asOf:DAY}).evidence.checkedAt,'2026-11-04');
});
