import {validateToolCall} from './walletAgent.js';
import {validateState,reduceToolResult,startTurn} from './conversationState.js';
// The conversation state lives in conversationState.js; memory is that state as it travels between turns.
export {validateState as validateMemory,purchaseMemory,topicContext} from './conversationState.js';
const VALUE_ALIASES={mr:['membership rewards','美国运通积分','美國運通積分'],ur:['ultimate rewards'],bilt:['bilt rewards','bilt points'],'bilt rewards':['bilt','bilt points'],'asia miles':['亚洲万里通','亞洲萬里通','cathay','国泰','國泰'],cathay:['asia miles','亚洲万里通','亞洲萬里通','国泰','國泰'],hilton:['希尔顿','希爾頓','hilton honors'],marriott:['万豪','萬豪','bonvoy'],hyatt:['凯悦','凱悅'],ihg:['洲际','洲際']};
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
// The topic index lets a follow-up say "the second one" or "that card" without replaying old tool results. It holds
// only public catalogue ids, written by code from tool results; names are rendered from the shipped catalogue when
// the prompt is built, so no text from a chat, a model or a bank page can reach the system message through it.
export function prepareAgentContext(history,memory={},{maxTurns=6,maxChars=22000}={}){
 let state=validateState(memory),turn;const turns=[];
 for(const m of history){
  if(m.role==='user'){turn=[];turns.push(turn);turn.push({role:'user',content:m.content});}
  else if(m.role==='assistant'){
   // A purchase compared in a turn the client kept but whose state was lost is recovered from its arguments.
   for(const c of m.tool_calls||[]){const checked=validateToolCall(c);if(checked.name==='choose_card')state=reduceToolResult(state,{name:checked.name,args:checked.args});}
   if(m.content?.trim()&&turn)turn.push({role:'assistant',content:m.content.slice(0,5000)});
  }
 }
 // Historical tool evidence is deliberately discarded: mutable wallet state must be read afresh.
 const selected=[];let chars=0;
 for(const t of turns.slice(-maxTurns).reverse()){
  const size=JSON.stringify(t).length;if(chars+size>maxChars)break;selected.unshift(...t);chars+=size;
 }
 const shown=selected.filter(m=>m.role==='user').length,droppedTurns=turns.length-shown;
 // The history a client sends back was already trimmed last turn, so where the shown chat starts comes from the
 // turns the state counted, not from the length of this history.
 return {messages:selected,memory:startTurn(state,{historyTurns:turns.length,shownTurns:shown}),droppedTurns,chars};
}
