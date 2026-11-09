// Benefit recall with the real model filling find_benefits: the measured version of the offline eval's mode C.
// Costs money: run only with the owner's approval. Synthetic public portfolios only; no wallet data.
//   CARDYBARA_MODEL_CONFIG=/path/to/.env.local node scripts/eval-benefit-recall-live.mjs --max-usd=0.45 [--label=x] [--golden=...] [--limit=n]
//   node scripts/eval-benefit-recall-live.mjs --rescore=<report.json>   (no model: re-scores stored calls with the current search)
// Each question gets the production system prompt and tools. The model may call list_cards or other read-only tools
// first (they run locally); the first round with find_benefits ends the question, with no final answer, to save cost.
// Three scores: find_benefits alone; plus credits that query_credits returned, because a credit question answered
// from query_credits is right for the user; plus questions the golden set labels as also answered by another tool
// (alsoAnsweredBy), when the model used that tool.
// The key is read from the config file and passed to the client only. It is never printed or written.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chatAgent} from './chat-agent.mjs';
import {runWalletTool} from '../src/walletAgent.js';
import {queryKnowledge} from '../src/knowledge.js';
import {loadGolden,K} from '../evals/benefit-recall/lib.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=(name,d)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??d;
const label=arg('label','run'),maxUsd=Number(arg('max-usd','0.45')),limit=Number(arg('limit','0'))||Infinity,rescore=arg('rescore');
if(!(maxUsd>0&&maxUsd<=1))throw Error('--max-usd must be between 0 and 1');
// Conservative list prices in USD per million tokens (DeepSeek peak rates), so the guard stops early rather than late.
const PRICE={cacheMiss:0.30,cacheHit:0.006,output:1.20};
const ROUNDS=3;

