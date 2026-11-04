// Dev build only: the plugin's own schedule, redacted diagnostics and self-reload. Nothing here listens to
// the network, so no local page or tool can start a refresh. localhost only receives the redacted report.
import {ready,engine,next} from './background.js';
import {ACTIVE_BANKS,PROVIDERS,guidedPage} from './providers.js';
import {discoverVisibleCards} from './discovery.js';
import {DEV_STAMP} from './dev-build-info.js';
import {SETTINGS_KEY,CHECK_MINUTES,IDLE_SECONDS,defaultSettings,setEnabled,afterRun,planBanks,markAttempted,buildReport} from './schedule-core.js';
import {STATE_KEY} from './engine.js';

const TICK='cardybara-dev-schedule',RELOAD='cardybara-dev-reload',REPORT_URL='http://127.0.0.1:8766/api/dev/diagnostics',PENDING='cardybara-dev-pending-report',RUN='cardybara-dev-run';
let queue=Promise.resolve();
const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
const loadSettings=async()=>(await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]||defaultSettings();
const saveSettings=settings=>chrome.storage.local.set({[SETTINGS_KEY]:settings});
async function showState(settings){const attention=Object.values(settings.banks).some(b=>['stopped','login_expired'].includes(b.state));await chrome.action.setBadgeText({text:settings.enabled&&attention?'!':''});}

// Sends the report once. If the local server is off it waits for the next check; nothing is asked of the owner.
async function deliver(report){
 const body=report||(await chrome.storage.local.get(PENDING))[PENDING];if(!body)return;
 try{const r=await fetch(REPORT_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension-dev'},body:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('refused');await chrome.storage.local.remove(PENDING);}
 catch{await chrome.storage.local.set({[PENDING]:body});}
}
async function pageShape(job){
 try{const tab=await chrome.tabs.get(job.tabId);if(!guidedPage(job.bank,tab.url))return null;const [{result}]=await chrome.scripting.executeScript({target:{tabId:job.tabId},files:['dev-structure-report.js']});return result||null;}catch{return null;}
}
// Handles a scheduled run once it ends, including one a worker restart interrupted.
const finishRun=()=>serial(async()=>{
 const state=await engine.load(),run=state.run,mine=(await chrome.storage.local.get(RUN))[RUN];
 if(!run?.scheduled||run.status==='running'||mine?.id!==run.id||mine.done)return;
 await chrome.storage.local.set({[RUN]:{...mine,done:true}});
 const pages={};for(const job of run.jobs)if(job.status!=='updated'&&Number.isInteger(job.tabId))pages[job.bank]=await pageShape(job);
 for(const job of run.jobs)if(job.owned&&Number.isInteger(job.tabId))await chrome.tabs.remove(job.tabId).catch(()=>{});
 if(Number.isInteger(mine.restoreTab)){const current=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];if(current&&run.jobs.some(j=>j.tabId===current.id))await chrome.tabs.update(mine.restoreTab,{active:true}).catch(()=>{});}
 const settings=afterRun(await loadSettings(),run,Date.now());await saveSettings(settings);await showState(settings);
 await deliver(buildReport({run,state,pages,build:'dev',now:Date.now()}));
});
async function bankTabs(){
 const tabs=await chrome.tabs.query({}),focused=await chrome.windows.getLastFocused().catch(()=>null),signedIn=[],inUse=[];
 for(const bank of ACTIVE_BANKS){
  for(const tab of tabs.filter(t=>guidedPage(bank,t.url))){
   if(tab.active&&focused?.focused&&tab.windowId===focused.id){inUse.push(bank);break;}
   const found=await chrome.scripting.executeScript({target:{tabId:tab.id},func:discoverVisibleCards,args:[bank,PROVIDERS[bank].locales]}).catch(()=>[]);
   if(found[0]?.result?.status==='found'){signedIn.push(bank);break;}
  }
 }
 return {signedIn,inUse};
}
const tick=()=>serial(async()=>{
 await ready;const settings=await loadSettings();if(!settings.enabled)return;await deliver();
 if((await chrome.idle.queryState(IDLE_SECONDS))!=='idle')return;
 const state=await engine.load();if(state.run?.status==='running')return;
 const known=(state.discoveredCards||[]).filter(c=>ACTIVE_BANKS.includes(c.bank)),{signedIn,inUse}=await bankTabs(),now=Date.now();
 const banks=planBanks({settings,activeBanks:ACTIVE_BANKS,disabled:state.disabled,withCards:[...new Set(known.map(c=>c.bank))],signedIn,inUse,now});if(!banks.length)return;
 const restoreTab=(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.id,id=crypto.randomUUID();
 await saveSettings(markAttempted(settings,banks,now));await chrome.storage.local.set({[RUN]:{id,restoreTab:restoreTab??null}});
 await engine.start({type:'refresh',requestId:id,banks,cards:known.filter(c=>banks.includes(c.bank)).map(({id,bank,tail,currency})=>({id,bank,tail,currency}))},-1,{scheduled:true});
 void next();
});
// An unpacked extension reads this file from disk, so a new build is noticed with no network and no page. It never reads a bank or starts a refresh.
async function reloadIfRebuilt(){
 const stamp=await fetch(chrome.runtime.getURL('build-stamp.json'),{cache:'no-store'}).then(r=>r.json()).then(j=>j.stamp).catch(()=>null);if(!stamp||stamp===DEV_STAMP)return;
 const state=await engine.load();if(state.run?.status==='running')return;
 const {devReloadTried}=await chrome.storage.local.get('devReloadTried');if(devReloadTried===stamp)return;
 await chrome.storage.local.set({devReloadTried:stamp});chrome.runtime.reload();
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===TICK)void tick().catch(()=>{});if(alarm.name===RELOAD)void reloadIfRebuilt().catch(()=>{});});
chrome.idle.setDetectionInterval(IDLE_SECONDS);
chrome.idle.onStateChanged.addListener(state=>{if(state==='idle')void tick().catch(()=>{});});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[STATE_KEY]?.newValue?.run?.scheduled&&changes[STATE_KEY].newValue.run.status!=='running')void finishRun().catch(()=>{});});
chrome.runtime.onMessage.addListener((raw,sender,reply)=>{
 if(!['dev-schedule-get','dev-schedule-set'].includes(raw?.type))return false;
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('dev-popup.html')){reply({ok:false});return false;}
 void serial(async()=>{let settings=await loadSettings();if(raw.type==='dev-schedule-set'){settings=setEnabled(settings,raw.enabled,raw.intervalMinutes);await saveSettings(settings);await showState(settings);}reply({ok:true,settings});}).catch(()=>reply({ok:false}));
 return true;
});
void (async()=>{await ready;await finishRun();for(const [name,periodInMinutes]of [[TICK,CHECK_MINUTES],[RELOAD,1]])if(!await chrome.alarms.get(name))await chrome.alarms.create(name,{periodInMinutes});})().catch(()=>{});
