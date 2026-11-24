import {profileForCard,benefitPeriod} from './benefitRules.js';
import {creditCategoriesForRuleId} from './creditCategories.js';
import {cleanFeeDate} from './feeDate.js';
export const PERSONAL_SCHEMA=1;
const statuses=new Set(['unknown','unused','partial','used','skipped','dismissed','restored']);
// "Stop reminding" lasts across cycles, so it is keyed by card and rule, not by one cycle. Restoring
// appends a new event; the per-cycle marks are never touched, so they come back as they were.
const DISMISSAL=new Set(['dismissed','restored']);
export const dismissKey=(cardId,ruleId)=>JSON.stringify([cardId,ruleId]);
/** Keys of credits whose latest dismissal event is "dismissed". */
export function dismissedKeys(events){
 const latest=new Map();
 for(const e of events){if(!DISMISSAL.has(e.status))continue;const prev=latest.get(e.key);if(!prev||Date.parse(e.at)>Date.parse(prev.at)||e.at===prev.at&&e.id>prev.id)latest.set(e.key,e);}
 return new Set([...latest.values()].filter(e=>e.status==='dismissed').map(e=>e.key));
}
export const isDismissed=(task,dismissed)=>dismissed.has(dismissKey(task.cardId,task.ruleId));
/** Tasks the user still wants to hear about. */
export function activeTasks(tasks,events){const dismissed=dismissedKeys(events);return dismissed.size?tasks.filter(t=>!isDismissed(t,dismissed)):tasks;}
/** Every dismissed credit on these cards, newest first, for the list the user restores from. */
export function dismissedCredits(cards,events){
 const keys=dismissedKeys(events),rows=[];
 for(const card of cards)for(const b of profileForCard(card)?.benefits||[]){
  const key=dismissKey(card.id,b.knowledgeRuleId);if(!keys.has(key)||rows.some(r=>r.key===key))continue;
  const at=events.filter(e=>e.key===key).reduce((a,e)=>e.at>a?e.at:a,'');
  rows.push({key,cardId:card.id,ruleId:b.knowledgeRuleId,title:b.title,...(b.original?{original:structuredClone(b.original)}:{}),at});
 }
 return rows.sort((a,b)=>b.at.localeCompare(a.at)||a.key.localeCompare(b.key));
}
const walletDayOf=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
export const walletDay=()=>walletDayOf(new Date());
export function creditTasks(cards,asOf=walletDay()){
 const rows=[];
 for(const card of cards)for(const b of profileForCard(card)?.benefits||[]){
  if(!['credit','promo'].includes(b.category)||b.validFrom&&b.validFrom>asOf||b.validThrough&&b.validThrough<asOf||b.applicability)continue;
  const period=benefitPeriod(b,asOf,{feeDate:card.feeDate}),limit=b.monthlyAmounts?.[Number(asOf.slice(5,7))-1]??b.amount;
  if(!period||!Number.isFinite(limit)||limit<=0)continue;
  rows.push({key:JSON.stringify([card.id,b.knowledgeRuleId,period.start,period.end]),cardId:card.id,ruleId:b.knowledgeRuleId,revisionId:b.revisionId,title:b.title,condition:b.condition,sourceIds:b.sourceIds,limit:b.quantity?limit*b.quantity:limit,currency:b.currency||card.currency,period,cycle:b.period||null,requiresEnrollment:b.requiresEnrollment??null,categories:creditCategoriesForRuleId(b.knowledgeRuleId),...(b.original?{original:structuredClone(b.original)}:{}),...(b.translations?{translations:structuredClone(b.translations)}:{}),...(b.coupon?{coupon:structuredClone(b.coupon)}:{})});
 }
 return rows.sort((a,b)=>a.period.end.localeCompare(b.period.end)||a.cardId.localeCompare(b.cardId));
}
/**
 * Card-year credits of cards with no usable fee date. Without the date there is no cycle, and none is guessed
 * (no calendar-year fallback), so they are not tasks; they stay in the list as a row that asks for the date.
 * Setting it turns each row into a normal cycle task (see creditTasks), whose key then carries the cycle.
 */
