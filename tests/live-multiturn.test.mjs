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
