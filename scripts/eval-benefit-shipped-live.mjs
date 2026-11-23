// Live run of the shipped find_benefits path (#575): the model writes the find_benefits call, runWalletToolAsync runs it
// with the gated answer judge, on the dev, held-out and frozen no-answer sets. Reports no-answer noise, recall@12 and
// judge call share per set (what the user sees after the judge).
//   node scripts/eval-benefit-shipped-live.mjs --dry-run      (no model, no network, no key: a stub model and a stub judge)
//   CARDYBARA_MODEL_CONFIG=/path/to/.env.local node scripts/eval-benefit-shipped-live.mjs --max-usd=0.2 [--sets=golden,holdout,noanswer]
// The live run costs money: owner approval in chat only. The key is read from the config file, passed to the client, and
// never printed or written. The report keeps question ids, tool names, find_benefits arguments, counts and yes/no.
// Frozen-set rule: report its aggregate and its still-noisy ids; never change the judge prompt after reading them.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGolden,K} from '../evals/benefit-recall/lib.mjs';
import {runShippedSet} from '../evals/benefit-recall/shipped-path.mjs';
import {JUDGE_GATE} from '../src/benefitAnswerJudge.js';
import {JUDGE_MAX_TOKENS} from '../src/judgeClient.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=(name,d)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??d;
const dry=process.argv.includes('--dry-run'),maxUsd=Number(arg('max-usd','0.2')),limit=Number(arg('limit','0'))||Infinity;
if(!dry&&!(maxUsd>0&&maxUsd<=1))throw Error('--max-usd must be between 0 and 1');
const sets=arg('sets','golden,holdout,noanswer').split(',');
const output=resolve(arg('out',resolve(root,`evals/latest-benefit-recall-shipped${dry?'-dry':''}.json`)));
// Same conservative DeepSeek peak prices as eval-benefit-recall-live.mjs.
const PRICE={cacheMiss:0.30,cacheHit:0.006,output:1.20};
const spend={calls:0,judgeCalls:0,promptTokens:0,cacheHitTokens:0,completionTokens:0,usd:0,errors:0};
let stopped=null,consecutiveErrors=0;
const cost=u=>{const hit=u.prompt_cache_hit_tokens??0,miss=u.prompt_cache_miss_tokens??Math.max(0,(u.prompt_tokens||0)-hit);return (miss*PRICE.cacheMiss+hit*PRICE.cacheHit+(u.completion_tokens||0)*PRICE.output)/1e6;};
const ceiling=(messages,maxTokens,extraChars=0)=>((JSON.stringify(messages).length+extraChars)/2*PRICE.cacheMiss+maxTokens*PRICE.output)/1e6;
const addUsage=u=>{spend.promptTokens+=u.prompt_tokens||0;spend.cacheHitTokens+=u.prompt_cache_hit_tokens??0;spend.completionTokens+=u.completion_tokens||0;spend.usd+=cost(u);};

let chat,judgeComplete;
if(dry){
 // Offline plumbing check: the stub model calls find_benefits with the golden rewrite; the judge keeps every result.
 chat=async(messages,q)=>({role:'assistant',content:null,tool_calls:messages.some(m=>m.role==='tool')?undefined:q.rewrite.map((args,i)=>({id:`c${i}`,type:'function',function:{name:'find_benefits',arguments:JSON.stringify(args)}}))});
 judgeComplete=async()=>{spend.judgeCalls++;return '{"answers":[1]}';};
}else{
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;if(!envFile)throw Error('set CARDYBARA_MODEL_CONFIG');
 const env={};for(const line of (await readFile(resolve(envFile),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 const {chatAgent}=await import('./chat-agent.mjs');
 const {createDeepSeekClient}=await import('./deepseek-client.mjs');
 const client=createDeepSeekClient(env);
 const guard=()=>{if(stopped)throw Error(stopped);};
 chat=async(messages,q)=>{
  guard();
  if(spend.usd+ceiling(messages,1800,15000)>maxUsd){stopped='budget';throw Error('budget');}
  try{const m=await chatAgent(env,{messages,today:'2026-11-09'},fetch,undefined,{onUsage:u=>{spend.calls++;addUsage(u);}});consecutiveErrors=0;return m;}
  catch(e){
   // A bad tool call or answer is the model's own miss; only a failed request leaves the question out.
   const error=e.status?'http_'+e.status:/^[a-z_]+$/.test(e.message)?e.message:e.constructor?.name||'error';
   if(/^[a-z_]+$/.test(error)&&!error.startsWith('http_'))return {role:'assistant',content:''};
   spend.errors++;consecutiveErrors++;if(consecutiveErrors>=3)stopped='errors';throw Error(error);
  }
 };
 judgeComplete=async messages=>{
  guard();
  if(spend.usd+ceiling(messages,JUDGE_MAX_TOKENS)>maxUsd){stopped='budget';throw Error('budget');}
  const body=await client.chat.completions.create({model:env.DEEPSEEK_MODEL||'deepseek-flash',messages,thinking:{type:'disabled'},max_tokens:JUDGE_MAX_TOKENS,temperature:0});
  spend.judgeCalls++;addUsage(body.usage||{});
  return body.choices?.[0]?.message?.content||'';
 };
}

const report={schema:1,createdAt:new Date().toISOString(),dryRun:dry,k:K,gate:JUDGE_GATE,priceAssumption:PRICE,maxUsd:dry?null:maxUsd,sets:{}};
for(const set of sets){
 const data=await loadGolden(resolve(root,`evals/benefit-recall/${set}.json`));
 report.sets[set]=await runShippedSet(data,{chat,judgeComplete,limit,shouldStop:()=>!!stopped});
 if(stopped)break;
}
report.spend={...spend,usd:Number(spend.usd.toFixed(4))};report.stopped=stopped;
await writeFile(output,JSON.stringify(report,null,1)+'\n');
const pct=x=>x==null?'-':(100*x).toFixed(1)+'%';
for(const [set,s] of Object.entries(report.sets))console.log(`${set}: recall@${K} ${pct(s.recallAt12)} (n=${s.scored}) · no-answer noise ${pct(s.noise)} (n=${s.absent}) · judge asked on ${pct(s.judgeShare)} of questions (${pct(s.judgeShareOfSearched)} of those that searched, ${s.judgeCalls} calls) · searched ${pct(s.searchedShare)} · failed requests ${s.failedRequests}${s.stopped?' · STOPPED':''}`);
for(const [set,s] of Object.entries(report.sets))if(s.absent)console.log(`${set}: still noisy ${s.stillNoisy.join(', ')||'none'}`);
console.log(dry?'dry run: stub model and stub judge, no model call, no spend':`live: ${spend.calls} assistant + ${spend.judgeCalls} judge calls, ${spend.promptTokens} prompt (${spend.cacheHitTokens} cached) + ${spend.completionTokens} output tokens, about $${spend.usd.toFixed(4)} at assumed peak prices${spend.errors?` · ${spend.errors} failed requests`:''}${stopped?` · STOPPED (${stopped})`:''}`);
console.log(`Report: ${output}`);
