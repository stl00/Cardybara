import {latestDueField,latestNoPayment} from './agentData.js';
import {walletDay} from './personalBenefits.js';

// Everything the payment assistant says about a bill is decided here, so the honesty rules
// (unknown is not zero, no guessed year, old readings are labelled) can be tested without a browser.
export const PAYMENT_MARKS_KEY='cardybara-payment-handled-v1';
export const SOON_DAYS=7,STALE_DAYS=14,VISIBLE_ITEMS=4;
// A yearless date repeats every year, so its mark cannot outlive roughly one billing cycle.
const YEARLESS_MARK_DAYS=45,MAX_MARKS=2000;
const DAY_MS=86400000;
const isoDay=/^\d{4}-\d{2}-\d{2}$/;
const chicagoDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
const daysBetween=(from,to)=>Math.round((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/DAY_MS);
function readDay(value){
 if(isoDay.test(value||''))return value;
 const date=new Date(value);return value&&Number.isFinite(date.getTime())?chicagoDay.format(date):null;
}
const validDate=value=>typeof value==='string'&&isoDay.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

/** The bill a card is currently in: a full date, a yearless bank label, or none. A year is never added. */
export function paymentCycle(card){
 if(latestNoPayment(card))return null;
 if(latestDueField(card)==='duePartial'&&card.duePartial)return {kind:'yearless',label:String(card.duePartial)};
 return validDate(card.due)?{kind:'date',date:card.due}:null;
}
export function paymentKey(card,cycle){return cycle?JSON.stringify([card.id,cycle.kind,cycle.kind==='date'?cycle.date:cycle.label]):null;}

// The oldest of the readings on the row, because one fresh field does not make the others fresh.
function oldestReading(card,keys){
 let oldest=null;
 for(const key of keys){
  const day=readDay(card.fieldDates?.[key]||card.updated);
  if(!day)return null;
  if(!oldest||day<oldest)oldest=day;
 }
 return oldest;
}
export function isHandled(key,marks,asOf=walletDay()){
 const mark=key&&marks.find(m=>m.key===key);if(!mark)return false;
 if(JSON.parse(key)[1]!=='yearless')return true;
 const day=readDay(mark.at);return !!day&&daysBetween(day,asOf)<=YEARLESS_MARK_DAYS;
}

/** One card's payment state. `stale` is separate because an old reading can be in any state. */
export function paymentItem(card,marks=[],asOf=walletDay()){
 const cycle=paymentCycle(card),noPayment=latestNoPayment(card),key=paymentKey(card,cycle);
 const known=noPayment?['paymentStatus']:[...(cycle?[cycle.kind==='date'?'due':'duePartial']:[]),...['statement','minimum'].filter(k=>card[k]!=null),...(card.autopay==='on'||card.autopay==='off'?['autopay']:[])];
 const readAt=known.length?oldestReading(card,known):null,age=readAt?daysBetween(readAt,asOf):null;
 const stale=known.length>0&&(age==null||age>STALE_DAYS);
 const days=cycle?.kind==='date'?daysBetween(asOf,cycle.date):null,autopayOn=card.autopay==='on';
 let state;
 if(noPayment)state='no_payment';
 else if(days!=null&&days<0)state=stale?'stale':'overdue'; // An old reading cannot show that today's bill is unpaid.
 else if(autopayOn)state='autopay';
 else if(cycle?.kind==='yearless')state='yearless';
 else if(cycle)state='due';
 else state='unknown'; // Amounts without a due date still cannot say when to pay.
 const soon=state==='due'&&days<=SOON_DAYS;
 return {card,key,cycle,state,soon,days,stale,readAt,autopay:autopayOn?'on':card.autopay==='off'?'off':'unknown',handled:isHandled(key,marks,asOf),canMark:!!key};
}

const RANKS={overdue:0,yearless:3,stale:5,autopay:6,no_payment:7,unknown:8};
export function paymentRank(item){
 if(item.state==='overdue')return item.autopay==='on'?1:0;
 if(item.state==='due')return item.soon?2:4;
 return RANKS[item.state];
}
function compare(a,b){
 return paymentRank(a)-paymentRank(b)
  ||(a.days??Infinity)-(b.days??Infinity)
  ||String(a.card.name).localeCompare(String(b.card.name))
  ||String(a.card.id).localeCompare(String(b.card.id));
}
const needsAction=item=>paymentRank(item)<=4;

/** The overview's answer: a few bills to act on now, a rollup of what cannot be judged, and the rest. */
export function paymentView(cards,marks=[],asOf=walletDay()){
 const items=cards.map(card=>paymentItem(card,marks,asOf)).sort(compare);
 const open=items.filter(i=>!i.handled),action=open.filter(needsAction);
 const top=action.slice(0,VISIBLE_ITEMS),shown=new Set(top);
 return {
  items,top,
  rest:open.filter(i=>!shown.has(i)),
  handled:items.filter(i=>i.handled),
  refresh:open.filter(i=>i.state==='unknown'||i.stale),
  urgent:action.filter(i=>paymentRank(i)<=2).length,
  action:action.length,
 };
}
export const PAYMENT_GROUPS=['due','autopay','no_payment','unknown'];
export function paymentGroup(item){
 if(['overdue','due','yearless'].includes(item.state))return 'due';
 if(item.state==='stale')return 'unknown';
 return item.state;
}

const validMark=m=>m&&typeof m.key==='string'&&m.key.length<=300&&typeof m.at==='string'&&Number.isFinite(Date.parse(m.at))&&(()=>{try{const k=JSON.parse(m.key);return Array.isArray(k)&&k.length===3&&k.every(x=>typeof x==='string')&&['date','yearless'].includes(k[1]);}catch{return false}})();
export function readPaymentMarks(storage){
 try{const rows=JSON.parse(storage.getItem(PAYMENT_MARKS_KEY));return Array.isArray(rows)?rows.filter(validMark).map(({key,at})=>({key,at})):[];}catch{return []}
}
export function withPaymentMark(marks,key,at=new Date().toISOString()){return [...marks.filter(m=>m.key!==key),{key,at}].slice(-MAX_MARKS);}
export function withoutPaymentMark(marks,key){return marks.filter(m=>m.key!==key);}
/** Backup restore: rejects a malformed file as a whole; on a conflict the later mark wins. */
export function mergePaymentMarks(marks,backup){
 if(backup?.schema!==1||!Array.isArray(backup.marks)||backup.marks.length>MAX_MARKS||!backup.marks.every(validMark))throw Error('invalid_payment_backup');
 const merged=new Map(marks.map(m=>[m.key,m]));
 for(const {key,at} of backup.marks)if(!merged.has(key)||merged.get(key).at<at)merged.set(key,{key,at});
 return [...merged.values()];
}
