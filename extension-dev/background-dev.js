// Dev build only: the plugin's own schedule, redacted diagnostics and self-reload. Nothing here listens to
// the network, so no local page or tool can start a refresh. localhost only receives the redacted report.
import {ready,engine,next} from './background.js';
import {ACTIVE_BANKS,PROVIDERS,guidedPage} from './providers.js';
import {discoverVisibleCards} from './discovery.js';
import {DEV_STAMP} from './dev-build-info.js';
import {SETTINGS_KEY,CHECK_MINUTES,IDLE_SECONDS,defaultSettings,setEnabled,afterRun,decideBanks,planBanks,markAttempted,buildReport,skipReport,skipSignature} from './schedule-core.js';
import {STATE_KEY} from './engine.js';

const TICK='cardybara-dev-schedule',RELOAD='cardybara-dev-reload',REPORT_URL='http://127.0.0.1:8766/api/dev/diagnostics',PENDING='cardybara-dev-pending-report',RUN='cardybara-dev-run';
let queue=Promise.resolve();
const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
const loadSettings=async()=>(await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]||defaultSettings();
const saveSettings=settings=>chrome.storage.local.set({[SETTINGS_KEY]:settings});
async function showState(settings){const attention=Object.values(settings.banks).some(b=>['stopped','login_expired'].includes(b.state));await chrome.action.setBadgeText({text:settings.enabled&&attention?'!':''});}

