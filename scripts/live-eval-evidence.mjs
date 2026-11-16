// Reads GitHub Actions metadata for the daily `Live assistant eval` workflow (#302). It never calls a model and needs no key:
// only run and issue metadata, through the gh CLI. `gh` is injectable so tests never reach the network.
import {execFileSync} from 'node:child_process';
export const LIVE_REPO='stl00/Cardybara',LIVE_WORKFLOW='live-evals.yml',LIVE_WORKFLOW_PATH='.github/workflows/live-evals.yml',REGRESSION_LABEL='live-eval-regression';
export const ghCli=args=>execFileSync('gh',args,{encoding:'utf8'});
const json=(gh,args)=>JSON.parse(gh(args));
// The fields acceptance records: the run, the commit it ran on, how it ended and when.
export function summariseRun(run){
 if(!run||typeof run!=='object')throw Error('Live eval run not found');
 return {runId:run.id,headSha:run.head_sha,conclusion:run.conclusion,finishedAt:run.updated_at};
}
// Latest successful run of the live eval workflow on `main` at exactly this commit.
export function findLiveEvalRun(commit,gh=ghCli,repo=LIVE_REPO){
 const data=json(gh,['api',`repos/${repo}/actions/workflows/${LIVE_WORKFLOW}/runs?branch=main&status=success&head_sha=${commit}&per_page=1`]);
 const run=(data.workflow_runs||[])[0];
 if(!run)throw Error(`No successful ${LIVE_WORKFLOW} run on main for commit ${commit}. Trigger the "Live assistant eval" workflow by hand on main at that commit.`);
 return summariseRun(run);
}
// The run as GitHub reports it now, so a hand-edited report cannot vouch for itself.
export function fetchLiveEvalRun(runId,gh=ghCli,repo=LIVE_REPO){
 const run=json(gh,['api',`repos/${repo}/actions/runs/${encodeURIComponent(runId)}`]);
 if(run.path!==LIVE_WORKFLOW_PATH||run.head_branch!=='main')throw Error('Run is not the Live assistant eval workflow on main');
 return summariseRun(run);
}
export function openRegressionIssueCount(gh=ghCli,repo=LIVE_REPO){
 return json(gh,['issue','list','--repo',repo,'--state','open','--label',REGRESSION_LABEL,'--limit','100','--json','number']).length;
}
// Throws unless the recorded run is still what GitHub says and no regression issue is open.
export function recheckLiveEval(liveEval,sourceCommit,gh=ghCli){
 const now=fetchLiveEvalRun(liveEval?.runId,gh);
 for(const key of ['headSha','conclusion','finishedAt'])if(now[key]!==liveEval[key])throw Error(`Live eval ${key} in the report differs from GitHub`);
 if(now.conclusion!=='success'||now.headSha!==sourceCommit)throw Error('Live eval did not succeed on the commit the GitHub tag points at');
 if(openRegressionIssueCount(gh)!==0)throw Error('A live-eval-regression issue is open');
}
