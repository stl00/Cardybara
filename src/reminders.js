import {paymentView} from './paymentStates.js';
import {creditTasks,taskStatus} from './personalBenefits.js';
// Decides which reminders are due. No browser APIs here, so "never fire for handled or autopay bills"
// and "no amounts unless asked" can be tested directly.
export const REMINDER_SETTINGS_KEY='cardybara-reminders-v1',REMINDER_SENT_KEY='cardybara-reminders-sent-v1';
export const LEAD_DAYS=[1,3,7];
export const DEFAULT_SETTINGS=Object.freeze({enabled:false,bills:true,credits:true,billDays:3,creditDays:3,showAmounts:false});
const SINGLE_LIMIT=3,SENT_KEEP_DAYS=120,DAY_MS=86400000;

export function normalizeSettings(value){
 const v=value&&typeof value==='object'?value:{};
 return {enabled:v.enabled===true,bills:v.bills!==false,credits:v.credits!==false,billDays:LEAD_DAYS.includes(v.billDays)?v.billDays:DEFAULT_SETTINGS.billDays,creditDays:LEAD_DAYS.includes(v.creditDays)?v.creditDays:DEFAULT_SETTINGS.creditDays,showAmounts:v.showAmounts===true};
}
export function readSettings(storage){try{return normalizeSettings(JSON.parse(storage.getItem(REMINDER_SETTINGS_KEY)));}catch{return normalizeSettings(null)}}
export function readSent(storage){try{const rows=JSON.parse(storage.getItem(REMINDER_SENT_KEY));return Array.isArray(rows)?rows.filter(r=>typeof r?.id==='string'&&typeof r?.day==='string'):[];}catch{return []}}
export function pruneSent(sent,asOf){return sent.filter(r=>(Date.parse(asOf+'T00:00:00Z')-Date.parse(r.day+'T00:00:00Z'))/DAY_MS<=SENT_KEEP_DAYS);}

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
/** Status never comes from a guess: an unconfirmed credit still reminds, a used or skipped one does not. */
export function creditReminders(cards,events,settings,asOf){
 return creditTasks(cards,asOf).filter(task=>!['used','skipped'].includes(taskStatus(task,events))).map(task=>({task,days:Math.round((Date.parse(task.period.end+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/DAY_MS)})).filter(r=>r.days<=settings.creditDays).map(({task,days})=>({
  id:`credit:${task.key}`,kind:'credit',title:task.title,name:cards.find(c=>c.id===task.cardId)?.name||'',days,
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
