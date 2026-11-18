// Hourly alert check (stl00/Cardybara#259), run by the Worker's `scheduled` handler (a Cron Trigger on this same
// Worker, not a second one: it needs the UsageLedger and KV bindings, which a second Worker could reach only through
// cross-script Durable Object bindings, and it shares the version id it reports).
//
// It reads the last hours of the metrics dataset through the Analytics Engine SQL API, the month-to-date spend from the
// UsageLedger, and compares them with thresholds (defaults below, overridable in KV `settings.alerts`). A breach opens
// one GitHub issue per signal (labels agent-incident and P1) or comments on the open one; the next healthy check
// comments and closes it. Issue bodies hold aggregates only: never a client id, a question or a per-turn number.
// docs/GATEWAY.md ("Alerts and switches") describes the signals and the flow.
import {readConfig,withSettings,callLedger,SETTINGS_KEY} from './gateway.js';

export const DEFAULT_THRESHOLDS={
 // Month-to-date spend as a percentage of the monthly budget.
 budgetPercent:80,
 // Error rate over the last hour, as a percentage, with at least minTurns turns in that hour.
 errorPercent:5,
 // Repair or fallback rate of the last hour, as a multiple of its mean over the 7 days before, with at least minTurns
 // turns; minRatePercent keeps a mean of zero from turning one repair into an incident.
 rateMultiple:2,
 minRatePercent:5,
 minTurns:20,
 // Silence: the last 3 hours had no turns while the 7 days before averaged at least this many turns per hour.
 minHourlyTurns:5,
};
export const SIGNALS=['budget','errors','repair','fallback','silence'];
export const LABELS=['agent-incident','P1'];
export const DOCS_URL='https://github.com/stl00/Cardybara/blob/main/docs/GATEWAY.md#alerts-and-switches';
const TITLE='Assistant alert: ';
const MEANING={budget:'monthly budget used',errors:'error rate, last hour',repair:'repair rate vs 7-day mean',fallback:'fallback rate vs 7-day mean',silence:'no turns recorded, last 3 hours'};

/** Defaults with each valid number of settings.alerts applied; an invalid one is ignored and named in `invalid`. */
export function readThresholds(settings){
 const t={...DEFAULT_THRESHOLDS},invalid=[],given=settings&&typeof settings==='object'&&settings.alerts&&typeof settings.alerts==='object'&&!Array.isArray(settings.alerts)?settings.alerts:{};
 for(const key of Object.keys(DEFAULT_THRESHOLDS)){
  if(!(key in given))continue;
  const v=given[key],max=key==='minTurns'||key==='minHourlyTurns'?100000:100;
  if(typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=max&&(key!=='minTurns'||Number.isInteger(v)))t[key]=v;else invalid.push(key);
 }
 return {thresholds:t,invalid};
}

// --- Metrics queries. _sample_interval corrects for Analytics Engine sampling, as in the docs' example queries.
// A turn is an agent request that ended: an answer was sent (double12) or an error code was set (blob6); a request
// that only asked the extension for wallet tools (double11) is part of a turn that is still running.
const TURN="blob1 = 'agent' AND double11 = 0 AND (double12 = 1 OR blob6 != '')";
export const HOUR_SQL=`SELECT SUM(_sample_interval) AS turns, SUM(_sample_interval * IF(blob6 != '', 1, 0)) AS errors, SUM(_sample_interval * double8) AS repaired, SUM(_sample_interval * double9) AS fallbacks FROM cardybara_agent_metrics WHERE ${TURN} AND timestamp > NOW() - INTERVAL '1' HOUR FORMAT JSON`;
export const WEEK_SQL=`SELECT SUM(_sample_interval) AS turns, SUM(_sample_interval * double8) AS repaired, SUM(_sample_interval * double9) AS fallbacks FROM cardybara_agent_metrics WHERE ${TURN} AND timestamp > NOW() - INTERVAL '169' HOUR AND timestamp <= NOW() - INTERVAL '1' HOUR FORMAT JSON`;
export const SILENCE_SQL=`SELECT SUM(_sample_interval) AS turns FROM cardybara_agent_metrics WHERE ${TURN} AND timestamp > NOW() - INTERVAL '3' HOUR FORMAT JSON`;

