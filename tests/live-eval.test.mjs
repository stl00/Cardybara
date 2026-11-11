// The scheduled live eval (#40): case selection, repeated-attempt verdicts, comparison with the last good run,
// the spend cap, what the report may hold, and the workflow's triggers. No model and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectCases,verdict,runLiveEval,compare,buildReport,summary} from '../scripts/live-eval.mjs';
import {runLiveCase} from '../evals/live-case.mjs';
import {liveCases} from '../evals/fixtures.mjs';
import {meter,priceFor} from '../evals/multiturn/live.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const config=JSON.parse(fs.readFileSync(path.join(root,'evals/live/config.json'),'utf8'));
const rules={attempts:3,passesNeeded:2,budgetUsd:1};
const freeSpend=()=>({canStartDialogue:()=>true,spent:()=>0,usage:{}});
const scripted=outcomes=>{const seen={};return async c=>{const i=seen[c.id]=(seen[c.id]??-1)+1;return {checks:{completed:true,expectedTool:outcomes[c.id][i]},detail:{toolNames:['choose_card'],ms:1}};};};
const ids=(...names)=>names.map(id=>({id}));

test('the pinned config names known cases, a priced model and a month of runs within the budget',()=>{
 const cases=selectCases(config,liveCases);
 assert.equal(cases.length,config.cases.length);assert.ok(cases.length<=config.maxCases);
 assert.ok(priceFor(config.model));
 // The owner's budget is about 10 USD a month and the workflow runs once a day.
 assert.ok(config.budgetUsd*31<=10,'31 daily runs at the cap must fit the monthly budget');
 assert.throws(()=>selectCases({...config,cases:['no-such-case']},liveCases),/unknown live eval case/);
 assert.throws(()=>selectCases({...config,maxCases:1},liveCases),/over the cap/);
 assert.throws(()=>selectCases({...config,passesNeeded:config.attempts+1},liveCases),/passesNeeded/);
});

test('a case is judged over repeated attempts, not one sample',async()=>{
 assert.equal(verdict(2,0,rules),'pass');assert.equal(verdict(1,1,rules),null);assert.equal(verdict(0,2,rules),'fail');assert.equal(verdict(2,1,rules),'pass');assert.equal(verdict(1,2,rules),'fail');
 const {results}=await runLiveEval({config:rules,cases:ids('steady','flaky','broken','unlucky'),spend:freeSpend(),runCase:scripted({steady:[true,true],flaky:[false,true,true],broken:[false,false],unlucky:[true,false,false]})});
 assert.deepEqual(results.map(r=>[r.id,r.status,r.tries.length]),[['steady','pass',2],['flaky','pass',3],['broken','fail',2],['unlucky','fail',3]]);
});

test('a regression is a case that passed in the last good run and fails now',()=>{
 const baseline={cases:[{id:'a',status:'pass'},{id:'b',status:'fail'},{id:'c',status:'pass'},{id:'d',status:'fail'}]};
 const now=[{id:'a',status:'fail',tries:[]},{id:'b',status:'fail',tries:[]},{id:'c',status:'pass',tries:[]},{id:'d',status:'pass',tries:[]},{id:'new',status:'fail',tries:[]}];
 const c=compare(now,baseline);
 assert.deepEqual(c.regressions,['a']);assert.deepEqual(c.failing,['b','new']);assert.deepEqual(c.fixed,['d']);
 assert.deepEqual(compare(now,null).regressions,[],'the first run has nothing to regress from');
 const report=buildReport({config,run:{results:now},baseline,spend:freeSpend()});
 assert.equal(report.status,'regression');assert.match(summary(report),/Passed in the last good run and fail now:\n- `a`/);
 const accepted=buildReport({config,run:{results:now},baseline,spend:freeSpend(),accept:true});
 assert.equal(accepted.status,'good');assert.equal(accepted.accepted,true);
 assert.equal(buildReport({config,run:{results:now.slice(1)},baseline,spend:freeSpend()}).status,'good');
});

test('the spend cap stops the run, and a case that was not run keeps its last good status',async()=>{
 const spend=meter({price:priceFor(config.model),budget:0.2});
 const runCase=async()=>{spend.record({prompt_tokens:30000,completion_tokens:1800});return {checks:{completed:true},detail:{toolNames:[]}};};
 const run=await runLiveEval({config:rules,cases:ids('a','b','c','d','e','f','g','h'),spend,runCase});
 assert.equal(run.stopped.reason,'budget');assert.ok(spend.spent()<=0.2,'the cap holds');
 const cut=run.results.filter(r=>r.status==='not_run').map(r=>r.id);
 assert.ok(cut.length>0&&cut.length<8,'some cases ran and some did not');assert.equal(run.results.length,8);
 const baseline={cases:run.results.map(r=>({id:r.id,status:'pass'}))};
 const c=compare(run.results,baseline);
 assert.deepEqual(c.regressions,[]);assert.deepEqual(c.notRun,cut);
 for(const id of cut)assert.equal(c.cases.find(x=>x.id===id).status,'pass');
 // An unmetered call is charged its worst case, so a silent provider cannot run past the cap.
 const blind=meter({price:priceFor(config.model),budget:0.2});let calls=0;
 await runLiveEval({config:rules,cases:ids('a','b','c','d','e','f','g','h'),spend:blind,runCase:async()=>{calls++;for(let i=0;i<6;i++)blind.unmetered();return {checks:{completed:true},detail:{}};}});
 assert.ok(calls<16&&blind.spent()<=0.2);
});

