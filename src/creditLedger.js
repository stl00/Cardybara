import {profileForCard,benefitPeriod} from './benefitRules.js';
import {dismissKey,dismissedKeys} from './personalBenefits.js';
import {anniversaryPeriod,cleanFeeDate} from './feeDate.js';
// Per-card credit ledger. A pure function of cards, the user's own marks and a day: no clock, no storage, so the
// wallet page and the assistant read the same numbers. Amounts are the published per-cycle limits; "used" is only
// what the user marked. A cycle that ended with no mark is "not captured": the wallet does not know, and never
// calls it used or missed.
export const LEDGER_BASES=['card-year','calendar-year'];
const CYCLES=new Set(['calendar-month','calendar-quarter','calendar-half-year','calendar-year','account-anniversary']);
const ZERO=()=>({available:0,used:0,unused:0,skipped:0,notCaptured:0,open:0});
const addDay=day=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const cents=n=>Math.round(n*100)/100;
function latestMark(events,key){return events.filter(e=>e.key===key).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||String(b.id).localeCompare(String(a.id)))[0];}
/** The window a basis covers: the card year containing asOf (null without a usable fee date) or the calendar year of asOf. */
export function ledgerWindow(basis,feeDate,asOf){
 if(basis==='calendar-year'){const y=asOf.slice(0,4);return {start:`${y}-01-01`,end:`${y}-12-31`};}
 return anniversaryPeriod(feeDate,asOf);
}
/**
 * Every cycle of a credit that starts inside the window, in order. Counting by start day gives a monthly credit 12
 * cycles, a quarterly one 4, a half-yearly one 2 and a calendar-year or card-year one 1, whichever basis is used.
 */
export function cyclesInWindow(rule,window,feeDate){
 const out=[];let probe=window.start;
 for(let guard=0;guard<40&&probe<=window.end;guard++){
  const p=benefitPeriod(rule,probe,{feeDate});if(!p)break;
  if(p.start>=window.start&&p.start<=window.end)out.push(p);
  probe=addDay(p.end);
 }
 return out;
}
function cycleRow(card,rule,period,events,asOf){
 const key=JSON.stringify([card.id,rule.knowledgeRuleId,period.start,period.end]);
 const per=rule.monthlyAmounts?.[Number(period.start.slice(5,7))-1]??rule.amount;
 if(!Number.isFinite(per)||per<=0)return null;
 const limit=cents(rule.quantity?per*rule.quantity:per),mark=latestMark(events,key),ended=period.end<asOf;
 const status=mark&&mark.revisionId===rule.revisionId?mark.status||'unknown':'unknown',b=ZERO();b.available=limit;
 const rest=amount=>{b[ended?'notCaptured':'open']+=amount;};
 if(status==='skipped')b.skipped=limit;
 else if(status==='used'||status==='partial'){
  const amount=mark.usage?.amount,known=Number.isFinite(amount)&&amount>=0;
  if(known||status==='used'){const u=cents(Math.min(known?amount:limit,limit));b.used=u;if(limit>u)b[ended?'unused':'open']+=cents(limit-u);}
  else rest(limit); // partly used with no amount written down: nothing is known to be used
 }
 else if(status==='unused')b[ended?'unused':'open']=limit;
 else rest(limit);
 return {key,start:period.start,end:period.end,status,ended,...b};
}
const sum=(into,row)=>{for(const k of Object.keys(ZERO()))into[k]=cents(into[k]+row[k]);return into;};
/**
 * @param {object[]} cards wallet cards (id, name, bank, region, currency, feeDate)
 * @param {object[]} events the user's credit marks
 * @param {string} asOf wallet day, YYYY-MM-DD
 * @param {{basis?:'card-year'|'calendar-year'}} options
 * @returns one entry per card with a known credit profile: amounts in the card's currency (available = used +
 * unused + skipped + notCaptured + open), the published annual fee, and a note when the basis cannot be worked out.
 */
export function creditLedger(cards,events,asOf,{basis='card-year'}={}){
 if(!LEDGER_BASES.includes(basis))throw Error('invalid_ledger_basis');
 const dismissed=dismissedKeys(events),out=[];
 for(const card of cards||[]){
  const profile=profileForCard(card);if(!profile)continue;
  const feeDate=cleanFeeDate(card.feeDate)?card.feeDate:null,window=ledgerWindow(basis,feeDate,asOf);
  const fee=profile.fees?.currency===card.currency||!card.currency?profile.fees?.primaryAnnual??null:null;
  const entry={cardId:card.id,basis,currency:card.currency||profile.fees?.currency,period:window,annualFee:fee,...ZERO(),credits:[],needsFeeDate:false,excluded:{cardYearCredits:0,oneOffOrOngoing:0}};
  const totals=ZERO();
  for(const b of profile.benefits||[]){
   if(!['credit','promo'].includes(b.category)||b.applicability||dismissed.has(dismissKey(card.id,b.knowledgeRuleId)))continue;
   if(!CYCLES.has(b.period)){entry.excluded.oneOffOrOngoing++;continue;}
   if(b.period==='account-anniversary'&&!feeDate&&basis==='calendar-year'){entry.excluded.cardYearCredits++;entry.needsFeeDate=true;continue;}
   if(!window)continue;
   const cycles=cyclesInWindow(b,window,feeDate).filter(p=>(!b.validFrom||b.validFrom<=p.end)&&(!b.validThrough||b.validThrough>=p.start));
   const rows=cycles.map(p=>cycleRow(card,b,p,events,asOf)).filter(Boolean);
   if(!rows.length)continue;
   const credit={ruleId:b.knowledgeRuleId,title:b.title,cycle:b.period,cycles:rows.length,...rows.reduce(sum,ZERO())};
   entry.credits.push(credit);sum(totals,credit);
  }
  if(basis==='card-year'&&!window)entry.needsFeeDate=true;
  Object.assign(entry,totals);
  entry.netOfFee={used:fee==null?null:cents(entry.used-fee),available:fee==null?null:cents(entry.available-fee)};
  out.push(entry);
 }
 return out;
}
