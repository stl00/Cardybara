// Multi-turn reference eval (evals/multiturn). Offline by default: deterministic, no network.
//   node scripts/eval-multiturn.mjs [--min=0.8] [--out=path]
//     (a) Is the entity the last question refers to still identifiable in what the model receives?
//   node scripts/eval-multiturn.mjs --live --budget-usd=0.45 [--limit=n] [--case=id]   real model, API cost; ask the owner first.
//     Stops before a dialogue that could pass the budget. Dialogues run round-robin by kind, so a stopped run still covers every kind.
//   node scripts/eval-multiturn.mjs --live --dry-run        same path with a scripted model, no network
//     (b) Does the model call the expected tool with the expected key arguments?
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dialogues} from '../evals/multiturn/dialogues.mjs';
import {interleaved,scoreLive,passedLive,priceFor,meter} from '../evals/multiturn/live.mjs';
import {replay,contextSources,resolvable,strictTarget,checkLabels,selectCards,evalContext} from '../evals/multiturn/harness.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const rescoring=process.argv.some(a=>a.startsWith('--rescore=')),live=process.argv.includes('--live')||rescoring,dryRun=process.argv.includes('--dry-run')||rescoring;
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('out')||resolve(root,'evals/latest-multiturn-'+(live?(dryRun?'dry-run':'live'):'offline')+'.json'));
// Live runs go round-robin by kind, so --limit=n still covers every kind; offline runs keep file order.
const limit=arg('limit')===undefined?Infinity:Number(arg('limit'));
if(!(limit>0))throw Error('--limit must be a positive number');
const only=arg('case'),ordered=live?interleaved(dialogues):dialogues,selected=(only?ordered.filter(d=>d.id===only):ordered).slice(0,limit);
if(!selected.length)throw Error('unknown_eval_case');
const report={schema:1,dataset:'multiturn-references-v1',mode:live?(dryRun?'live-dry-run':'live'):'offline',asOf:evalContext.day,syntheticWallet:true,createdAt:new Date().toISOString(),cases:[],limitations:[
 'Earlier turns are scripted, not generated: their answers are written to read like the assistant, so how often names survive in them is a modelling choice of this set.',
 'Offline "resolvable" means the referent is still present in the model input, not that a model resolves it.',
 'Development set, not held out.']};
const toolCallsOf=m=>(m.tool_calls||[]).map(c=>({name:c.function.name,args:JSON.parse(c.function.arguments||'{}')}));
const fixtureErrors=[];

