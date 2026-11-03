import {validateToolCall} from './walletAgent.js';
export function validateMemory(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>k!=='lastComparison'))throw Error('invalid_memory');
 if(!raw.lastComparison)return {};
 const args=validateToolCall({id:'memory',function:{name:'compare_cards',arguments:JSON.stringify(raw.lastComparison)}}).args;
 return {lastComparison:args};
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
