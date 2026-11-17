// Web Push handler for the web wallet's service worker (stl00/Cardybara#381). Bundled by scripts/web-build.mjs into
// dist/web/push-worker.js and loaded by sw.js with importScripts. A push carries no payload: this reads the plan the
// page keeps in IndexedDB (src/pushMirror.js) and writes the same texts the extension's worker would, in the language
// the page last saved. With nothing in the plan it shows one generic line, because a push must always show something.
import {dueNotifications,pruneSent,readLog,readSchedule,reminderDay} from '../extension-next/reminder-core.js';
import {PUSH_GENERIC_KEY,REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY,mirrorArea} from '../src/pushMirror.js';
export const WALLET_URL='/#overview';
const FALLBACK={title:'Cardybara',body:'Open the wallet to see what is due.'};
const generic=v=>typeof v?.title==='string'&&typeof v?.body==='string'?{title:v.title.slice(0,80),body:v.body.slice(0,200)}:FALLBACK;

/** area: get/set like chrome.storage.local; show(title, body, tag) puts up one notification. Returns what was shown. */
export async function handlePush({area,show,now=Date.now()}){
 let stored={};
 try{stored=await area.get([REMINDER_SCHEDULE_KEY,REMINDER_LOG_KEY,PUSH_GENERIC_KEY]);}catch{/* an unreadable store still shows the generic line */}
 const schedule=readSchedule(stored[REMINDER_SCHEDULE_KEY]),log=readLog(stored[REMINDER_LOG_KEY]);
 const items=schedule?dueNotifications(schedule,log,now):[];
 if(!items.length){const g=generic(stored[PUSH_GENERIC_KEY]);await show(g.title,g.body,'cardybara-push');return [];}
 const day=reminderDay(now),shown=[];
 try{for(const item of items){await show(item.title,item.message,item.id);shown.push(...item.ids.map(id=>({id,day})));}}
 finally{if(shown.length)try{await area.set({[REMINDER_LOG_KEY]:pruneSent([...log,...shown],day)});}catch{/* the page's log still stops most repeats */}}
 return items;
}

/** Where a click goes: a wallet window that is already open, otherwise a new one. */
export async function handleClick({clients,origin}){
 const open=await clients.matchAll({type:'window',includeUncontrolled:true});
 const mine=open.find(c=>c.url.startsWith(origin+'/'));
 if(mine){await mine.focus?.();if('navigate' in mine)try{await mine.navigate(origin+WALLET_URL);}catch{}return mine;}
 return clients.openWindow(origin+WALLET_URL);
}

if(typeof ServiceWorkerGlobalScope!=='undefined'&&self instanceof ServiceWorkerGlobalScope){
 self.addEventListener('push',event=>{
  event.waitUntil(handlePush({area:mirrorArea(),show:(title,body,tag)=>self.registration.showNotification(title,{body,tag,icon:'/cardybara.svg',badge:'/cardybara.svg',data:{url:WALLET_URL}})}));
 });
 self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(handleClick({clients:self.clients,origin:self.location.origin}));
 });
}
