import {REMINDER_ALARM,REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY,dueNotifications,nextFireAt,pruneSent,readLog,readSchedule,reminderDay} from './reminder-core.js';
// Fires what the wallet page published while no wallet page is open. Separate from the bank
// collector: it shares no state with the engine and never touches a bank tab.
export function createReminderWorker({chrome,now=()=>Date.now()}){
 let queue=Promise.resolve(),boundClick=false;
 // Events can arrive together when the worker wakes; each must see the last one's log.
 const serial=job=>{const run=queue.then(job,job);queue=run.catch(()=>{});return run;};
 const tick=()=>serial(async()=>{
  const stored=await chrome.storage.local.get([REMINDER_SCHEDULE_KEY,REMINDER_LOG_KEY]),schedule=readSchedule(stored[REMINDER_SCHEDULE_KEY]);
  // Without the permission nothing is logged, so what is still current can fire if it comes back.
  if(!schedule||!chrome.notifications){await chrome.alarms.clear(REMINDER_ALARM);return;}
  const log=readLog(stored[REMINDER_LOG_KEY]),time=now(),shown=[];
  for(const item of dueNotifications(schedule,log,time)){
   try{await chrome.notifications.create(item.id,{type:'basic',iconUrl:chrome.runtime.getURL('icons/128.png'),title:item.title,message:item.message});shown.push(...item.ids);}
   catch{/* Not logged, so it stays due until its last day. */}
  }
  const updated=shown.length?[...log,...shown.map(id=>({id,day:reminderDay(time)}))]:log;
  if(shown.length)await chrome.storage.local.set({[REMINDER_LOG_KEY]:pruneSent(updated,reminderDay(time))});
  const next=nextFireAt(schedule,updated,time);
  if(next==null)await chrome.alarms.clear(REMINDER_ALARM);else await chrome.alarms.create(REMINDER_ALARM,{when:next});
 });
 const clicked=async id=>{
  const url=chrome.runtime.getURL('index.html'),tabs=await chrome.tabs.query({url:url+'*'}).catch(()=>[]);
  if(tabs[0]){await chrome.tabs.update(tabs[0].id,{active:true,url:url+'#overview'});await chrome.windows?.update(tabs[0].windowId,{focused:true});}
  else await chrome.tabs.create({url:url+'#overview',active:true});
  await chrome.notifications?.clear(id);
 };
 // chrome.notifications exists only while the optional permission is held.
 const bindClick=()=>{if(!chrome.notifications||boundClick)return;boundClick=true;chrome.notifications.onClicked.addListener(id=>{void clicked(id).catch(()=>{});});};
 const wake=()=>{void tick().catch(()=>{});};
 /** Call at the service worker's top level, so these events can wake it. */
 const listen=()=>{
  bindClick();
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===REMINDER_ALARM)wake();});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes[REMINDER_SCHEDULE_KEY])wake();});
  chrome.runtime.onStartup?.addListener(wake);
  chrome.runtime.onInstalled?.addListener(wake);
  chrome.permissions?.onAdded?.addListener(({permissions=[]})=>{if(permissions.includes('notifications')){bindClick();wake();}});
 };
 return {listen,tick,clicked};
}
