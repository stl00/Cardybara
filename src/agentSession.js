import {runWalletTool} from './walletAgent.js';
import {prepareAgentContext,statedPointValues} from './agentContext.js';
import {validateState,reduceToolResult,topicItems,diffState} from './conversationState.js';
import {answerGrounding} from './answerGrounding.js';
import {planResults} from './creditClaims.js';
import {renderCreditAnswers} from './creditAnswer.js';
import {renderChoiceAnswer} from './decisionAnswer.js';
import {creditNamesForCards} from './creditQuery.js';
export async function runAgentTurn({history,question,context,request,memory={},onProgress=()=>{},signal}){
 if(!question.trim()||question.length>4000)throw Error('invalid_question');
 const prepared=prepareAgentContext(history,memory);
 // The conversation state. Only reduceToolResult replaces it; nothing modifies it in place.
 let state=prepared.memory,itemsWritten=false;
 const messages=[...prepared.messages,{role:'user',content:question}],tools=[],evidence=[],trace=[];
 // The model receives the wallet day every turn; it never infers the current date.
 const invoke=async(final=false,override)=>{signal?.throwIfAborted();const start=Date.now();const reply=await request({messages:override||messages,memory:state,final,...(context.day?{today:context.day}:{})},signal);trace.push({type:'model',ms:Date.now()-start,inputChars:JSON.stringify(override||messages).length,final,...(reply.usage?{usage:reply.usage}:{})});return reply.message;};
 const creditNames=creditNamesForCards(context.cards,context.day);
 const groundingContext=()=>question+' '+JSON.stringify(state.lastPurchase||{})+' '+JSON.stringify(state.trip||{})+' '+(context.day||'');
 // Complete turns only; old tool evidence is not replayed as current account state.
 for(let round=0;round<5;round++){
  onProgress({phase:round?'thinking':'connecting',tools:[...tools]});
  let message=await invoke(round===4);
  if(!message||message.role!=='assistant')throw Error('invalid_response');
  if(!message.tool_calls?.length){
   if(!message.content?.trim())throw Error('empty_answer');
   let grade=answerGrounding(message.content,evidence,{contextText:groundingContext(),creditNames});trace.push({type:'grounding',passed:grade.passed,codes:grade.issues.map(i=>i.code)});
   if(!grade.passed){
    // One bounded repair attempt. No new tools or changes to wallet state.
    const correction={role:'user',content:'The answer checker found unsupported claims: '+JSON.stringify(grade.issues)+'. Rewrite using only the supplied tool evidence. Remove unsupported numbers, links and action claims. Explain missing facts rather than guessing. An item with unknown status must be described as not confirmed, never as unused. State the assumed dates and cover every credit the tool returned. Answer the original question in its language.'};
    message=await invoke(true,[...messages,message,correction]);
    if(!message||message.role!=='assistant'||message.tool_calls?.length||!message.content?.trim())throw Error('invalid_repair');
    grade=answerGrounding(message.content,evidence,{contextText:groundingContext(),creditNames});trace.push({type:'repair',passed:grade.passed,codes:grade.issues.map(i=>i.code)});if(!grade.passed){
     // Credit facts are already computed, so code can state them plainly rather than refuse the question.
     const choice=evidence.findLast(x=>x?.tool==='choose_card'&&x.choice);
     const plans=planResults(evidence);
     if(!plans.length&&!choice)throw Object.assign(Error('answer_not_grounded'),{codes:grade.issues.map(i=>i.code)});
     // Say so when the turn asked for more than these lookups can answer.
     const onlyTool=choice?'choose_card':'query_credits',partial=tools.some(name=>name!==onlyTool)||evidence.some(x=>x?.needsDates);
     message={role:'assistant',content:choice?renderChoiceAnswer(choice,question):renderCreditAnswers(plans,question,{partial})};trace.push({type:'fallback',codes:grade.issues.map(i=>i.code)});
    }
   }
   messages.push(message);
   return {messages,answer:message.content,tools,memory:validateState(state),trace,context:{droppedTurns:prepared.droppedTurns,historyChars:prepared.chars}};
  }
  if(round===4||message.tool_calls.length>4)throw Error('tool_limit');
  // The model can't introduce a point value: one the user didn't say is dropped before the tool runs, and before the call enters history.
  message={...message,tool_calls:message.tool_calls.map(call=>{
   if(call.function.name!=='choose_card')return call;
   const raw=JSON.parse(call.function.arguments||'{}');if(!raw.pointValues)return call;
   const kept=statedPointValues(raw.pointValues,question,state.lastPurchase?.pointValues),{pointValues,...rest}=raw;
   return {...call,function:{...call.function,arguments:JSON.stringify(kept?{...rest,pointValues:kept}:rest)}};
  })};
  messages.push(message);
  for(const call of message.tool_calls){
   signal?.throwIfAborted();
   const start=Date.now(),result=runWalletTool(call,{...context,trip:state.trip}),args=JSON.parse(call.function.arguments||'{}');tools.push(call.function.name);evidence.push(result,args);
   // Each tool result updates the state through the reducers; the trace records what changed, channel by channel.
   const event={name:call.function.name,args,result},before=state;
   state=reduceToolResult(state,event,{cards:context.cards,appendItems:itemsWritten});itemsWritten||=topicItems(event,context.cards).length>0;
   const changes=diffState(before,state);if(changes.length)trace.push({type:'state',tool:call.function.name,changes});
   trace.push({type:'tool',name:call.function.name,ms:Date.now()-start,resultChars:JSON.stringify(result).length,...(['find_benefits','get_card_rules'].includes(call.function.name)?{matches:result.totalMatches,returned:result.rules.length,truncated:result.truncated}:{}),...(call.function.name==='choose_card'?{choice:result.choice?.kind,certainty:result.choice?.certainty||null,rows:result.totalRows,excluded:result.excluded?.length}:{}),...(call.function.name==='query_credits'?{needsDates:!!result.needsDates,...(result.groupCounts?{groups:result.groupCounts,truncated:result.truncated}:{})}:{})});
   onProgress({phase:'tool',name:call.function.name,tools:[...tools]});messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
  }
 }
 throw Error('tool_limit');
}
