import {paymentView} from './paymentStates.js';
import {activeTasks,creditTasks,taskStatus} from './personalBenefits.js';
import {REMINDER_LOG_KEY,REMINDER_SCHEDULE_KEY,SCHEDULE_SCHEMA,SINGLE_LIMIT,pruneSent,readLog,reminderDay} from '../extension-next/reminder-core.js';
export {pruneSent};
// Decides which reminders are due. No browser APIs here, so "never fire for handled or autopay bills"
// and "no amounts unless asked" can be tested directly.
export const REMINDER_SETTINGS_KEY='cardybara-reminders-v1',REMINDER_SENT_KEY='cardybara-reminders-sent-v1';
export const LEAD_DAYS=[1,3,7];
export const DEFAULT_SETTINGS=Object.freeze({enabled:false,bills:true,credits:true,billDays:3,creditDays:3,showAmounts:false});
const DAY_MS=86400000;
// How far ahead the page plans for the worker, and the local hour a planned reminder fires.
export const SCHEDULE_DAYS=60,FIRE_HOUR=9;
const MAX_ENTRIES=300;

export function normalizeSettings(value){
 const v=value&&typeof value==='object'?value:{};
 return {enabled:v.enabled===true,bills:v.bills!==false,credits:v.credits!==false,billDays:LEAD_DAYS.includes(v.billDays)?v.billDays:DEFAULT_SETTINGS.billDays,creditDays:LEAD_DAYS.includes(v.creditDays)?v.creditDays:DEFAULT_SETTINGS.creditDays,showAmounts:v.showAmounts===true};
}
export function readSettings(storage){try{return normalizeSettings(JSON.parse(storage.getItem(REMINDER_SETTINGS_KEY)));}catch{return normalizeSettings(null)}}
export function readSent(storage){try{const rows=JSON.parse(storage.getItem(REMINDER_SENT_KEY));return Array.isArray(rows)?rows.filter(r=>typeof r?.id==='string'&&typeof r?.day==='string'):[];}catch{return []}}

/**
 * Yearless bills are left out: without a year there is no way to know when the lead time starts.
 * Handled, no-payment, nothing-billed, unread and old passed-date bills never fire. Autopay covers a
 * bill only while its own reading is recent; an old "on" no longer shows that the bill will be paid.
 */
