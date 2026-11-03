import {billingObservation} from '../extension-next/agent-core.js';
import {formatReadDate} from './i18n-core.js';
import {canonicalProgramme} from '../extension-next/bank-adapters.js';
// Only evidence-validated findings from the bank-scoped refresh reach this reducer.
export function applyAgentRecords(data,records=[]){
 const d=structuredClone(data);
 for(const i of records){
  const c=d.cards.find(c=>c.id===i.cardId&&c.bank===i.bank);if(!c)continue;
  if(i.kind==='card'){
   if(!['balance','available','statement','statementClosing','minimum','creditLimit'].includes(i.key)||!Number.isFinite(i.value)||i.currency!==c.currency)continue;
   const old=c.fieldDates?.[i.key]||c.updated;
   if(old&&Date.parse(old)>Date.parse(i.capturedAt))continue;
   c[i.key]=i.value;(c.fieldDates??={})[i.key]=i.capturedAt;(c.fieldSources??={})[i.key]={method:i.method==='rules'?'rules-evidence-validated':'ai-evidence-validated',page:i.page,region:i.region};
  }
  if(i.kind==='billing'){
   if(i.value!==null||i.currency!==c.currency||!['due','autopay','paymentStatus','duePartial'].includes(i.key))continue;
   if(['paymentStatus','duePartial'].includes(i.key)&&!billingObservation(i))continue;
   if(i.key==='due'&&!/^\d{4}-\d{2}-\d{2}$/.test(i.date))continue;
   if(i.key==='autopay'&&!['on','off'].includes(i.status))continue;
   const old=c.fieldDates?.[i.key]||c.updated;if(old&&Date.parse(old)>Date.parse(i.capturedAt))continue;
   c[i.key]=i.key==='due'?i.date:['paymentStatus','duePartial'].includes(i.key)?i.title:i.status;(c.fieldDates??={})[i.key]=i.capturedAt;(c.fieldSources??={})[i.key]={method:i.method==='rules'?'rules-evidence-validated':'ai-evidence-validated',page:i.page,region:i.region,...(['paymentStatus','duePartial'].includes(i.key)?{evidence:i.evidence}: {})};
  }
  if(i.kind==='reward'){
   // A programme name does not prove two cards share the same rewards account.
   // Preserve the historical pool and keep fresh card observations separate.
   const observations=d.rewardObservations??=[];
   const r={id:`observed-${i.bank}-${i.cardId}-${canonicalProgramme(i.key)}`,card:i.cardId,bank:i.bank,region:i.region,label:i.key,amount:i.value,unit:i.currency,date:formatReadDate(i.capturedAt),capturedAt:i.capturedAt,evidence:i.evidence,poolStatus:'unconfirmed'};
   const idx=observations.findIndex(o=>o.id===r.id);if(idx<0)observations.push(r);else if(Date.parse(observations[idx].capturedAt)<=Date.parse(r.capturedAt))observations[idx]=r;
  }
  if(i.kind==='offer'){
   const r={name:i.title,summary:i.evidence,expires:i.date||null,status:i.status,card:i.cardId,sourceDate:formatReadDate(i.capturedAt)};
   const idx=d.offers.findIndex(o=>o.name===r.name&&o.card===r.card);if(idx<0)d.offers.push(r);else d.offers[idx]=r;
  }
  if(i.kind==='transaction'){
   const r={id:`ai-${i.bank}-${i.cardId}-${i.currency}-${i.key||i.date+'-'+i.title+'-'+i.value+'-'+i.status}`,date:i.date,description:i.title,amount:i.value,currency:i.currency,card:i.cardId,sourceDate:formatReadDate(i.capturedAt),status:i.status,inferred_type:'unclassified'};
   const idx=d.transactions.findIndex(t=>t.id===r.id||(!i.key&&t.card===r.card&&t.currency===r.currency&&t.date===r.date&&t.description===r.description&&t.amount===r.amount&&t.status===r.status));if(idx<0)d.transactions.push(r);else d.transactions[idx]=r;
  }
  if(i.kind==='benefit'&&['entitlement','spend_progress','spend_limit','credit_progress','credit_limit'].includes(i.key)){
   const list=d[i.key==='entitlement'?'benefitEntitlements':'benefitProgress']??=[];
   const r={name:i.title,card:i.cardId,value:i.value,currency:i.currency,metric:i.key,validThrough:i.date||null,status:['activated','requires_activation','redeemed','locked'].includes(i.status)?i.status:'unconfirmed',capturedAt:i.capturedAt,evidence:i.evidence};
   const at=list.findIndex(x=>x.card===r.card&&x.name===r.name&&(x.metric||'spend_progress')===r.metric);if(at<0)list.push(r);else if(Date.parse(list[at].capturedAt)<=Date.parse(r.capturedAt))list[at]=r;
   continue;
  }
  // Benefit limits must be explicit; retain the observed used amount as a separate record.
  if(i.kind==='benefit'){
   const r={name:i.title,card:i.cardId,used:i.value,currency:i.currency,period:i.date||'周期待确认',sourceDate:formatReadDate(i.capturedAt),evidence:i.evidence};
   const idx=d.benefits.findIndex(b=>b.card===r.card&&b.name===r.name&&b.period===r.period);if(idx<0)d.benefits.push(r);else d.benefits[idx]=r;
  }
 }
 return d;
}

// Prefer the latest observed precision without erasing any historical complete date.
export function latestDueField(card){
 const partial=card.fieldDates?.duePartial,full=card.fieldDates?.due||card.updated;
 return card.duePartial&&partial&&(!card.due||!full||Date.parse(partial)>=Date.parse(full))?'duePartial':'due';
}

// A bank job's reading phase is limited to this (see Engine.progress), so a reading this close to
// the statement almost always came from the same run, and a positive one contradicts it. A real
// payment inside this window hides the statement until the next refresh, which fails safe.
const SAME_RUN_MS=600000;
export function latestNoPayment(card){
 const at=Date.parse(card.fieldDates?.paymentStatus);
 return /^(?:暫時毋須付款|暂时毋须付款|No payment (?:is )?(?:required|due)|You (?:don['’]t|do not) have a payment due right now)(?:[。.!！])?$/i.test(card.paymentStatus||'')&&Number.isFinite(at)&&['minimum','due','duePartial'].every(k=>{
  const date=card.fieldDates?.[k]||(card[k]!=null?card.updated:null);if(!date)return true;
  // A reading with an unusable date cannot be shown to be older, so it is not replaced.
  const value=Date.parse(date);if(!Number.isFinite(value))return false;
  const contradicts=k==='minimum'?card.minimum>0:card[k]!=null;
  return at>=value&&!(contradicts&&at-value<SAME_RUN_MS);
 });
}
// True for an older reading that the bank's current no-payment statement has replaced.
export function supersededByNoPayment(card,key){return card[key]!=null&&latestNoPayment(card);}
