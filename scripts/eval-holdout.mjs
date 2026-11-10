// Runs the frozen held-out assistant eval for one release candidate and records the result in its private acceptance report.
// It runs only on a clean checkout of the candidate's release tag, so it is not a development loop: tuning against these cases would void them.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {artifactBuildId,candidateSourceCommit} from './acceptance.mjs';
import {BUILD_ID} from '../extension-next/build-info.js';
import {runHoldout,holdoutManifest,holdoutSha256} from '../evals/holdout/run.mjs';
const fail=why=>{console.error(why);process.exit(1);};
const [zip,reportPath]=process.argv.slice(2);
if(!zip||!reportPath)fail('Usage: node scripts/eval-holdout.mjs CANDIDATE.zip PRIVATE-REPORT.json');
const root=fileURLToPath(new URL('..',import.meta.url)),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
// The eval runs this checkout's source, so it must be exactly the source the candidate was built from.
// Untracked files are ignored, so a report or ZIP kept in the checkout does not block the run; a change to tracked code does.
if(git('status','--porcelain','--untracked-files=no'))fail('The checkout has uncommitted changes. Run on a clean checkout of the release tag.');
const head=git('rev-parse','HEAD');let tagged;
try{tagged=candidateSourceCommit(root);}catch(error){fail(error.message);}
if(head!==tagged)fail('This checkout is not the commit the release tag points at. Check out the release tag.');
const bytes=readFileSync(zip);
if(artifactBuildId(bytes)!==BUILD_ID)fail('This checkout is not the build in the candidate.');
if(holdoutSha256()!==holdoutManifest.sha256)fail('evals/holdout does not match its frozen manifest.');
const report=JSON.parse(readFileSync(reportPath,'utf8')),result=runHoldout();
report.heldOutEval={dataset:result.dataset,datasetSha256:result.datasetSha256,mode:result.mode,artifactSha256:createHash('sha256').update(bytes).digest('hex'),runtimeBuild:BUILD_ID,sourceCommit:head,ranAt:new Date().toISOString(),passed:result.passed,total:result.total,failed:result.cases.filter(c=>!c.passed).map(c=>c.id)};
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({dataset:result.dataset,passed:result.passed,total:result.total,minPassRate:holdoutManifest.minPassRate}));
if(result.passed/result.total<holdoutManifest.minPassRate)process.exitCode=1;