// Sends reports oldest first. If the local server is off they wait for the next check; nothing is asked of the owner.
async function deliver(report){
 const waiting=[...((await chrome.storage.local.get(PENDING))[PENDING]||[]),...(report?[report]:[])].slice(-5);
 while(waiting.length){
  try{const r=await fetch(REPORT_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension-dev'},body:JSON.stringify(waiting[0]),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('refused');waiting.shift();}
  catch{break;}
 }
 if(waiting.length)await chrome.storage.local.set({[PENDING]:waiting});else await chrome.storage.local.remove(PENDING);
}
async function pageShape(job){
 try{const tab=await chrome.tabs.get(job.tabId);if(!guidedPage(job.bank,tab.url))return null;const read=chrome.scripting.executeScript({target:{tabId:job.tabId},files:['dev-structure-report.js']});const [{result}]=await Promise.race([read,new Promise((_,no)=>setTimeout(()=>no(Error('timeout')),8000))]);return result||null;}catch{return null;}
}
// Handles a scheduled run once it ends, including one a worker restart or reload interrupted. The stop is saved
// first, so nothing after it can lose it. A repeat repeats the report and closes only a tab still on the bank.
async function settleRun(){
 const state=await engine.load(),run=state.run,mine=(await chrome.storage.local.get(RUN))[RUN];
 if(!run?.scheduled||run.status==='running'||mine?.id!==run.id||mine.done)return;
 const settings=afterRun(await loadSettings(),run,Date.now());await saveSettings(settings);await showState(settings);
 const pages={};for(const job of run.jobs)if((job.status!=='updated'||job.readError)&&Number.isInteger(job.tabId))pages[job.bank]=await pageShape(job);
 for(const job of run.jobs)if(job.owned&&Number.isInteger(job.tabId)){const tab=await chrome.tabs.get(job.tabId).catch(()=>null);if(tab&&guidedPage(job.bank,tab.url))await chrome.tabs.remove(job.tabId).catch(()=>{});}
 if(Number.isInteger(mine.restoreTab)){const current=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];if(current&&run.jobs.some(j=>j.tabId===current.id))await chrome.tabs.update(mine.restoreTab,{active:true}).catch(()=>{});}
 await deliver(buildReport({run,state,pages,build:'dev',now:Date.now()}));
 await chrome.storage.local.set({[RUN]:{...mine,done:true}});
}
const finishRun=()=>serial(settleRun);
// What the plugin's own read-only check sees in each bank's tabs. A signed-in tab wins over any other.
async function bankTabs(){
 const tabs=await chrome.tabs.query({}),seen={};
 for(const bank of ACTIVE_BANKS){
  for(const tab of tabs.filter(t=>guidedPage(bank,t.url))){
   const found=await chrome.scripting.executeScript({target:{tabId:tab.id},func:discoverVisibleCards,args:[bank,PROVIDERS[bank].locales]}).catch(()=>[]);
   const status=found[0]?.result?.status;
   seen[bank]=status==='found'?'found':['needs_login','ambiguous','no_data'].includes(status)?status:(seen[bank]||'failed');
   if(status==='found')break;
  }
 }
 return seen;
}
// Every check records why each bank will or won't be read. Only a scheduled check may start a run: opening the popup, turning it on or reloading never does.
const check=({mayRead})=>serial(async()=>{
 // An unfinished run settles first, so a new run can't replace it and lose its stop.
 await ready;await settleRun();let settings=await loadSettings();await deliver();
 const state=await engine.load();if(state.run?.status==='running')return;
 const known=(state.discoveredCards||[]).filter(c=>ACTIVE_BANKS.includes(c.bank)),now=Date.now(),idle=await chrome.idle.queryState(IDLE_SECONDS);
 const input={settings,activeBanks:ACTIVE_BANKS,disabled:state.disabled,withCards:[...new Set(known.map(c=>c.bank))],tabs:settings.enabled?await bankTabs():{},idle,now};
 const skips=decideBanks(input),signature=skipSignature(skips),changed=signature!==settings.skipSignature;
 settings={...settings,skips,skipSignature:signature,lastCheckAt:now};await saveSettings(settings);
 if(changed)await deliver(skipReport(skips,now));
 const banks=mayRead&&idle==='idle'?planBanks(input):[];if(!banks.length)return;
 const restoreTab=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.id,id=crypto.randomUUID();
 await saveSettings(markAttempted(settings,banks,now));await chrome.storage.local.set({[RUN]:{id,restoreTab:restoreTab??null}});
 await engine.start({type:'refresh',requestId:id,banks,cards:known.filter(c=>banks.includes(c.bank)).map(({id,bank,tail,currency})=>({id,bank,tail,currency}))},-1,{scheduled:true});
 void next();
});
const tick=()=>check({mayRead:true});
// An unpacked extension reads this file from disk, so a new build is noticed with no network and no page. It never reads a bank or starts a refresh.
const reloadIfRebuilt=()=>serial(async()=>{
 const stamp=await fetch(chrome.runtime.getURL('build-stamp.json'),{cache:'no-store'}).then(r=>r.json()).then(j=>j.stamp).catch(()=>null);if(!stamp||stamp===DEV_STAMP)return;
 const state=await engine.load(),mine=(await chrome.storage.local.get(RUN))[RUN];if(state.run?.status==='running'||(state.run?.scheduled&&mine?.id===state.run.id&&!mine.done))return;
 const {devReloadTried}=await chrome.storage.local.get('devReloadTried');if(devReloadTried===stamp)return;
 await chrome.storage.local.set({devReloadTried:stamp});chrome.runtime.reload();
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===TICK)void tick().catch(()=>{});if(alarm.name===RELOAD)void reloadIfRebuilt().catch(()=>{});});
chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.idle.onStateChanged.addListener(state=>{if(state==='idle')void tick().catch(()=>{});});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[STATE_KEY]?.newValue?.run?.scheduled&&changes[STATE_KEY].newValue.run.status!=='running')void finishRun().catch(()=>{});});
chrome.runtime.onMessage.addListener((raw,sender,reply)=>{
 if(!['dev-schedule-get','dev-schedule-set'].includes(raw?.type))return false;
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('dev-popup.html')){reply({ok:false});return false;}
 void (async()=>{if(raw.type==='dev-schedule-set')await serial(async()=>{const settings=setEnabled(await loadSettings(),raw.enabled,raw.intervalMinutes);await saveSettings(settings);await showState(settings);});await Promise.race([check({mayRead:false}),new Promise(done=>setTimeout(done,3000))]);reply({ok:true,settings:await loadSettings()});})().catch(()=>reply({ok:false}));
 return true;
});
void (async()=>{await ready;await finishRun();await check({mayRead:false});for(const [name,periodInMinutes]of [[TICK,CHECK_MINUTES],[RELOAD,1]])if(!await chrome.alarms.get(name))await chrome.alarms.create(name,{periodInMinutes});})().catch(()=>{});
