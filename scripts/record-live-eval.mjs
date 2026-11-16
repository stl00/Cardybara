// Records the live assistant eval run for the release tag's commit in the private acceptance report (#302).
// Reads only GitHub run metadata: no key, no model call. If no run exists, trigger the workflow by hand on main at the tag's commit.
import {readFileSync,writeFileSync} from 'node:fs';
import {candidateSourceCommit} from './acceptance.mjs';
import {findLiveEvalRun,fetchLiveEvalRun} from './live-eval-evidence.mjs';
const [reportPath,runId]=process.argv.slice(2);
if(!reportPath){console.error('Usage: node scripts/record-live-eval.mjs PRIVATE-REPORT.json [RUN-ID]');process.exit(1);}
try{
 const commit=candidateSourceCommit(),report=JSON.parse(readFileSync(reportPath,'utf8'));
 report.liveEval=runId?fetchLiveEvalRun(runId):findLiveEvalRun(commit);
 writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.liveEval));
 if(report.liveEval.headSha!==commit||report.liveEval.conclusion!=='success'){console.error('Recorded, but this run will not pass acceptance: it must succeed on the tag commit.');process.exitCode=1;}
}catch(error){console.error(error.message);process.exit(1);}