export function feeDateNeededRows(cards,asOf=walletDay()){
 const rows=[];
 for(const card of cards){
  if(cleanFeeDate(card.feeDate))continue;
  for(const b of profileForCard(card)?.benefits||[]){
   if(!['credit','promo'].includes(b.category)||b.period!=='account-anniversary'||b.validFrom&&b.validFrom>asOf||b.validThrough&&b.validThrough<asOf||b.applicability)continue;
   const limit=b.monthlyAmounts?.[Number(asOf.slice(5,7))-1]??b.amount,known=Number.isFinite(limit)&&limit>0;
   rows.push({state:'needs-fee-date',key:JSON.stringify([card.id,b.knowledgeRuleId,'needs-fee-date']),cardId:card.id,ruleId:b.knowledgeRuleId,revisionId:b.revisionId,title:b.title,condition:b.condition,sourceIds:b.sourceIds,limit:known?(b.quantity?limit*b.quantity:limit):null,currency:b.currency||card.currency,categories:creditCategoriesForRuleId(b.knowledgeRuleId),...(b.original?{original:structuredClone(b.original)}:{}),...(b.translations?{translations:structuredClone(b.translations)}:{})});
  }
 }
 return rows.sort((a,b)=>a.cardId.localeCompare(b.cardId)||a.ruleId.localeCompare(b.ruleId));
}

const isRealDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const OFF_CYCLE_KEYS=['four-year','one-off'];
const CYCLE_PERIODS=new Set(['calendar-year','calendar-quarter','calendar-half-year','calendar-month','account-anniversary']);
export const ONE_OFF_PERIODS=new Set(['per-trip','per-stay','activation-based','fixed-date','promotion-period']);
/** Date four years after a day (same month and day; every date that can be used on Feb 29 has a Feb 29 four years on). */
export const nextFourYears=day=>{const d=new Date(day+'T00:00:00Z');d.setUTCFullYear(d.getUTCFullYear()+4);return d.toISOString().slice(0,10);};
/**
 * Credit and promo rules that are not a calendar or card-year cycle task and not a needs-fee-date row. Each is exactly one of:
 * four-year (marked with the date used; next date = +4 years), one-off (explicit row, mark used / not relevant),
 * ongoing (a perk to read, no cycle, no marks), cycle-not-stated (an amount with no period the issuer states: no reset date, no
 * reminder, no marks, not counted). A cycle rule with no positive public limit also lands in ongoing, never nowhere.
 */
