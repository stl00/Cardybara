// Mode A no-answer noise and recall@12 with the answer judge (#289): searchBenefitKnowledge on the raw question, then a
// model says whether any of the top rules answers it (src/benefitAnswerJudge.js). Dev, held-out and the frozen no-answer set.
//   node scripts/eval-benefit-judge.mjs --dry-run            (no model, no network: counts judge calls and the cost ceiling)
//   node scripts/eval-benefit-judge.mjs --from-report=live-measure/benefit-judge.json   (no model, no network, no spend:
//     re-scores the gate from the judge verdicts stored by an earlier live run; a question the stored run has no verdict
//     for counts as unknown, keeps its rules, and is listed)
// The judge is gated (#291): it is only asked when the deterministic search is weak (src/benefitAnswerJudge.js JUDGE_GATE).
// Override with --gate=off (ask on every result, the #289 behaviour), --top-score=N and --worded=0|1 (a worded match makes a result strong).
//   CARDYBARA_MODEL_CONFIG=/path/to/.env.local node scripts/eval-benefit-judge.mjs --max-usd=0.2 [--sets=golden,holdout,noanswer]
// The live run costs money: owner approval only. The key is read from the config file, passed to the client, and never
// printed or written. The report keeps question ids, counts and judged yes/no; no answers or keys.
// Frozen-set rule: report its aggregate and its still-noisy ids; never change the judge prompt after reading them.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGolden,K} from '../evals/benefit-recall/lib.mjs';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';
import {gatedJudge,JUDGE_TOP,JUDGE_GATE} from '../src/benefitAnswerJudge.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=(name,d)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??d;
const dry=process.argv.includes('--dry-run'),maxUsd=Number(arg('max-usd','0.2')),fromReport=arg('from-report',null),offline=dry||!!fromReport;
const gate=arg('gate','on')==='off'?{topScoreBelow:Infinity,requireNoWorded:false}:{topScoreBelow:Number(arg('top-score',JUDGE_GATE.topScoreBelow)),requireNoWorded:arg('worded',JUDGE_GATE.requireNoWorded?'1':'0')==='1'};
if(!(gate.topScoreBelow>0))throw Error('--top-score must be a positive number');
if(!offline&&!(maxUsd>0&&maxUsd<=1))throw Error('--max-usd must be between 0 and 1');
const sets=arg('sets','golden,holdout,noanswer').split(',');
const output=resolve(arg('out',resolve(root,`evals/latest-benefit-recall-judge${dry?'-dry':fromReport?'-offline':''}.json`)));
const stored=fromReport?JSON.parse(await readFile(resolve(fromReport),'utf8')):null;
let current=null;
// Same conservative DeepSeek peak prices as eval-benefit-recall-live.mjs.
const PRICE={cacheMiss:0.30,cacheHit:0.006,output:1.20},MAX_TOKENS=40;
const callCeiling=messages=>(JSON.stringify(messages).length/2*PRICE.cacheMiss+MAX_TOKENS*PRICE.output)/1e6;

