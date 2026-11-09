// Dev build only. Pure scheduling and report rules, so they can be tested without a browser.
export const SETTINGS_KEY='cardybara-dev-schedule';
export const MIN_INTERVAL_MINUTES=60,CHECK_MINUTES=15,IDLE_SECONDS=120;
export const INTERVALS=[60,180,360,720,1440];
const OK=['updated','partial'],FIELD_KEYS=['balance','available','statement','statementClosing','minimum','creditLimit','due','duePartial','paymentStatus','autopay'];
export const defaultSettings=()=>({enabled:false,intervalMinutes:360,banks:{}});
export const normalizeInterval=value=>INTERVALS.includes(value)?value:Math.max(MIN_INTERVAL_MINUTES,360);
// Turning the schedule on again is the owner's decision to try stopped banks once more, at the next check. A bank that wasn't stopped keeps its last attempt, so a read just made still counts for the interval.
const lastAttempts=banks=>Object.fromEntries(Object.entries(banks||{}).filter(([,b])=>b?.lastAttemptAt&&b.state!=='stopped').map(([bank,b])=>[bank,{lastAttemptAt:b.lastAttemptAt,...(b.retried?{retried:true}:{})}]));
export function setEnabled(settings,enabled,intervalMinutes=settings.intervalMinutes){return {...settings,enabled:enabled===true,intervalMinutes:normalizeInterval(intervalMinutes),banks:enabled===true&&!settings.enabled?lastAttempts(settings.banks):settings.banks};}
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
export const SKIP_REASONS=['off','disconnected','stopped','not_due','no_tab','signed_out','other_region','no_cards_found','check_failed','amex_turn','not_idle','ready','reading'];
const TAB_REASON={none:'no_tab',needs_login:'signed_out',ambiguous:'other_region',no_data:'no_cards_found',failed:'check_failed'};
// A bank is opened only if it read fine last time. Otherwise the owner's own signed-in tab must exist, so a login
// page is never hit again and again. When Chrome is idle, a frontmost tab is not in use, so it counts like any other.
// A read the owner starts from the popup skips the schedule switch, the interval and idle only.
export function decideBanks({settings,activeBanks,disabled=[],withCards,tabs={},idle='idle',now,manual=false}){
 let amex=false;
 return Object.fromEntries(activeBanks.map(bank=>{
  const seen=settings.banks[bank],tab=tabs[bank]||'none';let reason='ready';
  if(!settings.enabled&&!manual)reason='off';else if(disabled.includes(bank))reason='disconnected';else if(seen?.state==='stopped')reason='stopped';
  else if(!manual&&seen?.lastAttemptAt&&now<nextReadAt(settings,bank))reason='not_due';
  else if(tab!=='found'&&!(withCards.includes(bank)&&seen?.state==='ok'))reason=TAB_REASON[tab]||'check_failed';
  // Amex regions share a login domain, and their sessions replace each other.
  else if(bank.startsWith('Amex ')&&amex)reason='amex_turn';
  else{if(bank.startsWith('Amex '))amex=true;if(idle!=='idle'&&!manual)reason='not_idle';}
  return [bank,reason];
 }));
}
export const planBanks=input=>Object.entries(decideBanks(input)).filter(([,reason])=>reason==='ready').map(([bank])=>bank);
export const skipSignature=reasons=>JSON.stringify(Object.entries(reasons).sort(([a],[b])=>a<b?-1:1));
export const skipReport=(reasons,now)=>scrub({schema:1,at:now,build:'dev',run:'skipped',banks:Object.entries(reasons).map(([bank,reason])=>({bank,status:'skipped',reason:word(reason)||'unknown'}))});
// The popup's copy, in the wallet's three languages. A row says each thing once: the tag gives the tone, the detail
// says why and what happens next, and the last line says only what the last read did and when.
export const STATUS_TONES={ready:'ok',reading:'ok',not_due:'wait',not_idle:'wait',amex_turn:'wait',no_tab:'login',signed_out:'login',other_region:'login',stopped:'error',check_failed:'error',no_cards_found:'error',off:'off',disconnected:'off'};
export const RESULT_STATES=['ok','login_expired','stopped'];
// What the owner can do from a row: retry a stopped bank, or open the bank's own sign-in page.
const ROW_ACTION={stopped:'retry',no_tab:'open',signed_out:'open',other_region:'open'};
export const POPUP_WORDS={
 'en-US':{title:'Cardybara Dev',on:'Scheduled reads',every:'At most every',hours:'{0} h',readNow:'Read now',readNowWill:'Will read: {0}',readNowNone:'No signed-in bank is ready to read',readStarted:'Reading started',nothingToRead:'Nothing to read now',running:'A read is in progress',checked:'Last check {0}',note:'Reads after Chrome is idle for 2 min. Never signs in.',wallet:'Open wallet',retry:'Retry',retried:'Will retry at the next check',retryFailed:'Retry did not go through',open:'Open bank',banks:'Banks',
  tone_ok:'Ready',tone_wait:'Waiting',tone_login:'Sign in',tone_error:'Error',tone_off:'Off',
  last_ok:'Last read {0}',last_login_expired:'Sign-in expired {0}',last_stopped:'Failed {0}',
  off:'Scheduled reads are off',disconnected:'Disconnected in the wallet',stopped:'Scheduled reads paused for this bank',not_due:'Next read from {0}',no_tab:'No bank tab open',signed_out:'Signed out; reads after you sign in',other_region:'The open tab is another region',no_cards_found:'No card found on the open tab',check_failed:'Could not check the tab',amex_turn:'Amex reads one region at a time',not_idle:'Reads once Chrome is idle',ready:'Reads at the next check',reading:'Reading now'},
 'zh-CN':{title:'Cardybara 开发版',on:'定时读取',every:'最短间隔',hours:'{0} 小时',readNow:'现在读取',readNowWill:'将读取：{0}',readNowNone:'没有已登录、可读取的银行',readStarted:'已开始读取',nothingToRead:'现在没有可读的银行',running:'正在读取',checked:'上次检查 {0}',note:'Chrome 空闲 2 分钟后读取，不会替你登录。',wallet:'打开钱包',retry:'重试',retried:'下次检查时重试',retryFailed:'重试没有成功',open:'打开银行',banks:'银行',
  tone_ok:'正常',tone_wait:'等待',tone_login:'需要登录',tone_error:'出错',tone_off:'未启用',
  last_ok:'{0} 已读取',last_login_expired:'{0} 登录过期',last_stopped:'{0} 读取失败',
  off:'定时读取未打开',disconnected:'已在钱包里断开',stopped:'已暂停这家银行的定时读取',not_due:'{0} 起可再读取',no_tab:'没有打开这家银行',signed_out:'已退出登录，登录后自动读取',other_region:'打开的是其他地区的页面',no_cards_found:'打开的页面上没找到卡片',check_failed:'无法检查页面',amex_turn:'Amex 一次只读一个地区',not_idle:'等 Chrome 空闲后读取',ready:'下次检查时读取',reading:'正在读取'},
 'zh-TW':{title:'Cardybara 開發版',on:'定時讀取',every:'最短間隔',hours:'{0} 小時',readNow:'現在讀取',readNowWill:'將讀取：{0}',readNowNone:'沒有已登入、可讀取的銀行',readStarted:'已開始讀取',nothingToRead:'現在沒有可讀的銀行',running:'正在讀取',checked:'上次檢查 {0}',note:'Chrome 閒置 2 分鐘後讀取，不會替你登入。',wallet:'開啟錢包',retry:'重試',retried:'下次檢查時重試',retryFailed:'重試沒有成功',open:'開啟銀行',banks:'銀行',
  tone_ok:'正常',tone_wait:'等待',tone_login:'需要登入',tone_error:'出錯',tone_off:'未啟用',
  last_ok:'{0} 已讀取',last_login_expired:'{0} 登入過期',last_stopped:'{0} 讀取失敗',
  off:'定時讀取未開啟',disconnected:'已在錢包中中斷連線',stopped:'已暫停這家銀行的定時讀取',not_due:'{0} 起可再讀取',no_tab:'沒有開啟這家銀行',signed_out:'已登出，登入後自動讀取',other_region:'開啟的是其他地區的頁面',no_cards_found:'開啟的頁面上找不到卡片',check_failed:'無法檢查頁面',amex_turn:'Amex 一次只讀一個地區',not_idle:'等 Chrome 閒置後讀取',ready:'下次檢查時讀取',reading:'正在讀取'}
};
export const fill=(text,...values)=>values.reduce((out,v,i)=>out.replaceAll('{'+i+'}',v),text);
// The earliest time the schedule may read a bank again. A retried bank waits only for the hourly minimum.
export function nextReadAt(settings,bank){const seen=settings.banks?.[bank];if(!seen?.lastAttemptAt)return null;return seen.lastAttemptAt+(seen.retried?MIN_INTERVAL_MINUTES:normalizeInterval(settings.intervalMinutes))*60000;}
// One bank's row in the popup, as plain values, so the copy can be tested without a page. time formats a timestamp.
export function bankRow(settings,bank,words,time){
 const reason=settings.skips?.[bank]||'off',seen=settings.banks?.[bank]||{},tone=STATUS_TONES[reason]||'error';
 const next=reason==='not_due'?nextReadAt(settings,bank):null;
 const detail=fill(words[reason]||words.check_failed,next?time(next):'');
 const last=RESULT_STATES.includes(seen.state)&&seen.finishedAt?fill(words['last_'+seen.state],time(seen.finishedAt)):'';
 return {bank,reason,tone,tag:words['tone_'+tone],detail,last,action:ROW_ACTION[reason]||null};
}
// The owner's Retry on one stopped bank: only that bank's stop is cleared. Its last attempt stays, so a scheduled read
// still waits out the hourly minimum (Read now, as always, skips the interval); every other rule (one Amex region at a
// time, a signed-in tab) applies.
export function retryBank(settings,bank){
 const seen=settings.banks?.[bank];if(seen?.state!=='stopped')return settings;
 return {...settings,banks:{...settings.banks,[bank]:{...(seen.lastAttemptAt?{lastAttemptAt:seen.lastAttemptAt}:{}),retried:true}}};
}
export function markAttempted(settings,banks,now){const next={...settings.banks};for(const bank of banks){const {retried,...rest}=next[bank]||{};next[bank]={...rest,lastAttemptAt:now};}return {...settings,banks:next};}
// Fails closed: every string loses its digits, so amounts and tails cannot pass even if a label slipped through.
function scrub(value){
 if(typeof value==='string')return value.replace(/\p{N}+/gu,'#').slice(0,200);
 if(Array.isArray(value))return value.slice(0,1500).map(scrub);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[scrub(k),scrub(v)]));
 return Number.isFinite(value)||typeof value==='boolean'||value===null?value:null;
}
const word=v=>typeof v==='string'&&/^[a-z_]{1,40}$/.test(v)?v:undefined;
// Counts only: how many cards have each field, lack each field, or give each coverage reason. No card id, name or value.
export function jobReport(job,state,page=null){
 const ids=new Set((job.cards||[]).map(c=>c.id)),have={},fresh=at=>!job.startedAt||Date.parse(at)>=job.startedAt-5000;
 const note=(key,id)=>{if(FIELD_KEYS.includes(key))(have[key]??=new Set()).add(id);};
 for(const [id,fields]of Object.entries(state.records?.[job.bank]||{}))if(ids.has(id))for(const [key,field]of Object.entries(fields))if(fresh(field?.capturedAt))note(key,id);
 for(const item of state.agentRecords||[])if(item.bank===job.bank&&ids.has(item.cardId)&&['card','billing'].includes(item.kind)&&fresh(item.capturedAt))note(item.key,item.cardId);
 const tally=values=>{const out={};for(const v of values){const k=word(v);if(k)out[k]=(out[k]||0)+1;}return out;};
 const coverage=Object.fromEntries(Object.entries(job.sections||{}).filter(([,v])=>Array.isArray(v?.coverage)).map(([section,v])=>[word(section)||'other',v.coverage.filter(Boolean)]).map(([section,list])=>[section,{missing:tally(list.flatMap(c=>c.missing||[])),notApplicable:tally(list.flatMap(c=>c.notApplicable||[])),reasons:tally(list.map(c=>c.reason&&/^[a-z_]+$/.test(c.reason)?c.reason:c.reason?'payment_notice':null).filter(Boolean)),notCollected:list.filter(c=>c.notCollected?.length).length,unconfirmedProgrammes:list.filter(c=>c.unconfirmed?.length).length}]));
 return {bank:job.bank,status:word(job.status)||'unknown',step:word(job.diagnostic?.stage)||null,code:word(job.diagnostic?.code)||word(job.readError)||null,phase:word(job.phase)||null,cards:ids.size,read:Number.isFinite(job.received)?job.received:0,rejected:Number.isFinite(job.rejected)?job.rejected:0,rejectReasons:Object.keys(job.rejectReasons||{}).map(word).filter(Boolean),sections:Object.fromEntries(Object.entries(job.sections||{}).map(([k,v])=>[word(k)||'other',word(v?.status)||'unknown'])),coverage,fields:Object.fromEntries(Object.entries(have).map(([k,v])=>[k,v.size])),page};
}
export function buildReport({run,state,pages={},build,now}){return scrub({schema:1,at:now,build,run:word(run.status)||'unknown',banks:run.jobs.map(job=>jobReport(job,state,pages[job.bank]||null))});}
// The local server applies the same limit, so a report with a digit in any string is refused rather than stored.
export function validReport(report){
 if(!report||typeof report!=='object'||report.schema!==1||!Array.isArray(report.banks)||report.banks.length>7||JSON.stringify(report).length>2000000)return false;
 const clean=value=>typeof value==='string'?!/\p{N}/u.test(value):Array.isArray(value)?value.every(clean):value&&typeof value==='object'?Object.entries(value).every(([k,v])=>clean(k)&&clean(v)):true;
 return clean(report);
}
