// The staged gateway release tool and the hosted live-eval transport (stl00/Cardybara#258). No network, no deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {plan,run} from '../scripts/gateway-release.mjs';
import {hostedPost,OVERRIDE_HEADER,isVersionId} from '../evals/hosted-turn.mjs';
import {buildReport} from '../scripts/live-eval.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const V1='11111111-1111-4111-8111-111111111111',V2='22222222-2222-4222-8222-222222222222';
const free={spent:()=>0,usage:{}};

test('every step that acts on a version refuses to run without an explicit version id',()=>{
 for(const argv of [['eval'],['eval','latest'],['ramp'],['ramp','latest','10'],['rollback'],['rollback','x']])assert.throws(()=>plan(argv),/version id/,argv.join(' '));
 assert.throws(()=>plan(['upload',V1]),/no version id/);
 assert.throws(()=>plan(['ramp',V1,'10']),/--stable/);
 assert.throws(()=>plan(['ramp',V1,'10','--stable',V1]),/differ/);
 assert.throws(()=>plan(['ramp',V1,'0']),/percent/);
 assert.throws(()=>plan(['nonsense']),/usage/);
});

test('plans name the version and the traffic split, and dry runs execute nothing',()=>{
 const ramp=plan(['ramp',V2,'10','--stable',V1]);
 assert.deepEqual(ramp.steps[0].run[1].filter(a=>a.includes('%')),[`${V2}@10%`,`${V1}@90%`]);
 assert.deepEqual(plan(['ramp',V2,'100']).steps[0].run[1].filter(a=>a.includes('%')),[`${V2}@100%`]);
 assert.ok(plan(['eval',V2,'--out=x']).steps[0].run[1].includes('--version='+V2));
 const calls=[],lines=[];
 run(plan(['upload','--dry-run']),{exec:(...a)=>calls.push(a),log:l=>lines.push(l)});
 assert.equal(calls.length,0);assert.match(lines.join('\n'),/\[dry run\].*0%/);
 run(plan(['rollback',V1]),{exec:(...a)=>{calls.push(a);return 0;},log:()=>{}});assert.equal(calls.length,1);
 assert.throws(()=>run(plan(['rollback',V1]),{exec:()=>3,log:()=>{}}),/exit code 3/);
});

test('the hosted transport pins the version with the override header and never leaks the invite code in errors',async()=>{
 let seen;
 const post=hostedPost({base:'https://g.test/',invite:'cdy_secret',version:V1,fetch:async(url,init)=>{seen={url,init};return new Response('{"error":{"code":"rate_limited"}}',{status:429});}});
 await assert.rejects(post({a:1}),e=>!/cdy_secret/.test(e.message)&&e.gatewayCode==='rate_limited');
 assert.equal(seen.url,'https://g.test/v1/chat');assert.equal(seen.init.headers[OVERRIDE_HEADER],`cardybara-gateway="${V1}"`);
 assert.throws(()=>hostedPost({base:'x',invite:'c',version:'latest'}),/version id/);
 assert.ok(isVersionId(V1)&&!isVersionId('abc'));
});

test('a report of another Worker version is a new baseline candidate, not a regression',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'evals/live/config.json'),'utf8'));
 const results=[{id:'a',status:'fail',tries:[]}],baseline={kind:'live-eval',status:'good',version:V1,cases:[{id:'a',status:'pass'}]};
 const other=buildReport({config,run:{results},baseline,spend:free,target:'hosted',version:V2});
 assert.equal(other.status,'good');assert.equal(other.newBaselineCandidate,true);assert.equal(other.version,V2);
 const same=buildReport({config,run:{results},baseline,spend:free,target:'hosted',version:V1});
 assert.equal(same.status,'regression');
});

test('the hosted dry run goes through the real transport and gateway with no network or code',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'hosted-eval-'));
 const r=spawnSync('node',['scripts/live-eval.mjs','--target=hosted','--dry-run','--out='+out],{cwd:root,encoding:'utf8',timeout:120000,env:{...process.env,CARDYBARA_EVAL_INVITE:''}});
 assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
 assert.equal(report.target,'hosted');assert.equal(report.mode,'dry-run');assert.ok(isVersionId(report.version));
 assert.ok(report.cases.every(c=>c.status==='pass'));
 assert.doesNotMatch(JSON.stringify(report),/cdy_/);
 const failed=spawnSync('node',['scripts/live-eval.mjs','--target=hosted','--out='+out],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_EVAL_INVITE:''}});
 assert.notEqual(failed.status,0);assert.match(failed.stderr,/--version/);
});
