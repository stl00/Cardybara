#!/usr/bin/env node
// Staged release of the hosted gateway (stl00/Cardybara#258; steps in docs/GATEWAY.md, "Release"). Owner/ops tool:
// nothing here runs in CI on pull requests, and every step names the Worker version it acts on.
//
//   node scripts/gateway-release.mjs upload                          new version at 0% traffic; prints its version id
//   node scripts/gateway-release.mjs eval <version> [--out=dir] [--baseline=report.json]
//                                                                    live eval through POST /v1/chat pinned to that version
//                                                                    (needs CARDYBARA_EVAL_INVITE; costs model spend)
//   node scripts/gateway-release.mjs ramp <version> <percent> --stable <version>
//                                                                    send <percent> of traffic to <version>, the rest to --stable
//   node scripts/gateway-release.mjs rollback <stable-version>       100% of traffic back to that version
//   add --dry-run to any command to print what it would run and stop
import {execFileSync,spawnSync} from 'node:child_process';
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
 throw Error('usage: gateway-release.mjs upload | eval <version> | ramp <version> <percent> --stable <version> | rollback <version>  [--dry-run]');
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
 try{run(plan(process.argv.slice(2)));}
 catch(e){console.error(e.message);process.exitCode=e.exitCode||2;}
}
