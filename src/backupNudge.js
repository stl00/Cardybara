// #572: on the web build, remind the user to export a backup when the wallet has not been exported for a while.
// Times are milliseconds; the decision is a pure function so a test can drive it.
export const LAST_EXPORT_KEY='cardybara-last-export-v1';
export const NUDGE_STATE_KEY='cardybara-backup-nudge-v1';
export const BACKUP_EVENT='backup-nudge-change';
const DAY=86400000;
export const EXPORT_AFTER_DAYS=14,NEVER_EXPORTED_AFTER_DAYS=3,DISMISS_DAYS=7;

/** Whether the notice shows. `lastExport`, `lastDismiss` and `firstCardAt` are ms or null. */
export function showBackupNudge({web,now,lastExport=null,lastDismiss=null,cardCount=0,syncOn=false,firstCardAt=null}){
 if(!web||syncOn||!(cardCount>0))return false;
 if(Number.isFinite(lastDismiss)&&now-lastDismiss<DISMISS_DAYS*DAY)return false;
 if(Number.isFinite(lastExport))return now-lastExport>=EXPORT_AFTER_DAYS*DAY;
 return Number.isFinite(firstCardAt)&&now-firstCardAt>NEVER_EXPORTED_AFTER_DAYS*DAY;
}

const num=v=>Number.isFinite(v)?v:null;
const store=()=>{try{return typeof localStorage==='undefined'?null:localStorage}catch{return null}};
export function readNudgeInputs(storage=store()){
 const out={lastExport:null,lastDismiss:null,firstCardAt:null};
 if(!storage)return out;
 try{out.lastExport=num(Number(JSON.parse(storage.getItem(LAST_EXPORT_KEY))))}catch{}
 try{const s=JSON.parse(storage.getItem(NUDGE_STATE_KEY));out.lastDismiss=num(s?.dismissedAt);out.firstCardAt=num(s?.firstCardAt)}catch{}
 return out;
}
const emit=()=>{try{window.dispatchEvent(new Event(BACKUP_EVENT))}catch{}};
export function recordExport(now=Date.now(),storage=store()){try{storage?.setItem(LAST_EXPORT_KEY,JSON.stringify(now))}catch{}emit();}
function writeState(patch,storage){try{let s={};try{s=JSON.parse(storage.getItem(NUDGE_STATE_KEY))||{}}catch{}storage.setItem(NUDGE_STATE_KEY,JSON.stringify({...s,...patch}))}catch{}}
export function recordDismiss(now=Date.now(),storage=store()){if(storage)writeState({dismissedAt:now},storage);emit();}
/** The first day this device saw a card; the wallet keeps no card creation date, so the first sighting stands in. */
export function noteFirstCard(now=Date.now(),storage=store()){if(!storage)return;if(readNudgeInputs(storage).firstCardAt==null)writeState({firstCardAt:now},storage);}
