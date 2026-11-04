import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
test('development and release use one empty seed of active banks',()=>{
 const seed=JSON.parse(readFileSync(new URL('../public/data.example.json',import.meta.url),'utf8'));
 assert.deepEqual(seed.connections.map(c=>c.bank).sort(),[...ACTIVE_BANKS].sort());
 for(const key of ['cards','rewards','transactions','offers','benefits'])assert.deepEqual(seed[key],[]);
});
test('local parser preflight supports mixed bank fixture formats without claiming live acceptance',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const result=spawnSync(process.execPath,['scripts/debug-bank.mjs','--parse-only'],{cwd:root,encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 const path=result.stdout.match(/Report: (.+)/)?.[1];assert.ok(path);
 const report=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(report.parsing.pass,true);assert.equal(report.parsing.cases.length,17);assert.equal(report.parsing.cases.filter(c=>c.bank==='BOA').length,2);assert.equal(report.parsing.cases.filter(c=>c.bank==='SC HK').length,2);
 assert.equal(report.parsing.cases.filter(c=>c.bank==='Chase').length,6);
 assert.equal(report.workflow.status,'not_run');assert.equal(report.workflow.pass,null);
 assert.equal(report.liveAcceptance.status,'not_run');
});
