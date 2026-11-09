// Multi-turn reference eval (evals/multiturn). Offline by default: deterministic, no network.
//   node scripts/eval-multiturn.mjs [--min=0.8] [--out=path]
//     (a) Is the entity the last question refers to still identifiable in what the model receives?
//   node scripts/eval-multiturn.mjs --live [--case=id]      real model, API cost; ask the owner first
//   node scripts/eval-multiturn.mjs --live --dry-run        same path with a scripted model, no network
//     (b) Does the model call the expected tool with the expected key arguments?
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dialogues} from '../evals/multiturn/dialogues.mjs';
import {replay,contextSources,resolvable,checkLabels,selectCards,evalContext} from '../evals/multiturn/harness.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const live=process.argv.includes('--live'),dryRun=process.argv.includes('--dry-run');
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('out')||resolve(root,'evals/latest-multiturn-'+(live?(dryRun?'dry-run':'live'):'offline')+'.json'));
const only=arg('case'),selected=only?dialogues.filter(d=>d.id===only):dialogues;
if(!selected.length)throw Error('unknown_eval_case');
const report={schema:1,dataset:'multiturn-references-v1',mode:live?(dryRun?'live-dry-run':'live'):'offline',asOf:evalContext.day,syntheticWallet:true,createdAt:new Date().toISOString(),cases:[],limitations:[
 'Earlier turns are scripted, not generated: their answers are written to read like the assistant, so how often names survive in them is a modelling choice of this set.',
 'Offline "resolvable" means the referent is still present in the model input, not that a model resolves it.',
 'Development set, not held out.']};
const toolCallsOf=m=>(m.tool_calls||[]).map(c=>({name:c.function.name,args:JSON.parse(c.function.arguments||'{}')}));
const fixtureErrors=[];

// An argument matches if it is the expected value; a card name matches if it selects the same held cards.
function argumentsMatch(expect,call){
 if(call.name!==expect.tool)return false;
 return Object.entries(expect.args).every(([k,v])=>{
  if(k==='query')return typeof call.args.query==='string'&&call.args.query.trim().length>0;
  if(k==='cardName'||k==='region'){const want=selectCards(expect.args).map(c=>c.id).sort().join(),got=selectCards(call.args).map(c=>c.id).sort().join();return want===got;}
  if(k==='programme')return typeof call.args.programme==='string'&&(call.args.programme.toLowerCase().includes(v.toLowerCase())||v.toLowerCase().includes(call.args.programme.toLowerCase()));
  return call.args[k]===v;
 });
}

let env=null,chatAgent=null;
if(live&&!dryRun){
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;
 env={};for(const line of (await readFile(envFile?resolve(envFile):resolve(root,'.env.local'),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 ({chatAgent}=await import('./chat-agent.mjs'));
 report.model=env.DEEPSEEK_MODEL||'deepseek-flash';
}

for(const d of selected){
 const labelIssues=checkLabels(d);
 if(!live){
  let replayed;try{replayed=await replay(d);}catch(error){fixtureErrors.push({id:d.id,issues:[...labelIssues,'replay failed: '+error.message+' '+(error.codes||[]).join(',')]});continue;}
  const {sent,fixtureIssues,memory}=replayed;
  const issues=[...labelIssues,...fixtureIssues];if(issues.length)fixtureErrors.push({id:d.id,issues});
  const users=sent.messages.filter(m=>m.role==='user').length-1;
  const sources=contextSources(sent),r=resolvable(d.target,sources,{regionGiven:!!d.regionInQuestion}),strict=resolvable(d.target,sources,{regionGiven:!!d.regionInQuestion,strict:true});
  report.cases.push({id:d.id,lang:d.lang,kind:d.kind,turns:d.turns.length,keptTurns:users,droppedTurns:d.turns.length-users,memoryKeys:Object.keys(memory),resolvable:r.resolvable,missing:r.missing,toolReady:strict.resolvable,toolReadyMissing:strict.missing,inputChars:JSON.stringify(sent.messages).length});
  continue;
 }
 const calls=[];let step=0;
 const finalRequest=dryRun
  // The dry run answers like a perfect model: the expected call, then a plain answer.
  ?async()=>({message:step++?{role:'assistant',content:'(dry run)'}:{role:'assistant',content:'',tool_calls:[{id:'dry',type:'function',function:{name:d.expect.tool,arguments:JSON.stringify(d.expect.args)}}]}})
  :async(payload,signal)=>({message:await chatAgent(env,payload,fetch,signal)});
 const start=Date.now();
 try{
  const {finalResult}=await replay(d,{finalRequest:async(p,s)=>{const r=await finalRequest(p,s);calls.push(...toolCallsOf(r.message));return r;}});
  const checks={completed:!!finalResult?.answer?.trim(),expectedTool:calls.some(c=>c.name===d.expect.tool),expectedArguments:calls.some(c=>argumentsMatch(d.expect,c))};
  report.cases.push({id:d.id,lang:d.lang,kind:d.kind,passed:Object.values(checks).every(Boolean),checks,asked:!calls.length,ms:Date.now()-start,calls});
 }catch(error){report.cases.push({id:d.id,lang:d.lang,kind:d.kind,passed:false,checks:{completed:false},error:error.message==='answer_not_grounded'?'answer_not_grounded':'model_or_execution_failed',...(dryRun?{detail:error.message}:{}),ms:Date.now()-start,calls});}
 console.log(d.id+': '+(report.cases.at(-1).passed?'PASS':'FAIL'));
}

const key=live?'passed':'resolvable';
const share=(list,k)=>list.length?+(list.filter(c=>c[k]).length/list.length).toFixed(3):null;
const rate=list=>({n:list.length,[key]:list.filter(c=>c[key]).length,rate:share(list,key),...(live?{}:{toolReady:list.filter(c=>c.toolReady).length,toolReadyRate:share(list,'toolReady')})});
const by=field=>Object.fromEntries([...new Set(report.cases.map(c=>c[field]))].map(v=>[v,rate(report.cases.filter(c=>c[field]===v))]));
report.summary={...rate(report.cases),byKind:by('kind'),byLanguage:by('lang')};
if(!live)report.summary.missing=report.cases.flatMap(c=>c.missing).reduce((a,m)=>({...a,[m]:(a[m]||0)+1}),{});
if(!live)report.summary.notToolReady=report.cases.filter(c=>c.resolvable&&!c.toolReady).map(c=>`${c.id} (${c.toolReadyMissing.join('+')})`);
if(!live)report.summary.unresolved=report.cases.filter(c=>!c.resolvable).map(c=>`${c.id} (${c.missing.join('+')}${c.droppedTurns?`, ${c.droppedTurns} turns dropped`:''})`);
report.fixtureErrors=fixtureErrors;
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,...report.summary,fixtureErrors,report:output},null,1));
const min=arg('min');
if(fixtureErrors.length||min&&report.summary.rate<Number(min))process.exitCode=1;
