#!/usr/bin/env node
// Staged release of the hosted gateway (stl00/Cardybara#258; steps in docs/GATEWAY.md, "Release"). Owner/ops tool:
// nothing here runs in CI on pull requests, and every step names the Worker version it acts on.
//
//   node scripts/gateway-release.mjs upload                          new version at 0% traffic; prints its version id
//   node scripts/gateway-release.mjs eval <version> [--out=dir] [--baseline=report.json]
//                                                                    live eval through POST /v1/chat pinned to that version
//                                                                    (no credential; costs model spend)
//   node scripts/gateway-release.mjs ramp <version> <percent> --stable <version>
//                                                                    send <percent> of traffic to <version>, the rest to --stable
//   node scripts/gateway-release.mjs rollback <stable-version>       100% of traffic back to that version
//   node scripts/gateway-release.mjs compare <new-version> --stable <version> [--metrics=file.json]
//                                                                    ramp, hold or rollback from saved per-version metrics (docs/GATEWAY.md);
//                                                                    JSON on stdin without --metrics; no token, no network
//                                                                    [--min-turns=N] [--min-rate-percent=P] [--rate-multiple=M]
//   add --dry-run to any command to print what it would run and stop
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {isVersionId} from '../evals/hosted-turn.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const WRANGLER=['--yes','wrangler@4.150.0'],CONFIG=resolve(root,'gateway/wrangler.jsonc');
const need=(v,what)=>{if(!isVersionId(v))throw Error(`${what} must be an explicit Worker version id, got ${v?'"'+v+'"':'nothing'}`);return v;};

/** What a command will run, as [description, program, args] steps. Throws on a missing or malformed version id or percent. */
export function plan(argv){
 const args=[...argv],take=flag=>{const i=args.findIndex(a=>a===flag||a.startsWith(flag+'='));if(i<0)return undefined;const a=args[i];if(a.includes('=')){args.splice(i,1);return a.slice(flag.length+1);}const v=args[i+1];args.splice(i,2);return v;};
 const dryRun=!!args.includes('--dry-run');if(dryRun)args.splice(args.indexOf('--dry-run'),1);
 const stable=take('--stable'),out=take('--out'),baseline=take('--baseline'),[cmd,version,percent,...extra]=args;
 if(extra.length)throw Error('unexpected arguments: '+extra.join(' '));
 const wrangler=(...a)=>['npx',[...WRANGLER,...a,'--config',CONFIG]];
 if(cmd==='upload'){
  if(version)throw Error('upload makes a new version; it takes no version id');
  return {dryRun,steps:[{say:'Upload a new Worker version without sending it traffic (0%)',run:wrangler('versions','upload')}]};
 }
 if(cmd==='eval'){
  need(version,'eval needs a version: it');
  const a=['scripts/live-eval.mjs','--target=hosted','--version='+version,...(out?['--out='+out]:[]),...(baseline?['--baseline='+baseline]:[])];
  return {dryRun,steps:[{say:`Run the pinned live eval against Worker version ${version} through the hosted route (model spend, capped by evals/live/config.json)`,run:['node',a]}]};
 }
 if(cmd==='ramp'){
  need(version,'ramp needs a version: it');
  if(!/^\d{1,3}$/.test(percent||'')||Number(percent)<1||Number(percent)>100)throw Error('ramp needs a percent from 1 to 100');
  const p=Number(percent);
  if(p<100){need(stable,'--stable (the version that keeps the rest of the traffic)');if(stable===version)throw Error('--stable must differ from the version being ramped');}
  const spec=p===100?[`${version}@100%`]:[`${version}@${p}%`,`${stable}@${100-p}%`];
  return {dryRun,steps:[{say:`Send ${p}% of traffic to ${version}${p<100?`, ${100-p}% to ${stable}`:''}`,run:wrangler('versions','deploy',...spec,'--yes')}]};
 }
 if(cmd==='rollback'){
  need(version,'rollback needs the version to return to: it');
  return {dryRun,steps:[{say:`Send 100% of traffic back to ${version}`,run:wrangler('versions','deploy',`${version}@100%`,'--yes')}]};
 }
 throw Error('usage: gateway-release.mjs upload | eval <version> | ramp <version> <percent> --stable <version> | rollback <version> | compare <version> --stable <version>  [--dry-run]');
}

const COMPARE_USAGE='usage: gateway-release.mjs compare <new-version> --stable <version> [--metrics=file.json] [--min-turns=N] [--min-rate-percent=P] [--rate-multiple=M]';
// The defaults of DEFAULT_THRESHOLDS in gateway/src/alerts.js, copied because importing that module pulls in the
// gateway's dependencies; tests/gateway-release.test.mjs fails if the two drift apart.
export const DEFAULT_THRESHOLDS={rateMultiple:2,minRatePercent:5,minTurns:20};
const round=n=>Math.round(n*100)/100;

