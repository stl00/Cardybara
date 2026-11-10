import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {holdoutManifest,holdoutSha256,holdoutCaseIds} from '../evals/holdout/run.mjs';
import * as dev from '../evals/fixtures.mjs';
import * as held from '../evals/holdout/cases.mjs';
import {validateAcceptance} from '../scripts/acceptance.mjs';
import {BUILD_ID} from '../extension-next/build-info.js';
test('the held-out cases are frozen: any edit must update the manifest on purpose',()=>{
 assert.equal(holdoutSha256(),holdoutManifest.sha256,'evals/holdout/cases.mjs changed without updating evals/holdout/manifest.json');
 assert.equal(holdoutCaseIds().length,holdoutManifest.caseCount);
 assert.ok(holdoutManifest.minPassRate>0&&holdoutManifest.minPassRate<=1);
});
test('held-out cases do not overlap the development set',()=>{
 const ids=holdoutCaseIds();assert.equal(new Set(ids).size,ids.length,'duplicate held-out id');
 const devIds=new Set([...dev.retrievalCases,...dev.decisionCases,...dev.planCases,...dev.publicRuleCases,...dev.liveCases].map(c=>c.id).concat(dev.planGroundingCases.map(c=>c[0])));
 for(const id of ids)assert.ok(!devIds.has(id),id);
 const devQueries=new Set([...dev.retrievalCases.map(c=>c.query),...dev.liveCases.map(c=>c.question)]);
 for(const c of held.retrievalCases)assert.ok(!devQueries.has(c.query),c.query);
 for(const id of holdoutManifest.retired)assert.ok(!ids.includes(id),'a retired case is still held out: '+id);
});
function makeZip(file,build){execFileSync('python3',['-c',"import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:z.writestr('build-info.js',\"export const BUILD_ID='\"+sys.argv[2]+\"';\\n\")",file,build]);}
test('the held-out run needs a candidate built from this checkout and records itself in the private report',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cardybara-holdout-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const zip=path.join(dir,'c.zip'),report=path.join(dir,'r.json'),run=()=>spawnSync(process.execPath,['scripts/eval-holdout.mjs',zip,report],{encoding:'utf8'});
 assert.notEqual(spawnSync(process.execPath,['scripts/eval-holdout.mjs'],{encoding:'utf8'}).status,0,'no candidate, no run');
 const blank=path.join(dir,'blank.zip');writeFileSync(blank,'synthetic');execFileSync(process.execPath,['scripts/new-acceptance.mjs',blank,report]);
 makeZip(zip,'another-build');const other=run();assert.equal(other.status,1);assert.match(other.stderr,/not the build in the candidate/);
 assert.equal(JSON.parse(readFileSync(report,'utf8')).heldOutEval,null,'nothing recorded for a mismatched build');
 makeZip(zip,BUILD_ID);run();
 const h=JSON.parse(readFileSync(report,'utf8')).heldOutEval;
 assert.equal(h.runtimeBuild,BUILD_ID);assert.equal(h.datasetSha256,holdoutManifest.sha256);assert.equal(h.total,holdoutManifest.caseCount);
 assert.ok(Number.isInteger(h.passed)&&Array.isArray(h.failed)&&h.failed.length===h.total-h.passed);
 const errors=validateAcceptance(JSON.parse(readFileSync(report,'utf8')),{sha256:h.artifactSha256,runtimeBuild:BUILD_ID}).errors;
 for(const why of ['held-out assistant eval: not run on the frozen dataset','held-out assistant eval: not run on this candidate','held-out assistant eval: run date missing or stale'])assert.ok(!errors.includes(why),why);
});
