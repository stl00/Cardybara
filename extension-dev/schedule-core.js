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
 // A login or challenge can appear mid-run, after something was read, so the read's own error decides first.
 if(job.status==='needs_login'||job.readError==='needs_login')return {state:'login_expired',reason:'needs_login'};
 if(job.readError)return {state:'stopped',reason:/^[a-z_]{1,40}$/.test(job.readError)?job.readError:'unknown'};
 if(OK.includes(job.status))return {state:'ok',reason:job.status};
 return {state:'stopped',reason:/^[a-z_]{1,40}$/.test(job.status||'')?job.status:'unknown'};
}
export function afterRun(settings,run,now){const banks={...settings.banks};for(const job of run.jobs)banks[job.bank]={...banks[job.bank],...classifyJob(job),finishedAt:now};return {...settings,banks};}
// Why each bank will or won't be read at a check, so a check that starts nothing still says why.
export const SKIP_REASONS=['off','disconnected','stopped','not_due','no_tab','signed_out','other_region','no_cards_found','check_failed','amex_turn','not_idle','ready'];
const TAB_REASON={none:'no_tab',needs_login:'signed_out',ambiguous:'other_region',no_data:'no_cards_found',failed:'check_failed'};
// A bank is opened only if it read fine last time. Otherwise the owner's own signed-in tab must exist, so a login
// page is never hit again and again. When Chrome is idle, a frontmost tab is not in use, so it counts like any other.
export function decideBanks({settings,activeBanks,disabled=[],withCards,tabs={},idle='idle',now}){
 const interval=normalizeInterval(settings.intervalMinutes)*60000;let amex=false;
 return Object.fromEntries(activeBanks.map(bank=>{
  const seen=settings.banks[bank],tab=tabs[bank]||'none';let reason='ready';
  if(!settings.enabled)reason='off';else if(disabled.includes(bank))reason='disconnected';else if(seen?.state==='stopped')reason='stopped';
  else if(seen?.lastAttemptAt&&now-seen.lastAttemptAt<interval)reason='not_due';
  else if(tab!=='found'&&!(withCards.includes(bank)&&seen?.state==='ok'))reason=TAB_REASON[tab]||'check_failed';
  // Amex regions share a login domain, and their sessions replace each other.
  else if(bank.startsWith('Amex ')&&amex)reason='amex_turn';
  else{if(bank.startsWith('Amex '))amex=true;if(idle!=='idle')reason='not_idle';}
  return [bank,reason];
 }));
}
export const planBanks=input=>Object.entries(decideBanks(input)).filter(([,reason])=>reason==='ready').map(([bank])=>bank);
export const skipSignature=reasons=>JSON.stringify(Object.entries(reasons).sort(([a],[b])=>a<b?-1:1));
export const skipReport=(reasons,now)=>scrub({schema:1,at:now,build:'dev',run:'skipped',banks:Object.entries(reasons).map(([bank,reason])=>({bank,status:'skipped',reason:word(reason)||'unknown'}))});
export const POPUP_WORDS={
 en:{on:'Refresh on a schedule',every:'At most every',hours:'h',checked:'Last check',note:'It reads when Chrome has been idle for 2 minutes. It never signs in and sends only a redacted report to this computer.',wallet:'Open wallet',
  off:'Schedule is off',disconnected:'Disconnected in the wallet',stopped:'Stopped: turn the schedule off and on to try again',not_due:'Read recently; waiting for the interval',no_tab:'No bank tab open',signed_out:'Signed out. It will read after you next sign in',other_region:'The open tab is for another region',no_cards_found:'Tab open, but no card found on the page',check_failed:'Could not check the tab',amex_turn:'Waiting: Amex reads one region at a time',not_idle:'Ready; waiting until Chrome is idle',ready:'Reads at the next check'},
 'zh-CN':{on:'定时刷新',every:'最短间隔',hours:' 小时',checked:'上次检查',note:'Chrome 空闲 2 分钟后才读取。插件不会替你登录，只向本机发送脱敏报告。',wallet:'打开钱包',
  off:'定时刷新未打开',disconnected:'已在钱包里断开',stopped:'已停止：关掉再打开定时刷新后才会重试',not_due:'刚读过，等下一个间隔',no_tab:'没有打开这家银行的标签页',signed_out:'已退出登录。你下次登录后会自动读取',other_region:'打开的标签页属于其他地区',no_cards_found:'标签页已打开，但页面上没找到卡片',check_failed:'无法检查标签页',amex_turn:'等待中：Amex 一次只读一个地区',not_idle:'已就绪，等 Chrome 空闲',ready:'下次检查时读取'},
 'zh-TW':{on:'定時重新整理',every:'最短間隔',hours:' 小時',checked:'上次檢查',note:'Chrome 閒置 2 分鐘後才讀取。外掛不會替你登入，只向本機傳送去識別化報告。',wallet:'開啟錢包',
  off:'定時重新整理未開啟',disconnected:'已在錢包中中斷連線',stopped:'已停止：關掉再打開定時重新整理後才會重試',not_due:'剛讀過，等下一個間隔',no_tab:'沒有開啟這家銀行的分頁',signed_out:'已登出。你下次登入後會自動讀取',other_region:'開啟的分頁屬於其他地區',no_cards_found:'分頁已開啟，但頁面上找不到卡片',check_failed:'無法檢查分頁',amex_turn:'等待中：Amex 一次只讀一個地區',not_idle:'已就緒，等 Chrome 閒置',ready:'下次檢查時讀取'}
};
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
 const ids=new Set((job.cards||[]).map(c=>c.id)),counts={},note=key=>{if(FIELD_KEYS.includes(key))counts[key]=(counts[key]||0)+1;},fresh=at=>!job.startedAt||Date.parse(at)>=job.startedAt-5000;
 for(const [id,fields]of Object.entries(state.records?.[job.bank]||{}))if(ids.has(id))for(const [key,field]of Object.entries(fields))if(fresh(field?.capturedAt))note(key);
 for(const item of state.agentRecords||[])if(item.bank===job.bank&&ids.has(item.cardId)&&['card','billing'].includes(item.kind)&&fresh(item.capturedAt))note(item.key);
 return {bank:job.bank,status:word(job.status)||'unknown',step:word(job.diagnostic?.stage)||null,code:word(job.diagnostic?.code)||word(job.readError)||null,phase:word(job.phase)||null,cards:ids.size,read:Number.isFinite(job.received)?job.received:0,rejected:Number.isFinite(job.rejected)?job.rejected:0,rejectReasons:Object.keys(job.rejectReasons||{}).map(word).filter(Boolean),sections:Object.fromEntries(Object.entries(job.sections||{}).map(([k,v])=>[word(k)||'other',word(v?.status)||'unknown'])),fields:counts,page};
}
export function buildReport({run,state,pages={},build,now}){return scrub({schema:1,at:now,build,run:word(run.status)||'unknown',banks:run.jobs.map(job=>jobReport(job,state,pages[job.bank]||null))});}
// The local server applies the same limit, so a report with a digit in any string is refused rather than stored.
export function validReport(report){
 if(!report||typeof report!=='object'||report.schema!==1||!Array.isArray(report.banks)||report.banks.length>7||JSON.stringify(report).length>2000000)return false;
 const clean=value=>typeof value==='string'?!/\p{N}/u.test(value):Array.isArray(value)?value.every(clean):value&&typeof value==='object'?Object.entries(value).every(([k,v])=>clean(k)&&clean(v)):true;
 return clean(report);
}
