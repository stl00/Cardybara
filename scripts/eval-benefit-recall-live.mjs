// Benefit recall with the real model filling find_benefits: the measured version of the offline eval's mode C.
// Costs money: run only with the owner's approval. Synthetic public portfolios only; no wallet data.
//   CARDYBARA_MODEL_CONFIG=/path/to/.env.local node scripts/eval-benefit-recall-live.mjs --max-usd=0.45 [--label=x] [--golden=...] [--limit=n]
// Each question gets the production system prompt and tools. The model may call list_cards or other read-only tools
// first (they run locally); the first round with find_benefits ends the question, with no final answer, to save cost.
// The key is read from the config file and passed to the client only. It is never printed or written.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chatAgent} from './chat-agent.mjs';
import {runWalletTool} from '../src/walletAgent.js';
import {loadGolden,K} from '../evals/benefit-recall/lib.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=(name,d)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??d;
const label=arg('label','run'),maxUsd=Number(arg('max-usd','0.45')),limit=Number(arg('limit','0'))||Infinity;
if(!(maxUsd>0&&maxUsd<=1))throw Error('--max-usd must be between 0 and 1');
// Conservative list prices in USD per million tokens (DeepSeek peak rates), so the guard stops early rather than late.
const PRICE={cacheMiss:0.30,cacheHit:0.006,output:1.20};
const ROUNDS=3;

const envFile=process.env.CARDYBARA_MODEL_CONFIG;if(!envFile)throw Error('set CARDYBARA_MODEL_CONFIG');
const env={};for(const line of (await readFile(resolve(envFile),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}

const spend={calls:0,promptTokens:0,cacheHitTokens:0,completionTokens:0,usd:0};
const cost=u=>{const hit=u.prompt_cache_hit_tokens??0,miss=u.prompt_cache_miss_tokens??Math.max(0,u.prompt_tokens-hit);return (miss*PRICE.cacheMiss+hit*PRICE.cacheHit+u.completion_tokens*PRICE.output)/1e6;};
// Worst case for one more call: the whole prompt uncached and the full output budget.
const nextCallCeiling=chars=>(chars/2*PRICE.cacheMiss+1800*PRICE.output)/1e6;
let stopped=null;

async function ask(question,cards,day){
 const messages=[{role:'user',content:question}],calls=[],tools=[];
 for(let round=0;round<ROUNDS;round++){
  const chars=JSON.stringify(messages).length+15000;
  if(spend.usd+nextCallCeiling(chars)>maxUsd){stopped='budget';return {calls,tools,stopped:true};}
  let message;
  try{message=await chatAgent(env,{messages,today:day},fetch,undefined,{onUsage:u=>{spend.calls++;spend.promptTokens+=u.prompt_tokens;spend.cacheHitTokens+=u.prompt_cache_hit_tokens??0;spend.completionTokens+=u.completion_tokens;spend.usd+=cost(u);}});}
  // Only a status or error name: provider messages can echo request details.
  catch(e){return {calls,tools,error:e.status?'http_'+e.status:/^[a-z_]+$/.test(e.message)?e.message:e.name||'error'};}
  if(!message.tool_calls?.length)return {calls,tools,answeredWithoutSearch:true};
  messages.push(message);
  for(const call of message.tool_calls){
   tools.push(call.function.name);
   const args=JSON.parse(call.function.arguments||'{}');
   if(call.function.name==='find_benefits')calls.push(args);
   messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(runWalletTool(call,{cards,events:[],day}))});
  }
  if(calls.length)return {calls,tools};
 }
 return {calls,tools};
}

const report={schema:1,label,createdAt:new Date().toISOString(),model:env.DEEPSEEK_MODEL||'deepseek-flash',k:K,priceAssumption:PRICE,maxUsd,sets:{}};
for(const path of (arg('golden')?[arg('golden')]:['evals/benefit-recall/golden.json','evals/benefit-recall/holdout.json'])){
 const {golden,portfolios,questions,run,score}=await loadGolden(resolve(root,path));
 const rows=[];
 for(const q of questions.filter(q=>!q.ambiguous&&q.type!=='absent').slice(0,limit)){
  if(stopped)break;
  // The model sees only the held cards' public names and regions, through list_cards.
  const cards=portfolios[q.portfolio].cards,r=await ask(q.question,cards,golden.asOf);
  const s=r.calls.length?score(q,run(r.calls,portfolios[q.portfolio].cards)):score(q,{ranked:[],total:0});
  rows.push({id:q.id,lang:q.lang,type:q.type,recall:s.recall,rr:s.rr,missed:s.missed,returned:s.returned,tools:r.tools,calls:r.calls,...(r.error?{error:r.error}:{}),...(r.answeredWithoutSearch?{answeredWithoutSearch:true}:{}),...(r.stopped?{stopped:true}:{})});
  process.stdout.write('.');
 }
 const done=rows.filter(x=>!x.stopped),mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,cjk=s=>/[㐀-鿿]/.test(s||'');
 const sum=list=>({n:list.length,recallAt12:mean(list.map(x=>x.recall)),mrr:mean(list.map(x=>x.rr)),searched:mean(list.map(x=>x.calls.length?1:0)),
  filterSet:mean(list.filter(x=>x.calls.length).map(x=>x.calls.some(c=>c.scenarioId||c.category)?1:0)),programmeSet:mean(list.filter(x=>x.calls.length).map(x=>x.calls.some(c=>c.programme)?1:0)),
  chineseQuery:mean(list.filter(x=>x.calls.length).map(x=>x.calls.some(c=>cjk(c.query))?1:0)),callsPerQuestion:mean(list.map(x=>x.calls.length))});
 const by=key=>Object.fromEntries([...new Set(done.map(x=>x[key]))].sort().map(v=>[v,sum(done.filter(x=>x[key]===v))]));
 report.sets[golden.dataset]={overall:sum(done),byLanguage:by('lang'),byType:by('type'),notRun:rows.length-done.length+Math.max(0,questions.filter(q=>!q.ambiguous&&q.type!=='absent').length-rows.length),
  worst:done.filter(x=>x.recall<1).sort((a,b)=>a.recall-b.recall||a.id.localeCompare(b.id)).slice(0,15).map(x=>({id:x.id,recall:x.recall,calls:x.calls,missed:x.missed,tools:x.tools})),cases:rows};
 process.stdout.write('\n');
}
report.spend={...spend,usd:Number(spend.usd.toFixed(4)),stopped};
const out=resolve(arg('out',resolve(root,`evals/latest-benefit-recall-live-${label}.json`)));
await writeFile(out,JSON.stringify(report,null,1)+'\n');
const pct=x=>x==null?'-':(100*x).toFixed(1)+'%';
for(const [name,s] of Object.entries(report.sets)){
 console.log(`${name}: recall@12 ${pct(s.overall.recallAt12)} (n=${s.overall.n}, not run ${s.notRun}) · searched ${pct(s.overall.searched)} · filter set ${pct(s.overall.filterSet)} · programme ${pct(s.overall.programmeSet)} · Chinese query ${pct(s.overall.chineseQuery)}`);
 for(const [lang,v] of Object.entries(s.byLanguage))console.log(`  ${lang.padEnd(8)} ${pct(v.recallAt12)} (n=${v.n})`);
}
console.log(`spend: ${spend.calls} calls, ${spend.promptTokens} prompt tokens (${spend.cacheHitTokens} cached), ${spend.completionTokens} output, ≈$${spend.usd.toFixed(4)} at assumed peak prices${stopped?' · STOPPED at budget':''}`);
console.log('Report: '+out);
