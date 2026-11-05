import {completeChat} from '../extension-next/model-client.js';
import {chatRequest,acceptReply} from './chatProtocol.js';
// In the extension the wallet page calls the provider itself, with the same validated payload the local server sends.
export async function extensionChat(payload,signal,client={completeChat}){
 const request=chatRequest(payload);
 const {message,finishReason,usage}=await client.completeChat({...request,signal});
 return {message:acceptReply(message,payload,finishReason),...(usage?{usage:{promptTokens:usage.prompt_tokens,completionTokens:usage.completion_tokens,cacheHitTokens:usage.prompt_cache_hit_tokens??null}}:{})};
}
