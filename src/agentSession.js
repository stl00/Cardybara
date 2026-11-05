import {runWalletTool} from './walletAgent.js';
import {prepareAgentContext,validateMemory} from './agentContext.js';
import {answerGrounding} from './answerGrounding.js';
import {planResults} from './creditClaims.js';
import {renderCreditAnswer} from './creditAnswer.js';
export async function runAgentTurn({history,question,context,request,memory={},onProgress=()=>{},signal}){
 if(!question.trim()||question.length>4000)throw Error('invalid_question');
 const prepared=prepareAgentContext(history,memory),state=prepared.memory;
 const messages=[...prepared.messages,{role:'user',content:question}],tools=[],evidence=[],trace=[];
 // The model receives the wallet day every turn; it never infers the current date.
 const invoke=async(final=false,override)=>{signal?.throwIfAborted();const start=Date.now();const reply=await request({messages:override||messages,memory:state,final,...(context.day?{today:context.day}:{})},signal);trace.push({type:'model',ms:Date.now()-start,inputChars:JSON.stringify(override||messages).length,final,...(reply.usage?{usage:reply.usage}:{})});return reply.message;};
 const groundingContext=()=>question+' '+JSON.stringify(state.lastComparison||{})+' '+JSON.stringify(state.trip||{})+' '+(context.day||'');
 // Complete turns only; old tool evidence is not replayed as current account state.
 for(let round=0;round<5;round++){
  onProgress({phase:round?'thinking':'connecting',tools:[...tools]});
  let message=await invoke(round===4);
  if(!message||message.role!=='assistant')throw Error('invalid_response');
  if(!message.tool_calls?.length){
   if(!message.content?.trim())throw Error('empty_answer');
   let grade=answerGrounding(message.content,evidence,{contextText:groundingContext()});trace.push({type:'grounding',passed:grade.passed,codes:grade.issues.map(i=>i.code)});
   if(!grade.passed){
    // One bounded repair attempt. No new tools or changes to wallet state.
    const correction={role:'user',content:'The answer checker found unsupported claims: '+JSON.stringify(grade.issues)+'. Rewrite using only the supplied tool evidence. Remove unsupported numbers, links and action claims. Explain missing facts rather than guessing. An item with unknown status must be described as not confirmed, never as unused. State the assumed dates and cover every credit the tool returned. Answer the original question in its language.'};
    message=await invoke(true,[...messages,message,correction]);
    if(!message||message.role!=='assistant'||message.tool_calls?.length||!message.content?.trim())throw Error('invalid_repair');
    grade=answerGrounding(message.content,evidence,{contextText:groundingContext()});trace.push({type:'repair',passed:grade.passed,codes:grade.issues.map(i=>i.code)});if(!grade.passed){
     // Credit facts are already computed, so code can state them plainly rather than refuse the question.
     const plan=planResults(evidence).at(-1);
     if(!plan)throw Object.assign(Error('answer_not_grounded'),{codes:grade.issues.map(i=>i.code)});
     message={role:'assistant',content:renderCreditAnswer(plan,question)};trace.push({type:'fallback',codes:grade.issues.map(i=>i.code)});
    }
   }
   messages.push(message);
   return {messages,answer:message.content,tools,memory:validateMemory(state),trace,context:{droppedTurns:prepared.droppedTurns,historyChars:prepared.chars}};
  }
  if(round===4||message.tool_calls.length>4)throw Error('tool_limit');messages.push(message);
  for(const call of message.tool_calls){
   signal?.throwIfAborted();const start=Date.now(),result=runWalletTool(call,{...context,trip:state.trip}),args=JSON.parse(call.function.arguments||'{}');tools.push(call.function.name);evidence.push(result,args);
   if(call.function.name==='compare_cards')state.lastComparison=args;
   // Only dates that code resolved reach memory, so a failed resolution keeps the previous trip.
   if(call.function.name==='query_credits'&&result.window&&result.window.precision!=='current-cycle')state.trip={...(result.use?{use:result.use}:{}),start:result.window.start,end:result.window.end,precision:result.window.precision,...(result.destination?{destination:result.destination}:{})};
   trace.push({type:'tool',name:call.function.name,ms:Date.now()-start,resultChars:JSON.stringify(result).length,...(['find_benefits','get_card_rules'].includes(call.function.name)?{matches:result.totalMatches,returned:result.rules.length,truncated:result.truncated}:{}),...(call.function.name==='query_credits'?{needsDates:!!result.needsDates,...(result.groupCounts?{groups:result.groupCounts,truncated:result.truncated}:{})}:{})});
   onProgress({phase:'tool',name:call.function.name,tools:[...tools]});messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
  }
 }
 throw Error('tool_limit');
}
