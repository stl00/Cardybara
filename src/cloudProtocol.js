// The wire format between the extension and the hosted agent (`POST /v1/chat`, stl00/Cardybara#210), shared by
// both sides so each checks the other the same way.
//
// Request: {question, history, memory, summary, rounds?, turn?}
//  - history: earlier turns as trimHistory leaves them (questions, answers, choose_card arguments; never a tool result);
//  - summary: src/walletSummary.js;
//  - rounds/turn: only when continuing a turn after a tool_request: the turn's signed tool-call rounds, each with
//    the results of the wallet tools that round asked for, and nothing else.
// Response: server-sent events, one JSON object per `data:` line:
//  {type:'model'} a model call starts (drop any draft text) · {type:'delta',text} answer text as it streams ·
//  {type:'progress',phase,tool?} · {type:'tool_request',rounds,calls,trip,turn} run calls locally, then post again ·
//  {type:'done',answer,memory,history,tools} · {type:'error',code}.
import {validateToolCall} from './walletAgent.js';

export const AGENT_PATH='/v1/chat';
export const MAX_ROUNDS=4;
export const MAX_RESULT_CHARS=60000;
// The gateway's MAX_BODY_BYTES (gateway/wrangler.jsonc), less room for headers of the JSON itself.
export const MAX_REQUEST_BYTES=260000;
const MAX_HISTORY=64;

/** Earlier turns as they may travel to the agent: no tool result, and of the tool calls only choose_card's arguments. */
export function trimHistory(messages=[]){
 const out=[];
 for(const m of Array.isArray(messages)?messages:[]){
  if(m?.role==='user'&&typeof m.content==='string'&&m.content.trim())out.push({role:'user',content:m.content.slice(0,4000)});
  else if(m?.role==='assistant'){
   const calls=(m.tool_calls||[]).filter(c=>c?.function?.name==='choose_card').slice(0,4).map(c=>({id:c.id,type:'function',function:{name:'choose_card',arguments:c.function.arguments}}));
   const content=typeof m.content==='string'&&m.content.trim()?m.content.slice(0,20000):null;
   if(content||calls.length)out.push({role:'assistant',content,...(calls.length?{tool_calls:calls}:{})});
  }
 }
 return out.slice(-MAX_HISTORY);
}

const exactKeys=(o,required,optional=[])=>!!o&&typeof o==='object'&&!Array.isArray(o)&&required.every(k=>Object.hasOwn(o,k))&&Object.keys(o).every(k=>required.includes(k)||optional.includes(k));
/** Throws invalid_history unless every message is exactly what trimHistory produces. */
export function validateHistory(history){
 const fail=()=>{throw Error('invalid_history');};
 if(!Array.isArray(history)||history.length>MAX_HISTORY)fail();
 for(const m of history){
  if(m?.role==='user'){if(!exactKeys(m,['role','content'])||typeof m.content!=='string'||!m.content.trim()||m.content.length>4000)fail();continue;}
  if(m?.role!=='assistant'||!exactKeys(m,['role','content'],['tool_calls']))fail();
  if(!(m.content===null||typeof m.content==='string'&&m.content.length<=20000))fail();
  if(m.tool_calls!==undefined){
   if(!Array.isArray(m.tool_calls)||!m.tool_calls.length||m.tool_calls.length>4)fail();
   for(const c of m.tool_calls){if(!exactKeys(c,['id','type','function'])||c.type!=='function'||!exactKeys(c.function,['name','arguments'])||c.function.name!=='choose_card')fail();try{validateToolCall(c);}catch{fail();}}
  }else if(!m.content)fail();
 }
 return history;
}

/** A wallet tool result as it may be posted back: one JSON object or array, bounded. */
export function validToolResult(value){
 if(!value||typeof value!=='object')return false;
 try{return JSON.stringify(value).length<=MAX_RESULT_CHARS;}catch{return false;}
}

/** Server-sent events from a byte stream: yields each `data:` line's JSON. Bounded in line length. */
export async function* sseEvents(body,{maxLine=1<<20,signal}={}){
 const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
 // Stopping the turn stops reading: the pending read ends and the caller sees the abort.
 const stop=()=>{reader.cancel().catch(()=>{});};signal?.addEventListener('abort',stop,{once:true});
 try{
  for(;;){
   const {done,value}=await reader.read();
   buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
   const lines=buffer.split('\n');buffer=done?'':lines.pop();
   if(buffer.length>maxLine)throw Error('event_too_large');
   for(const raw of lines){
    const line=raw.replace(/\r$/,'');
    if(!line.startsWith('data:'))continue;
    const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;
    let event;try{event=JSON.parse(data);}catch{continue;}
    yield event;
   }
   if(done)return;
  }
 }finally{signal?.removeEventListener('abort',stop);await reader.cancel().catch(()=>{});}
}
