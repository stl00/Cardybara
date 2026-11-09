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
import {knowledgeEntities} from '../src/knowledge.js';
import {replay,contextSources,resolvable,strictTarget,checkLabels,selectCards,evalContext} from '../evals/multiturn/harness.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const rescoring=process.argv.some(a=>a.startsWith('--rescore=')),live=process.argv.includes('--live')||rescoring,dryRun=process.argv.includes('--dry-run')||rescoring;
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('out')||resolve(root,'evals/latest-multiturn-'+(live?(dryRun?'dry-run':'live'):'offline')+'.json'));
// Round-robin by kind, so the first n dialogues cover every kind.
const interleaved=list=>{const byKind=[...new Set(list.map(d=>d.kind))].map(k=>list.filter(d=>d.kind===k)),out=[];for(let i=0;out.length<list.length;i++)for(const group of byKind)if(group[i])out.push(group[i]);return out;};
const only=arg('case'),limit=Number(arg('limit')||Infinity),ordered=live?interleaved(dialogues):dialogues,selected=(only?ordered.filter(d=>d.id===only):ordered).slice(0,limit);
if(!selected.length)throw Error('unknown_eval_case');
const report={schema:1,dataset:'multiturn-references-v1',mode:live?(dryRun?'live-dry-run':'live'):'offline',asOf:evalContext.day,syntheticWallet:true,createdAt:new Date().toISOString(),cases:[],limitations:[
 'Earlier turns are scripted, not generated: their answers are written to read like the assistant, so how often names survive in them is a modelling choice of this set.',
 'Offline "resolvable" means the referent is still present in the model input, not that a model resolves it.',
 'Development set, not held out.']};
const toolCallsOf=m=>(m.tool_calls||[]).map(c=>({name:c.function.name,args:JSON.parse(c.function.arguments||'{}')}));
const fixtureErrors=[];

// An argument matches if it is the expected value; a card name matches if it selects the same held cards.
const programmesOf=text=>knowledgeEntities.programmes.map(p=>p.name).filter(n=>n.toLowerCase().includes(text.toLowerCase().trim()));
// The reference itself: some call names the card the question refers to (cardName and region select it and nothing else).
const resolvesCard=(d,calls)=>!d.target.card||calls.some(c=>c.args.cardName&&(()=>{const got=selectCards(c.args);return got.length===1&&got[0].productId===d.target.card;})());
const scoreLive=(d,calls,completed)=>({completed,expectedTool:calls.some(c=>c.name===d.expect.tool),expectedArguments:calls.some(c=>argumentsMatch(d.expect,c)),referentResolved:resolvesCard(d,calls)});
function argumentsMatch(expect,call){
 if(call.name!==expect.tool)return false;
 return Object.entries(expect.args).every(([k,v])=>{
  if(k==='query')return typeof call.args.query==='string'&&call.args.query.trim().length>0;
  if(k==='cardName'||k==='region'){const want=selectCards(expect.args).map(c=>c.id).sort().join(),got=selectCards(call.args).map(c=>c.id).sort().join();return want===got;}
  // The tool filters programmes by substring, so "Cathay" and "Asia Miles" both reach Cathay Asia Miles.
  if(k==='programme')return typeof call.args.programme==='string'&&call.args.programme.trim().length>0&&programmesOf(call.args.programme).some(p=>programmesOf(v).includes(p));
  return call.args[k]===v;
 });
}

