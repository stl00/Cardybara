import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {holdoutManifest,holdoutSha256,holdoutCaseIds} from '../evals/holdout/run.mjs';
import * as dev from '../evals/fixtures.mjs';
import * as held from '../evals/holdout/cases.mjs';
import {validateAcceptance} from '../scripts/acceptance.mjs';
import {BUILD_ID} from '../extension-next/build-info.js';
const devIds=new Set([...dev.retrievalCases,...dev.decisionCases,...dev.planCases,...dev.publicRuleCases,...dev.liveCases,...dev.tripCases].map(c=>c.id).concat(dev.planGroundingCases.map(c=>c[0]),dev.actionClaimCases.map(c=>c[0]),dev.actionClaimControls.map(c=>c[0])));
test('the held-out cases, their wallet and checks are frozen: any edit must update the manifest on purpose',()=>{
 assert.equal(holdoutSha256(),holdoutManifest.sha256,'evals/holdout changed without updating evals/holdout/manifest.json');
 assert.equal(holdoutCaseIds().length,holdoutManifest.caseCount);
 assert.ok(holdoutManifest.minPassRate>0&&holdoutManifest.minPassRate<=1);
});
test('held-out cases do not overlap the development set, and retired ones moved into it',()=>{
 const ids=holdoutCaseIds();assert.equal(new Set(ids).size,ids.length,'duplicate held-out id');
 for(const id of ids)assert.ok(!devIds.has(id),id);
 const devQueries=new Set([...dev.retrievalCases.map(c=>c.query),...dev.liveCases.map(c=>c.question)]);
 for(const c of held.retrievalCases)assert.ok(!devQueries.has(c.query),c.query);
 for(const id of holdoutManifest.retired){assert.ok(!ids.includes(id),'a retired case is still held out: '+id);assert.ok(devIds.has(id),'a retired case was not moved to evals/fixtures.mjs: '+id);}
});
function makeZip(file,build){execFileSync('python3',['-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('build-info.js',\"export const BUILD_ID='\"+sys.argv[2]+\"';\\n\")",file,build]);}
test('the held-out run needs a clean checkout of the release tag and the frozen set, and records itself in the private report',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-holdout-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 // A copy of the code the eval reads, in its own repository, so the tag and working tree can be changed safely.
 const repo=path.join(dir,'repo');for(const p of ['src','evals','extension-next','scripts','release.json','package.json'])cpSync(p,path.join(repo,p),{recursive:true});
 symlinkSync(path.resolve('node_modules'),path.join(repo,'node_modules'));writeFileSync(path.join(repo,'.gitignore'),'node_modules\n');
 const git=(...a)=>execFileSync('git',['-c','user.name=test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-c','tag.gpgsign=false',...a],{cwd:repo,encoding:'utf8'}).trim(),tag='v'+JSON.parse(readFileSync('release.json','utf8')).label;
 git('init','-q');git('add','-A');git('commit','-q','-m','candidate');git('tag',tag);
 const zip=path.join(dir,'c.zip'),blank=path.join(dir,'blank.zip'),report=path.join(dir,'r.json'),run=()=>spawnSync(process.execPath,['scripts/eval-holdout.mjs',zip,report],{cwd:repo,encoding:'utf8'});
 const recorded=()=>JSON.parse(readFileSync(report,'utf8')).heldOutEval;
 writeFileSync(blank,'synthetic');execFileSync(process.execPath,['scripts/new-acceptance.mjs',blank,report]);
 assert.notEqual(spawnSync(process.execPath,['scripts/eval-holdout.mjs'],{cwd:repo,encoding:'utf8'}).status,0,'no candidate, no run');
 makeZip(zip,'another-build');let r=run();assert.equal(r.status,1);assert.match(r.stderr,/not the build in the candidate/);
 makeZip(zip,BUILD_ID);
 appendFileSync(path.join(repo,'src/answerGrounding.js'),'\n');r=run();assert.equal(r.status,1);assert.match(r.stderr,/uncommitted changes/);
 git('commit','-qam','after the tag');r=run();assert.equal(r.status,1);assert.match(r.stderr,/not the commit the release tag points at/);
 appendFileSync(path.join(repo,'evals/holdout/cases.mjs'),'\n');git('commit','-qam','edit held-out');git('tag','-f',tag);r=run();assert.equal(r.status,1);assert.match(r.stderr,/does not match its frozen manifest/);
 assert.equal(recorded(),null,'nothing recorded by a refused run');
 git('reset','-q','--hard',tag+'~2');git('tag','-f',tag);run();
 const h=recorded();
 assert.equal(h.runtimeBuild,BUILD_ID);assert.equal(h.sourceCommit,git('rev-parse','HEAD'));assert.equal(h.datasetSha256,holdoutManifest.sha256);assert.equal(h.total,holdoutManifest.caseCount);
 assert.ok(Number.isInteger(h.passed)&&Array.isArray(h.failed)&&h.failed.length===h.total-h.passed);
 const errors=validateAcceptance(JSON.parse(readFileSync(report,'utf8')),{sha256:h.artifactSha256,runtimeBuild:BUILD_ID,sourceCommit:h.sourceCommit}).errors;
 for(const why of ['held-out assistant eval: not run on the frozen dataset','held-out assistant eval: not run on this candidate','held-out assistant eval: not run on the candidate source','held-out assistant eval: run date missing or stale'])assert.ok(!errors.includes(why),why);
});
