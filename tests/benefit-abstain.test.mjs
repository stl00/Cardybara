import test from 'node:test';
import assert from 'node:assert/strict';
import {loadGolden} from '../evals/benefit-recall/lib.mjs';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';

// #266: an unfiltered question whose only matches are generic words (membership, 保障, discount) abstains, like an unknown subject.
const {golden,portfolios,questions}=await loadGolden(new URL('../evals/benefit-recall/golden.json',import.meta.url).pathname);
const search=(question,portfolio,filters={})=>searchBenefitKnowledge(question,portfolios[portfolio].cards,golden.asOf,filters);

test('generic words alone do not return unrelated rules', () => {
 for(const [question,portfolio] of [['gym membership credit?','dev-business'],['Is my phone screen covered if it cracks?','us-premium'],['买红酒或者鲜花有折扣吗？','us-premium'],['Do I get cash back at the pharmacy?','hk']]){
  const r=search(question,portfolio);
  assert.equal(r.rules.length,0,question);assert.ok(r.unknownSubject,question);
 }
});

test('a question with a filter or a real match still searches', () => {
 assert.ok(search('airport lounge Priority Pass','us-premium').rules.length>0);
 assert.equal(search('我有哪些会员优惠','us-premium').unknownSubject,undefined);
});

test('abstaining keeps recall on the development set', () => {
 const scored=questions.filter(q=>q.type!=='absent'&&!q.ambiguous&&q.expected.length);
 const recalls=scored.map(q=>{const ids=new Set(search(q.question,q.portfolio).rules.map(r=>r.id));return q.expected.filter(id=>ids.has(id)).length/Math.min(q.expected.length,12);});
 const mean=recalls.reduce((a,b)=>a+b,0)/recalls.length;
 assert.ok(mean>=0.97,`mode A recall@12 ${mean}`);
});

test('the frozen no-answer set is well formed', async () => {
 const set=await loadGolden(new URL('../evals/benefit-recall/noanswer.json',import.meta.url).pathname);
 assert.ok(set.questions.length>=40);
 assert.ok(set.questions.every(q=>q.type==='absent'&&!q.expected.length));
 for(const lang of ['zh-Hans','zh-Hant','en'])assert.ok(set.questions.filter(q=>q.lang===lang).length>=10,lang);
});
