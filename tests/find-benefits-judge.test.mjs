import test from 'node:test';
import assert from 'node:assert/strict';
import {runWalletTool,runWalletToolAsync} from '../src/walletAgent.js';
import {cardProducts} from '../src/productCatalog.js';
import {turnJudge,JUDGE_MAX_CALLS} from '../src/judgeClient.js';

// #295: the gated answer judge inside find_benefits. The model call is a stub; nothing here touches a network or a key.
const card=id=>{const p=cardProducts.find(x=>x.id===id);return {id:'t-'+id,productId:id,name:p.name,bank:p.bank,region:p.region,currency:'USD'};};
const wallet={cards:['amex-us-us-delta-skymiles-reserve-card','chase-us-united-quest','amex-us-us-marriott-bonvoy-brilliant-card'].map(card),events:[],day:'2026-11-09'};
const call=query=>({id:'c1',function:{name:'find_benefits',arguments:JSON.stringify({query})}});
const WEAK='hotel free night',STRONG='Delta Sky Club access';
const judgeOf=(reply,question=WEAK)=>{const j={question,maxCalls:2,used:0,asked:0,complete:async()=>{j.asked++;if(reply instanceof Error)throw reply;return reply;}};return j;};

test('without a judge the async path returns exactly the synchronous result', async () => {
 for(const q of [WEAK,STRONG])assert.deepEqual(await runWalletToolAsync(call(q),wallet),runWalletTool(call(q),wallet));
});

test('a weak match the judge rejects becomes "no held card lists this"', async () => {
 const plain=runWalletTool(call(WEAK),wallet);assert.ok(plain.rules.length>0);
 const judge=judgeOf('{"answers":[]}');
 const result=await runWalletToolAsync(call(WEAK),{...wallet,judge});
 assert.equal(judge.asked,1);assert.equal(judge.used,1);
 assert.deepEqual(result.rules,[]);assert.equal(result.totalMatches,0);
 assert.match(result.unknownSubject.note,/none of their cards lists a benefit/);
 assert.equal(result.suggestions,undefined);
});

test('a weak match the judge accepts, or cannot read, keeps every rule', async () => {
 const plain=runWalletTool(call(WEAK),wallet);
 for(const reply of ['{"answers":[1]}','I am not sure',new Error('model_failed')]){
  const judge=judgeOf(reply);
  assert.deepEqual(await runWalletToolAsync(call(WEAK),{...wallet,judge}),plain,String(reply));
 }
});

test('a strong match never calls the judge', async () => {
 const judge=judgeOf('{"answers":[]}',STRONG);
 const result=await runWalletToolAsync(call(STRONG),{...wallet,judge});
 assert.equal(judge.asked,0);assert.deepEqual(result,runWalletTool(call(STRONG),wallet));
});

test('other tools never call the judge, and the per-turn call cap holds', async () => {
 const judge=judgeOf('{"answers":[1]}');
 await runWalletToolAsync({id:'c2',function:{name:'list_cards',arguments:'{}'}},{...wallet,judge});
 assert.equal(judge.asked,0);
 for(let i=0;i<5;i++)await runWalletToolAsync(call(WEAK),{...wallet,judge});
 assert.equal(judge.asked,2);
});

test('an abort is not swallowed as a judge failure', async () => {
 const abort=Object.assign(Error('aborted'),{name:'AbortError'});
 await assert.rejects(runWalletToolAsync(call(WEAK),{...wallet,judge:judgeOf(abort)}),{name:'AbortError'});
});

test('the turn judge sends a short, time-limited, deterministic request through the injected client only', async () => {
 let seen;const judge=turnJudge('q',{complete:async(body,opts)=>{seen={body,opts};return {choices:[{message:{content:'{"answers":[]}'}}]};}});
 assert.equal(judge.maxCalls,JUDGE_MAX_CALLS);
 assert.equal(await judge.complete([{role:'user',content:'x'}]),'{"answers":[]}');
 assert.equal(seen.body.temperature,0);assert.ok(seen.body.max_tokens<=40);assert.ok(seen.opts.signal&&seen.opts.timeout<=8000);
 assert.doesNotMatch(JSON.stringify(seen),/key|authorization/i);
});
