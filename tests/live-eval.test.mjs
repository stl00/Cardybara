// The scheduled live eval (#40): case selection, repeated-attempt verdicts, comparison with the last good run,
// the spend cap, what the report may hold, and the workflow's triggers. No model and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {selectCases,verdict,runLiveEval,compare,buildReport,summary,buildTranscripts,scrub,TRANSCRIPT_CAP} from '../scripts/live-eval.mjs';
import {runLiveCase,caseWallet} from '../evals/live-case.mjs';
import {runWalletTool} from '../src/walletAgent.js';
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
 const turn=args=>async({request})=>{await request({});return {answer:'American Express Gold Card '+secret,trace:[{type:'answer',text:secret}],tools:[],memory:{},messages:[],context:{note:secret}};};
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

test('failing tries keep their answer text and failure codes in the transcripts, never in the report',async()=>{
 const c=liveCases.find(x=>x.id==='dining'),words='WRONG-ANSWER-TEXT',key='sk-'+'a1b2c3d4e5f6a7b8c9d0';
 const chat=async()=>({content:words+' '+key+' '+'word '.repeat(1000),tool_calls:[{function:{name:'find_benefits',arguments:JSON.stringify({q:'Bearer abcdefghijklmnop'})}}]});
 const turn=async({request})=>{await request({});throw Object.assign(Error('answer_not_grounded'),{codes:['unsupported_number']});};
 const pass=async()=>({content:'PASSING-TEXT',tool_calls:[{function:{name:'choose_card',arguments:JSON.stringify(c.expectedArgs)}}]});
 const okTurn=async({request})=>{await request({});return {answer:'PASSING-TEXT',trace:[],tools:[],memory:{},messages:[],context:{}};};
 const other=liveCases.find(x=>x.id!==c.id);
 const run=await runLiveEval({config:{attempts:2,passesNeeded:2,budgetUsd:1},cases:[c,other],spend:freeSpend(),runCase:x=>x.id===c.id?runLiveCase(x,{chat,turn}):runLiveCase(x,{chat:pass,turn:okTurn})});
 const report=buildReport({config,run,baseline:null,spend:freeSpend()});
 const t=buildTranscripts({report,run});
 assert.equal(t.kind,'live-eval-transcripts');assert.equal(t.tries[0].id,c.id);assert.equal(t.tries[0].error,'answer_not_grounded');assert.deepEqual(t.tries[0].codes,['unsupported_number']);
 assert.match(t.tries[0].answer,/^WRONG-ANSWER-TEXT/);assert.equal(t.tries[0].answer.length,TRANSCRIPT_CAP);assert.equal(t.tries[0].answerTruncated,true);
 assert.deepEqual(t.tries[0].toolCalls[0].name,'find_benefits');
 const kept=JSON.stringify(t);assert.equal(kept.includes(key),false);assert.equal(kept.includes('abcdefghijklmnop'),false);assert.equal(kept.includes('PASSING-TEXT'),false,'passing tries add nothing');
 const text=JSON.stringify(report)+summary(report);assert.equal(text.includes(words),false);
 assert.equal(JSON.stringify(report).includes('transcript'),false,'the baseline stays text-free');
 assert.throws(()=>buildTranscripts({report:{...report,syntheticWallet:false},run}),/synthetic wallet/);
 assert.equal(scrub('literal-secret-value here',['literal-secret-value']),'[redacted] here');
});

