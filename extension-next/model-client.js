// The one model client for the extension: wallet chat, card-type suggestions and model-assisted bank parsing.
// Two ways to reach a model: the Cardybara hosted gateway, which needs no credential (no invite code since
// 2026-11-16) and is on by default, or the owner's own provider key (developer-only). An own key lives only in
// chrome.storage.local, goes only to its provider, and is never logged, exported, synced or shown in full.
export const KEY_STORE='cardybara-model-key';
// The hosted gateway (gateway/ in this repo, docs/GATEWAY.md). It must equal the manifest's optional host
// permission, which builds from before 2026-11-16 asked for; requests to it are plain CORS requests the gateway
// allows for extension origins, so it needs no permission. A name under .invalid marks the hosted service as not open.
export const GATEWAY_ORIGIN='https://cardybara-gateway.cardybara.workers.dev';
export const gatewayConfigured=!new URL(GATEWAY_ORIGIN).hostname.endsWith('.invalid');
export const HOSTED='cardybara';
export const PROVIDERS={
 deepseek:{label:'DeepSeek',origin:'https://api.deepseek.com',chat:'https://api.deepseek.com/chat/completions',models:'https://api.deepseek.com/models',model:'deepseek-flash'},
 [HOSTED]:{label:'Cardybara 托管服务',origin:GATEWAY_ORIGIN,chat:GATEWAY_ORIGIN+'/v1/chat/completions',agent:GATEWAY_ORIGIN+'/v1/chat',check:GATEWAY_ORIGIN+'/v1/invite',model:'deepseek-flash',hosted:true},
};
// The beta offers the hosted service only. An own provider key is a developer-only mode (local development and
// the owner's live evals), switched on by this storage flag from DevTools or a test harness; no wallet UI sets it.
export const DEV_OWN_KEY='cardybara-dev-own-key';
export async function ownKeyAllowed(){try{return (await local()?.get(DEV_OWN_KEY))?.[DEV_OWN_KEY]===true;}catch{return false;}}
function local(){return globalThis.chrome?.storage?.local||null;}
const permissionFor=provider=>({origins:[PROVIDERS[provider].origin+'/*']});
// A Cardybara invite code (cdy_…, from builds before 2026-11-16) pasted as an own key would go to the provider, so
// it is never a valid key.
const OLD_INVITE=/^cdy_[A-Za-z0-9_-]{43}$/;
export const validKey=key=>typeof key==='string'&&/^[\x21-\x7e]{16,200}$/.test(key)&&!OLD_INVITE.test(key);
export const maskKey=key=>key.slice(0,3)+'…'+key.slice(-4);
/**
 * The saved setting: an own key {provider,key,…}, or the hosted service {provider:HOSTED,enabled}. With nothing saved
 * the hosted service is on (when it is open). A record from an older build that still holds an invite code is
 * rewritten without it: the code is not needed and is not kept.
 */