async function sql(env,fetch,query){
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/analytics_engine/sql`,{method:'POST',headers:{Authorization:'Bearer '+env.ANALYTICS_SQL_TOKEN},body:query});
 if(!r.ok){await r.body?.cancel().catch(()=>{});throw Error('sql_failed');}
 const row=(await r.json())?.data?.[0]||{};
 const n=v=>{const x=Number(v);return Number.isFinite(x)&&x>=0?x:0;};
 return {turns:n(row.turns),errors:n(row.errors),repaired:n(row.repaired),fallbacks:n(row.fallbacks)};
}

/**
 * Turns the numbers into one verdict per signal: {signal, state:'breach'|'ok'|'unknown', figures}. `unknown` (too few
 * turns, or the source could not be read) neither opens nor closes an incident. hour/week are query results or null,
 * spend is {micros,budgetMicros} or null.
 */
export function evaluate({hour,week,spend,recent},t=DEFAULT_THRESHOLDS){
 const out=[];
 if(spend&&spend.budgetMicros>0){
  const pct=100*spend.micros/spend.budgetMicros;
  out.push({signal:'budget',state:pct>=t.budgetPercent?'breach':'ok',figures:{usedPercent:round(pct),thresholdPercent:t.budgetPercent}});
 }else out.push({signal:'budget',state:'unknown',figures:{}});
 out.push(silence(recent,week,t));
 const enough=hour&&hour.turns>=t.minTurns;
 if(!enough){for(const s of ['errors','repair','fallback'])out.push({signal:s,state:'unknown',figures:{turnsLastHour:hour?hour.turns:null,minTurns:t.minTurns}});return out;}
 const errPct=100*hour.errors/hour.turns;
 out.push({signal:'errors',state:errPct>=t.errorPercent?'breach':'ok',figures:{errorPercent:round(errPct),thresholdPercent:t.errorPercent,turnsLastHour:hour.turns}});
 for(const [signal,key] of [['repair','repaired'],['fallback','fallbacks']]){
  const rate=100*hour[key]/hour.turns,mean=week&&week.turns>0?100*week[key]/week.turns:null;
  if(mean==null){out.push({signal,state:'unknown',figures:{turnsLastHour:hour.turns}});continue;}
  const breach=rate>=t.minRatePercent&&rate>=t.rateMultiple*mean;
  out.push({signal,state:breach?'breach':'ok',figures:{ratePercent:round(rate),weekMeanPercent:round(mean),multiple:t.rateMultiple,turnsLastHour:hour.turns,turnsPriorWeek:week.turns}});
 }
 return out;
}
// recent: turns in the last 3 hours; week: the 7 days before the last hour (168 hours), so its hourly mean is turns/168.
function silence(recent,week,t){
 if(!recent)return {signal:'silence',state:'unknown',figures:{}};
 if(recent.turns>0)return {signal:'silence',state:'ok',figures:{turnsLast3Hours:recent.turns}};
 const mean=week?week.turns/168:null;
 if(mean==null||mean<t.minHourlyTurns)return {signal:'silence',state:'unknown',figures:{turnsLast3Hours:0,priorWeekHourlyMean:mean==null?null:round(mean),minHourlyTurns:t.minHourlyTurns}};
 return {signal:'silence',state:'breach',figures:{turnsLast3Hours:0,priorWeekHourlyMean:round(mean),minHourlyTurns:t.minHourlyTurns}};
}
const round=v=>Math.round(v*100)/100;

// --- GitHub. Fine-grained token, issues write on this repository only (GITHUB_TOKEN, a Worker secret).
function github(env,fetch){
 const repo=/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO||'')?env.GITHUB_REPO:'stl00/Cardybara';
 const call=async(path,init={})=>{
  const r=await fetch('https://api.github.com/repos/'+repo+path,{...init,headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'cardybara-gateway-alerts',...(init.body?{'Content-Type':'application/json'}:{})}});
  if(!r.ok){await r.body?.cancel().catch(()=>{});throw Error('github_'+r.status);}
  return r.json();
 };
 return {
  open:()=>call('/issues?state=open&labels='+LABELS[0]+'&per_page=100'),
  create:(title,body)=>call('/issues',{method:'POST',body:JSON.stringify({title,body,labels:LABELS})}),
  comment:(number,body)=>call(`/issues/${number}/comments`,{method:'POST',body:JSON.stringify({body})}),
  close:number=>call('/issues/'+number,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})}),
 };
}

const figures=f=>Object.entries(f).map(([k,v])=>`- ${k}: ${v}`).join('\n');
export function incidentBody(result,version,at){
 return `Signal: ${MEANING[result.signal]}\nChecked: ${at}\nWorker version: ${version||'unknown'}\n\n${figures(result.figures)}\n\nAggregates only. What the signal means and how to act: ${DOCS_URL}`;
}
const titleOf=signal=>TITLE+signal;

/**
 * Applies the verdicts to GitHub: a breach opens an incident for its signal or comments on the open one; an `ok` on a
 * signal with an open incident comments and closes it. Returns what it did, as names only.
 */
export async function applyIncidents(results,{gh,version,at}){
 const open=await gh.open(),done=[];
 for(const r of results){
  const existing=open.find(i=>!i.pull_request&&i.title===titleOf(r.signal));
  if(r.state==='breach'){
   if(existing){await gh.comment(existing.number,'Still breached.\n\n'+incidentBody(r,version,at));done.push(r.signal+':commented');}
   else{await gh.create(titleOf(r.signal),incidentBody(r,version,at));done.push(r.signal+':opened');}
  }else if(r.state==='ok'&&existing){
   await gh.comment(existing.number,'Healthy again.\n\n'+incidentBody(r,version,at));await gh.close(existing.number);done.push(r.signal+':closed');
  }
 }
 return done;
}

/** The scheduled handler's work. deps: {fetch, now, log}. Never throws; a source that fails leaves its signals unknown. */
export async function runAlerts(env,{fetch=(...a)=>globalThis.fetch(...a),now=Date.now,log=l=>console.log(l)}={}){
 const say=o=>log(JSON.stringify({alerts:o}));
 try{
  if(!env.GITHUB_TOKEN){say('github_token_missing');return {skipped:'github_token_missing'};}
  const base=readConfig(env);
  let settings=null;try{settings=await env.INVITES.get(SETTINGS_KEY,{type:'json'});}catch{}
  const {thresholds,invalid}=readThresholds(settings);
  for(const key of invalid)say({ignored:'alerts.'+key});
  const config=await withSettings(base,env);
  let spend=null,hour=null,week=null,recent=null;
  try{
   const month=new Date(now()).toISOString().slice(0,7);
   const {micros}=await callLedger(env,'month',{month});
   if(Number.isFinite(micros)&&config.monthlyBudgetMicros>0)spend={micros,budgetMicros:config.monthlyBudgetMicros};
  }catch{say('ledger_unreadable');}
  if(env.ANALYTICS_SQL_TOKEN&&env.CF_ACCOUNT_ID){
   try{[hour,week,recent]=await Promise.all([sql(env,fetch,HOUR_SQL),sql(env,fetch,WEEK_SQL),sql(env,fetch,SILENCE_SQL)]);}catch{say('metrics_unreadable');hour=week=recent=null;}
  }else say('sql_token_missing');
  const results=evaluate({hour,week,spend,recent},thresholds);
  const done=await applyIncidents(results,{gh:github(env,fetch),version:env.CF_VERSION_METADATA?.id,at:new Date(now()).toISOString()});
  say({states:Object.fromEntries(results.map(r=>[r.signal,r.state])),done});
  return {results,done};
 }catch(e){say({failed:String(e?.message||'error').slice(0,40)});return {failed:true};}
}
