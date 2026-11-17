// Live benefit recall scoring (#131 follow-up): find_protections answers count like query_credits answers, mapped to
// rule ids by revision, at most 12, after find_benefits and credits. No model is called; tool calls are hand-written.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGolden,K} from '../evals/benefit-recall/lib.mjs';
import {scoreCase,protectionRuleIds,creditRuleIds} from '../evals/benefit-recall/live-score.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dev=await loadGolden(resolve(root,'evals/benefit-recall/golden.json'));
const day=dev.golden.asOf,ctx=q=>({cards:dev.portfolios[q.portfolio].cards,run:dev.run,score:dev.score,day});
const question=id=>dev.questions.find(q=>q.id===id);

test('a protection question answered by find_protections is credited only in the protections score',()=>{
 const q=question('p-flight-protection-hans');
 const s=scoreCase(q,[{name:'find_protections',args:{}}],ctx(q));
 assert.equal(s.find.recall,0);
 assert.equal(s.both.recall,0,'the step 4 score stays find_benefits + query_credits, comparable with older runs');
 assert.equal(s.tools.recall,1);
 assert.ok(s.tools.precision<1,'other protections of the portfolio lower precision');
});

test('a coverage type narrows what is credited',()=>{
 const q=question('p-flight-protection-hans'),s=scoreCase(q,[{name:'find_protections',args:{type:'trip-delay'}}],ctx(q));
 assert.deepEqual(s.tools.missed.sort(),q.expected.filter(id=>!id.endsWith('.trip-delay')).sort());
});

test('protection rules map to active protection rule ids, at most 12, and a rejected call credits nothing',()=>{
 const {cards}=ctx(question('p-flight-protection-hans'));
 const ids=protectionRuleIds({},cards,day);
 assert.ok(ids.length>0&&ids.length<=K);
 assert.ok(ids.every(id=>id.startsWith('rule.')&&!id.includes('@')));
 assert.deepEqual(protectionRuleIds({type:'not-a-coverage-type'},cards,day),[]);
});

test('find_benefits results keep their place; protections only add what is missing',()=>{
 const q=question('p-flight-protection-hans');
 const rewrite=q.rewrite.map(args=>({name:'find_benefits',args}));
 const alone=scoreCase(q,rewrite,ctx(q)),both=scoreCase(q,[...rewrite,{name:'find_protections',args:{}}],ctx(q));
 assert.equal(both.find.recall,alone.find.recall);
 assert.ok(both.tools.recall>=alone.tools.recall);
 assert.equal(both.tools.recall,1);
});

test('every dev and held-out question whose expected rules are protections is reachable through find_protections',async()=>{
 const held=await loadGolden(resolve(root,'evals/benefit-recall/holdout.json'));
 for(const set of [dev,held]){
  const c=q=>({cards:set.portfolios[q.portfolio].cards,run:set.run,score:set.score,day:set.golden.asOf});
  const protection=new Set(set.questions.flatMap(q=>protectionRuleIds({},c(q).cards,set.golden.asOf)));
  for(const q of set.questions.filter(q=>!q.ambiguous&&q.type!=='absent'&&q.expected.length&&q.expected.every(id=>protection.has(id)))){
   assert.equal(scoreCase(q,[{name:'find_protections',args:{}}],c(q)).tools.recall,1,q.id);
  }
 }
});

test('query_credits crediting is unchanged by the split into its own module',()=>{
 const q=dev.questions.find(q=>q.type!=='absent'&&!q.ambiguous&&creditRuleIds({},ctx(q).cards,day).some(id=>q.expected.includes(id)));
 assert.ok(q,'some dev question has an expected credit rule');
 const s=scoreCase(q,[{name:'query_credits',args:{}}],ctx(q));
 assert.ok(s.both.recall>0);
 assert.equal(s.tools.recall>=s.both.recall,true);
});
