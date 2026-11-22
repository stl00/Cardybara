// The web wallet's reminder plan, kept in IndexedDB so the service worker can read it when a push arrives (the wallet
// itself lives in localStorage, which a worker cannot open). It holds what the extension's worker holds in its
// extension storage: the schedule (labels and fire times, same shape as extension-next/reminder-core.js), the log
// of reminders already shown, and one generic line. It stays on this device; the gateway only ever gets fire times.
import {REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY} from '../extension-next/reminder-core.js';
export const PUSH_GENERIC_KEY='cardybara:push-generic';
const DB='cardybara-push-mirror',STORE='kv';
const open=idb=>new Promise((resolve,reject)=>{const req=idb.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('storage_blocked'));});
async function run(idb,mode,action){
 const db=await open(idb);
 return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);let value;tx.oncomplete=()=>{db.close();resolve(value)};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('storage_failed'))};action(tx.objectStore(STORE),v=>{value=v});});
}
/** Same get/set shape as the extension's storage area, so publishSchedule() in reminders.js works on it unchanged. */
export function mirrorArea(idb=globalThis.indexedDB){
 return {
  get:keys=>run(idb,'readonly',(store,done)=>{const out={},list=Array.isArray(keys)?keys:[keys];let left=list.length;if(!left)done(out);for(const k of list){const req=store.get(k);req.onsuccess=()=>{if(req.result!==undefined)out[k]=req.result;if(--left===0)done(out);};}}),
  set:values=>run(idb,'readwrite',store=>{for(const [k,v] of Object.entries(values))store.put(v,k);}),
  remove:key=>run(idb,'readwrite',store=>{store.delete(key);}),
 };
}
export {REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY};