export function billReminders(cards,marks,settings,asOf){
 return paymentView(cards,marks,asOf).items.filter(i=>!i.handled&&!(i.autopay==='on'&&!i.autopayOld)&&(i.state==='overdue'||(['due','autopay'].includes(i.state)&&i.days!=null&&i.days<=settings.billDays))).map(i=>({
  id:`${i.state==='overdue'?'overdue':'bill'}:${i.key}`,kind:i.state==='overdue'?'overdue':'bill',name:i.card.name,days:i.days,stale:i.stale,statement:i.card.statement??null,currency:i.card.currency,
 }));
}
/** Status never comes from a guess: an unconfirmed credit still reminds, a used, skipped or dismissed one does not. */
export function creditReminders(cards,events,settings,asOf){
 return activeTasks(creditTasks(cards,asOf),events).filter(task=>!['used','skipped'].includes(taskStatus(task,events))).map(task=>({task,days:Math.round((Date.parse(task.period.end+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/DAY_MS)})).filter(r=>r.days<=settings.creditDays).map(({task,days})=>({
  id:`credit:${task.key}`,kind:'credit',title:task.title,...(task.original?{original:task.original}:{}),name:cards.find(c=>c.id===task.cardId)?.name||'',days,
 }));
}
const ofKind=(list,...kinds)=>list.filter(r=>kinds.includes(r.kind));
/**
 * Turns what is due into notifications, once per bill or credit cycle. Several at once become one
 * summary that names nothing. Returns message descriptions; the caller translates and shows them.
 */
export function pendingNotifications({cards,marks,events,settings,sent,asOf}){
 if(!settings.enabled)return [];
 const seen=new Set(sent.map(r=>r.id));
 const fresh=[...(settings.bills?billReminders(cards,marks,settings,asOf):[]),...(settings.credits?creditReminders(cards,events,settings,asOf):[])].filter(r=>!seen.has(r.id));
 const out=[];
 for(const [group,rows] of [['bills',ofKind(fresh,'overdue','bill')],['credits',ofKind(fresh,'credit')]]){
  if(!rows.length)continue;
  if(rows.length>SINGLE_LIMIT)out.push({type:group==='bills'?'bill-summary':'credit-summary',count:rows.length,ids:rows.map(r=>r.id),tag:`cardybara-${group}-${asOf}-${sent.length}`});
  else for(const r of rows)out.push({type:r.kind,...r,ids:[r.id],tag:r.id,...(r.kind==='credit'||settings.showAmounts?{}:{statement:undefined,currency:undefined})});
 }
 return out;
}

const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*DAY_MS).toISOString().slice(0,10);
/**
 * 9am local on that wallet day, or the wallet day's start if that is later: the wallet counts days on
 * Chicago's calendar, so in Hong Kong a wallet day doesn't begin until the afternoon.
 */
export function fireTime(day){
 const [y,m,d]=day.split('-').map(Number),local=new Date(y,m-1,d,FIRE_HOUR).getTime();
 for(let hour=0;hour<24;hour++){const start=Date.UTC(y,m-1,d,hour);if(reminderDay(start)===day)return Math.max(local,start);}
 return local;
}
/**
 * Plans ahead by asking the same questions as the page does today, for each coming day, so the plan
 * can't drift from them. Sent ids are left out. firstDay and lastDay bound when each one is still true:
 * a bill's reminder ends with its due date, and an overdue one ends when the reading gets old.
 */
export function buildSchedule({cards,marks,events,settings,sent,asOf,phrases,translate=text=>text,days=SCHEDULE_DAYS}){
 const seen=new Set(sent.map(r=>r.id)),entries=new Map();
 for(let n=0;n<=days;n++){
  const day=addDays(asOf,n);
  for(const r of [...(settings.bills?billReminders(cards,marks,settings,day):[]),...(settings.credits?creditReminders(cards,events,settings,day):[])]){
   if(seen.has(r.id))continue;
   let entry=entries.get(r.id);
   if(!entry){
    const credit=r.kind==='credit',amount=!credit&&settings.showAmounts&&r.statement!=null&&r.currency?`${r.currency} ${Number(r.statement).toLocaleString()}`:null;
    entry={id:r.id,group:credit?'credits':'bills',label:credit?`${translate(r.title,r)} · ${r.name}`:r.name,firstDay:day,lastDay:day,targetDay:addDays(day,r.days),fireAt:fireTime(day),...(amount?{amount}:{})};
    entries.set(r.id,entry);
   }
   entry.lastDay=day;
   if(r.stale&&!entry.staleFrom)entry.staleFrom=day;
  }
 }
 return {schema:SCHEDULE_SCHEMA,enabled:true,phrases,entries:[...entries.values()].sort((a,b)=>a.fireAt-b.fireAt||a.id.localeCompare(b.id)).slice(0,MAX_ENTRIES)};
}
// Chrome may hand stored objects back with their keys in another order.
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:1)):v);
/** Both logs count as sent, so a reminder shown by either the page or the worker is never repeated. */
export function mergeSent(a,b){const rows=new Map();for(const r of [...a,...b])if(!rows.has(r.id))rows.set(r.id,r);return [...rows.values()];}
/**
 * Hands the worker today's plan. Off, or without the permission, nothing stays stored. Called only once
 * the wallet and its marks have loaded, because publishing replaces the plan the worker holds.
 */
export async function publishSchedule({area,storage,granted,cards,marks,events,asOf,phrases,translate}){
 const settings=readSettings(storage);
 if(!settings.enabled||!granted){await area.remove(REMINDER_SCHEDULE_KEY);return null;}
 const stored=await area.get([REMINDER_SCHEDULE_KEY,REMINDER_LOG_KEY]),page=readSent(storage),sent=mergeSent(page,readLog(stored[REMINDER_LOG_KEY]));
 if(sent.length!==page.length)try{storage.setItem(REMINDER_SENT_KEY,JSON.stringify(pruneSent(sent,asOf)));}catch{/* The worker's own log still stops a repeat. */}
 const schedule=buildSchedule({cards,marks,events,settings,sent,asOf,phrases,translate});
 if(canonical(stored[REMINDER_SCHEDULE_KEY])!==canonical(schedule))await area.set({[REMINDER_SCHEDULE_KEY]:schedule});
 return schedule;
}
