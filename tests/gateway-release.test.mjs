// The staged gateway release tool and the hosted live-eval transport (stl00/Cardybara#258). No network, no deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {plan,run,compare,parseCompare,DEFAULT_THRESHOLDS} from '../scripts/gateway-release.mjs';
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

test('the hosted transport pins the version with the override header and sends no credential',async()=>{
 let seen;
 const post=hostedPost({base:'https://g.test/',version:V1,fetch:async(url,init)=>{seen={url,init};return new Response('{"error":{"code":"rate_limited"}}',{status:429});}});
 await assert.rejects(post({a:1}),e=>e.gatewayCode==='rate_limited');assert.equal(seen.init.headers.Authorization,undefined);
 assert.equal(seen.url,'https://g.test/v1/chat');assert.equal(seen.init.headers[OVERRIDE_HEADER],`cardybara-gateway="${V1}"`);
 assert.throws(()=>hostedPost({base:'x',version:'latest'}),/version id/);
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
 const r=spawnSync('node',['scripts/live-eval.mjs','--target=hosted','--dry-run','--out='+out],{cwd:root,encoding:'utf8',timeout:120000,env:process.env});
 assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
 assert.equal(report.target,'hosted');assert.equal(report.mode,'dry-run');assert.ok(isVersionId(report.version));
 assert.ok(report.cases.every(c=>c.status==='pass'));
 assert.doesNotMatch(JSON.stringify(report),/cdy_/);
 const failed=spawnSync('node',['scripts/live-eval.mjs','--target=hosted','--out='+out],{cwd:root,encoding:'utf8',env:process.env});
 assert.notEqual(failed.status,0);assert.match(failed.stderr,/--version/);
});

// --- compare (#528): synthetic numbers only
const V3='33333333-3333-4333-8333-333333333333';
const row=(version,turns,errors=0,repaired=0,fallbacks=0)=>({version,turns,errors,repaired,fallbacks});
const run2=(rows,extra=[],argv=['compare',V2,'--stable',V1])=>{const lines=[];const r=compare([...argv,'--metrics=m.json',...extra],{readFile:()=>JSON.stringify({data:rows}),log:l=>lines.push(l)});return {...r,lines};};

test('compare ramps when the new version is no worse than stable',()=>{
 const r=run2([row(V1,1000,10,50,5),row(V2,200,2,12,1)]);
 assert.equal(r.verdict,'ramp');assert.match(r.lines.join('\n'),/verdict: ramp/);assert.equal(r.new.turns,200);assert.equal(r.new.errorPercent,1);
 assert.equal(run2([row(V1,1000,100),row(V2,200,12)]).verdict,'ramp');// 6% but stable is 10%: under 2x
});

test('compare holds when either side has too few turns',()=>{
 assert.equal(run2([row(V1,1000),row(V2,19,19)]).verdict,'hold');
 assert.equal(run2([row(V1,19),row(V2,1000)]).verdict,'hold');
 assert.equal(run2([row(V1,19),row(V2,1000)],['--min-turns=10']).verdict,'ramp');
});

test('compare rolls back on errors or fallbacks, and the rule needs both the floor and the multiple',()=>{
 assert.equal(run2([row(V1,1000,10),row(V2,100,10)]).verdict,'rollback');
 const f=run2([row(V1,1000,0,0,10),row(V2,100,0,0,10)]);assert.equal(f.verdict,'rollback');assert.match(f.reason,/fallback/);
 assert.equal(run2([row(V1,1000,0),row(V2,100,4)]).verdict,'ramp');// below 5% floor
 assert.equal(run2([row(V1,1000,0),row(V2,100,4)],['--min-rate-percent=3']).verdict,'rollback');
 assert.equal(run2([row(V1,100,5),row(V2,100,9)]).verdict,'ramp');// 9% < 2x5%
 assert.equal(run2([row(V1,100,5),row(V2,100,9)],['--rate-multiple','1.5']).verdict,'rollback');
});

test('compare reads sampling-weighted counts from stdin as given',()=>{
 // a sample interval of 10 makes 5 sampled turns weigh 50; the query has already applied it, so the counts are used as is
 const r=compare(['compare',V2,'--stable',V1],{readStdin:()=>JSON.stringify({data:[row(V1,500,5),row(V2,50,5)]}),log:()=>{}});
 assert.equal(r.verdict,'rollback');assert.equal(r.new.errorPercent,10);
});

test('compare rejects a malformed id, an unknown version and a malformed file instead of ramping',()=>{
 const ok=[row(V1,100),row(V2,100)],go=(argv,data)=>()=>compare(argv,{readFile:()=>typeof data==='string'?data:JSON.stringify(data),log:()=>{}});
 assert.throws(go(['compare','latest','--stable',V1,'--metrics=m'],{data:ok}),/version id/);
 assert.throws(go(['compare',V2,'--metrics=m'],{data:ok}),/--stable/);
 assert.throws(go(['compare',V2,'--stable',V2,'--metrics=m'],{data:ok}),/differ/);
 assert.throws(go(['compare',V3,'--stable',V1,'--metrics=m'],{data:ok}),/not in the metrics/);
 assert.throws(go(['compare',V2,'--stable',V1,'--metrics=m'],'not json'),/readable JSON/);
 assert.throws(go(['compare',V2,'--stable',V1,'--metrics=m'],{rows:[]}),/"data" array/);
 assert.throws(go(['compare',V2,'--stable',V1,'--metrics=m'],{data:[row(V1,100),row(V2,'x')]}),/invalid count/);
 assert.throws(go(['compare',V2,'--stable',V1,'--metrics=m'],{data:[row(V1,100),row(V2,10,20)]}),/more events/);
 assert.throws(go(['compare',V2,'--stable',V1,'--metrics=m'],{data:[row(V1,100),row(V1,100),row(V2,100)]}),/twice/);
 assert.throws(()=>parseCompare(['compare',V2,'--stable',V1,'--min-turns=0']),/min-turns/);
 assert.throws(()=>parseCompare(['compare',V2,'--stable',V1,'--rate-multiple=abc']),/rate-multiple/);
});

test('compare makes no network request and the CLI works end to end',()=>{
 const realFetch=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('network');};
 try{run2([row(V1,100),row(V2,100)]);}finally{globalThis.fetch=realFetch;}
 assert.equal(calls,0);
 const src=fs.readFileSync(path.join(root,'scripts/gateway-release.mjs'),'utf8');
 assert.doesNotMatch(src,/\bfetch\s*\(|node:https?|node:net\b|XMLHttpRequest/);
 const r=spawnSync('node',['scripts/gateway-release.mjs','compare',V2,'--stable',V1],{cwd:root,encoding:'utf8',input:JSON.stringify({data:[row(V1,100,1),row(V2,100,20)]})});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/verdict: rollback/);
 const bad=spawnSync('node',['scripts/gateway-release.mjs','compare',V2,'--stable',V1],{cwd:root,encoding:'utf8',input:'{}'});
 assert.notEqual(bad.status,0);
});

test('compare defaults are the alert defaults of gateway/src/alerts.js',()=>{
 const src=fs.readFileSync(path.join(root,'gateway/src/alerts.js'),'utf8');
 for(const k of Object.keys(DEFAULT_THRESHOLDS))assert.equal(Number(src.match(new RegExp('\\b'+k+':(\\d+)'))?.[1]),DEFAULT_THRESHOLDS[k],k);
 assert.deepEqual(parseCompare(['compare',V2,'--stable',V1]).thresholds,DEFAULT_THRESHOLDS);
});
