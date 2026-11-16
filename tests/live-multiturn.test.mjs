// The weekly live multi-turn eval (#269): workflow gating, the summary format and the public report. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const yml=fs.readFileSync(path.join(root,'.github/workflows/live-multiturn.yml'),'utf8');

test('the weekly workflow runs only on a schedule or by hand, on main, behind the protected environment',()=>{
 const triggers=yml.slice(yml.indexOf('\non:\n'),yml.indexOf('\npermissions:'));
 assert.match(triggers,/schedule:\n\s+# .*\n\s+- cron: '\d+ \d+ \* \* \d'/,'weekly: a day-of-week field');
 assert.match(triggers,/workflow_dispatch:/);
 assert.doesNotMatch(triggers,/pull_request|push:|workflow_run|issue_comment/);
 assert.match(yml,/\n    environment: live-evals\n/);
 assert.match(yml,/if: vars\.LIVE_EVALS_ENABLED == 'true' && github\.ref == 'refs\/heads\/main'/);
 assert.doesNotMatch(yml,/self-hosted/);
 assert.equal(yml.match(/secrets\./g).length,1,'the key reaches one step only');
 for(const uses of yml.match(/uses: .+/g))assert.match(uses,/@[0-9a-f]{40} /,'actions are pinned by commit: '+uses);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'.github/workflows/ci.yml'),'utf8'),/live-multiturn|eval-multiturn[^\n]*--live/);
});

test('the workflow caps spend at 0.50 USD through the script and uploads a public report plus a job summary',()=>{
 assert.match(yml,/node scripts\/eval-multiturn\.mjs --live --budget-usd=0\.50 --public /);
 assert.match(yml,/--summary=live-multiturn\/summary\.md/);
 assert.match(yml,/GITHUB_STEP_SUMMARY/);
 assert.match(yml,/name: live-multiturn-report\n\s+path: live-multiturn\//);
 assert.doesNotMatch(yml,/issues: write|gh issue/,'no regression issue yet');
});

test('a live run needs a budget, and the dry run prints the summary by reference kind with no key',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'live-mt-')),env={...process.env,NODE_NO_WARNINGS:'1'};delete env.DEEPSEEK_API_KEY;
 const run=(...args)=>spawnSync(process.execPath,['scripts/eval-multiturn.mjs',...args],{cwd:root,env,encoding:'utf8'});
 try{
  assert.notEqual(run('--live','--out='+path.join(dir,'x.json')).status,0,'no --budget-usd, no live run');
  const r=run('--live','--dry-run','--budget-usd=0.50','--public','--out='+path.join(dir,'report.json'),'--summary='+path.join(dir,'summary.md'));
  assert.equal(r.status,0,r.stderr);
  const md=fs.readFileSync(path.join(dir,'summary.md'),'utf8');
  assert.match(md,/strict pass rate 100\.0%/);
  assert.match(md,/\| all \| \d+ \| \d+ \| 100\.0% \|/);
  assert.match(md,/\| long-range \(很早之前\) \| \d+ \|/);
  assert.match(md,/\| ordinal \| \d+ \|/);
  const report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'),'utf8'));
  assert.equal(report.syntheticWallet,true);
  for(const c of report.cases){assert.equal(c.calls,undefined,'call arguments are not published');assert.ok(Array.isArray(c.toolCalls));}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('a missed weekly run is reported: freshness decision, issue open/update/close, and the daily workflow wiring (#353)',async()=>{
 const {freshness,check}=await import('../scripts/check-live-multiturn-fresh.mjs');
 const now=Date.parse('2026-11-24T12:00:00Z'),day=864e5,at=d=>new Date(now-d*day).toISOString();
 assert.equal(freshness({runs:[{created_at:at(3),conclusion:'success'}],workflowCreatedAt:at(30),now}).stale,false);
 assert.equal(freshness({runs:[{created_at:at(9),conclusion:'success'}],workflowCreatedAt:at(30),now}).stale,true);
 assert.equal(freshness({runs:[{created_at:at(1),conclusion:'skipped'},{created_at:at(9),conclusion:'failure'}],workflowCreatedAt:at(30),now}).stale,true,'skipped runs do not count');
 assert.equal(freshness({runs:[],workflowCreatedAt:at(2),now}).stale,false,'a new workflow gets its first week');
 const never=freshness({runs:[],workflowCreatedAt:at(9),now});assert.equal(never.stale,true);assert.equal(never.reason,'never-ran');
 const calls=[],fake=(runs,open)=>a=>{calls.push(a.join(' '));
  if(a[1]&&a[1].endsWith('/runs?per_page=10'))return JSON.stringify({workflow_runs:runs});
  if(a[0]==='api')return JSON.stringify({created_at:at(30)});
  if(a[0]==='issue'&&a[1]==='list')return JSON.stringify(open?[{number:7}]:[]);
  return '';};
 const go=(runs,open,extra={})=>{calls.length=0;return check({repo:'o/r',now,log(){},run:fake(runs,open),...extra});};
 assert.equal(go([],false).action,'create');assert.ok(calls.some(c=>c.startsWith('issue create')));
 assert.equal(go([],true).action,'comment');assert.ok(calls.some(c=>c.startsWith('issue comment 7')));
 assert.equal(go([{created_at:at(1),conclusion:'success'}],true).action,'close');assert.ok(calls.some(c=>c.startsWith('issue close 7')));
 assert.equal(go([{created_at:at(1),conclusion:'success'}],false).action,'none');
 assert.equal(go([],false,{dryRun:true}).action,'create');assert.ok(!calls.some(c=>/^(issue (create|comment|close)|label)/.test(c)),'a dry run changes nothing');
 const daily=fs.readFileSync(path.join(root,'.github/workflows/live-evals.yml'),'utf8');
 assert.match(daily,/multiturn-fresh:[\s\S]*?github\.event_name == 'schedule'[\s\S]*?check-live-multiturn-fresh\.mjs --max-days=8/);
 assert.doesNotMatch(daily.slice(daily.indexOf('multiturn-fresh:'),daily.indexOf('  live-eval:')),/secrets\.|environment:/,'the check holds no model key');
});
