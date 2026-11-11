// The hosted assistant (stl00/Cardybara#210): `POST /v1/chat` runs the agent loop of src/agentSession.js in the
// Worker and streams its answer as server-sent events. The system prompt, the model calls and the tools over
// public knowledge (catalogue, benefit rules, transfer routes, point-value defaults, pooling rules) run here,
// bundled from src/ at deploy time. Tools that read the user's wallet (WALLET_TOOLS) run in the extension: the
// stream ends with a tool_request, the extension runs those calls locally and posts the same turn again with only
// their results. The wallet itself never comes here; the agent sees a per-turn summary of held products.
//
// No conversation state is kept between requests. A continuation carries the turn's tool-call rounds, signed by
// this Worker when it asked for them (HMAC, 10 minutes), so the extension can only answer calls the agent made, and
// a replayed round is not sent to the model again. Every model call reserves its worst case and settles it, as on
// the model proxy, so a turn of several calls counts against the same caps. Nothing from a body is logged.
import {runAgentTurn} from '../../src/agentSession.js';
import {chatRequest,acceptReply} from '../../src/chatProtocol.js';
import {validateMemory} from '../../src/agentContext.js';
import {validateState} from '../../src/conversationState.js';
import {validateToolCall} from '../../src/walletAgent.js';
import {WALLET_TOOLS,validateWalletSummary,summaryCards,summaryContext} from '../../src/walletSummary.js';
import {trimHistory,validateHistory,validToolResult,sseEvents,MAX_ROUNDS} from '../../src/cloudProtocol.js';
import {Refusal,readJson,reserve,callProvider,sanitizeBody,worstCase,actualCost,readLimited,ERRORS} from './gateway.js';

const REMOTE=new Set(WALLET_TOOLS);
const TURN_TTL_MS=10*60*1000;
const encoder=new TextEncoder();
// Errors of the agent loop the extension may see. Anything else is agent_failed.
export const AGENT_ERRORS=new Set(['answer_not_grounded','tool_limit','answer_truncated','invalid_model_output','empty_answer','invalid_response','invalid_repair','invalid_tools','duplicate_tools','invalid_tool','invalid_arguments','invalid_tool_results','invalid_round']);
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);

