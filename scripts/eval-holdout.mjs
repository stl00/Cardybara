// Runs the frozen held-out assistant eval for one release candidate and records the result in its private acceptance report.
// It refuses to run without a candidate, so it is not a development loop: tuning against these cases would void them.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifactBuildId} from './acceptance.mjs';
import {BUILD_ID} from '../extension-next/build-info.js';
import {runHoldout,holdoutManifest,holdoutSha256} from '../evals/holdout/run.mjs';
const [zip,reportPath]=process.argv.slice(2);
if(!zip||!reportPath){console.error('Usage: node scripts/eval-holdout.mjs CANDIDATE.zip PRIVATE-REPORT.json');process.exit(1);}
const bytes=readFileSync(zip);
// The eval runs this checkout's source, so the checkout must be the build inside the candidate.
if(artifactBuildId(bytes)!==BUILD_ID){console.error('This checkout is not the build in the candidate. Check out the commit the candidate was built from.');process.exit(1);}
if(holdoutSha256()!==holdoutManifest.sha256){console.error('evals/holdout/cases.mjs does not match its frozen manifest.');process.exit(1);}
const report=JSON.parse(readFileSync(reportPath,'utf8')),result=runHoldout();
report.heldOutEval={dataset:result.dataset,datasetSha256:result.datasetSha256,mode:result.mode,artifactSha256:createHash('sha256').update(bytes).digest('hex'),runtimeBuild:BUILD_ID,ranAt:new Date().toISOString(),passed:result.passed,total:result.total,failed:result.cases.filter(c=>!c.passed).map(c=>c.id)};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({dataset:result.dataset,passed:result.passed,total:result.total,minPassRate:holdoutManifest.minPassRate}));
if(result.passed/result.total<holdoutManifest.minPassRate)process.exitCode=1;
