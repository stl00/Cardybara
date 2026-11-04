// Dev build only. Pure scheduling and report rules, so they can be tested without a browser.
export const SETTINGS_KEY='cardybara-dev-schedule';
export const MIN_INTERVAL_MINUTES=60,CHECK_MINUTES=15,IDLE_SECONDS=120;
export const INTERVALS=[60,180,360,720,1440];
const OK=['updated','partial'],FIELD_KEYS=['balance','available','statement','statementClosing','minimum','creditLimit','due','duePartial','paymentStatus','autopay'];
export const defaultSettings=()=>({enabled:false,intervalMinutes:360,banks:{}});
export const normalizeInterval=value=>INTERVALS.includes(value)?value:Math.max(MIN_INTERVAL_MINUTES,360);
// Turning the schedule on again is the owner's decision to try stopped banks once more.
export function setEnabled(settings,enabled,intervalMinutes=settings.intervalMinutes){return {...settings,enabled:enabled===true,intervalMinutes:normalizeInterval(intervalMinutes),banks:enabled===true&&!settings.enabled?{}:settings.banks};}
// A successful read carries on. An expired login waits for the owner's own signed-in tab. Anything else stops the bank.
export function classifyJob(job){
 if(OK.includes(job.status))return {state:'ok',reason:job.status};
 if(job.status==='needs_login')return {state:'login_expired',reason:'needs_login'};
 return {state:'stopped',reason:/^[a-z_]{1,40}$/.test(job.status||'')?job.status:'unknown'};
}
export function afterRun(settings,run,now){const banks={...settings.banks};for(const job of run.jobs)banks[job.bank]={...banks[job.bank],...classifyJob(job),finishedAt:now};return {...settings,banks};}
// A bank is opened only if it read fine last time. Otherwise the owner's own signed-in tab must exist, so a login page is never hit again and again.
export function planBanks({settings,activeBanks,disabled=[],withCards,signedIn,inUse=[],now}){
 if(!settings.enabled)return [];const interval=normalizeInterval(settings.intervalMinutes)*60000;let amex=false;
 return activeBanks.filter(bank=>{
  const seen=settings.banks[bank];if(disabled.includes(bank)||inUse.includes(bank)||seen?.state==='stopped')return false;
  if(seen?.lastAttemptAt&&now-seen.lastAttemptAt<interval)return false;
  if(!(signedIn.includes(bank)||withCards.includes(bank)&&seen?.state==='ok'))return false;
  // Amex regions share a login domain, and their sessions replace each other.
  if(bank.startsWith('Amex ')){if(amex)return false;amex=true;}
  return true;
 });
}
export function markAttempted(settings,banks,now){const next={...settings.banks};for(const bank of banks)next[bank]={...next[bank],lastAttemptAt:now};return {...settings,banks:next};}
// Fails closed: every string loses its digits, so amounts and tails cannot pass even if a label slipped through.
function scrub(value){
 if(typeof value==='string')return value.replace(/\p{N}+/gu,'#').slice(0,200);
 if(Array.isArray(value))return value.slice(0,1500).map(scrub);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[scrub(k),scrub(v)]));
 return Number.isFinite(value)||typeof value==='boolean'||value===null?value:null;
}
const word=v=>typeof v==='string'&&/^[a-z_]{1,40}$/.test(v)?v:undefined;
export function jobReport(job,state,page=null){
 const ids=new Set((job.cards||[]).map(c=>c.id)),counts={},note=key=>{if(FIELD_KEYS.includes(key))counts[key]=(counts[key]||0)+1;};
 for(const [id,fields]of Object.entries(state.records?.[job.bank]||{}))if(ids.has(id))for(const key of Object.keys(fields))note(key);
 for(const item of state.agentRecords||[])if(item.bank===job.bank&&ids.has(item.cardId)&&['card','billing'].includes(item.kind))note(item.key);
 return {bank:job.bank,status:word(job.status)||'unknown',step:word(job.diagnostic?.stage)||null,code:word(job.diagnostic?.code)||word(job.readError)||null,phase:word(job.phase)||null,cards:ids.size,read:Number.isFinite(job.received)?job.received:0,rejected:Number.isFinite(job.rejected)?job.rejected:0,rejectReasons:Object.keys(job.rejectReasons||{}).map(word).filter(Boolean),sections:Object.fromEntries(Object.entries(job.sections||{}).map(([k,v])=>[word(k)||'other',word(v?.status)||'unknown'])),fields:counts,page};
}
export function buildReport({run,state,pages={},build,now}){return scrub({schema:1,at:now,build,run:word(run.status)||'unknown',banks:run.jobs.map(job=>jobReport(job,state,pages[job.bank]||null))});}
// The local server applies the same limit, so a report with a digit in any string is refused rather than stored.
export function validReport(report){
 if(!report||typeof report!=='object'||report.schema!==1||!Array.isArray(report.banks)||report.banks.length>7||JSON.stringify(report).length>2000000)return false;
 const clean=value=>typeof value==='string'?!/\p{N}/u.test(value):Array.isArray(value)?value.every(clean):value&&typeof value==='object'?Object.entries(value).every(([k,v])=>clean(k)&&clean(v)):true;
 return clean(report);
}
