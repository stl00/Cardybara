// #575: the live eval of the shipped find_benefits path, run with stub models. No network, no key, no spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGolden} from '../evals/benefit-recall/lib.mjs';
import {runShippedSet,askShipped,revisionIds} from '../evals/benefit-recall/shipped-path.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const frozen=await loadGolden(resolve(root,'evals/benefit-recall/noanswer.json'));
const dev=await loadGolden(resolve(root,'evals/benefit-recall/golden.json'));
// Stub model: writes the golden rewrite as find_benefits calls in the first round, then stops.
const rewriteChat=async(messages,q)=>({role:'assistant',content:null,tool_calls:messages.some(m=>m.role==='tool')?undefined:q.rewrite.map((args,i)=>({id:'c'+i,type:'function',function:{name:'find_benefits',arguments:JSON.stringify(args)}}))});
const keep=async()=>'{"answers":[1]}',reject=async()=>'{"answers":[]}';
const small=(set,n)=>({...set,questions:set.questions.slice(0,n)});

test('a judge that keeps everything reproduces the search result and a judge that rejects removes the noise it was asked about',async()=>{
 const kept=await runShippedSet(frozen,{chat:rewriteChat,judgeComplete:keep});
 const rejected=await runShippedSet(frozen,{chat:rewriteChat,judgeComplete:reject});
 assert.equal(kept.absent,52);assert.ok(kept.noise>0);
 assert.ok(rejected.noise<kept.noise,'rejecting judged questions lowers noise');
 assert.ok(rejected.judgeShare>0&&rejected.judgeShare<1,'the gate leaves strong matches unjudged');
 assert.equal(rejected.judgeShare,kept.judgeShare);
 // every still-noisy question in the rejecting run was not judged (strong match)
 const judgedIds=new Set(rejected.rows.filter(r=>r.judgeAsked).map(r=>r.id));
 assert.ok(rejected.stillNoisy.every(id=>!judgedIds.has(id)));
});

test('questions the model never searches for return nothing: no noise, no recall',async()=>{
 const silent=async()=>({role:'assistant',content:'No tool needed.'});
 const r=await runShippedSet(small(dev,30),{chat:silent,judgeComplete:keep}),n=await runShippedSet(small(frozen,30),{chat:silent,judgeComplete:keep});
 assert.equal(r.searchedShare,0);assert.equal(r.judgeShare,0);assert.equal(r.recallAt12,0);
 assert.equal(n.noise,0);
});

test('a failed request leaves the question out of the numbers and is counted',async()=>{
 const boom=async()=>{throw Error('http_500');};
 const r=await runShippedSet(small(frozen,5),{chat:boom,judgeComplete:keep});
 assert.equal(r.failedRequests,5);assert.equal(r.answered,0);assert.equal(r.noise,null);
});

test('a judge failure keeps the rules (fail open) and the judge call share counts only questions where it was asked',async()=>{
 const broken=async()=>{throw Error('model_failed');};
 const a=await runShippedSet(frozen,{chat:rewriteChat,judgeComplete:broken}),b=await runShippedSet(frozen,{chat:rewriteChat,judgeComplete:keep});
 assert.equal(a.noise,b.noise);assert.equal(a.judgeShare,b.judgeShare);
});

test('the per-turn judge cap of 2 holds when the model writes several find_benefits calls',async()=>{
 const q=frozen.questions[0],many=Array.from({length:4},()=>({query:q.rewrite[0].query}));
 const chat=async messages=>({role:'assistant',content:null,tool_calls:messages.some(m=>m.role==='tool')?undefined:many.map((args,i)=>({id:'c'+i,type:'function',function:{name:'find_benefits',arguments:JSON.stringify(args)}}))});
 const r=await askShipped(q,{cards:frozen.portfolios[q.portfolio].cards,day:frozen.golden.asOf,chat,judgeComplete:keep,idOf:revisionIds(frozen.golden.asOf)});
 assert.ok(r.judgeAsked<=2);
});

test('an invalid tool call from the model scores as no search result, not a crash',async()=>{
 const bad=async messages=>({role:'assistant',content:null,tool_calls:messages.some(m=>m.role==='tool')?undefined:[{id:'x',type:'function',function:{name:'find_benefits',arguments:'{"scenarioId":"nope"}'}}]});
 const r=await runShippedSet(small(frozen,3),{chat:bad,judgeComplete:keep});
 assert.equal(r.answered,3);assert.equal(r.noise,0);
});

test('shouldStop ends the set early and marks it stopped',async()=>{
 let n=0;
 const r=await runShippedSet(frozen,{chat:rewriteChat,judgeComplete:keep,shouldStop:()=>n++>=4});
 assert.equal(r.stopped,true);assert.equal(r.questions,4);
});