test('facts are checked by code and the report holds no model text',async()=>{
 const c=liveCases.find(x=>x.id==='dining'),secret='MODEL-TEXT-MUST-NOT-LEAVE';
 const turn=args=>async({request})=>{await request({});return {answer:'Freedom Unlimited '+secret,trace:[{type:'answer',text:secret}],tools:[],memory:{},messages:[],context:{note:secret}};};
 const call=(name,a)=>async()=>({content:secret,tool_calls:[{function:{name,arguments:JSON.stringify(a)}}]});
 const right=await runLiveCase(c,{chat:call('choose_card',c.expectedArgs),turn:turn()});
 assert.ok(Object.values(right.checks).every(Boolean));
 const wrongTool=await runLiveCase(c,{chat:call('find_benefits',{}),turn:turn()});
 assert.equal(wrongTool.checks.expectedTool,false);
 const wrongAmount=await runLiveCase(c,{chat:call('choose_card',{...c.expectedArgs,amount:1}),turn:turn()});
 assert.equal(wrongAmount.checks.expectedArguments,false);
 const writes=await runLiveCase(c,{chat:call('pay_card',{}),turn:turn()});
 assert.equal(writes.checks.readOnly,false);
 const thrown=await runLiveCase(c,{chat:call('choose_card',c.expectedArgs),turn:async()=>{throw Object.assign(Error('answer_not_grounded'),{codes:['unsupported_number']});}});
 assert.deepEqual(thrown.checks,{completed:false});assert.equal(thrown.detail.error,'answer_not_grounded');
 const run=await runLiveEval({config:rules,cases:[c],spend:freeSpend(),runCase:x=>runLiveCase(x,{chat:call('choose_card',c.expectedArgs),turn:turn()})});
 const report=buildReport({config,run,baseline:null,spend:freeSpend()});
 const text=JSON.stringify(report)+summary(report);
 assert.equal(report.cases[0].status,'pass');assert.equal(text.includes(secret),false);assert.equal(text.includes(c.question),false);assert.equal(report.syntheticWallet,true);assert.equal(report.model,config.model);
});

test('the command exits 0 on a good run, 1 on a regression and 2 without a key',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-eval-')),env={...process.env,NODE_NO_WARNINGS:'1'};delete env.DEEPSEEK_API_KEY;
 const run=(...args)=>spawnSync(process.execPath,['scripts/live-eval.mjs',...args],{cwd:root,env,encoding:'utf8'});
 try{
  const good=run('--dry-run','--out='+path.join(dir,'good'));assert.equal(good.status,0,good.stderr);
  const baseline=path.join(dir,'good','report.json');assert.equal(JSON.parse(fs.readFileSync(baseline,'utf8')).status,'good');
  const bad=run('--dry-run','--out='+path.join(dir,'bad'),'--baseline='+baseline,'--fail='+config.cases[0]);
  assert.equal(bad.status,1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'bad','report.json'),'utf8')).regressions,[config.cases[0]]);
  assert.equal(run('--dry-run','--out='+path.join(dir,'accepted'),'--baseline='+baseline,'--fail='+config.cases[0],'--accept').status,0);
  // A regression report is never taken as a baseline, and a missing baseline file is a first run.
  assert.equal(run('--dry-run','--out='+path.join(dir,'x'),'--baseline='+path.join(dir,'bad','report.json')).status,2);
  assert.equal(run('--dry-run','--out='+path.join(dir,'y'),'--baseline='+path.join(dir,'none.json')).status,0);
  const noKey=run('--out='+path.join(dir,'live'));assert.equal(noKey.status,2);assert.match(noKey.stderr,/DEEPSEEK_API_KEY is not set/);assert.equal(fs.existsSync(path.join(dir,'live')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the workflow runs only on a schedule or by hand, behind the protected environment',()=>{
 const yml=fs.readFileSync(path.join(root,'.github/workflows/live-evals.yml'),'utf8');
 const triggers=yml.slice(yml.indexOf('\non:\n'),yml.indexOf('\npermissions:'));
 assert.match(triggers,/schedule:/);assert.match(triggers,/workflow_dispatch:/);
 assert.doesNotMatch(triggers,/pull_request|push:|workflow_run|issue_comment/);
 assert.match(yml,/\n    environment: live-evals\n/);
 assert.match(yml,/if: vars\.LIVE_EVALS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main'/);
 assert.doesNotMatch(yml,/self-hosted/);
 assert.equal(yml.match(/secrets\./g).length,1,'the key reaches one step only');
 for(const uses of yml.match(/uses: .+/g))assert.match(uses,/@[0-9a-f]{40} /,'actions are pinned by commit: '+uses);
 // The key must not reach CI, where pull requests run.
 assert.doesNotMatch(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'),/DEEPSEEK_API_KEY/);
});
