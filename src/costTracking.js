import {profileForCard} from './benefitRules.js';
export const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export const moneyOK=n=>n===null||Number.isFinite(n)&&n>=0&&n<=1e9;
export function annualEnd(start){if(!dateOK(start))return '';const [y,m,d]=start.split('-').map(Number),last=new Date(Date.UTC(y+1,m,0)).getUTCDate(),next=new Date(Date.UTC(y+1,m-1,Math.min(d,last)));return new Date(next-86400000).toISOString().slice(0,10);}
export function validateCostEvent(e){
 if(!e||e.schema!==1||typeof e.id!=='string'||!e.id||e.id.length>100||typeof e.cardId!=='string'||!e.cardId||e.cardId.length>100||!['fee','account'].includes(e.kind)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.at)||!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)>Date.now()+300000)throw Error('invalid_tracking_event');
 const v=e.value;if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_tracking_value');let value,key;
 if(e.kind==='fee'){
  if(!dateOK(v.start)||!dateOK(v.end)||v.end<v.start||Date.parse(v.end)-Date.parse(v.start)>550*86400000||!['USD','HKD','CAD','CNY','GBP'].includes(v.currency)||![v.listedFee,v.charged,v.refund].every(moneyOK)||!['unknown','none','partial','full'].includes(v.waiver)||typeof(v.note??'')!=='string'||(v.note||'').length>500||v.charged!=null&&v.refund!=null&&v.refund>v.charged)throw Error('invalid_fee_cycle');
  if(v.charged==null&&v.refund>0)throw Error('refund_without_charge');
  value={start:v.start,end:v.end,currency:v.currency,listedFee:v.listedFee,charged:v.charged,refund:v.refund,waiver:v.waiver,note:v.note||'',deleted:v.deleted===true};key=JSON.stringify(['fee',e.cardId,v.start]);
 }else{
  if(!moneyOK(v.creditLimit)||typeof v.noPresetLimit!=='boolean'||typeof(v.limitGroup??'')!=='string'||(v.limitGroup||'').length>80)throw Error('invalid_account_config');
  value={creditLimit:v.creditLimit,noPresetLimit:v.noPresetLimit,limitGroup:(v.limitGroup||'').trim()};key=JSON.stringify(['account',e.cardId]);
 }
 if(e.key!==key)throw Error('invalid_tracking_key');return {schema:1,id:e.id,kind:e.kind,cardId:e.cardId,key,at:e.at,value};
}
export function latestCosts(events){const map=new Map();for(const e of events){const old=map.get(e.key);if(!old||e.at>old.at||e.at===old.at&&e.id>old.id)map.set(e.key,e);}return [...map.values()];}
export function feeCycles(events,cardId){return latestCosts(events).filter(e=>e.kind==='fee'&&!e.value.deleted&&(!cardId||e.cardId===cardId)).sort((a,b)=>b.value.start.localeCompare(a.value.start));}
export function checkFeeOverlap(events,event){if(event.kind!=='fee'||event.value.deleted)return;for(const other of feeCycles(events,event.cardId))if(other.key!==event.key&&other.value.start<=event.value.end&&other.value.end>=event.value.start)throw Error('overlapping_fee_cycles');}
export function actualCost(cycle){const v=cycle?.value;return v&&v.charged!=null&&v.refund!=null?Math.round((v.charged-v.refund)*100)/100:null;}
export function creditValueForCycle(cycle,benefitEvents){
 if(!cycle)return {value:0,count:0,unvalued:0};const rows=new Map();for(const e of benefitEvents){const prev=rows.get(e.key);if(!prev||e.at>prev.at||e.at===prev.at&&e.id>prev.id)rows.set(e.key,e);}
 let value=0,count=0,unvalued=0;for(const e of rows.values()){const [card]=JSON.parse(e.key);if(card!==cycle.cardId||!['used','partial'].includes(e.status))continue;const u=e.usage;if(!u){unvalued++;continue;}if(u.date<cycle.value.start||u.date>cycle.value.end)continue;if(u.currency!==cycle.value.currency||u.value==null){unvalued++;continue;}value+=u.value;count++;}return {value:Math.round(value*100)/100,count,unvalued};
}
export function portfolioMetrics(cards,costEvents,benefitEvents,asOf){
 const groups=new Map(),accounts=new Map(latestCosts(costEvents).filter(e=>e.kind==='account').map(e=>[e.cardId,e.value])),limits=new Map();
 const group=currency=>{if(!groups.has(currency))groups.set(currency,{currency,debt:0,creditBalance:0,balanceKnown:0,balanceMissing:0,balanceDates:[],limit:0,limitKnown:0,limitMissing:0,noPreset:0,limitConflicts:0,publishedFee:0,publishedKnown:0,publishedMissing:0,netFee:0,feeKnown:0,feeMissing:0,creditValue:0,valuedCredits:0});return groups.get(currency)};
 for(const card of cards){const g=group(card.currency);const balances=[[card.currency,card.balance],...Object.entries(card.otherBalance||{})];for(const [cur,amount] of balances){const b=group(cur);if(Number.isFinite(amount)){b.debt+=Math.max(0,amount);b.creditBalance+=Math.max(0,-amount);b.balanceKnown++;const date=card.fieldDates?.balance||card.updated;if(date)b.balanceDates.push(date.slice(0,10));}else b.balanceMissing++;}
  const cfg=accounts.get(card.id),limit=cfg?.creditLimit??card.creditLimit;
  if(cfg?.noPresetLimit)g.noPreset++;else if(Number.isFinite(limit)&&limit>=0){const key=JSON.stringify([card.bank,card.currency,cfg?.limitGroup||'card:'+card.id]),entry=limits.get(key)||{g,values:new Set(),count:0};entry.values.add(limit);entry.count++;limits.set(key,entry);}else g.limitMissing++;
  const profile=profileForCard(card),publicFee=profile?.coverage!=='variant-unconfirmed'&&profile?.fees?.currency===card.currency?profile.fees.primaryAnnual:null;
  if(Number.isFinite(publicFee)){g.publishedFee+=publicFee;g.publishedKnown++;}else g.publishedMissing++;
  const cycle=feeCycles(costEvents,card.id).find(e=>e.value.start<=asOf&&e.value.end>=asOf),cost=actualCost(cycle);if(cost!=null&&cycle.value.currency===card.currency){g.netFee+=cost;g.feeKnown++;}else g.feeMissing++;
  const credit=creditValueForCycle(cycle,benefitEvents);if(cycle&&cycle.value.currency===card.currency){g.creditValue+=credit.value;g.valuedCredits+=credit.count;}
 }
 for(const {g,values,count} of limits.values()){if(values.size===1){g.limit+=[...values][0];g.limitKnown+=count;}else{g.limitConflicts++;g.limitMissing+=count;}}
 return [...groups.values()].map(g=>({...g,...Object.fromEntries(['debt','creditBalance','limit','publishedFee','netFee','creditValue'].map(k=>[k,Math.round(g[k]*100)/100])),balanceDates:[...new Set(g.balanceDates)].sort()}));
}
