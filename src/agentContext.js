import {validateToolCall} from './walletAgent.js';
import {CREDIT_USES} from './creditQuery.js';
import {isRealDate,tripDays,MAX_TRIP_DAYS} from './tripDates.js';
const TRIP_PRECISIONS=['days','part-of-month','month','holiday'];
// Dates reach memory only after code resolved them; free text never does.
function validateTrip(raw){
 const keys=['use','start','end','precision','destination','assumed'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k))||raw.use!==undefined&&!CREDIT_USES.includes(raw.use)||!TRIP_PRECISIONS.includes(raw.precision)||!isRealDate(raw.start)||!isRealDate(raw.end)||raw.start>raw.end||tripDays(raw.start,raw.end)>MAX_TRIP_DAYS||raw.destination!==undefined&&!/^[A-Z]{2}$/.test(raw.destination)||raw.assumed!==undefined&&typeof raw.assumed!=='boolean')throw Error('invalid_memory');
 return {...(raw.use?{use:raw.use}:{}),start:raw.start,end:raw.end,precision:raw.precision,...(raw.destination?{destination:raw.destination}:{}),...(raw.assumed?{assumed:true}:{})};
}
// A merchant name is free text, so it stays in the conversation and out of memory.
const PURCHASE_KEYS=['category','amount','currency','country','channel','pointValues'];
const VALUE_ALIASES={mr:['membership rewards','美国运通积分','美國運通積分'],ur:['ultimate rewards'],'asia miles':['亚洲万里通','亞洲萬里通','cathay','国泰','國泰'],cathay:['asia miles','亚洲万里通','亞洲萬里通','国泰','國泰'],hilton:['希尔顿','希爾頓','hilton honors'],marriott:['万豪','萬豪','bonvoy'],hyatt:['凯悦','凱悅'],ihg:['洲际','洲際']};
const aliasesFor=key=>{const k=key.toLowerCase().trim(),base=k.replace(/\s+(?:us|hk|ca)$/,'');return [...new Set([k,base,...(VALUE_ALIASES[base]||[])])];};
/** A point value survives only if the user's own words this turn contain it, or memory already held it. */
export function statedPointValues(values,question,remembered={}){
 if(!values)return null;
 const text=question.normalize('NFKC').toLowerCase();
 // The number must be said as a value: next to a cents unit, or right after the programme's name. "Dinner for 2" is not a point value.
 // The value must be said about that programme: its name or a known alias as a whole word, then within a few
 // characters a valuing word or a cents unit, then the number. A bare 分 is never 分钟, and a rating or a price
 // elsewhere in the sentence can't be borrowed.
 const stated=(key,value)=>{
  const n=String(value).replace('.','\\.'),names=aliasesFor(key).map(a=>a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  return names.some(name=>{
   const named=`(?<![a-z])${name}(?![a-z])`,num=`(?<![\\d.])${n}(?![\\d.])`,unit=`\\s*(?:美分|港分|分(?![钟鐘半])|cents?\\b|¢)`;
   return new RegExp(`${named}[^\\d]{0,12}?(?:值|是|估|=|:|：|\\bat\\b|\\bworth\\b|\\bvalued?\\b)[^\\d]{0,4}${num}`).test(text)||new RegExp(`${named}[^\\d]{0,8}${num}${unit}`).test(text);
  });
 };
 const kept=Object.fromEntries(Object.entries(values).filter(([k,v])=>stated(k,v)||remembered?.[k]===v));
 return Object.keys(kept).length?kept:null;
}
export function purchaseMemory(raw,strict=false){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||strict&&Object.keys(raw).some(k=>!PURCHASE_KEYS.includes(k)))throw Error('invalid_memory');
 const kept=Object.fromEntries(PURCHASE_KEYS.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
 try{return validateToolCall({id:'memory',function:{name:'choose_card',arguments:JSON.stringify(kept)}}).args;}catch{throw Error('invalid_memory');}
}
export function validateMemory(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['lastPurchase','trip'].includes(k)))throw Error('invalid_memory');
 return {
  ...(raw.lastPurchase?{lastPurchase:purchaseMemory(raw.lastPurchase,true)}:{}),
  ...(raw.trip?{trip:validateTrip(raw.trip)}:{})
 };
}
export function prepareAgentContext(history,memory={},{maxTurns=6,maxChars=22000}={}){
 const state=validateMemory(memory),turns=[];let turn;
 for(const m of history){
  if(m.role==='user'){turn=[];turns.push(turn);turn.push({role:'user',content:m.content});}
  else if(m.role==='assistant'){
   for(const c of m.tool_calls||[]){const checked=validateToolCall(c);if(checked.name==='choose_card')state.lastPurchase=purchaseMemory(checked.args);}
   if(m.content?.trim()&&turn)turn.push({role:'assistant',content:m.content.slice(0,5000)});
  }
 }
 // Historical tool evidence is deliberately discarded: mutable wallet state must be read afresh.
 const selected=[];let chars=0;
 for(const t of turns.slice(-maxTurns).reverse()){
  const size=JSON.stringify(t).length;if(chars+size>maxChars)break;selected.unshift(...t);chars+=size;
 }
 return {messages:selected,memory:state,droppedTurns:turns.length-selected.filter(m=>m.role==='user').length,chars};
}
