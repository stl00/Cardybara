// Dev build only: the owner's Read now, redacted diagnostics and self-reload. Nothing here listens to
// the network, so no local page or tool can start a refresh. localhost only receives the redacted report.
import {ready,engine,next} from './background.js';
// Read now reads only the banks this build connects (all active banks unless release.json scopes the build).
import {CONNECTABLE_BANKS,PROVIDERS,guidedPage} from './providers.js';
import {discoverVisibleCards} from './discovery.js';
import {DEV_STAMP} from './dev-build-info.js';
import {STATE_KEY as READ_KEY,OBSOLETE_KEYS,defaultState,afterRun,decideBanks,planBanks,buildReport} from './read-core.js';
import {STATE_KEY} from './engine.js';
import {refreshCard} from './protocol.js';

const RELOAD='cardybara-dev-reload',REPORT_URL='http://127.0.0.1:8776/api/dev/diagnostics',PENDING='cardybara-dev-pending-report',RUN='cardybara-dev-run';
let queue=Promise.resolve();
const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
const loadRead=async()=>(await chrome.storage.local.get(READ_KEY))[READ_KEY]||defaultState();
const saveRead=read=>chrome.storage.local.set({[READ_KEY]:read});

// Sends reports oldest first. If the server is off they wait for the next try (startup, opening the popup, a read, or the reload alarm); if it refuses one, that one is dropped, since sending it again can't help. Nothing is asked of the owner.
async function deliver(report){
 const stored=(await chrome.storage.local.get(PENDING))[PENDING];
 // An earlier build kept a single report here, and its "skipped" reports no longer mean anything.
 const waiting=[...(Array.isArray(stored)?stored:stored?[stored]:[]).filter(r=>r?.run!=='skipped'),...(report?[report]:[])];
 // Room for five: the oldest go first.
 while(waiting.length>5)waiting.shift();
 while(waiting.length){
  try{const r=await fetch(REPORT_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension-dev'},body:JSON.stringify(waiting[0]),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok&&r.status>=500)break;waiting.shift();}
  catch{break;}
 }
 if(waiting.length)await chrome.storage.local.set({[PENDING]:waiting});else await chrome.storage.local.remove(PENDING);
}
async function pageShape(job){
 try{const tab=await chrome.tabs.get(job.tabId);if(!guidedPage(job.bank,tab.url))return null;const read=chrome.scripting.executeScript({target:{tabId:job.tabId},files:['dev-structure-report.js']});const [{result}]=await Promise.race([read,new Promise((_,no)=>setTimeout(()=>no(Error('timeout')),8000))]);return result||null;}catch{return null;}
}
// Handles a read once it ends, including one a worker restart or reload interrupted. The result is saved first, so
// nothing after it can lose it. A repeat repeats the report. The owner is there, so the bank tab stays open and in
// front, and the guide stays where they can see it.
async function settleRun(){
 const state=await engine.load(),run=state.run,mine=(await chrome.storage.local.get(RUN))[RUN];
 if(!run?.scheduled||run.status==='running'||mine?.id!==run.id||mine.done)return;
 await saveRead(afterRun(await loadRead(),run,Date.now()));
 const pages={};for(const job of run.jobs)if((job.status!=='updated'||job.readError)&&Number.isInteger(job.tabId))pages[job.bank]=await pageShape(job);
 await deliver(buildReport({run,state,pages,build:'dev',now:Date.now()}));
 await chrome.storage.local.set({[RUN]:{...mine,done:true}});
}
const finishRun=()=>serial(settleRun);
// What the plugin's own read-only check sees in each bank's tabs. A signed-in tab wins over any other.
async function bankTabs(banks){
 const tabs=await chrome.tabs.query({}),seen={};
 for(const bank of banks){
  for(const tab of tabs.filter(t=>guidedPage(bank,t.url))){
   // A hung tab can't stall every later check.
   const found=await Promise.race([chrome.scripting.executeScript({target:{tabId:tab.id},func:discoverVisibleCards,args:[bank,PROVIDERS[bank].locales]}),new Promise((_,no)=>setTimeout(()=>no(Error('timeout')),5000))]).catch(()=>[]);
   const status=found[0]?.result?.status;
   seen[bank]=status==='found'?'found':['needs_login','ambiguous','no_data'].includes(status)?status:(seen[bank]||'failed');
   if(status==='found')break;
  }
 }
 return seen;
}
// Every check records why each bank will or won't be read. Only the owner's Read now (start) may start a run: opening
// the popup or reloading never does. The check looks at the bank tabs Read now would look at.
const check=({start=false}={})=>serial(async()=>{
 // An unfinished run settles first, so a new run can't replace it and lose its result.
 await ready;await settleRun();let read=await loadRead();await deliver();
 const state=await engine.load();
 // No check of tabs during a read: the popup just says which banks are being read.
 if(state.run?.status==='running'){const reading=state.run.jobs.map(j=>j.bank);await saveRead({...read,skips:{...read.skips,...Object.fromEntries(reading.map(bank=>[bank,'reading']))},lastCheckAt:Date.now()});return 'running';}
 const known=(state.discoveredCards||[]).filter(c=>CONNECTABLE_BANKS.includes(c.bank)),now=Date.now();
 const input={state:read,activeBanks:CONNECTABLE_BANKS,disabled:state.disabled,withCards:[...new Set(known.map(c=>c.bank))]};
 // A disconnected bank isn't touched, even by the read-only tab check.
 input.tabs=await bankTabs(CONNECTABLE_BANKS.filter(bank=>!(state.disabled||[]).includes(bank)));
 const skips=decideBanks(input),banks=planBanks(input);
 read={...read,skips,readNow:banks,lastCheckAt:now};await saveRead(read);
 if(!start||!banks.length)return 'nothing';
 const id=crypto.randomUUID();await chrome.storage.local.set({[RUN]:{id}});
 // The run is flagged scheduled+manual: the shared engine's name for a read with no page of its own, and the owner
 // being there. With manual it shows the guide; scheduled still keeps the model route out of the read.
 await engine.start({type:'refresh',requestId:id,banks,cards:known.filter(c=>banks.includes(c.bank)).map(refreshCard)},-1,{scheduled:true,manual:true});
 void next();return 'started';
});
const popupState=async()=>({read:await loadRead(),running:(await engine.load()).run?.status==='running'});
// An unpacked extension reads this file from disk, so a new build is noticed with no network and no page. It never reads a bank or starts a refresh.
const reloadIfRebuilt=()=>serial(async()=>{
 const stamp=await fetch(chrome.runtime.getURL('build-stamp.json'),{cache:'no-store'}).then(r=>r.json()).then(j=>j.stamp).catch(()=>null);if(!stamp||stamp===DEV_STAMP)return;
 const state=await engine.load(),mine=(await chrome.storage.local.get(RUN))[RUN];if(state.run?.status==='running'||(state.run?.scheduled&&mine?.id===state.run.id&&!mine.done))return;
 const {devReloadTried}=await chrome.storage.local.get('devReloadTried');if(devReloadTried===stamp)return;
 await chrome.storage.local.set({devReloadTried:stamp});chrome.runtime.reload();
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===RELOAD)void reloadIfRebuilt().then(()=>serial(()=>deliver())).catch(()=>{});});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[STATE_KEY]?.newValue?.run?.scheduled&&changes[STATE_KEY].newValue.run.status!=='running')void finishRun().catch(()=>{});});
chrome.runtime.onMessage.addListener((raw,sender,reply)=>{
 if(!['dev-read-status','dev-read-poll','dev-read-now'].includes(raw?.type))return false;
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('dev-popup.html')){reply({ok:false});return false;}
 // Following a run touches no tab: it only reads what is stored.
 if(raw.type==='dev-read-poll'){void popupState().then(state=>reply({ok:true,...state})).catch(()=>reply({ok:false}));return true;}
 if(raw.type==='dev-read-now'){void check({start:true}).then(async outcome=>reply({ok:true,outcome:outcome||'nothing',...await popupState()})).catch(()=>reply({ok:false}));return true;}
 void Promise.race([check(),new Promise(done=>setTimeout(done,3000))]).then(async()=>reply({ok:true,...await popupState()})).catch(()=>reply({ok:false}));
 return true;
});
// Obsolete: the scheduled refresh's settings, alarm and badge. Cleared once, so an old build's leftovers can't linger.
void (async()=>{await chrome.storage.local.remove(OBSOLETE_KEYS);await chrome.alarms.clear('cardybara-dev-schedule');await chrome.action.setBadgeText({text:''});
 if(!await chrome.alarms.get(RELOAD))await chrome.alarms.create(RELOAD,{periodInMinutes:1});await ready;await finishRun();await check();})().catch(()=>{});
