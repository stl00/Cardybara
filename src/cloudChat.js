// The extension's side of the hosted assistant (stl00/Cardybara#210). The agent runs on the Cardybara gateway; this
// sends the question, the trimmed history and the wallet summary, renders the streamed answer, and runs the wallet
// tools the agent asks for here, posting back only their results. Nothing else from the wallet leaves the browser.
import {postAgent,hostedError} from '../extension-next/model-client.js';
import {runWalletTool} from './walletAgent.js';
import {heldCards} from './heldCards.js';
import {validateState} from './conversationState.js';
import {buildWalletSummary,assistantCardName,WALLET_TOOLS} from './walletSummary.js';
import {trimHistory,sseEvents,MAX_ROUNDS,MAX_REQUEST_BYTES} from './cloudProtocol.js';

/**
 * One turn through the hosted agent. Returns what runAgentTurn returns for the chat UI: {answer, memory, messages, tools}.
 * onDelta(text) gets answer text as it streams, onDelta(null) when a new model call starts (drop the draft: only the
 * checked answer in the result is final). post is the transport, replaced in tests.
 */
export async function runCloudTurn({history=[],memory={},question,context,signal,onProgress=()=>{},onDelta=()=>{},post=postAgent}){
 const summary=buildWalletSummary({cards:context.cards,day:context.day,language:context.language,pointValues:context.pointValues});
 // Wallet tools here name cards as the summary does, so the agent sees one name per card and never a name with digits.
 const local={...context,cards:heldCards(context.cards).map(c=>({...c,name:assistantCardName(c)}))};
 const base={question,history:trimHistory(history),memory,summary};
 let rounds=null,turn=null;
 for(let request=0;request<=MAX_ROUNDS;request++){
  signal?.throwIfAborted();
  const request=rounds?{...base,rounds,turn}:base;
  // The gateway takes up to 256 KB; a turn whose rounds outgrow it ends as a too-long conversation, not a failure.
  if(new TextEncoder().encode(JSON.stringify(request)).byteLength>MAX_REQUEST_BYTES)throw Error('tool_limit');
  const body=await post(request,{signal});
  let end=null;
  try{
   for await(const event of sseEvents(body,{signal})){
    if(event?.type==='model')onDelta(null);
    else if(event?.type==='delta'&&typeof event.text==='string')onDelta(event.text);
    else if(event?.type==='progress')onProgress({phase:event.phase,...(event.tool?{name:event.tool}:{})});
    else if(['tool_request','done','error'].includes(event?.type)){end=event;break;}
   }
  }catch(error){if(signal?.aborted)throw signal.reason;throw Error('model_failed');}
  // A stream that stops before its last event is a lost connection.
  if(!end){signal?.throwIfAborted();throw Error('model_failed');}
  if(end.type==='error')throw Error(hostedError(end.code));
  if(end.type==='done'){
   if(typeof end.answer!=='string'||!end.answer.trim())throw Error('model_failed');
   return {answer:end.answer,memory:validateState(end.memory||{}),messages:trimHistory(end.history),tools:Array.isArray(end.tools)?end.tools.filter(n=>typeof n==='string'):[],trace:Array.isArray(end.trace)?end.trace:[],context:end.context||null};
  }
  // tool_request: the agent may ask only for wallet tools, and only in its newest round.
  const calls=Array.isArray(end.calls)?end.calls:[],sent=Array.isArray(end.rounds)?end.rounds:[];
  const latest=sent.at(-1)?.tool_calls||[];
  if(!calls.length||calls.length>4||sent.length>MAX_ROUNDS||sent.length<=(rounds?.length||0)||!calls.every(c=>WALLET_TOOLS.includes(c?.function?.name)&&latest.some(l=>l.id===c.id&&l.function?.name===c.function.name&&l.function?.arguments===c.function.arguments)))throw Error('model_failed');
  let trip=null;try{trip=end.trip?validateState({trip:end.trip}).trip:null;}catch{throw Error('model_failed');}
  const results={};
  for(const call of calls){
   signal?.throwIfAborted();
   onProgress({phase:'tool',name:call.function.name});
   try{results[call.id]=runWalletTool(call,{...local,trip});}catch{throw Error('model_failed');}
  }
  const before=rounds||[];
  rounds=sent.map((message,i)=>({message,results:i<before.length?before[i].results:i===sent.length-1?results:{}}));
  turn=end.turn;
 }
 throw Error('tool_limit');
}
