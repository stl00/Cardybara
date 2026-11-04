// What the service worker decides when reminders fire. No browser APIs here, and imported by the
// wallet page too, so both sides agree on the schedule's shape and the wording rules.
// The worker can't read wallet state, so it only ever sees what the page published: ids, labels and
// times, plus an amount string only when the user turned amounts on.
export const REMINDER_SCHEDULE_KEY='cardybara:reminder-schedule',REMINDER_LOG_KEY='cardybara:reminder-sent';
// Must not start with "cardybara:", which background.js treats as a bank attempt's timeout.
export const REMINDER_ALARM='cardybara-reminder:next';
export const SCHEDULE_SCHEMA=1,SINGLE_LIMIT=3,RETRY_MS=3600000;
const SENT_KEEP_DAYS=120,MAX_ENTRIES=300,DAY_MS=86400000;
const chicagoDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
/** The same calendar as walletDay() in the wallet, so a day count here matches the page's. */
export const reminderDay=now=>chicagoDay.format(new Date(now));
export const daysBetween=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY_MS);
export function pruneSent(sent,asOf){return sent.filter(r=>daysBetween(r.day,asOf)<=SENT_KEEP_DAYS);}
export function readLog(value){return Array.isArray(value)?value.filter(r=>typeof r?.id==='string'&&typeof r?.day==='string'):[];}

const day=/^\d{4}-\d{2}-\d{2}$/;
const validEntry=e=>typeof e?.id==='string'&&['bills','credits'].includes(e.group)&&typeof e.label==='string'&&Number.isFinite(e.fireAt)&&day.test(e.firstDay)&&day.test(e.lastDay)&&day.test(e.targetDay);
/** A damaged or disabled schedule fires nothing. */
export function readSchedule(value){
 if(value?.schema!==SCHEDULE_SCHEMA||value.enabled!==true||!Array.isArray(value.entries)||typeof value.phrases!=='object'||!value.phrases)return null;
 return {...value,entries:value.entries.filter(validEntry).slice(0,MAX_ENTRIES)};
}
const pending=(schedule,log,now)=>{const seen=new Set(log.map(r=>r.id)),today=reminderDay(now);return schedule.entries.filter(e=>!seen.has(e.id)&&today<=e.lastDay);};
/** The next time worth waking for, never one already passed, so a blocked send cannot spin. */
export function nextFireAt(schedule,log,now){
 const times=pending(schedule,log,now).map(e=>e.fireAt).filter(t=>t>now);
 return times.length?Math.min(...times):null;
}
const fill=(phrase,value)=>String(phrase??'').replace('{0}',value);
function whenText(days,bill,p){
 if(days<0)return fill(p.overdue,-days);
 if(days===0)return bill?p.dueToday:p.endsToday;
 if(days===1)return bill?p.dueTomorrow:p.endsTomorrow;
 return fill(p.later,days);
}
/** One reminder's wording. The day count comes from today, because a send can be late. */
export function reminderText({group,label,days,amount,stale},phrases){
 const bill=group==='bills';
 return {title:bill?phrases.bill:phrases.credit,message:[label,whenText(days,bill,phrases),...(amount?[amount]:[]),...(stale?[phrases.stale]:[])].join(' · ')};
}
/**
 * What to show right now. An entry past its last day is dropped rather than sent late: a bill that
 * has since passed its due date is the overdue entry's job. Several at once become one summary that
 * names nothing, like the wallet page's. Ids stay stable, so a repeat replaces instead of doubling.
 */
export function dueNotifications(schedule,log,now){
 const today=reminderDay(now),due=pending(schedule,log,now).filter(e=>e.fireAt<=now),out=[],{phrases:p}=schedule;
 for(const group of ['bills','credits']){
  const rows=due.filter(e=>e.group===group);
  if(!rows.length)continue;
  if(rows.length>SINGLE_LIMIT)out.push({id:`summary:${group}:${today}:${log.length}`,ids:rows.map(r=>r.id),title:group==='bills'?p.bill:p.credit,message:fill(group==='bills'?p.billSummary:p.creditSummary,rows.length)});
  else for(const e of rows)out.push({id:e.id,ids:[e.id],...reminderText({group,label:e.label,amount:e.amount,days:daysBetween(today,e.targetDay),stale:!!e.staleFrom&&today>=e.staleFrom},p)});
 }
 return out;
}
