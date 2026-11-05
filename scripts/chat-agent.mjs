import {createDeepSeekClient} from './deepseek-client.mjs';
import {chatRequest,acceptReply,validateChat} from '../src/chatProtocol.js';
export {validateChat};
export async function chatAgent(env,payload,fetcher=fetch,signal,{onUsage}={}){
 const request=chatRequest(payload),client=createDeepSeekClient(env,{fetcher});
 const body=await client.chat.completions.create({model:env.DEEPSEEK_MODEL||'deepseek-flash',messages:request.messages,thinking:{type:'disabled'},tools:request.tools,tool_choice:request.toolChoice,max_tokens:request.maxTokens,temperature:request.temperature},{signal});
 if(body.usage)onUsage?.(body.usage);
 return acceptReply(body.choices?.[0]?.message,payload,body.choices?.[0]?.finish_reason);
}