export function offCycleRows(cards,asOf=walletDay()){
 const rows=[];
 for(const card of cards)for(const b of profileForCard(card)?.benefits||[]){
  if(!['credit','promo'].includes(b.category)||b.validFrom&&b.validFrom>asOf||b.validThrough&&b.validThrough<asOf||b.applicability)continue;
  const limit=b.monthlyAmounts?.[Number(asOf.slice(5,7))-1]??b.amount,hasLimit=Number.isFinite(limit)&&limit>0;
  if(CYCLE_PERIODS.has(b.period)){
   if(b.period==='account-anniversary'&&!cleanFeeDate(card.feeDate))continue; // needs-fee-date row
   if(hasLimit&&benefitPeriod(b,asOf,{feeDate:card.feeDate}))continue; // cycle task
  }
  const kind=b.period==='rolling-four-years'?'four-year':ONE_OFF_PERIODS.has(b.period)?'one-off':!b.period&&hasLimit?'cycle-not-stated':'ongoing';
  rows.push({state:kind,key:kind==='ongoing'||kind==='cycle-not-stated'?dismissKey(card.id,b.knowledgeRuleId):JSON.stringify([card.id,b.knowledgeRuleId,kind]),cardId:card.id,ruleId:b.knowledgeRuleId,revisionId:b.revisionId,title:b.title,condition:b.condition,sourceIds:b.sourceIds,limit:hasLimit?(b.quantity?limit*b.quantity:limit):null,currency:b.currency||card.currency,period:b.period||null,categories:creditCategoriesForRuleId(b.knowledgeRuleId),...(b.original?{original:structuredClone(b.original)}:{}),...(b.translations?{translations:structuredClone(b.translations)}:{})});
 }
 return rows.sort((a,b)=>a.cardId.localeCompare(b.cardId)||a.ruleId.localeCompare(b.ruleId));
}
/** Status of an off-cycle row: four-year -> {status:'available'|'used', usedOn, nextEligible}; one-off -> unknown|used|skipped; ongoing -> null. */
export function offCycleStatus(row,events){
 if(row.state==='ongoing'||row.state==='cycle-not-stated')return null;
 const latest=events.filter(e=>e.key===row.key).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id))[0];
 if(row.state==='four-year'){const used=latest?.status==='used'&&latest.usedOn;return used?{status:'used',usedOn:latest.usedOn,nextEligible:nextFourYears(latest.usedOn)}:{status:'available',usedOn:null,nextEligible:null};}
 return {status:latest&&(!latest.revisionId||latest.revisionId===row.revisionId)?latest.status:'unknown'};
}
export function taskStatus(task,events){const latest=events.filter(e=>e.key===task.key).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id))[0];return latest?.revisionId===task.revisionId?latest?.status||'unknown':'unknown';}
export function validatePersonalEvent(e){
 if(!e||e.schema!==1||typeof e.id!=='string'||e.id.length>100||typeof e.key!=='string'||e.key.length>600||!statuses.has(e.status)||typeof e.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at)||!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)>Date.now()+300000)throw Error('invalid_personal_event');
 const key=JSON.parse(e.key);
 if(DISMISSAL.has(e.status)){if(!Array.isArray(key)||key.length!==2||key.some(x=>typeof x!=='string'||!x)||!key[1].startsWith('rule.')||e.usage!=null||e.revisionId!=null)throw Error('invalid_personal_dismissal');return {schema:1,id:e.id,key:e.key,status:e.status,at:e.at,revisionId:null};}
 if(Array.isArray(key)&&key.length===3){
  const [card,rule,kind]=key,ok=[card,rule,kind].every(x=>typeof x==='string'&&x)&&rule.startsWith('rule.')&&OFF_CYCLE_KEYS.includes(kind);
  if(!ok||e.usage!=null||(e.revisionId!=null&&(typeof e.revisionId!=='string'||!e.revisionId.startsWith(rule+'@'))))throw Error('invalid_personal_key');
  const allowed=kind==='four-year'?['used','unknown','unused']:['used','skipped','unknown'];
  if(!allowed.includes(e.status))throw Error('invalid_personal_key');
  if(kind==='four-year'&&e.status==='used'){if(!isRealDate(e.usedOn)||e.usedOn>walletDay())throw Error('invalid_used_on');}else if(e.usedOn!=null)throw Error('invalid_used_on');
  return {schema:1,id:e.id,key:e.key,status:e.status,at:e.at,...(e.usedOn?{usedOn:e.usedOn}:{}),revisionId:typeof e.revisionId==='string'&&e.revisionId.length<300?e.revisionId:null};
 }
 if(!Array.isArray(key)||key.length!==4||key.some(x=>typeof x!=='string')||!key[1].startsWith('rule.')||!/^\d{4}-\d{2}-\d{2}$/.test(key[2])||!/^\d{4}-\d{2}-\d{2}$/.test(key[3])||key[2]>key[3])throw Error('invalid_personal_key');
 if(e.revisionId!=null&&(typeof e.revisionId!=='string'||!e.revisionId.startsWith(key[1]+'@')))throw Error('invalid_personal_revision');
 let usage;if(e.usage!=null){const u=e.usage;if(!['used','partial'].includes(e.status)||!u||!Number.isFinite(u.amount)||u.amount<0||!Number.isFinite(u.limit)||u.limit<=0||u.amount>u.limit||!(u.value===null||Number.isFinite(u.value)&&u.value>=0&&u.value<=u.amount)||!['USD','HKD','CAD','CNY','GBP'].includes(u.currency)||typeof u.title!=='string'||u.title.length>200||typeof u.date!=='string'||u.date<key[2]||u.date>key[3]||!/^\d{4}-\d{2}-\d{2}$/.test(u.date)||new Date(u.date+'T00:00:00Z').toISOString().slice(0,10)!==u.date||u.date>walletDay())throw Error('invalid_credit_usage');usage={amount:u.amount,value:u.value,limit:u.limit,currency:u.currency,title:u.title,date:u.date};}
 return {schema:1,id:e.id,key:e.key,status:e.status,at:e.at,...(usage?{usage}:{}),revisionId:typeof e.revisionId==='string'&&e.revisionId.length<300?e.revisionId:null};
}
export function reminderTasks(tasks,events,asOf=walletDay(),days=3){const now=Date.parse(asOf+'T00:00:00Z');return activeTasks(tasks,events).filter(t=>['unknown','unused','partial'].includes(taskStatus(t,events))&&(Date.parse(t.period.end+'T00:00:00Z')-now)/86400000<=days);}
/**
 * Four-year credits the user marked used with a date and still wants to hear about, each with the day it can be
 * used again. An unmarked row has no next date and never appears (it is not guessed). Rows come from offCycleRows,
 * so a card the user does not hold has none; "stop reminding" is honoured like for cycle credits.
 */