/** Reads `compare` arguments. Returns {version,stable,metrics,thresholds}; throws on anything malformed. */
export function parseCompare(argv){
 const args=[...argv],take=flag=>{const i=args.findIndex(a=>a===flag||a.startsWith(flag+'='));if(i<0)return undefined;const a=args[i];if(a.includes('=')){args.splice(i,1);return a.slice(flag.length+1);}const v=args[i+1];args.splice(i,2);return v;};
 const stable=take('--stable'),metrics=take('--metrics'),minTurns=take('--min-turns'),minRatePercent=take('--min-rate-percent'),rateMultiple=take('--rate-multiple');
 const [cmd,version,...extra]=args;
 if(cmd!=='compare'||extra.length)throw Error(extra.length?'unexpected arguments: '+extra.join(' '):COMPARE_USAGE);
 need(version,'compare needs the new version: it');need(stable,'--stable');
 if(stable===version)throw Error('--stable must differ from the version being compared');
 const thresholds={minTurns:DEFAULT_THRESHOLDS.minTurns,minRatePercent:DEFAULT_THRESHOLDS.minRatePercent,rateMultiple:DEFAULT_THRESHOLDS.rateMultiple};
 for(const [k,v,max] of [['minTurns',minTurns,100000],['minRatePercent',minRatePercent,100],['rateMultiple',rateMultiple,100]]){
  if(v===undefined)continue;
  const n=/^\d+(\.\d+)?$/.test(v)?Number(v):NaN;
  if(!(n>0&&n<=max)||(k==='minTurns'&&!Number.isInteger(n)))throw Error(`--${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())} must be a positive ${k==='minTurns'?'whole ':''}number up to ${max}`);
  thresholds[k]=n;
 }
 return {version,stable,metrics,thresholds};
}

/**
 * The rule (docs/GATEWAY.md, "Release"). `data` is the saved result of the per-version Analytics Engine query: rows of
 * {version, turns, errors, repaired, fallbacks}, each count already weighted by _sample_interval. `hold` when either
 * version has fewer than minTurns turns; `rollback` when the new version's error or fallback rate is at least
 * minRatePercent and at least rateMultiple times the stable version's; otherwise `ramp`.
 */
export function compareVersions(data,{version,stable,thresholds}){
 const rows=Array.isArray(data)?data:data&&Array.isArray(data.data)?data.data:null;
 if(!rows)throw Error('metrics file must be the JSON result of the documented query: an object with a "data" array');
 const num=v=>{const x=Number(v);return Number.isFinite(x)&&x>=0?x:NaN;};
 const by=new Map();
 for(const r of rows){
  if(!r||typeof r!=='object'||typeof r.version!=='string')throw Error('metrics row without a version column');
  const f={turns:num(r.turns),errors:num(r.errors),repaired:num(r.repaired),fallbacks:num(r.fallbacks)};
  if(Object.values(f).some(Number.isNaN))throw Error(`metrics row for ${r.version} has a missing or invalid count`);
  if(f.errors>f.turns||f.repaired>f.turns||f.fallbacks>f.turns)throw Error(`metrics row for ${r.version} counts more events than turns`);
  if(by.has(r.version))throw Error(`metrics list ${r.version} twice`);
  by.set(r.version,f);
 }
 for(const v of [version,stable])if(!by.has(v))throw Error(`version ${v} is not in the metrics data`);
 const figures=id=>{const f=by.get(id),pct=k=>f.turns>0?round(100*f[k]/f.turns):0;return {version:id,turns:round(f.turns),errorPercent:pct('errors'),repairPercent:pct('repaired'),fallbackPercent:pct('fallbacks'),raw:f};};
 const n=figures(version),s=figures(stable),{minTurns,minRatePercent,rateMultiple}=thresholds;
 const rate=(f,k)=>f.raw.turns>0?100*f.raw[k]/f.raw.turns:0;
 let verdict,reason;
 const thin=[n,s].filter(f=>f.turns<minTurns);
 if(thin.length){verdict='hold';reason=`${thin.map(f=>`${f.version} has ${f.turns} turns`).join(' and ')}, fewer than ${minTurns}; wait for more traffic`;}
 else{
  const bad=[['error','errors'],['fallback','fallbacks']].find(([,k])=>{const a=rate(n,k),b=rate(s,k);return a>=minRatePercent&&a>=rateMultiple*b;});
  if(bad){verdict='rollback';reason=`new ${bad[0]} rate ${round(rate(n,bad[1]))}% is at least ${minRatePercent}% and at least ${rateMultiple}x the stable ${round(rate(s,bad[1]))}%`;}
  else{verdict='ramp';reason=`new error and fallback rates are below ${minRatePercent}% or below ${rateMultiple}x the stable version's`;}
 }
 for(const f of [n,s])delete f.raw;
 return {verdict,reason,thresholds,new:n,stable:s};
}

/** Runs `compare`: reads the metrics file (or stdin), prints figures and the verdict. Makes no network request. */
export function compare(argv,{readFile=p=>readFileSync(p,'utf8'),readStdin=()=>readFileSync(0,'utf8'),log=console.log}={}){
 const o=parseCompare(argv);let data;
 try{data=JSON.parse(o.metrics?readFile(o.metrics):readStdin());}catch(e){throw Error('metrics are not readable JSON: '+(e.code||e.message));}
 const r=compareVersions(data,o);
 for(const [label,f] of [['new   ',r.new],['stable',r.stable]])log(`${label} ${f.version}  turns ${f.turns}  error ${f.errorPercent}%  repair ${f.repairPercent}%  fallback ${f.fallbackPercent}%`);
 log(`verdict: ${r.verdict}`);log(`reason: ${r.reason}`);
 return r;
}

/** Runs a plan. `exec(program,args)` is replaced in tests; returns the printed lines. */
export function run(p,{exec=(program,a)=>spawnSync(program,a,{cwd:root,stdio:'inherit'}).status,log=console.log}={}){
 for(const s of p.steps){
  log((p.dryRun?'[dry run] ':'')+s.say);log('  $ '+[s.run[0],...s.run[1]].join(' '));
  if(p.dryRun)continue;
  const status=exec(...s.run);
  if(status)throw Object.assign(Error(`step failed with exit code ${status}`),{exitCode:status});
 }
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 try{if(process.argv[2]==='compare')compare(process.argv.slice(2));else run(plan(process.argv.slice(2)));}
 catch(e){console.error(e.message);process.exitCode=e.exitCode||2;}
}
