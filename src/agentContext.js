import {validateToolCall} from './walletAgent.js';
import {CREDIT_USES} from './creditQuery.js';
import {isRealDate,tripDays,MAX_TRIP_DAYS} from './tripDates.js';
const TRIP_PRECISIONS=['days','part-of-month','month','holiday'];
// Dates reach memory only after code resolved them; free text never does.
function validateTrip(raw){
 const keys=['use','start','end','precision','destination'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k))||raw.use!==undefined&&!CREDIT_USES.includes(raw.use)||!TRIP_PRECISIONS.includes(raw.precision)||!isRealDate(raw.start)||!isRealDate(raw.end)||raw.start>raw.end||tripDays(raw.start,raw.end)>MAX_TRIP_DAYS||raw.destination!==undefined&&!/^[A-Z]{2}$/.test(raw.destination))throw Error('invalid_memory');
 return {...(raw.use?{use:raw.use}:{}),start:raw.start,end:raw.end,precision:raw.precision,...(raw.destination?{destination:raw.destination}:{})};
}
export function validateMemory(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['lastComparison','trip'].includes(k)))throw Error('invalid_memory');
 return {
  ...(raw.lastComparison?{lastComparison:validateToolCall({id:'memory',function:{name:'compare_cards',arguments:JSON.stringify(raw.lastComparison)}}).args}:{}),
  ...(raw.trip?{trip:validateTrip(raw.trip)}:{})
 };
}
export function prepareAgentContext(history,memory={},{maxTurns=6,maxChars=22000}={}){
 const state=validateMemory(memory),turns=[];let turn;
 for(const m of history){
  if(m.role==='user'){turn=[];turns.push(turn);turn.push({role:'user',content:m.content});}
  else if(m.role==='assistant'){
   for(const c of m.tool_calls||[]){const checked=validateToolCall(c);if(checked.name==='compare_cards')state.lastComparison=checked.args;}
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
