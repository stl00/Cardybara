import {profileForCard,benefitPeriod} from './benefitRules.js';
import {creditCategoriesForRuleId} from './creditCategories.js';
export const PERSONAL_SCHEMA=1;
const statuses=new Set(['unknown','unused','partial','used','skipped']);
export const walletDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function creditTasks(cards,asOf=walletDay()){
 const rows=[];
 for(const card of cards)for(const b of profileForCard(card)?.benefits||[]){
  if(!['credit','promo'].includes(b.category)||b.validFrom&&b.validFrom>asOf||b.validThrough&&b.validThrough<asOf||b.applicability)continue;
  const period=benefitPeriod(b,asOf),limit=b.monthlyAmounts?.[Number(asOf.slice(5,7))-1]??b.amount;
  if(!period||!Number.isFinite(limit)||limit<=0)continue;
  rows.push({key:JSON.stringify([card.id,b.knowledgeRuleId,period.start,period.end]),cardId:card.id,ruleId:b.knowledgeRuleId,revisionId:b.revisionId,title:b.title,condition:b.condition,sourceIds:b.sourceIds,limit:b.quantity?limit*b.quantity:limit,currency:b.currency||card.currency,period,requiresEnrollment:b.requiresEnrollment??null,categories:creditCategoriesForRuleId(b.knowledgeRuleId),...(b.coupon?{coupon:structuredClone(b.coupon)}:{})});
 }
 return rows.sort((a,b)=>a.period.end.localeCompare(b.period.end)||a.cardId.localeCompare(b.cardId));
}
export function taskStatus(task,events){const latest=events.filter(e=>e.key===task.key).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id))[0];return latest?.revisionId===task.revisionId?latest?.status||'unknown':'unknown';}
export function validatePersonalEvent(e){
 if(!e||e.schema!==1||typeof e.id!=='string'||e.id.length>100||typeof e.key!=='string'||e.key.length>600||!statuses.has(e.status)||typeof e.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at)||!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)>Date.now()+300000)throw Error('invalid_personal_event');
 const key=JSON.parse(e.key);if(!Array.isArray(key)||key.length!==4||key.some(x=>typeof x!=='string')||!key[1].startsWith('rule.')||!/^\d{4}-\d{2}-\d{2}$/.test(key[2])||!/^\d{4}-\d{2}-\d{2}$/.test(key[3])||key[2]>key[3])throw Error('invalid_personal_key');
 if(e.revisionId!=null&&(typeof e.revisionId!=='string'||!e.revisionId.startsWith(key[1]+'@')))throw Error('invalid_personal_revision');
 let usage;if(e.usage!=null){const u=e.usage;if(!['used','partial'].includes(e.status)||!u||!Number.isFinite(u.amount)||u.amount<0||!Number.isFinite(u.limit)||u.limit<=0||u.amount>u.limit||!(u.value===null||Number.isFinite(u.value)&&u.value>=0&&u.value<=u.amount)||!['USD','HKD','CAD','CNY','GBP'].includes(u.currency)||typeof u.title!=='string'||u.title.length>200||typeof u.date!=='string'||u.date<key[2]||u.date>key[3]||!/^\d{4}-\d{2}-\d{2}$/.test(u.date)||new Date(u.date+'T00:00:00Z').toISOString().slice(0,10)!==u.date||u.date>walletDay())throw Error('invalid_credit_usage');usage={amount:u.amount,value:u.value,limit:u.limit,currency:u.currency,title:u.title,date:u.date};}
 return {schema:1,id:e.id,key:e.key,status:e.status,at:e.at,...(usage?{usage}:{}),revisionId:typeof e.revisionId==='string'&&e.revisionId.length<300?e.revisionId:null};
}
export function reminderTasks(tasks,events,asOf=walletDay(),days=3){const now=Date.parse(asOf+'T00:00:00Z');return tasks.filter(t=>['unknown','unused','partial'].includes(taskStatus(t,events))&&(Date.parse(t.period.end+'T00:00:00Z')-now)/86400000<=days);}
const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\r/g,'').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function creditCalendar(tasks,events,days=3,{now=new Date()}={}){
 const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Cardybara//Credits//EN','CALSCALE:GREGORIAN'];
 for(const t of tasks.filter(t=>['unknown','unused','partial'].includes(taskStatus(t,events)))){
  const day=new Date(Date.parse(t.period.end+'T00:00:00Z')-days*86400000).toISOString().slice(0,10).replaceAll('-','');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now),part=k=>parts.find(p=>p.type===k).value,localNow=part('year')+part('month')+part('day')+'T'+part('hour')+part('minute')+part('second');
  const starts=day+'T090000'<localNow?new Date(now.getTime()+600000).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''):day+'T090000';
  rows.push('BEGIN:VEVENT','UID:'+encodeURIComponent(t.key)+'@cardybara','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART:'+starts,'SUMMARY:'+esc('Cardybara · '+t.title),'DESCRIPTION:'+esc('Check this credit before '+t.period.end+'. Public limit is not a remaining balance. '+t.condition),'BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY','DESCRIPTION:'+esc(t.title),'END:VALARM','END:VEVENT');
 }
 return rows.concat('END:VCALENDAR','').map(line=>{let parts=[],segment='',size=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(size+bytes>73){parts.push(segment);segment=' ';size=1;}segment+=char;size+=bytes;}parts.push(segment);return parts.join('\r\n');}).join('\r\n');
}