const spend={calls:0,promptTokens:0,completionTokens:0,usd:0,ceilingUsd:0,errors:0};
let complete,stopped=null;
if(stored){
 // Offline re-score: the stored verdict of this question stands in for the model.
 complete=async()=>{spend.calls++;const j=stored.sets?.[current.set]?.rows?.find(r=>r.id===current.id)?.judgement;
  if(j==='answers')return '{"answers":[1]}';if(j==='none')return '{"answers":[]}';throw Error('no-stored-verdict');};
}else if(dry){
 // Offline plumbing check: the stub keeps every result, so the numbers equal plain mode A.
 complete=async messages=>{spend.calls++;spend.ceilingUsd+=callCeiling(messages);return '{"answers":[1]}';};
}else{
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;if(!envFile)throw Error('set CARDYBARA_MODEL_CONFIG');
 const env={};for(const line of (await readFile(resolve(envFile),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 const {createDeepSeekClient}=await import('./deepseek-client.mjs');
 const client=createDeepSeekClient(env);
 complete=async messages=>{
  if(spend.usd+callCeiling(messages)>maxUsd){stopped='budget';throw Error('budget');}
  const body=await client.chat.completions.create({model:env.DEEPSEEK_MODEL||'deepseek-flash',messages,thinking:{type:'disabled'},max_tokens:MAX_TOKENS,temperature:0});
  const u=body.usage||{},hit=u.prompt_cache_hit_tokens??0,miss=u.prompt_cache_miss_tokens??Math.max(0,(u.prompt_tokens||0)-hit);
  spend.calls++;spend.promptTokens+=u.prompt_tokens||0;spend.completionTokens+=u.completion_tokens||0;spend.usd+=(miss*PRICE.cacheMiss+hit*PRICE.cacheHit+(u.completion_tokens||0)*PRICE.output)/1e6;
  return body.choices?.[0]?.message?.content||'';
 };
}

const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const report={schema:1,createdAt:new Date().toISOString(),dryRun:dry,judgeTop:JUDGE_TOP,k:K,priceAssumption:PRICE,maxUsd:offline?null:maxUsd,gate,fromReport:fromReport?'(given)':null,sets:{}};
for(const set of sets){
 const {golden,portfolios,questions,run,score}=await loadGolden(resolve(root,`evals/benefit-recall/${set}.json`));
 const rows=[];
 for(const q of questions){
  if(stopped)break;
  const cards=portfolios[q.portfolio].cards;
  const before=score(q,run([{query:q.question}],cards));
  // The judge sees what mode A returns: the raw question, no filters.
  const found=searchBenefitKnowledge(q.question,cards,golden.asOf);
  let after=before,judgement='not-called';
  if(found.rules.length){
   current={set,id:q.id};
   try{const j=await gatedJudge(q.question,found.rules,complete,{gate});judgement=j.gated==='strong'?'skipped-strong':j.unreadable?'unreadable':j.answers?'answers':'none';
    if(!j.rules.length)after=score(q,{ranked:[],total:0});}
   catch(e){judgement=e.message==='budget'?'budget':e.message==='no-stored-verdict'?'unknown':'error';if(judgement==='error')spend.errors++;}
  }
  rows.push({id:q.id,lang:q.lang,absent:q.type==='absent',scored:q.type!=='absent'&&!q.ambiguous,judgement,
   before:{recall:before.recall,noisy:q.type==='absent'?before.spurious>0:null},after:{recall:after.recall,noisy:q.type==='absent'?after.spurious>0:null}});
 }
 const scored=rows.filter(r=>r.scored),absent=rows.filter(r=>r.absent);
 const sum=side=>({recallAt12:mean(scored.map(r=>r[side].recall)),noise:mean(absent.map(r=>r[side].noisy?1:0)),
  noiseByLang:Object.fromEntries([...new Set(absent.map(r=>r.lang))].sort().map(l=>[l,mean(absent.filter(r=>r.lang===l).map(r=>r[side].noisy?1:0))]))});
 report.sets[set]={dataset:golden.dataset,asOf:golden.asOf,questions:rows.length,scored:scored.length,absent:absent.length,before:sum('before'),after:sum('after'),
  judgements:Object.fromEntries(['answers','none','skipped-strong','unreadable','error','budget','unknown','not-called'].map(k=>[k,rows.filter(r=>r.judgement===k).length])),
  // Share of all questions the judge is asked about under this gate (lower is cheaper).
  judgeShare:rows.filter(r=>['answers','none','unreadable','error','budget','unknown'].includes(r.judgement)).length/rows.length,
  unknownIds:rows.filter(r=>r.judgement==='unknown').map(r=>r.id),
  stillNoisy:absent.filter(r=>r.after.noisy).map(r=>r.id),lostRecall:scored.filter(r=>r.after.recall<r.before.recall).map(r=>r.id),rows};
}
report.spend=spend;report.stopped=stopped;
await writeFile(output,JSON.stringify(report,null,1)+'\n');
const pct=x=>x==null?'-':(100*x).toFixed(1)+'%';
for(const [set,s] of Object.entries(report.sets))console.log(`${set}: recall@${K} A ${pct(s.before.recallAt12)} → ${pct(s.after.recallAt12)} · no-answer noise A ${pct(s.before.noise)} → ${pct(s.after.noise)} (n=${s.absent}) · judge ${JSON.stringify(s.judgements)}`);
for(const [set,s] of Object.entries(report.sets))console.log(`${set}: judge asked on ${pct(s.judgeShare)} of questions${s.unknownIds.length?`; no stored verdict for ${s.unknownIds.join(', ')}`:''}`);
console.log(fromReport?`offline re-score of stored verdicts: no model call, no spend`:dry?`dry run: ${spend.calls} judge calls, cost ceiling $${spend.ceilingUsd.toFixed(4)} at assumed peak prices`:`live: ${spend.calls} calls, ${spend.promptTokens} prompt + ${spend.completionTokens} output tokens, about $${spend.usd.toFixed(4)}${stopped?`, stopped: ${stopped}`:''}`);
console.log(`Report: ${output}`);
