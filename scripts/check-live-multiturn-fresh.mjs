#!/usr/bin/env node
// Reports a missed weekly live multi-turn eval (#353). GitHub can drop or delay scheduled runs, and a missing run
// leaves no failure to notice. The daily live-evals job runs this: when the newest live-multiturn run (not skipped)
// is older than --max-days (default 8), it opens or updates one issue labelled live-multiturn-stale, and it closes
// that issue once a fresh run exists. No model, no key, no spend. --dry-run prints the decision and changes nothing.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const DAY=86400000, WORKFLOW='live-multiturn.yml', LABEL='live-multiturn-stale';

// Pure decision. runs: [{created_at, conclusion}] newest first; workflowCreatedAt: when the workflow file appeared.
export function freshness({runs=[],workflowCreatedAt,now=Date.now(),maxDays=8}){
 const last=runs.find(r=>r&&r.conclusion!=='skipped'&&r.created_at);
 const since=last?Date.parse(last.created_at):Date.parse(workflowCreatedAt);
 if(!Number.isFinite(since))return {stale:false,reason:'unknown'};
 const days=(now-since)/DAY;
 return {stale:days>maxDays,days:Math.floor(days*10)/10,lastRun:last?last.created_at:null,reason:last?'last-run':'never-ran'};
}

export function issueBody(f,maxDays,repo){
 const since=f.lastRun?'The newest run was at '+f.lastRun+' ('+f.days+' days ago).':'The workflow has never run since it was added ('+f.days+' days ago).';
 return ['The weekly live multi-turn eval (`'+WORKFLOW+'`, cron `17 10 * * 1`) has no run in the last '+maxDays+' days. '+since,
  '','Possible causes: GitHub dropped or delayed the scheduled run, `LIVE_EVALS_ENABLED` is not `true`, or the workflow was disabled after 60 days without repository activity.',
  '','Owner/ops step: check https://github.com/'+repo+'/actions/workflows/'+WORKFLOW+' and, if needed, start one manual `workflow_dispatch` (costs up to 0.50 USD). This issue closes itself on the next daily check after a run appears.'].join('\n');
}

const gh=(args)=>execFileSync('gh',args,{encoding:'utf8'});

export function check({repo,maxDays=8,dryRun=false,now=Date.now(),run=gh,log=console.log}){
 const wf=JSON.parse(run(['api','repos/'+repo+'/actions/workflows/'+WORKFLOW]));
 const runs=JSON.parse(run(['api','repos/'+repo+'/actions/workflows/'+WORKFLOW+'/runs?per_page=10'])).workflow_runs||[];
 const f=freshness({runs,workflowCreatedAt:wf.created_at,now,maxDays});
 const open=JSON.parse(run(['issue','list','--repo',repo,'--state','open','--label',LABEL,'--limit','1','--json','number'])||'[]')[0];
 log('live-multiturn: '+(f.stale?'STALE':'fresh')+' ('+f.reason+', '+f.days+' days)'+(dryRun?' [dry run]':''));
 if(dryRun)return {...f,action:f.stale?(open?'comment':'create'):(open?'close':'none')};
 if(f.stale){
  const body=issueBody(f,maxDays,repo);
  if(open)run(['issue','comment',String(open.number),'--repo',repo,'--body',body]);
  else{
   run(['label','create',LABEL,'--repo',repo,'--color','B60205','--description','The weekly live multi-turn eval has not run','--force']);
   run(['issue','create','--repo',repo,'--title','Weekly live multi-turn eval has not run in '+maxDays+' days','--label',LABEL,'--label','ai','--body',body]);
  }
  return {...f,action:open?'comment':'create'};
 }
 if(open)run(['issue','close',String(open.number),'--repo',repo,'--reason','completed','--comment','A live multi-turn run appeared at '+f.lastRun+'.']);
 return {...f,action:open?'close':'none'};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const arg=n=>(process.argv.find(a=>a.startsWith('--'+n+'='))||'').split('=')[1];
 const repo=arg('repo')||process.env.REPO;
 if(!repo){console.error('need --repo=owner/name or REPO');process.exit(2);}
 check({repo,maxDays:Number(arg('max-days')||8),dryRun:process.argv.includes('--dry-run')});
}