const env={};
if(!rescore){
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;if(!envFile)throw Error('set CARDYBARA_MODEL_CONFIG');
 for(const line of (await readFile(resolve(envFile),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
}

// Failed requests report no usage, so their cost is unknown; they are counted, and three in a row stop the run.
const spend={calls:0,promptTokens:0,cacheHitTokens:0,completionTokens:0,usd:0,errors:0};
let consecutiveErrors=0;
const cost=u=>{const hit=u.prompt_cache_hit_tokens??0,miss=u.prompt_cache_miss_tokens??Math.max(0,u.prompt_tokens-hit);return (miss*PRICE.cacheMiss+hit*PRICE.cacheHit+u.completion_tokens*PRICE.output)/1e6;};
// Worst case for one more call: the whole prompt uncached and the full output budget.
const nextCallCeiling=chars=>(chars/2*PRICE.cacheMiss+1800*PRICE.output)/1e6;
let stopped=null;

// Every tool call with its arguments (public, model-written); the first round with find_benefits ends the question.
async function ask(question,cards,day){
 const messages=[{role:'user',content:question}],toolCalls=[];
 for(let round=0;round<ROUNDS;round++){
  const chars=JSON.stringify(messages).length+15000;
  if(spend.usd+nextCallCeiling(chars)>maxUsd){stopped='budget';return {toolCalls,stopped:true};}
  let message;
  try{message=await chatAgent(env,{messages,today:day},fetch,undefined,{onUsage:u=>{spend.calls++;spend.promptTokens+=u.prompt_tokens;spend.cacheHitTokens+=u.prompt_cache_hit_tokens??0;spend.completionTokens+=u.completion_tokens;spend.usd+=cost(u);}});}
  // Only a status or error name: provider messages can echo request details.
  catch(e){
   const error=e.status?'http_'+e.status:/^[a-z_]+$/.test(e.message)?e.message:e.constructor?.name||e.name||'error';
   // A bad tool call or answer is the model's own miss and scores 0; only a failed request (HTTP, timeout, connection) is left out.
   if(/^[a-z_]+$/.test(error)&&!error.startsWith('http_'))return {toolCalls,modelError:error};
   spend.errors++;consecutiveErrors++;if(consecutiveErrors>=3)stopped='errors';return {toolCalls,error};
  }
  consecutiveErrors=0;
  if(!message.tool_calls?.length)return {toolCalls,answeredWithoutSearch:true};
  messages.push(message);
  for(const call of message.tool_calls){
   toolCalls.push({name:call.function.name,args:JSON.parse(call.function.arguments||'{}')});
   messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(runWalletTool(call,{cards,events:[],day}))});
  }
  if(toolCalls.some(t=>t.name==='find_benefits'))return {toolCalls};
 }
 return {toolCalls};
}

// Credit items name a card and a title; together they identify the rule.
function creditRuleIds(args,cards,day){
 let r;try{r=runWalletTool({id:'credits',function:{name:'query_credits',arguments:JSON.stringify(args)}},{cards,events:[],day});}catch{return [];}
 const items=Object.entries(r.groups||{}).filter(([g])=>g!=='dismissedByUser').flatMap(([,list])=>list);
 const rules=queryKnowledge({kind:'benefit',asOf:day}).rules;
 return [...new Set(items.flatMap(i=>{const card=cards.find(c=>c.name===i.card);return rules.filter(x=>card&&x.productIds.includes(card.productId)&&x.content.title===i.title).map(x=>x.id);}))];
}
// Another tool counts only when its output has something to answer with: transfer relationships, or a card choice.
function altRouteAnswered(q,toolCalls,cards,day){
 return (q.alsoAnsweredBy||[]).some(a=>toolCalls.some(t=>{
  if(t.name!==a.tool||!t.args||(a.kind&&t.args.kind!==a.kind))return false;
  let r;try{r=runWalletTool({id:'alt',function:{name:t.name,arguments:JSON.stringify(t.args)}},{cards,events:[],day});}catch{return false;}
  return t.name==='get_card_rules'?r.rules?.length>0:t.name==='choose_card'?!!r.choice&&r.choice.kind!=='points-depends':false;
 }));
}
function scoreCase(q,toolCalls,{cards,run,score,day}){
 const calls=toolCalls.filter(t=>t.name==='find_benefits').map(t=>t.args),credits=toolCalls.filter(t=>t.name==='query_credits').map(t=>t.args);
 const found=calls.length?run(calls,cards):{ranked:[],total:0},find=score(q,found);
 const creditIds=credits.flatMap(a=>creditRuleIds(a,cards,day)),seen=new Set(found.ranked.map(([id])=>id));
 // Credits that query_credits returned join after the search results.
 // Capped at the same 12 a reader sees from each tool.
 const both=score(q,{ranked:[...found.ranked,...creditIds.filter(id=>!seen.has(id)).slice(0,K).map((id,i)=>[id,K+1+i])],total:found.total+creditIds.length});
 return {find,both,calls};
}

const old=rescore?JSON.parse(await readFile(resolve(rescore),'utf8')):null;
const report={schema:2,label,createdAt:new Date().toISOString(),model:old?.model||env.DEEPSEEK_MODEL||'deepseek-flash',k:K,priceAssumption:PRICE,maxUsd,...(old?{rescoredFrom:{label:old.label,createdAt:old.createdAt}}:{}),sets:{}};
for(const path of (arg('golden')?[arg('golden')]:['evals/benefit-recall/golden.json','evals/benefit-recall/holdout.json'])){
 const {golden,portfolios,questions,run,score}=await loadGolden(resolve(root,path));
 const stored=old?Object.fromEntries((old.sets[golden.dataset]?.cases||[]).map(c=>[c.id,c])):null;
 const rows=[];
 for(const q of questions.filter(q=>!q.ambiguous&&q.type!=='absent').slice(0,limit)){
  if(stopped)break;
  // The model sees only the held cards' public names and regions, through list_cards.
  const cards=portfolios[q.portfolio].cards;
  let r;
  if(old){
   const c=stored[q.id];if(!c)continue;
   // Schema 1 reports kept only find_benefits arguments, so their both-routes score covers find_benefits alone.
   r={toolCalls:c.toolCalls||[...c.tools.filter(n=>n!=='find_benefits').map(name=>({name,args:null})),...c.calls.map(args=>({name:'find_benefits',args}))],error:c.error,modelError:c.modelError,answeredWithoutSearch:c.answeredWithoutSearch,stopped:c.stopped,partialRoutes:!c.toolCalls};
  }else r=await ask(q.question,cards,golden.asOf);
  if(old&&r.error&&/^[a-z_]+$/.test(r.error)&&!r.error.startsWith('http_')){r.modelError=r.error;delete r.error;}
  const s=scoreCase(q,r.toolCalls.filter(t=>t.args),{cards,run,score,day:golden.asOf});
  // A question labelled as also answered by another tool counts when that tool returned something to answer with.
  const altRoute=!r.partialRoutes&&altRouteAnswered(q,r.toolCalls,cards,golden.asOf);
  rows.push({id:q.id,lang:q.lang,type:q.type,recall:s.find.recall,recallBothRoutes:s.both.recall,recallAnyRoute:altRoute?1:s.both.recall,rr:s.find.rr,precision:s.find.precision,precisionBothRoutes:s.both.precision,returnedBothRoutes:s.both.returned,forbiddenHits:s.find.forbiddenHits,missed:s.both.missed,returned:s.find.returned,
   tools:r.toolCalls.map(t=>t.name),toolCalls:r.toolCalls,calls:s.calls,...(r.error?{error:r.error}:{}),...(r.modelError?{modelError:r.modelError}:{}),...(r.answeredWithoutSearch?{answeredWithoutSearch:true}:{}),...(r.stopped?{stopped:true}:{}),...(r.partialRoutes?{partialRoutes:true}:{})});
  if(!old)process.stdout.write('.');
 }
 const done=rows.filter(x=>!x.stopped&&!x.error),mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,cjk=s=>/[㐀-鿿]/.test(s||'');
 const sum=list=>({n:list.length,recallAt12:mean(list.map(x=>x.recall)),recallBothRoutes:mean(list.map(x=>x.recallBothRoutes)),recallAnyRoute:mean(list.map(x=>x.recallAnyRoute??x.recallBothRoutes)),mrr:mean(list.map(x=>x.rr)),
  precision:mean(list.filter(x=>x.precision!=null).map(x=>x.precision)),precisionBothRoutes:mean(list.filter(x=>x.precisionBothRoutes!=null).map(x=>x.precisionBothRoutes)),returnedBothRoutes:mean(list.map(x=>x.returnedBothRoutes??x.returned)),modelErrors:list.filter(x=>x.modelError).length,forbiddenHitRate:mean(list.map(x=>x.forbiddenHits.length?1:0)),meanReturned:mean(list.map(x=>x.returned)),
  searched:mean(list.map(x=>x.calls.length?1:0)),creditsOnly:mean(list.map(x=>!x.calls.length&&x.tools.includes('query_credits')?1:0)),
  filterSet:mean(list.filter(x=>x.calls.length).map(x=>x.calls.some(c=>c.scenarioId||c.category)?1:0)),programmeSet:mean(list.filter(x=>x.calls.length).map(x=>x.calls.some(c=>c.programme)?1:0)),
  chineseQuery:mean(list.filter(x=>x.calls.length).map(x=>x.calls.some(c=>cjk(c.query))?1:0)),callsPerQuestion:mean(list.map(x=>x.calls.length))});
 const by=key=>Object.fromEntries([...new Set(done.map(x=>x[key]))].sort().map(v=>[v,sum(done.filter(x=>x[key]===v))]));
 report.sets[golden.dataset]={overall:sum(done),byLanguage:by('lang'),byType:by('type'),notRun:questions.filter(q=>!q.ambiguous&&q.type!=='absent').length-done.length,partialRoutes:done.some(x=>x.partialRoutes),
  worst:done.filter(x=>x.recallBothRoutes<1).sort((a,b)=>a.recallBothRoutes-b.recallBothRoutes||a.id.localeCompare(b.id)).slice(0,15).map(x=>({id:x.id,recall:x.recall,recallBothRoutes:x.recallBothRoutes,calls:x.calls,missed:x.missed,tools:x.tools})),cases:rows};
 if(!old)process.stdout.write('\n');
}
report.spend={...spend,usd:Number(spend.usd.toFixed(4)),stopped};
const out=resolve(arg('out',resolve(root,`evals/latest-benefit-recall-live-${label}.json`)));
await writeFile(out,JSON.stringify(report,null,1)+'\n');
const pct=x=>x==null?'-':(100*x).toFixed(1)+'%';
for(const [name,s] of Object.entries(report.sets)){
 const o=s.overall;
 console.log(`${name}: recall@12 find_benefits ${pct(o.recallAt12)} · + query_credits ${pct(o.recallBothRoutes)} · + labelled other routes ${pct(o.recallAnyRoute)}${s.partialRoutes?' (old report: find_benefits only)':''} (n=${o.n}, not run ${s.notRun})`);
 console.log(`  precision ${pct(o.precision)} (with credits ${pct(o.precisionBothRoutes)}, ${o.returnedBothRoutes?.toFixed(1)} returned) · model errors ${o.modelErrors} · returned ${o.meanReturned?.toFixed(1)} · forbidden ${pct(o.forbiddenHitRate)} · searched ${pct(o.searched)} · credits only ${pct(o.creditsOnly)} · filter set ${pct(o.filterSet)} · Chinese query ${pct(o.chineseQuery)}`);
 for(const [lang,v] of Object.entries(s.byLanguage))console.log(`  ${lang.padEnd(8)} ${pct(v.recallAt12)} · ${pct(v.recallBothRoutes)} · ${pct(v.recallAnyRoute)} (n=${v.n})`);
}
if(!old)console.log(`spend: ${spend.calls} calls, ${spend.promptTokens} prompt tokens (${spend.cacheHitTokens} cached), ${spend.completionTokens} output, ≈$${spend.usd.toFixed(4)} at assumed peak prices${spend.errors?` · ${spend.errors} failed requests (cost unknown, questions left out)`:''}${stopped?' · STOPPED ('+stopped+')':''}`);
console.log('Report: '+out);