async function readKey(){
 const store=local();if(!store)return null;
 const saved=(await store.get(KEY_STORE))[KEY_STORE];
 if(saved&&PROVIDERS[saved.provider]?.hosted){
  const hosted={provider:HOSTED,enabled:saved.enabled!==false,...(saved.savedAt?{savedAt:saved.savedAt}:{})};
  if('key' in saved)await store.set({[KEY_STORE]:hosted});
  return gatewayConfigured?hosted:null;
 }
 if(saved&&PROVIDERS[saved.provider]&&validKey(saved.key))return saved;
 return gatewayConfigured?{provider:HOSTED,enabled:true,default:true}:null;
}
export async function hasPermission(provider){try{return !!(await chrome.permissions.contains(permissionFor(provider)));}catch{return false;}}
/** Must run from a click: Chrome only shows the permission prompt for a user gesture. */
export async function requestPermission(provider){if(!PROVIDERS[provider])throw Error('invalid_provider');return !!(await chrome.permissions.request(permissionFor(provider)));}
export async function keyStatus(){
 const saved=await readKey();if(!saved)return {saved:false,enabled:false,permission:false,ready:false};
 const target=PROVIDERS[saved.provider],enabled=saved.enabled!==false;
 // The hosted service needs no key and no host permission; `saved` stays false for it, as nothing secret is stored.
 if(target.hosted)return {saved:false,provider:HOSTED,hosted:true,label:target.label,model:target.model,enabled,permission:true,ready:enabled};
 const permission=await hasPermission(saved.provider);
 return {saved:true,provider:saved.provider,hosted:false,label:target.label,model:target.model,masked:maskKey(saved.key),savedAt:saved.savedAt,enabled,permission,ready:enabled&&permission};
}
export async function isModelReady(){return (await keyStatus()).ready;}
/** Saves an own provider key (developer-only mode). The hosted service has nothing to save. */
export async function saveKey({provider,key}){
 if(!PROVIDERS[provider]||PROVIDERS[provider].hosted)throw Error('invalid_provider');if(!validKey(key))throw Error('invalid_key');
 const store=local();if(!store)throw Error('storage_unavailable');
 if(!await ownKeyAllowed())throw Error('own_key_disabled');
 await store.set({[KEY_STORE]:{provider,key,savedAt:new Date().toISOString(),enabled:true}});
 return keyStatus();
}
export async function setModelEnabled(enabled){
 const saved=await readKey();if(!saved)throw Error('model_not_ready');
 const {default:_,...record}=saved;
 await local().set({[KEY_STORE]:{...record,enabled:!!enabled}});return keyStatus();
}
/** Removes an own key; the wallet goes back to the hosted service (on). */
export async function deleteKey(){
 await local()?.remove(KEY_STORE);
 // Giving every provider's host permission back too, even if the stored record was damaged, so nothing can reach a provider without a new key and a new prompt.
 for(const provider of Object.keys(PROVIDERS))await chrome.permissions.remove(permissionFor(provider)).catch(()=>false);
 return keyStatus();
}
async function send(url,{provider,key,method='POST',body,signal,timeout=45000}){
 const target=PROVIDERS[provider];
 if(!target||new URL(url).origin!==target.origin)throw Error('unexpected_model_destination');
 if(!target.hosted&&!await hasPermission(provider))throw Error('model_not_ready');
 const signals=[AbortSignal.timeout(timeout),signal].filter(Boolean);
 let response;
 // The hosted service gets no Authorization header: there is no credential to send.
 try{response=await fetch(url,{method,headers:{...(target.hosted?{}:{Authorization:'Bearer '+key}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any(signals)});}
 catch(error){if(signal?.aborted)throw error;throw Error('model_failed');}
 // Error codes only. Provider text can echo the request, so it never travels further. The gateway's own
 // error codes are a fixed list and are read from its body; anything else falls back to the status.
 if(target.hosted&&!response.ok)throw Error(await gatewayError(response));
 if(response.status===401||response.status===403)throw Error('model_auth_failed');
 if(response.status===429)throw Error('model_rate_limited');
 if(!response.ok)throw Error('model_failed');
 try{return await response.json();}catch{throw Error('model_failed');}
}
// daily_requests / daily_tokens: this network address used its daily share. monthly_budget: the service's own
// daily or monthly budget is used up.
const GATEWAY_ERRORS={daily_requests:'hosted_client_cap',daily_tokens:'hosted_client_cap',monthly_budget:'hosted_over_cap',provider_rate_limited:'model_rate_limited',rate_limited:'model_rate_limited'};
/** The code the wallet shows for a gateway error code, from a response or a streamed error event. */
export const hostedError=code=>code==='too_large'?'tool_limit':['answer_not_grounded','tool_limit'].includes(code)?code:Object.hasOwn(GATEWAY_ERRORS,code)?GATEWAY_ERRORS[code]:'model_failed';
async function gatewayError(response){
 let code=null;try{code=(await response.json())?.error?.code;}catch{}
 return Object.hasOwn(GATEWAY_ERRORS,code)?GATEWAY_ERRORS[code]:'model_failed';
}
async function ready(){const saved=await readKey();if(!saved||saved.enabled===false)throw Error('model_not_ready');return saved;}
/** Checks the hosted service, or an own key before or after saving it, with a request that costs nothing. */
export async function testKey(candidate){
 const {provider,key}=candidate||await ready();
 if(!PROVIDERS[provider])throw Error('invalid_key');
 const target=PROVIDERS[provider];
 if(!target.hosted&&!validKey(key))throw Error('invalid_key');
 if(target.hosted)await send(target.check,{provider,method:'POST',timeout:10000});
 else await send(target.models,{provider,key,method:'GET',timeout:10000});
 return true;
}
/** A provider request body as built by agent-core or the chat protocol. */
export async function completeBody(body,{signal,timeout,hosted=true}={}){
 const saved=await ready(),target=PROVIDERS[saved.provider];
 // Bank-page parsing passes hosted:false: bank figures never go through the Cardybara gateway.
 if(target.hosted&&!hosted)throw Error('model_not_ready');
 return send(target.chat,{provider:saved.provider,key:saved.key,body:{...body,model:target.model},signal,timeout});
}
export async function completeChat({messages,tools,toolChoice='auto',maxTokens=1800,temperature=0.2,signal}){
 const response=await completeBody({messages,...(tools?{tools,tool_choice:toolChoice}:{}),max_tokens:maxTokens,temperature,thinking:{type:'disabled'}},{signal});
 const choice=response.choices?.[0];
 return {message:choice?.message||null,finishReason:choice?.finish_reason||null,usage:response.usage||null};
}
export async function completeJSON({system,user,maxTokens=600,signal}){
 const response=await completeBody({messages:[{role:'system',content:system},{role:'user',content:user}],response_format:{type:'json_object'},max_tokens:maxTokens,temperature:0,thinking:{type:'disabled'}},{signal});
 const message=response.choices?.[0]?.message,finishReason=response.choices?.[0]?.finish_reason;
 if(finishReason==='length')throw Error('answer_truncated');
 try{const parsed=JSON.parse(message?.content||'');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed;}catch{throw Error('invalid_json');}
}
/**
 * The hosted assistant (stl00/Cardybara#210): posts one /v1/chat request (no credential) and returns the
 * response body, a stream of server-sent events (src/cloudProtocol.js). Only the hosted service has this route.
 * Gateway errors become the same codes as for completions; a connection that fails becomes model_failed.
 */
export async function postAgent(body,{signal,timeout=30000,idle=200000}={}){
 const saved=await ready(),target=PROVIDERS[saved.provider];
 if(!target.hosted)throw Error('model_not_ready');
 // A turn may hold several model calls, so the whole stream has no limit: it fails when the response does not start
 // within timeout, or when nothing arrives for idle (longer than a provider call takes to start streaming).
 const stall=new AbortController();let timer=setTimeout(()=>stall.abort(),timeout);
 let response;
 try{response=await fetch(target.agent,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([stall.signal,signal].filter(Boolean))});}
 catch(error){clearTimeout(timer);if(signal?.aborted)throw error;throw Error('model_failed');}
 clearTimeout(timer);
 if(!response.ok)throw Error(await gatewayError(response));
 if(!/^text\/event-stream/i.test(response.headers.get('Content-Type')||'')||!response.body)throw Error('model_failed');
 const watch=()=>{clearTimeout(timer);timer=setTimeout(()=>stall.abort(),idle);};watch();
 return response.body.pipeThrough(new TransformStream({transform(chunk,c){watch();c.enqueue(chunk);},flush(){clearTimeout(timer);}}));
}
/** Whether the hosted service is the one in use (the assistant then runs in the cloud). */
export async function hostedReady(){const saved=await readKey();return !!saved&&saved.enabled!==false&&!!PROVIDERS[saved.provider]?.hosted;}
