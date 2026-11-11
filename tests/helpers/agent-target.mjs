// The agent the tests drive. By default the loop runs in process (src/agentSession.js, as in the developer own-key
// mode). With CARDYBARA_AGENT=cloud the same tests run against the hosted agent (stl00/Cardybara#210): the turn goes
// through the extension's client (src/cloudChat.js) to the gateway's `/v1/chat` route (gateway/src/agent.js) on
// in-memory bindings, whose provider is the test's scripted model, answering as a streaming provider would.
// The test's request(payload) sees the same payload in both modes.
import {runAgentTurn as localTurn} from '../../src/agentSession.js';
import {runCloudTurn} from '../../src/cloudChat.js';
import {hostedError} from '../../extension-next/model-client.js';
import {localGateway} from '../../gateway/src/local.mjs';

export const AGENT_TARGET=process.env.CARDYBARA_AGENT==='cloud'?'cloud':'local';
export const ORIGIN='chrome-extension://'+'c'.repeat(32);
export const INVITE='cdy_'+'agent-target-test-only-'.padEnd(43,'0');

/** A provider response for one scripted reply, streamed (SSE chunks, as DeepSeek sends them) or as one JSON body. */
export function providerResponse(reply,{stream,signal}){
 if(reply==='hang')return new Promise((_,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 if(reply?.status)return new Response(JSON.stringify({error:{message:'provider text'}}),{status:reply.status,headers:{'Content-Type':'application/json'}});
 const message=reply?.message!==undefined?reply.message:reply,usage=reply?.usage?{prompt_tokens:reply.usage.promptTokens??reply.usage.prompt_tokens??1,completion_tokens:reply.usage.completionTokens??reply.usage.completion_tokens??1}:{prompt_tokens:1,completion_tokens:1};
 const finish=reply?.finishReason||(message?.tool_calls?'tool_calls':'stop');
 if(!stream)return Response.json({id:'scripted',object:'chat.completion',choices:[{index:0,message:message&&{role:'assistant',...message},finish_reason:finish}],usage});
 const chunks=[];const chunk=delta=>chunks.push({id:'scripted',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason:null}]});
 chunk({role:'assistant',content:''});
 const content=typeof message?.content==='string'?message.content:'';
 // Split text and arguments across chunks, the way a provider streams them.
 for(let i=0;i<content.length;i+=40)chunk({content:content.slice(i,i+40)});
 for(const [index,call] of (message?.tool_calls||[]).entries()){
  chunk({tool_calls:[{index,id:call.id,type:'function',function:{name:call.function?.name,arguments:''}}]});
  const args=String(call.function?.arguments??'');for(let i=0;i<args.length;i+=25)chunk({tool_calls:[{index,function:{arguments:args.slice(i,i+25)}}]});
 }
 chunks.push({id:'scripted',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:finish}]});
 chunks.push({id:'scripted',object:'chat.completion.chunk',choices:[],usage});
 const text=chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join('')+'data: [DONE]\n\n';
 return new Response(text,{status:200,headers:{'Content-Type':'text/event-stream'}});
}

/** A gateway whose provider answers with request(payload, signal), plus the extension transport to it. */
export async function cloudGateway({request,vars={},log=()=>{},now}={}){
 const observed=[],providerRequests=[],agentRequests=[];let lastPayload=null,thrown=null;
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,DAILY_REQUESTS_PER_CODE:'1000000',DAILY_TOKENS_PER_CODE:'1000000000',MONTHLY_BUDGET_USD:'1000000',...vars},log,now,observe:p=>observed.push(structuredClone(p)),
  fetch:async(url,init)=>{
   const body=JSON.parse(init.body);providerRequests.push(body);
   const payload=observed.shift();
   if(body.stream)lastPayload=payload;
   // An error the test's model throws is kept and rethrown to the test as it was, not as the Worker's code for it.
   let reply;try{reply=await request(payload,init.signal,{repair:!body.stream});}catch(error){thrown??=error;throw error;}
   return providerResponse(reply,{stream:body.stream,signal:init.signal});
  }});
 await g.addInvite(INVITE,{id:'agent-tests'});
 const post=async(body,{signal}={})=>{
  agentRequests.push(structuredClone(body));
  const response=await g.handle(new Request('https://gateway.test/v1/chat',{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+INVITE,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  if(!response.ok){const code=(await response.json()).error?.code;throw Object.assign(Error(hostedError(code)),{gatewayCode:code});}
  return response.body;
 };
 return {...g,post,providerRequests,agentRequests,lastPayload:()=>lastPayload,thrown:()=>thrown};
}

/** runAgentTurn through the hosted agent: same arguments, same result fields the tests read. */
export async function cloudTurn({history,question,context,request,memory={},onProgress,signal}){
 // The Worker accepts a wallet day within a few days of its own clock; tests run on fixed days.
 const g=await cloudGateway({request,now:context?.day?()=>Date.parse(context.day+'T12:00:00Z'):undefined});
 let result;
 try{result=await runCloudTurn({history,memory,question,context,signal,onProgress,post:g.post});}
 catch(error){throw g.thrown()||error;}
 // The extension keeps no tool result. Tests that look inside the turn get the messages of the agent's last model
 // call (as the loop's own result would hold them), then the answer; the next turn's history is trimmed again anyway.
 const seen=g.lastPayload();
 return {...result,history:result.messages,messages:seen?[...seen.messages,{role:'assistant',content:result.answer}]:result.messages};
}
export const runAgentTurn=AGENT_TARGET==='cloud'?cloudTurn:localTurn;