test('the command writes transcripts for failing tries to a separate directory',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-eval-')),env={...process.env,NODE_NO_WARNINGS:'1'};delete env.DEEPSEEK_API_KEY;
 try{
  const r=spawnSync(process.execPath,['scripts/live-eval.mjs','--dry-run','--out='+path.join(dir,'out'),'--transcripts='+path.join(dir,'tx'),'--fail='+config.cases[0]],{cwd:root,env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const t=JSON.parse(fs.readFileSync(path.join(dir,'tx','transcripts.json'),'utf8'));
  assert.deepEqual([...new Set(t.tries.map(x=>x.id))],[config.cases[0]]);assert.deepEqual(t.tries[0].failedChecks,['completed']);
  assert.deepEqual(fs.readdirSync(path.join(dir,'out')).sort(),['report.json','summary.md']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('the workflow uploads the transcripts as their own short-lived artifact',()=>{
 const yml=fs.readFileSync(path.join(root,'.github/workflows/live-evals.yml'),'utf8');
 const step=yml.slice(yml.indexOf('name: Upload the transcripts'),yml.indexOf('name: Keep a good run'));
 assert.match(step,/name: live-eval-transcripts/);assert.match(step,/path: live-eval-transcripts\//);assert.match(step,/retention-days: 14/);
 assert.match(yml,/--transcripts=live-eval-transcripts/);
 assert.match(yml,/name: live-eval-report\n\s+path: live-eval\//);
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

test('the live ledger case sends its fee date and marks, and its totals are the tool\'s own',async()=>{
 const c=liveCases.find(x=>x.id==='ledger-card-year');
 assert.ok(config.cases.includes(c.id),'the daily sample lists the ledger case');
 let sent=null;
 const chat=async()=>({content:'',tool_calls:[{function:{name:'query_credits',arguments:JSON.stringify({cardName:'Sapphire Reserve',yearBasis:'card-year'})}}]});
 const turn=answer=>async({context,request})=>{sent=context;await request({});return {answer,trace:[],tools:[],memory:{},messages:[],context:{}};};
 const good=await runLiveCase(c,{chat,turn:turn('已标记用掉 USD 314；未记录 USD 70。')});
 assert.ok(Object.values(good.checks).every(Boolean),JSON.stringify(good.checks));
 const reserve=sent.cards.find(x=>x.productId===Object.keys(c.feeDates)[0]);
 assert.deepEqual(reserve.feeDate,{month:8,day:1});
 assert.equal(sent.cards.filter(x=>x.feeDate).length,1,'only the named card gets a fee date');
 assert.deepEqual(sent.events,c.events);assert.equal(sent.events.length,3);
 // Counting the uncaptured cycles as used is caught, as is a missing total.
 assert.equal((await runLiveCase(c,{chat,turn:turn('共返还 USD 384，其中未记录 USD 70，已用 314。')})).checks.avoidsWrongTotals,false);
 assert.equal((await runLiveCase(c,{chat,turn:turn('已用 USD 314。')})).checks.coversNamedProgrammes,false);
 assert.equal((await runLiveCase(c,{chat:async()=>({content:'',tool_calls:[{function:{name:'query_credits',arguments:JSON.stringify({cardName:'Sapphire Reserve'})}}]}),turn:turn('已标记用掉 USD 314；未记录 USD 70。')})).checks.expectedArguments,false,'without yearBasis');
 // The expected totals are what the tool returns for that wallet.
 const r=runWalletTool({id:'x',function:{name:'query_credits',arguments:JSON.stringify({cardName:'Sapphire Reserve',yearBasis:'card-year'})}},caseWallet(c));
 assert.equal(r.cards[0].returned.used,314);assert.equal(r.cards[0].returned.notCaptured,70);
});

// #361: the 2026-11-16 live tries answered correctly ("no record, this does not mean no coverage, see the guide to benefits")
// and failed on the case's own wording checks. Both answers are synthetic copies of those transcripts.
test('coverage-no-record accepts a hedged no-record answer and still rejects a flat "not covered"',async()=>{
 const c=liveCases.find(x=>x.id==='coverage-no-record');
 assert.ok(config.cases.includes(c.id));
 const chat=async()=>({content:'',tool_calls:[{function:{name:'find_protections',arguments:JSON.stringify({cardName:'Blue Cash Everyday',type:'trip-delay'})}}]});
 const turn=answer=>async({request})=>{await request({});return {answer,trace:[],tools:[],memory:{},messages:[],context:{}};};
 const run=async answer=>(await runLiveCase(c,{chat,turn:turn(answer)})).checks;
 for(const answer of[
  '我的记录里没有 Blue Cash Everyday 的航班延误保障资料（not found），所以无法确认。这不代表它一定没有保障，具体以该卡的 guide to benefits 为准；这不是保险建议。',
  '我的记录里没有找到 Blue Cash Everyday 的航班延误保障条目（not found）。这不代表它一定没有保障，具体以该卡的 guide to benefits 为准；以上不是保险建议。']){
  const checks=await run(answer);
  assert.ok(Object.values(checks).every(Boolean),JSON.stringify(checks));
 }
 assert.equal((await run('Blue Cash Everyday 没有保障。我的记录里没有找到，详见发卡行。')).avoidsWrongTotals,false,'a flat claim fails');
 assert.equal((await run('Blue Cash Everyday 不在保障范围内，请看 guide to benefits。')).avoidsWrongTotals,false);
 assert.equal((await run('我的记录里没有找到，详见发卡行。这不代表X，但没有保障。')).avoidsWrongTotals,false,'a comma-joined flat claim after a denial fails');
 assert.equal((await run('我的记录里没有找到，详见发卡行。This does not mean X, but it is not covered.')).avoidsWrongTotals,false);
 assert.equal((await run('这张卡航班延误有保障。')).coversNamedProgrammes,false,'no "no record" wording and no pointer fails');
});