export function fourYearReuse(rows,events){
 return activeTasks(rows.filter(r=>r.state==='four-year'),events).map(row=>({row,status:offCycleStatus(row,events)})).filter(({status})=>status?.status==='used'&&status.nextEligible).map(({row,status})=>({row,usedOn:status.usedOn,nextEligible:status.nextEligible}));
}
const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\r/g,'').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function creditCalendar(tasks,events,days=3,{now=new Date(),offCycle=[]}={}){
 const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Cardybara//Credits//EN','CALSCALE:GREGORIAN'];
 for(const t of activeTasks(tasks,events).filter(t=>['unknown','unused','partial'].includes(taskStatus(t,events)))){
  const day=new Date(Date.parse(t.period.end+'T00:00:00Z')-days*86400000).toISOString().slice(0,10).replaceAll('-','');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now),part=k=>parts.find(p=>p.type===k).value,localNow=part('year')+part('month')+part('day')+'T'+part('hour')+part('minute')+part('second');
  const starts=day+'T090000'<localNow?new Date(now.getTime()+600000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''):day+'T090000';
  rows.push('BEGIN:VEVENT','UID:'+encodeURIComponent(t.key)+'@cardybara','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART:'+starts,'SUMMARY:'+esc('Cardybara · '+t.title),'DESCRIPTION:'+esc('Check this credit before '+t.period.end+'. Public limit is not a remaining balance. '+t.condition),'BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:'+esc(t.title),'END:VALARM','END:VEVENT');
 }
 const today=walletDayOf(now),stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 for(const {row,nextEligible} of fourYearReuse(offCycle,events)){
  if(nextEligible<today)continue; // a past date has nothing left to remind
  const next=new Date(Date.parse(nextEligible+'T00:00:00Z')+86400000).toISOString().slice(0,10).replaceAll('-','');
  rows.push('BEGIN:VEVENT','UID:'+encodeURIComponent(row.key)+'-'+nextEligible+'@cardybara','DTSTAMP:'+stamp,'DTSTART;VALUE=DATE:'+nextEligible.replaceAll('-',''),'DTEND;VALUE=DATE:'+next,'SUMMARY:'+esc('Cardybara · '+row.title+' can be used again'),'DESCRIPTION:'+esc('Four years after the last use you recorded. Check the programme before applying again.'),'END:VEVENT');
 }
 return rows.concat('END:VCALENDAR','').map(line=>{let parts=[],segment='',size=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(size+bytes>73){parts.push(segment);segment=' ';size=1;}segment+=char;size+=bytes;}parts.push(segment);return parts.join('\r\n');}).join('\r\n');
}
