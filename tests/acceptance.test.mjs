import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {recheckLiveEval,findLiveEvalRun,openRegressionIssueCount} from '../scripts/live-eval-evidence.mjs';
import {validateAcceptance,artifactBuildId,dueYearEvidenced,REQUIRED_CASES,REQUIRED_BANKS} from '../scripts/acceptance.mjs';
import {readZipEntry} from '../scripts/read-zip.mjs';
import {BUILD_ID} from '../extension-next/build-info.js';
const HOLDOUT=JSON.parse(readFileSync(new URL('../evals/holdout/manifest.json',import.meta.url),'utf8'));
function fixture(){return {schema:1,artifactSha256:'a'.repeat(64),runtimeBuild:'fixture-build',verifiedAt:new Date().toISOString(),environment:{freshChromeProfile:true,oldBackupImported:false,developerServicesRequired:false,extensionId:'a'.repeat(32)},heldOutEval:{dataset:HOLDOUT.dataset,datasetSha256:HOLDOUT.sha256,mode:'offline',artifactSha256:'a'.repeat(64),runtimeBuild:'fixture-build',sourceCommit:'c'.repeat(40),ranAt:new Date().toISOString(),passed:HOLDOUT.caseCount,total:HOLDOUT.caseCount,failed:[]},liveEval:{runId:1234,headSha:'c'.repeat(40),conclusion:'success',finishedAt:new Date().toISOString()},cases:Object.fromEntries(REQUIRED_CASES.map(c=>[c,{status:'passed',mode:'real-chrome',evidence:'Synthetic validator test; not real acceptance.'}])),banks:Object.fromEntries(REQUIRED_BANKS.map(bank=>[bank,{status:'passed',cardCount:1,visibleCardCount:1,runtimeBuild:'fixture-build',capturedAt:new Date().toISOString(),cards:[{fields:Object.fromEntries(['reward','balance','statement','minimum','due'].map(f=>[f,{status:'observed',capturedAt:new Date().toISOString(),...(f==='due'?{date:'2030-01-15',yearEvidence:'Payment due January 15, 2030 (synthetic)'}:{})}]))}]}]))};}
const options={sha256:'a'.repeat(64),runtimeBuild:'fixture-build',sourceCommit:'c'.repeat(40),openRegressionIssues:0};
// A throwaway repository whose release tag stands in for the candidate's source commit.
function taggedRepo(dir){
 const label=JSON.parse(readFileSync('release.json','utf8')).label,git=(...a)=>execFileSync('git',a,{cwd:dir,encoding:'utf8'}).trim();
 git('init','-q');git('-c','user.name=test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-q','--allow-empty','-m','candidate');git('-c','tag.gpgsign=false','tag','v'+label);
 return git('rev-parse','HEAD');
}
test('release gate fails closed without actual installation and every bank field',()=>{
 assert.equal(validateAcceptance({},options).passed,false);const r=fixture();assert.equal(validateAcceptance(r,options).passed,true);
 for(const key of REQUIRED_CASES){const copy=structuredClone(r);copy.cases[key].mode='mock';assert.equal(validateAcceptance(copy,options).passed,false);}
 for(const bank of REQUIRED_BANKS){const copy=structuredClone(r);copy.banks[bank].cards[0].fields.reward.status='not_found';assert.equal(validateAcceptance(copy,options).passed,false);}
});
test('the gate matches the MVP regions and reward scope, and still fails closed',()=>{
 assert.deepEqual([...REQUIRED_BANKS].sort(),['Amex HK','Amex US','BOA','Chase','Citi US','HSBC HK','SC HK']);
 const r=fixture(),set=(bank,change)=>{const copy=structuredClone(r);Object.assign(copy.banks[bank].cards[0].fields.reward,change);return validateAcceptance(copy,options).passed;};
 const out={status:'not_collected',reason:'Not collected in this version.',programme:'Hilton Honors Points'};
 assert.equal(set('BOA',out),true);assert.equal(set('Chase',out),true,'a co-brand card');
 assert.equal(set('BOA',{...out,programme:undefined}),false,'must name the programme');assert.equal(set('BOA',{...out,reason:''}),false,'must say why');
 assert.equal(set('Chase',{...out,programme:'Ultimate Rewards points'}),false);assert.equal(set('Amex US',{...out,programme:'Membership Rewards'}),false);assert.equal(set('Amex HK',{...out,programme:'美國運通積分計劃'}),false);
 for(const programme of ['Ultimate  Rewards','Ultimate\u00a0Rewards','Ultimate-Rewards','Ultimate Reward','UR'])assert.equal(set('Chase',{...out,programme}),false,programme);
 for(const programme of ['MembershipRewards','Membership Reward','會員 積分','MR','Points','積分','n/a','Some Unlisted Points'])assert.equal(set('Amex US',{...out,programme}),false,programme);
 for(const programme of ['Points','n/a','none'])assert.equal(set('BOA',{...out,programme}),false,programme);
 assert.equal(set('BOA',{...out,reason:'        '}),false,'blank reason');
 assert.equal(set('Chase',{status:'explicit_not_applicable',reason:'Bank shows no reward.'}),false,'a reward cannot be waived that way');
 for(const field of ['balance','statement','minimum','due']){const copy=structuredClone(r);Object.assign(copy.banks.BOA.cards[0].fields[field],out);assert.equal(validateAcceptance(copy,options).passed,false,field);}
 const noCiti=structuredClone(r);delete noCiti.banks['Citi US'];assert.equal(validateAcceptance(noCiti,options).passed,false);
 for(const field of ['balance','statement']){const copy=structuredClone(r);Object.assign(copy.banks.BOA.cards[0].fields[field],{status:'explicit_not_applicable',reason:'Bank states no payment is due.'});assert.equal(validateAcceptance(copy,options).passed,false,field);}
 const noPay=structuredClone(r);Object.assign(noPay.banks.BOA.cards[0].fields.minimum,{status:'explicit_not_applicable',reason:'Bank states no payment is due.'});assert.equal(validateAcceptance(noPay,options).passed,true);
});
test('release gate refuses changed bytes, stale/old workers, imported backups and developer dependencies',()=>{
 for(const mutate of [r=>r.artifactSha256='b'.repeat(64),r=>r.runtimeBuild='old',r=>r.environment.oldBackupImported=true,r=>r.environment.freshChromeProfile=false,r=>r.environment.developerServicesRequired=true,r=>r.verifiedAt='2020-01-01']){const r=fixture();mutate(r);assert.equal(validateAcceptance(r,options).passed,false);}
});
test('new reports leave the backup answer and runtime build for the tester',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-acceptance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const zip=path.join(dir,'c.zip'),out=path.join(dir,'r.json');makeZip(zip,{'build-scope.js':'export const BUILD_BANKS=["Chase","Amex US"];\n'});
 execFileSync(process.execPath,['scripts/new-acceptance.mjs',zip,out]);
 const report=JSON.parse(readFileSync(out,'utf8'));
 assert.deepEqual(Object.keys(report.banks),['Chase','Amex US'],'a beta report lists the banks its package can connect');
 assert.equal(report.runtimeBuild,null);
 for(const [key,value] of Object.entries(report.environment))assert.equal(value,null,key);
 const result=validateAcceptance(report,{sha256:report.artifactSha256,runtimeBuild:BUILD_ID});
 assert.equal(result.passed,false);
 for(const why of ['executing worker build not verified','old wallet backup was used','fresh Chrome profile not verified'])assert.ok(result.errors.includes(why),why);
});
test('the gate refuses an empty expected build even when the report is also empty',()=>{
 for(const runtimeBuild of [undefined,null,'']){const r=fixture();r.runtimeBuild=runtimeBuild;for(const bank of REQUIRED_BANKS)r.banks[bank].runtimeBuild=runtimeBuild;assert.equal(validateAcceptance(r,{...options,runtimeBuild}).passed,false);}
});
test('explicit_not_applicable satisfies payment fields only',()=>{
 const waived={status:'explicit_not_applicable',reason:'Bank states no payment is due.'},pass=field=>{const r=fixture();r.banks.BOA.cards[0].fields[field]={...r.banks.BOA.cards[0].fields[field],...waived};return validateAcceptance(r,options).passed;};
 for(const field of ['reward','balance','statement'])assert.equal(pass(field),false,field);
 for(const field of ['minimum','due'])assert.equal(pass(field),true,field);
});
test('an observed due date needs a dated year from the page',()=>{
 const result=change=>{const r=fixture();Object.assign(r.banks.Chase.cards[0].fields.due,change);return validateAcceptance(r,options);};
 assert.equal(result({}).passed,true);
 const refused=[{date:undefined},{yearEvidence:undefined},{date:'01-15'},{date:'January 15'},{date:'2030-02-30'},{date:20300115},{yearEvidence:'Payment due January 15'},{yearEvidence:'Year guessed from today'},{yearEvidence:'Payment due January 15, 2031'},{yearEvidence:'Reference 120301'}];
 for(const change of refused){const r=result(change);assert.equal(r.passed,false,JSON.stringify(change));assert.ok(r.errors.includes('Chase card 1: due date has no year evidence'),JSON.stringify(change));}
 assert.equal(dueYearEvidenced({date:'2032-02-29',yearEvidence:'29/02/2032'}),true,'a real leap day');
 const r=fixture();r.banks.BOA.cards[0].fields.reward={status:'observed',capturedAt:new Date().toISOString()};assert.equal(validateAcceptance(r,options).passed,true,'other fields need no date');
});
function makeZip(file,entries){execFileSync('python3',['-c',"import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:\n for n,b in json.loads(sys.argv[2]).items():z.writestr(n,b)",file,JSON.stringify(entries)]);}
test('the artifact build is read from the packaged file',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-acceptance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const zip=path.join(dir,'c.zip');makeZip(zip,{'a.txt':'first','build-info.js':"// note\nexport const BUILD_ID='zip-build';\n",'z.txt':'last'});
 const bytes=readFileSync(zip);assert.equal(artifactBuildId(bytes),'zip-build');assert.equal(readZipEntry(bytes,'z.txt').toString(),'last');
 assert.throws(()=>readZipEntry(bytes,'missing.js'),/no missing\.js/);assert.throws(()=>artifactBuildId(Buffer.from('not a zip, just some synthetic bytes')),/Not a ZIP/);
 makeZip(zip,{'build-info.js':'export const OTHER=1;'});assert.throws(()=>artifactBuildId(readFileSync(zip)),/does not declare/);
});
test('promotion checks the build inside the ZIP, not the checkout',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-acceptance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const label=JSON.parse(readFileSync('release.json','utf8')).label,zip=path.join(dir,'candidate.zip'),evidence=path.join(dir,'report.json'),published=path.join(dir,'published');
 makeZip(zip,{'build-info.js':"export const BUILD_ID='zip-build';\n",'build-scope.js':'export const BUILD_BANKS=null;\n'});
 const sha256=createHash('sha256').update(readFileSync(zip)).digest('hex');
 // A stand-in gh: never reaches GitHub, reports a matching draft and records whether publishing was attempted.
 const draft=JSON.stringify({isDraft:true,tagName:'v'+label,assets:[{name:'candidate.zip',digest:'sha256:'+sha256}]});
 writeFileSync(path.join(dir,'gh'),`#!/bin/sh\nif [ "$1" = "api" ] && echo "$2" | grep -q actions/runs; then cat '${path.join(dir,'live-run')}'; elif [ "$1" = "issue" ]; then cat '${path.join(dir,'issues')}'; elif [ "$1" = "api" ]; then cat '${path.join(dir,'remote-commit')}'; elif [ "$2" = "edit" ]; then touch '${published}'; else echo '${draft}'; fi\n`);chmodSync(path.join(dir,'gh'),0o755);
 const source=taggedRepo(dir);
 const liveRun=(change={})=>writeFileSync(path.join(dir,'live-run'),JSON.stringify({id:1234,head_sha:source,conclusion:'success',updated_at:liveAt,path:'.github/workflows/live-evals.yml',head_branch:'main',...change}));
 const liveAt=new Date().toISOString();liveRun();writeFileSync(path.join(dir,'issues'),'[]');
 const promote=(build,change={})=>{rmSync(published,{force:true});const r=fixture();r.artifactSha256=sha256;r.runtimeBuild=build;Object.assign(r.heldOutEval,{artifactSha256:sha256,runtimeBuild:build,sourceCommit:source},change);r.liveEval={runId:1234,headSha:source,conclusion:'success',finishedAt:liveAt};for(const bank of REQUIRED_BANKS)r.banks[bank].runtimeBuild=build;writeFileSync(evidence,JSON.stringify(r));return spawnSync(process.execPath,[path.resolve('scripts/promote-release.mjs'),zip,evidence,'--publish'],{cwd:dir,env:{...process.env,PATH:dir+path.delimiter+process.env.PATH},encoding:'utf8'});};
 assert.notEqual(BUILD_ID,'zip-build');
 const stale=promote(BUILD_ID);assert.notEqual(stale.status,0);assert.equal(existsSync(published),false,'a report matching only the checkout must not publish');
 const other=promote('zip-build',{sourceCommit:'d'.repeat(40)});assert.notEqual(other.status,0);assert.equal(existsSync(published),false,'a held-out run on another commit must not publish');
 writeFileSync(path.join(dir,'remote-commit'),'e'.repeat(40)+'\n');const moved=promote('zip-build');assert.notEqual(moved.status,0);assert.match(moved.stderr,/GitHub tag/);assert.equal(existsSync(published),false,'a local tag that differs from GitHub must not publish');
 writeFileSync(path.join(dir,'remote-commit'),source+'\n');
 liveRun({head_sha:'d'.repeat(40)});const liveMoved=promote('zip-build');assert.notEqual(liveMoved.status,0);assert.equal(existsSync(published),false,'a live eval on another commit must not publish');
 liveRun({conclusion:'failure'});assert.notEqual(promote('zip-build').status,0);assert.equal(existsSync(published),false,'a failed live eval must not publish');
 liveRun();writeFileSync(path.join(dir,'issues'),'[{"number":7}]');const open=promote('zip-build');assert.notEqual(open.status,0);assert.equal(existsSync(published),false,'an open regression issue must not publish');
 writeFileSync(path.join(dir,'issues'),'[]');
 const tested=promote('zip-build');assert.equal(tested.status,0,tested.stderr);assert.equal(existsSync(published),true);
});
test('the acceptance command refuses a build that is not the one in the ZIP',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-acceptance-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const zip=path.join(dir,'c.zip'),evidence=path.join(dir,'r.json');makeZip(zip,{'build-info.js':"export const BUILD_ID='zip-build';\n",'build-scope.js':'export const BUILD_BANKS=null;\n'});
 const source=taggedRepo(dir);
 writeFileSync(path.join(dir,'gh'),'#!/bin/sh\necho "[]"\n');chmodSync(path.join(dir,'gh'),0o755);
 const check=build=>{const r=fixture();r.artifactSha256=createHash('sha256').update(readFileSync(zip)).digest('hex');r.runtimeBuild=build;Object.assign(r.heldOutEval,{artifactSha256:r.artifactSha256,runtimeBuild:build,sourceCommit:source});r.liveEval.headSha=source;for(const bank of REQUIRED_BANKS)r.banks[bank].runtimeBuild=build;writeFileSync(evidence,JSON.stringify(r));return spawnSync(process.execPath,[path.resolve('scripts/acceptance.mjs'),zip,evidence,build],{cwd:dir,env:{...process.env,PATH:dir+path.delimiter+process.env.PATH},encoding:'utf8'});};
 const old=check('old-build');assert.equal(old.status,1);assert.match(old.stdout,/not the build in this artifact/);
 assert.equal(check('zip-build').status,0);
 const label=JSON.parse(readFileSync('release.json','utf8')).label;execFileSync('git',['tag','-d','v'+label],{cwd:dir,stdio:'ignore'});
 const untagged=check('zip-build');assert.notEqual(untagged.status,0);assert.match(untagged.stderr,/Release tag v.* not found/);
});
test('the gate fails closed unless the frozen held-out assistant eval ran on this candidate',()=>{
 assert.equal(validateAcceptance(fixture(),options).passed,true);
 const refused=[r=>delete r.heldOutEval,r=>r.heldOutEval=null,r=>r.heldOutEval.artifactSha256='b'.repeat(64),r=>r.heldOutEval.runtimeBuild='old',r=>r.heldOutEval.datasetSha256='0'.repeat(64),r=>r.heldOutEval.dataset='wallet-agent-development-v1',r=>r.heldOutEval.ranAt='2020-01-01',r=>delete r.heldOutEval.ranAt,r=>r.heldOutEval.total=HOLDOUT.caseCount-1,r=>{const n=Math.ceil(HOLDOUT.caseCount*HOLDOUT.minPassRate)-1;r.heldOutEval.passed=n;r.heldOutEval.failed=Array.from({length:HOLDOUT.caseCount-n},(_,i)=>'case-'+i);},r=>r.heldOutEval.passed=HOLDOUT.caseCount+1,r=>r.heldOutEval.passed='27',r=>r.heldOutEval.sourceCommit='d'.repeat(40),r=>delete r.heldOutEval.sourceCommit,r=>r.heldOutEval.mode='live',r=>r.heldOutEval.failed=['one-too-many'],r=>delete r.heldOutEval.failed];
 for(const [i,mutate] of refused.entries()){const r=fixture();mutate(r);const result=validateAcceptance(r,options);assert.equal(result.passed,false,String(i));assert.ok(result.errors.some(e=>e.startsWith('held-out assistant eval')),String(i));}
 for(const sourceCommit of [undefined,'','c'.repeat(39),'C'.repeat(40)]){const r=fixture();r.heldOutEval.sourceCommit=sourceCommit;assert.equal(validateAcceptance(r,{...options,sourceCommit}).passed,false,String(sourceCommit));}
 const atRate=fixture(),atRatePassed=Math.ceil(HOLDOUT.caseCount*HOLDOUT.minPassRate);atRate.heldOutEval.passed=atRatePassed;atRate.heldOutEval.failed=Array.from({length:HOLDOUT.caseCount-atRatePassed},(_,i)=>'case-'+i);assert.equal(validateAcceptance(atRate,options).passed,true);
});
test('the gate fails closed unless the live assistant eval succeeded recently on the tagged commit',()=>{
 const day=86400000,old=new Date(Date.now()-8*day).toISOString();
 const refused={'missing evidence':r=>delete r.liveEval,'null evidence':r=>r.liveEval=null,'no run id':r=>delete r.liveEval.runId,'failed run':r=>r.liveEval.conclusion='failure','cancelled run':r=>r.liveEval.conclusion='cancelled','other commit':r=>r.liveEval.headSha='d'.repeat(40),'no commit':r=>delete r.liveEval.headSha,'stale run':r=>r.liveEval.finishedAt=old,'no date':r=>delete r.liveEval.finishedAt,'future run':r=>r.liveEval.finishedAt=new Date(Date.now()+day).toISOString()};
 for(const [why,mutate] of Object.entries(refused)){const r=fixture();mutate(r);const result=validateAcceptance(r,options);assert.equal(result.passed,false,why);assert.ok(result.errors.some(e=>e.startsWith('live assistant eval')),why);}
 for(const openRegressionIssues of [1,undefined,null,'0'])assert.equal(validateAcceptance(fixture(),{...options,openRegressionIssues}).passed,false,'open or unknown regression issues: '+openRegressionIssues);
 const edge=fixture();edge.liveEval.finishedAt=new Date(Date.now()-6*day).toISOString();assert.equal(validateAcceptance(edge,options).passed,true);
});
test('live eval evidence is read from GitHub metadata only, through an injected gh',()=>{
 const calls=[],run={id:42,head_sha:'c'.repeat(40),conclusion:'success',updated_at:'2030-01-01T00:00:00Z',path:'.github/workflows/live-evals.yml',head_branch:'main'};
 const gh=answer=>args=>{calls.push(args);return JSON.stringify(answer(args));};
 assert.deepEqual(findLiveEvalRun('c'.repeat(40),gh(()=>({workflow_runs:[run]}))),{runId:42,headSha:'c'.repeat(40),conclusion:'success',finishedAt:'2030-01-01T00:00:00Z'});
 assert.ok(calls[0][1].includes('live-evals.yml/runs')&&calls[0][1].includes('head_sha='+'c'.repeat(40)),'queries the workflow runs for the commit');
 assert.throws(()=>findLiveEvalRun('c'.repeat(40),gh(()=>({workflow_runs:[]}))),/No successful/);
 assert.equal(openRegressionIssueCount(gh(()=>[{number:3}])),1);assert.equal(openRegressionIssueCount(gh(()=>[])),0);
 const ok={runId:42,headSha:'c'.repeat(40),conclusion:'success',finishedAt:'2030-01-01T00:00:00Z'};
 const both=(r,issues=[])=>gh(a=>a[0]==='api'?r:issues);
 recheckLiveEval(ok,'c'.repeat(40),both(run));
 assert.throws(()=>recheckLiveEval(ok,'d'.repeat(40),both(run)),/GitHub tag/);
 assert.throws(()=>recheckLiveEval(ok,'c'.repeat(40),both({...run,conclusion:'failure'})),/differs/);
 assert.throws(()=>recheckLiveEval(ok,'c'.repeat(40),both({...run,path:'.github/workflows/ci.yml'})),/not the Live/);
 assert.throws(()=>recheckLiveEval(ok,'c'.repeat(40),both(run,[{number:9}])),/regression issue is open/);
});