// deepseek-flash list prices per million tokens, at the higher (peak) rate so the budget is never under-counted.
// https://api-docs.deepseek.com/quick_start/pricing, read 2026-11-09.
const PRICE={hit:0.006,miss:0.3,output:1.2};
const usage={calls:0,promptTokens:0,cacheHitTokens:0,cacheMissTokens:0,completionTokens:0};
const costOf=u=>(u.cacheHitTokens*PRICE.hit+u.cacheMissTokens*PRICE.miss+u.completionTokens*PRICE.output)/1e6;
const addUsage=u=>{usage.calls++;usage.promptTokens+=u.prompt_tokens||0;usage.completionTokens+=u.completion_tokens||0;const hit=u.prompt_cache_hit_tokens??0;usage.cacheHitTokens+=hit;usage.cacheMissTokens+=u.prompt_cache_miss_tokens??Math.max(0,(u.prompt_tokens||0)-hit);};
const budget=Number(arg('budget-usd'));
if(live&&!dryRun&&!(budget>0))throw Error('--budget-usd is required for a live run');
const rescore=arg('rescore');
if(rescore){
 const saved=JSON.parse(await readFile(resolve(rescore),'utf8')),byId=new Map(dialogues.map(d=>[d.id,d]));
 for(const c of saved.cases){const d=byId.get(c.id);const checks=scoreLive(d,c.calls||[],c.checks.completed!==false&&!c.error);c.checks=checks;c.passed=checks.completed&&checks.expectedTool&&checks.expectedArguments;}
 Object.assign(report,{...saved,rescoredAt:new Date().toISOString(),cases:saved.cases});
}
let env=null,chatAgent=null,mostPerDialogue=0.02;
if(live&&!dryRun){
 const envFile=process.env.CARDYBARA_MODEL_CONFIG;
 env={};for(const line of (await readFile(envFile?resolve(envFile):resolve(root,'.env.local'),'utf8')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 ({chatAgent}=await import('./chat-agent.mjs'));
 report.model=env.DEEPSEEK_MODEL||'deepseek-flash';
}

for(const d of rescore?[]:selected){
 // Stop before a dialogue that could pass the budget, estimated from the most any dialogue has cost so far.
 if(live&&!dryRun&&costOf(usage)+mostPerDialogue>budget){report.stopped={reason:'budget',before:d.id,remaining:selected.length-selected.indexOf(d)};break;}
 const spentBefore=costOf(usage);
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
  :async(payload,signal)=>({message:await chatAgent(env,payload,fetch,signal,{onUsage:addUsage})});
 const start=Date.now();
 try{
  const {finalResult}=await replay(d,{finalRequest:async(p,s)=>{const r=await finalRequest(p,s);calls.push(...toolCallsOf(r.message));return r;}});
  const checks=scoreLive(d,calls,!!finalResult?.answer?.trim());
  report.cases.push({id:d.id,lang:d.lang,kind:d.kind,passed:checks.completed&&checks.expectedTool&&checks.expectedArguments,checks,asked:!calls.length,ms:Date.now()-start,calls});
 }catch(error){report.cases.push({id:d.id,lang:d.lang,kind:d.kind,passed:false,checks:{completed:false},error:error.message==='answer_not_grounded'?'answer_not_grounded':'model_or_execution_failed',...(dryRun?{detail:error.message}:{}),ms:Date.now()-start,calls});}
 const spent=costOf(usage)-spentBefore;mostPerDialogue=Math.max(mostPerDialogue,spent);report.cases.at(-1).usd=+spent.toFixed(5);
 console.log(d.id+': '+(report.cases.at(-1).passed?'PASS':'FAIL')+(dryRun?'':' $'+costOf(usage).toFixed(4)));
}

const key=live?'passed':'resolvable';
const share=(list,k)=>list.length?+(list.filter(c=>c[k]).length/list.length).toFixed(3):null;
const rate=list=>({n:list.length,[key]:list.filter(c=>c[key]).length,rate:share(list,key),...(live?{referentResolved:list.filter(c=>c.checks?.referentResolved).length,completed:list.filter(c=>c.checks?.completed).length}:{toolReady:list.filter(c=>c.toolReady).length,toolReadyRate:share(list,'toolReady')})});
const by=field=>Object.fromEntries([...new Set(report.cases.map(c=>c[field]))].map(v=>[v,rate(report.cases.filter(c=>c[field]===v))]));
report.summary={...rate(report.cases),byKind:by('kind'),byLanguage:by('lang')};
if(!live)report.summary.missing=report.cases.flatMap(c=>c.missing).reduce((a,m)=>({...a,[m]:(a[m]||0)+1}),{});
if(!live)report.summary.notToolReady=report.cases.filter(c=>c.resolvable&&!c.toolReady).map(c=>`${c.id} (${c.toolReadyMissing.join('+')})`);
if(!live)report.summary.unresolved=report.cases.filter(c=>!c.resolvable).map(c=>`${c.id} (${c.missing.join('+')}${c.droppedTurns?`, ${c.droppedTurns} turns dropped`:''})`);
report.fixtureErrors=fixtureErrors;
if(live&&!dryRun)report.usage={...usage,usd:+costOf(usage).toFixed(4),budgetUsd:budget,prices:PRICE};
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode:report.mode,...report.summary,fixtureErrors,report:output},null,1));
const min=arg('min');
if(fixtureErrors.length||min&&report.summary.rate<Number(min))process.exitCode=1;
