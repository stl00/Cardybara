// Scheduled live assistant eval (stl00/Cardybara#40). Runs a pinned, capped set of the development live cases on
// the real model, judges each case over repeated attempts, and compares the result with the last good run.
//
//   node scripts/live-eval.mjs --out=dir [--baseline=report.json] [--accept]   real model, API cost
//   node scripts/live-eval.mjs --out=dir --dry-run [--fail=id,id]              no network, no key
//
// The key comes only from the DEEPSEEK_API_KEY environment variable and is never written anywhere. The report
// holds case ids, check outcomes, tool names, token counts and spend: no questions, answers or model text.
// Exit 0: good run (it becomes the next baseline). Exit 1: regression. Exit 2: the run could not be made.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));

/** The pinned cases, in config order. Unknown ids and a list over the cap are configuration errors, not skips. */
export function selectCases(config,liveCases){
 const byId=new Map(liveCases.map(c=>[c.id,c])),unknown=config.cases.filter(id=>!byId.has(id));
 if(unknown.length)throw Error('unknown live eval case: '+unknown.join(', '));
 if(new Set(config.cases).size!==config.cases.length)throw Error('duplicate live eval case');
 if(config.cases.length>config.maxCases)throw Error(`live eval lists ${config.cases.length} cases, over the cap of ${config.maxCases}`);
 if(!(config.passesNeeded>=1&&config.passesNeeded<=config.attempts))throw Error('passesNeeded must be between 1 and attempts');
 if(!(config.budgetUsd>0))throw Error('budgetUsd must be positive');
 return config.cases.map(id=>byId.get(id));
}

/** A case is decided once enough attempts passed, or too many failed for the rest to reach the bar. */
export function verdict(passes,fails,{attempts,passesNeeded}){
 if(passes>=passesNeeded)return 'pass';
 if(fails>attempts-passesNeeded)return 'fail';
 return null;
}

/**
 * Run every case until it is decided or the budget stops the run. `runCase(c)` returns {checks, detail};
 * `spend` is the meter from evals/multiturn/live.mjs. A case the budget cut short is `not_run`, never a failure.
 */
export async function runLiveEval({config,cases,runCase,spend,log=()=>{}}){
 const results=[];let stopped=null;
 for(const c of cases){
  const tries=[];let passes=0,fails=0,decided=null;
  while(!decided&&tries.length<config.attempts){
   if(!spend.canStartDialogue()){stopped={reason:'budget',before:c.id};break;}
   const before=spend.spent(),r=await runCase(c),passed=Object.values(r.checks).every(Boolean);
   passed?passes++:fails++;
   tries.push({passed,checks:r.checks,toolNames:r.detail?.toolNames||[],...(r.detail?.error?{error:r.detail.error}:{}),...(r.detail?.codes?{codes:r.detail.codes}:{}),ms:r.detail?.ms??null,usd:+(spend.spent()-before).toFixed(5)});
   decided=verdict(passes,fails,config);
  }
  results.push({id:c.id,status:decided||'not_run',passes,fails,tries});
  log(`${c.id}: ${decided||'not_run'} (${passes}/${tries.length})`);
  if(stopped)break;
 }
 for(const c of cases.slice(results.length))results.push({id:c.id,status:'not_run',passes:0,fails:0,tries:[]});
 return {results,stopped};
}

/**
 * Compare with the last good run. A regression is a case that passed there and fails now. A case that was not run
 * keeps its baseline status, so a budget stop neither hides nor invents a regression. A case that has never passed
 * is listed as failing but is not a regression.
 */
export function compare(results,baseline){
 const before=new Map((baseline?.cases||[]).map(c=>[c.id,c.status]));
 const cases=results.map(r=>r.status==='not_run'&&before.has(r.id)?{...r,status:before.get(r.id),carried:true}:r);
 const regressions=cases.filter(c=>!c.carried&&c.status==='fail'&&before.get(c.id)==='pass').map(c=>c.id);
 const failing=cases.filter(c=>c.status==='fail'&&!regressions.includes(c.id)).map(c=>c.id);
 const fixed=cases.filter(c=>!c.carried&&c.status==='pass'&&before.get(c.id)==='fail').map(c=>c.id);
 const notRun=cases.filter(c=>c.carried||c.status==='not_run').map(c=>c.id);
 return {cases,regressions,failing,fixed,notRun};
}