const budget=Number(arg('budget-usd'));
if(live&&!dryRun&&!(budget>0))throw Error('--budget-usd is required for a live run');
const rescore=arg('rescore');
if(rescore){
 // Recompute every check from the calls a saved live run recorded: no model call, no configuration read.
 const saved=JSON.parse(await readFile(resolve(rescore),'utf8')),byId=new Map(dialogues.map(d=>[d.id,d]));
 const known=saved.cases.filter(c=>byId.has(c.id));
 for(const c of known){const checks=scoreLive(byId.get(c.id),c.calls||[],c.checks.completed!==false&&!c.error);c.checks=checks;c.passed=passedLive(checks);}
 Object.assign(report,{...saved,mode:saved.mode,rescoredAt:new Date().toISOString(),cases:known,...(known.length<saved.cases.length?{droppedUnknownCases:saved.cases.length-known.length}:{})});
}
let env=null,chatAgent=null,spend=null;
if(live&&!dryRun){
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;
 env={};for(const line of (await readFile(envFile?resolve(envFile):resolve(root,'.env.local'),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 ({chatAgent}=await import('./chat-agent.mjs'));
 report.model=env.DEEPSEEK_MODEL||'deepseek-flash';
 spend=meter({price:priceFor(report.model),budget});
}

for(const d of rescore?[]:selected){
 // Stop before a dialogue whose worst case could pass the budget.
 if(spend&&!spend.canStartDialogue()){report.stopped={reason:'budget',before:d.id,remaining:selected.length-selected.indexOf(d)};break;}
 const spentBefore=spend?.spent()??0;
 const labelIssues=checkLabels(d);
 if(!live){
  let replayed;try{replayed=await replay(d);}catch(error){fixtureErrors.push({id:d.id,issues:[...labelIssues,'replay failed: '+error.message+' '+(error.codes||[]).join(',')]});continue;}
  const {sent,fixtureIssues,memory}=replayed;
  const issues=[...labelIssues,...fixtureIssues];if(issues.length)fixtureErrors.push({id:d.id,issues});
  const users=sent.messages.filter(m=>m.role==='user').length-1;
  const sources=contextSources(sent),r=resolvable(d.target,sources,{regionGiven:!!d.regionInQuestion}),strict=resolvable(strictTarget(d),sources,{regionGiven:!!d.regionInQuestion,strict:true});
  report.cases.push({id:d.id,lang:d.lang,kind:d.kind,turns:d.turns.length,keptTurns:users,droppedTurns:d.turns.length-users,memoryKeys:Object.keys(memory),resolvable:r.resolvable,missing:r.missing,toolReady:strict.resolvable,toolReadyMissing:strict.missing,inputChars:JSON.stringify(sent.messages).length});
  continue;
 }
 if(labelIssues.length)fixtureErrors.push({id:d.id,issues:labelIssues});
 const calls=[];let step=0;
 const finalRequest=dryRun
  // The dry run answers like a perfect model: the expected call, then a plain answer.
  ?async()=>({message:step++?{role:'assistant',content:'(dry run)'}:{role:'assistant',content:'',tool_calls:[{id:'dry',type:'function',function:{name:d.expect.tool,arguments:JSON.stringify(d.expect.args)}}]}})
  // A call that reports no usage, or fails after it may have been billed, is charged its worst case.
  :async(payload,signal)=>{let metered=false;try{const message=await chatAgent(env,payload,fetch,signal,{onUsage:x=>{metered=true;spend.record(x);}});if(!metered)spend.unmetered();return {message};}catch(error){if(!metered)spend.unmetered();throw error;}};
 const start=Date.now();
 try{
  const {finalResult}=await replay(d,{finalRequest:async(p,s)=>{const r=await finalRequest(p,s);calls.push(...toolCallsOf(r.message));return r;}});
  const checks=scoreLive(d,calls,!!finalResult?.answer?.trim());
  report.cases.push({id:d.id,lang:d.lang,kind:d.kind,passed:passedLive(checks),checks,asked:!calls.length,ms:Date.now()-start,calls});
 }catch(error){report.cases.push({id:d.id,lang:d.lang,kind:d.kind,passed:false,checks:scoreLive(d,calls,false),error:error.message==='answer_not_grounded'?'answer_not_grounded':'model_or_execution_failed',...(dryRun?{detail:error.message}:{}),ms:Date.now()-start,calls});}
 if(spend)report.cases.at(-1).usd=+(spend.spent()-spentBefore).toFixed(5);
 console.log(d.id+': '+(report.cases.at(-1).passed?'PASS':'FAIL')+(spend?' $'+spend.spent().toFixed(4):''));
}

const key=live?'passed':'resolvable';
const share=(list,k)=>list.length?+(list.filter(c=>c[k]).length/list.length).toFixed(3):null;
const rate=list=>({n:list.length,[key]:list.filter(c=>c[key]).length,rate:share(list,key),...(live?{referentResolved:list.filter(c=>c.checks?.referentResolved===true).length,referentApplicable:list.filter(c=>typeof c.checks?.referentResolved==='boolean').length,completed:list.filter(c=>c.checks?.completed).length}:{toolReady:list.filter(c=>c.toolReady).length,toolReadyRate:share(list,'toolReady')})});
const by=field=>Object.fromEntries([...new Set(report.cases.map(c=>c[field]))].map(v=>[v,rate(report.cases.filter(c=>c[field]===v))]));
report.summary={...rate(report.cases),byKind:by('kind'),byLanguage:by('lang')};
if(!live)report.summary.missing=report.cases.flatMap(c=>c.missing).reduce((a,m)=>({...a,[m]:(a[m]||0)+1}),{});
if(!live)report.summary.notToolReady=report.cases.filter(c=>c.resolvable&&!c.toolReady).map(c=>`${c.id} (${c.toolReadyMissing.join('+')})`);
if(!live)report.summary.unresolved=report.cases.filter(c=>!c.resolvable).map(c=>`${c.id} (${c.missing.join('+')}${c.droppedTurns?`, ${c.droppedTurns} turns dropped`:''})`);
report.fixtureErrors=fixtureErrors;
if(spend)report.usage={...spend.usage,usd:+spend.spent().toFixed(4),budgetUsd:budget,prices:priceFor(report.model)};
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,...report.summary,...(report.stopped?{stopped:report.stopped}:{}),...(report.usage?{usd:report.usage.usd}:{}),fixtureErrors,report:output},null,1));
const min=arg('min');
if(fixtureErrors.length||min&&report.summary.rate<Number(min))process.exitCode=1;