// --- Signed rounds. The key is TURN_KEY if set, else the provider key: both are Worker secrets, so no new deploy input
// is needed, and rotating either only invalidates turns in flight.
async function hmac(env,text){
 const secret=env.TURN_KEY||env.PROVIDER_KEY;
 const key=await crypto.subtle.importKey('raw',encoder.encode('cardybara-turn-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
// The signature binds the invite, the expiry, this turn's question, history, memory and summary, and every round's message.
async function signRounds(ctx,turn,messages,exp){return hmac(ctx.env,JSON.stringify(['turn',ctx.invite.id,exp,await digest([turn.question,turn.history,turn.memory,turn.summary]),messages]));}
function sameText(a,b){if(typeof a!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}

/** The request body as the agent accepts it, or a Refusal. Nothing beyond these fields is read. */
export function parseTurn(body,now){
 const bad=()=>{throw new Refusal('bad_request');};
 if(!plain(body)||Object.keys(body).some(k=>!['question','history','memory','summary','rounds','turn'].includes(k)))bad();
 const {question,history=[],memory={},summary,rounds,turn}=body;
 if(typeof question!=='string'||!question.trim()||question.length>4000)bad();
 try{validateHistory(history);validateMemory(memory);validateWalletSummary(summary);}catch{bad();}
 // The wallet day must be within a day or two of the Worker's: the agent never infers dates.
 if(Math.abs(Date.parse(summary.day+'T12:00:00Z')-now)>3*86400000)bad();
 if((rounds===undefined)!==(turn===undefined))bad();
 if(rounds!==undefined){
  if(!Array.isArray(rounds)||!rounds.length||rounds.length>MAX_ROUNDS)bad();
  if(!plain(turn)||Object.keys(turn).length!==2||!Number.isSafeInteger(turn.exp)||typeof turn.sig!=='string'||!/^[0-9a-f]{64}$/.test(turn.sig))bad();
  for(const r of rounds){
   if(!plain(r)||Object.keys(r).length!==2||!plain(r.message)||!plain(r.results))bad();
   const m=r.message;
   if(m.role!=='assistant'||!Array.isArray(m.tool_calls)||!m.tool_calls.length||m.tool_calls.length>4)bad();
   try{m.tool_calls.forEach(validateToolCall);}catch{bad();}
   // Results only for this round's wallet calls, each once: nothing else from the wallet travels with a turn.
   const wanted=m.tool_calls.filter(c=>REMOTE.has(c.function.name)).map(c=>c.id),given=Object.keys(r.results);
   if(given.length!==wanted.length||given.some(id=>!wanted.includes(id))||Object.values(r.results).some(v=>!validToolResult(v)))bad();
  }
 }
 return {question,history,memory,summary,rounds:rounds||[],turn:turn||null};
}

// --- One model call: the chat protocol's request with the summary in the system message, streamed from the provider.
async function modelCall(ctx,turn,payload,signal,{repair},emit){
 ctx.observe?.(payload);
 const request=chatRequest(payload);
 request.messages[0]={role:'system',content:request.messages[0].content+' '+summaryContext(turn.summary)};
 // A repair is checked before anyone sees it, so it is not streamed.
 const forwarded=sanitizeBody({messages:request.messages,tools:request.tools,tool_choice:request.toolChoice,max_tokens:request.maxTokens,temperature:request.temperature,stream:!repair},ctx.config);
 const settle=await reserve(ctx,worstCase(forwarded,ctx.config));
 ctx.record.model_calls=(ctx.record.model_calls||0)+1;
 const response=await callProvider(ctx,forwarded,settle,signal);
 let message,finishReason=null,usage=null;
 try{
  if(forwarded.stream){
   await emit({type:'model'});
   ({message,finishReason,usage}=await readStream(response,forwarded,text=>emit({type:'delta',text})));
  }else{
   const json=JSON.parse(await readLimited(response,4*ctx.config.maxBodyBytes+65536));
   message=json?.choices?.[0]?.message;finishReason=json?.choices?.[0]?.finish_reason??null;usage=json?.usage;
  }
 }catch(e){
  // A garbled or cut stream keeps the worst case charged: the provider may have billed it.
  await settle(null);
  if(signal?.aborted)throw signal.reason;
  throw new Refusal('provider_error');
 }
 const spent=actualCost(usage,ctx.config);
 await settle(spent);
 ctx.record.prompt_tokens=(ctx.record.prompt_tokens||0)+(spent?.input??0);ctx.record.completion_tokens=(ctx.record.completion_tokens||0)+(spent?.output??0);
 // Tools asked for in the last allowed round mean the turn ran out of rounds.
 if(payload.final&&message?.tool_calls?.length)throw Error('tool_limit');
 return {message:acceptReply(message,payload,finishReason)};
}

/** Reads an OpenAI-style chat stream into one message, passing content deltas on. Bounded like the model proxy. */
export async function readStream(response,forwarded,onText){
 const limit=Math.max(4*262144,forwarded.max_tokens*400+65536);
 let content='',finishReason=null,usage=null,total=0;const calls=[];
 const counted=new TransformStream({transform(chunk,c){total+=chunk.byteLength;if(total>limit)throw Error('too_large');c.enqueue(chunk);}});
 for await(const chunk of sseEvents(response.body.pipeThrough(counted),{maxLine:limit})){
  if(chunk?.usage)usage=chunk.usage;
  const choice=chunk?.choices?.[0];if(!choice)continue;
  if(choice.finish_reason)finishReason=choice.finish_reason;
  const delta=choice.delta||{};
  if(typeof delta.content==='string'&&delta.content){content+=delta.content;if(content.length>20000)throw Error('too_large');await onText(delta.content);}
  for(const part of Array.isArray(delta.tool_calls)?delta.tool_calls:[]){
   const i=part?.index;if(!Number.isInteger(i)||i<0||i>7)throw Error('bad_tool_delta');
   const call=calls[i]||={id:'',type:'function',function:{name:'',arguments:''}};
   if(typeof part.id==='string')call.id+=part.id;
   if(typeof part.function?.name==='string')call.function.name+=part.function.name;
   if(typeof part.function?.arguments==='string')call.function.arguments+=part.function.arguments;
   if(call.id.length>128||call.function.name.length>64||call.function.arguments.length>4000)throw Error('too_large');
  }
 }
 const toolCalls=calls.filter(Boolean);
 return {message:{role:'assistant',content,...(toolCalls.length?{tool_calls:toolCalls}:{})},finishReason,usage};
}

const errorCode=e=>e instanceof Refusal?e.message:AGENT_ERRORS.has(e?.message)?e.message:e?.name==='AbortError'||e?.name==='TimeoutError'?'cancelled':'agent_failed';

/** POST /v1/chat. Validates before anything streams; then the turn runs while its events stream out. */
export async function agentRoute(ctx){
 const turn=parseTurn(await readJson(ctx),ctx.now());
 if(turn.rounds.length){
  if(!(turn.turn.exp>ctx.now()&&turn.turn.exp<=ctx.now()+TURN_TTL_MS))throw new Refusal('turn_expired');
  if(!sameText(turn.turn.sig,await signRounds(ctx,turn,turn.rounds.map(r=>r.message),turn.turn.exp)))throw new Refusal('turn_invalid');
 }
 ctx.record.rounds_replayed=turn.rounds.length;
 ctx.record.wallet_results=turn.rounds.reduce((n,r)=>n+Object.keys(r.results).length,0);
 const {readable,writable}=new TransformStream();
 const writer=writable.getWriter(),abort=new AbortController();
 // A client that goes away cancels the turn: the next write fails, and so does any model call in flight.
 const emit=async event=>{try{await writer.write(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));}catch{abort.abort();}};
 // Also while waiting on the provider, when nothing is being written.
 writer.closed.catch(()=>abort.abort());
 const run=(async()=>{
  try{
   const result=await runAgentTurn({
    history:turn.history,memory:turn.memory,question:turn.question,signal:abort.signal,
    context:{cards:summaryCards(turn.summary),events:[],day:turn.summary.day,language:turn.summary.language,pointValues:turn.summary.pointValues},
    rounds:turn.rounds.map(r=>({message:r.message,results:r.results})),remoteTools:REMOTE,
    onProgress:p=>{void emit({type:'progress',phase:p.phase,...(p.name?{tool:p.name}:{})});},
    request:(payload,signal,options={})=>modelCall(ctx,turn,payload,signal,options,emit),
   });
   if(result.pending){
    const exp=ctx.now()+TURN_TTL_MS,messages=result.pending.rounds;
    ctx.record.wallet_calls=result.pending.calls.length;
    await emit({type:'tool_request',rounds:messages,calls:result.pending.calls,trip:result.pending.trip?validateState({trip:result.pending.trip}).trip:null,turn:{exp,sig:await signRounds(ctx,turn,messages,exp)}});
   }else{
    ctx.record.answered=true;
    // Only what the extension keeps for the next turn: no tool result goes back into its history.
    // The trace is the loop's own metadata (tool names, timings, check codes), for the wallet's diagnostics and tests.
    await emit({type:'done',answer:result.answer,memory:result.memory,history:trimHistory(result.messages),tools:result.tools,trace:result.trace,context:result.context});
   }
  }catch(e){
   const code=errorCode(e);ctx.record.error=code;
   await emit({type:'error',code});
  }finally{await writer.close().catch(()=>{});}
 })();
 ctx.deferLog(run);
 return new Response(readable,{status:200,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...ctx.cors}});
}
export {ERRORS};