export function summary(report){
 const failedChecks=c=>[...new Set(c.tries.filter(t=>!t.passed).flatMap(t=>[...Object.entries(t.checks).filter(([,ok])=>!ok).map(([k])=>k),...(t.error?[t.error]:[])]))].join(', ');
 const line=id=>{const c=report.cases.find(x=>x.id===id);return `- \`${id}\`: ${c.passes} of ${c.tries.length} attempts passed${failedChecks(c)?'; failed checks: '+failedChecks(c):''}`;};
 const out=[`**Live assistant eval: ${report.status}**`,'',`Model \`${report.model}\`, commit \`${report.commit||'unknown'}\`, ${report.cases.filter(c=>c.status==='pass').length} of ${report.cases.length} cases passing, spend $${report.spend.usd.toFixed(4)} of a $${report.budgetUsd} cap.`,`Compared with: ${report.baseline?`last good run at \`${report.baseline.commit||'unknown'}\` (${report.baseline.createdAt})`:'no earlier good run'}.`];
 if(report.regressions.length)out.push('','Passed in the last good run and fail now:',...report.regressions.map(line));
 if(report.failing.length)out.push('','Failing, and not passing in the last good run either:',...report.failing.map(line));
 if(report.fixed.length)out.push('','Passing again: '+report.fixed.map(id=>'`'+id+'`').join(', '));
 if(report.notRun.length)out.push('',`Not run${report.stopped?' (budget reached)':''}: `+report.notRun.map(id=>'`'+id+'`').join(', '));
 if(report.accepted)out.push('','This run was accepted as the new baseline by hand.');
 out.push('','Synthetic wallet only. The report holds check outcomes and tool names, no model text.');
 return out.join('\n')+'\n';
}

/** Build the report. `accept` makes this run the baseline whatever it shows (the owner's manual override). */
export function buildReport({config,run,baseline,spend,accept=false,dryRun=false,commit=null,now=new Date()}){
 const c=compare(run.results,baseline),status=c.regressions.length&&!accept?'regression':'good';
 return {schema:1,kind:'live-eval',status,accepted:accept&&c.regressions.length>0,mode:dryRun?'dry-run':'live',syntheticWallet:true,model:config.model,commit,createdAt:now.toISOString(),budgetUsd:config.budgetUsd,attempts:config.attempts,passesNeeded:config.passesNeeded,
  baseline:baseline?{commit:baseline.commit||null,createdAt:baseline.createdAt||null}:null,
  spend:{usd:+spend.spent().toFixed(5),...spend.usage},...(run.stopped?{stopped:run.stopped}:{}),
  regressions:c.regressions,failing:c.failing,fixed:c.fixed,notRun:c.notRun,cases:c.cases};
}

async function main(){
 const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3),flag=name=>process.argv.includes('--'+name);
 const out=resolve(arg('out')||resolve(root,'.debug/live-eval')),dryRun=flag('dry-run');
 const config=JSON.parse(await readFile(resolve(root,'evals/live/config.json'),'utf8'));
 const {liveCases}=await import('../evals/fixtures.mjs'),{meter,priceFor}=await import('../evals/multiturn/live.mjs');
 const cases=selectCases(config,liveCases),spend=meter({price:priceFor(config.model),budget:config.budgetUsd});
 let baseline=null;
 if(arg('baseline')){try{baseline=JSON.parse(await readFile(resolve(arg('baseline')),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(baseline&&(baseline.kind!=='live-eval'||baseline.status!=='good'||baseline.mode!==(dryRun?'dry-run':'live')))throw Error('baseline is not a good live-eval report of this mode');}
 let runCase;
 if(dryRun){
  // Same path with no model: every case passes unless named in --fail, and each attempt is charged one small call.
  const failing=new Set((arg('fail')||'').split(',').filter(Boolean));
  runCase=async c=>{spend.record({prompt_tokens:1000,completion_tokens:100});return {checks:{completed:!failing.has(c.id)},detail:{toolNames:[],ms:0}};};
 }else{
  const key=process.env.DEEPSEEK_API_KEY;if(!key)throw Error('DEEPSEEK_API_KEY is not set');
  // The model is pinned by the config, whatever the environment says.
  const env={DEEPSEEK_API_KEY:key,DEEPSEEK_MODEL:config.model},{chatAgent}=await import('./chat-agent.mjs'),{runLiveCase}=await import('../evals/live-case.mjs');
  // A call that reports no usage, or fails after it may have been billed, is charged its worst case.
  const chat=async payload=>{let metered=false;try{const m=await chatAgent(env,payload,fetch,undefined,{onUsage:x=>{metered=true;spend.record(x);}});if(!metered)spend.unmetered();return m;}catch(error){if(!metered)spend.unmetered();throw error;}};
  runCase=c=>runLiveCase(c,{chat});
 }
 const run=await runLiveEval({config,cases,runCase,spend,log:console.log});
 const report=buildReport({config,run,baseline,spend,accept:flag('accept'),dryRun,commit:process.env.GITHUB_SHA||null});
 await mkdir(out,{recursive:true});
 await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 await writeFile(resolve(out,'summary.md'),summary(report));
 console.log(JSON.stringify({status:report.status,usd:report.spend.usd,regressions:report.regressions,failing:report.failing,notRun:report.notRun,report:resolve(out,'report.json')}));
 if(report.status!=='good')process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(error=>{console.error('live eval could not run: '+error.message);process.exitCode=2;});
