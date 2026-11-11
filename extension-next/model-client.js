// The one model client for the extension: wallet chat, card-type suggestions and model-assisted bank parsing.
// Two ways to reach a model: the Cardybara hosted gateway with an invite code, or the owner's own provider key.
// Either credential lives only in chrome.storage.local, goes only to its own host, and is never logged,
// exported, synced or shown in full after saving.
export const KEY_STORE='cardybara-model-key';
// The hosted gateway (gateway/ in this repo, docs/GATEWAY.md). It must equal the manifest's optional host
// permission. A name under .invalid marks the hosted service as not open (the setting then defaults to an own key).
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
export const INVITE_PATTERN=/^cdy_[A-Za-z0-9_-]{43}$/;
function local(){return globalThis.chrome?.storage?.local||null;}
const permissionFor=provider=>({origins:[PROVIDERS[provider].origin+'/*']});
export const validInvite=code=>typeof code==='string'&&INVITE_PATTERN.test(code);
// An invite code pasted as an own key would go to the provider, so it is never a valid key.
export const validKey=key=>typeof key==='string'&&/^[\x21-\x7e]{16,200}$/.test(key)&&!validInvite(key);
const validCredential=(provider,key)=>PROVIDERS[provider]?.hosted?validInvite(key):validKey(key);
export const maskKey=key=>key.slice(0,3)+'…'+key.slice(-4);
async function readKey(){
 const store=local();if(!store)return null;
 const saved=(await store.get(KEY_STORE))[KEY_STORE];
 return saved&&PROVIDERS[saved.provider]&&validCredential(saved.provider,saved.key)?saved:null;
}
export async function hasPermission(provider){try{return !!(await chrome.permissions.contains(permissionFor(provider)));}catch{return false;}}
/** Must run from a click: Chrome only shows the permission prompt for a user gesture. */
export async function requestPermission(provider){if(!PROVIDERS[provider])throw Error('invalid_provider');return !!(await chrome.permissions.request(permissionFor(provider)));}
export async function keyStatus(){
 const saved=await readKey();if(!saved)return {saved:false,enabled:false,permission:false,ready:false};
 const permission=await hasPermission(saved.provider),enabled=saved.enabled!==false;
 return {saved:true,provider:saved.provider,hosted:!!PROVIDERS[saved.provider].hosted,label:PROVIDERS[saved.provider].label,model:PROVIDERS[saved.provider].model,masked:maskKey(saved.key),savedAt:saved.savedAt,enabled,permission,ready:enabled&&permission};
}
export async function isModelReady(){return (await keyStatus()).ready;}
export async function saveKey({provider,key}){
 if(!PROVIDERS[provider])throw Error('invalid_provider');if(!validCredential(provider,key))throw Error(PROVIDERS[provider].hosted?'invalid_invite':'invalid_key');
 const store=local();if(!store)throw Error('storage_unavailable');
 if(!PROVIDERS[provider].hosted&&!await ownKeyAllowed())throw Error('own_key_disabled');
 await store.set({[KEY_STORE]:{provider,key,savedAt:new Date().toISOString(),enabled:true}});
 return keyStatus();
}
export async function setModelEnabled(enabled){
 const saved=await readKey();if(!saved)throw Error('model_not_ready');
 await local().set({[KEY_STORE]:{...saved,enabled:!!enabled}});return keyStatus();
}
export async function deleteKey(){
 await local()?.remove(KEY_STORE);
 // Giving every provider's host permission back too, even if the stored record was damaged, so nothing can reach a provider without a new key and a new prompt.
 for(const provider of Object.keys(PROVIDERS))await chrome.permissions.remove(permissionFor(provider)).catch(()=>false);
 return keyStatus();
}
async function send(url,{provider,key,method='POST',body,signal,timeout=45000}){
 const target=PROVIDERS[provider];
 if(!target||new URL(url).origin!==target.origin)throw Error('unexpected_model_destination');
 if(!await hasPermission(provider))throw Error('model_not_ready');
 const signals=[AbortSignal.timeout(timeout),signal].filter(Boolean);
 let response;
 try{response=await fetch(url,{method,headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any(signals)});}
 catch(error){if(signal?.aborted)throw error;throw Error('model_failed');}
 // Error codes only. Provider text can echo the request, so it never travels further. The gateway's own
 // error codes are a fixed list and are read from its body; anything else falls back to the status.
 if(target.hosted&&!response.ok)throw Error(await gatewayError(response));
 if(response.status===401||response.status===403)throw Error('model_auth_failed');
 if(response.status===429)throw Error('model_rate_limited');
 if(!response.ok)throw Error('model_failed');
 try{return await response.json();}catch{throw Error('model_failed');}
}
const GATEWAY_ERRORS={invite_invalid:'invite_invalid',invite_revoked:'invite_revoked',daily_requests:'hosted_over_cap',daily_tokens:'hosted_over_cap',monthly_budget:'hosted_over_cap',provider_rate_limited:'model_rate_limited',rate_limited:'model_rate_limited'};
/** The code the wallet shows for a gateway error code, from a response or a streamed error event. */
export const hostedError=code=>code==='too_large'?'tool_limit':['answer_not_grounded','tool_limit'].includes(code)?code:Object.hasOwn(GATEWAY_ERRORS,code)?GATEWAY_ERRORS[code]:'model_failed';
async function gatewayError(response){
 let code=null;try{code=(await response.json())?.error?.code;}catch{}
 return Object.hasOwn(GATEWAY_ERRORS,code)?GATEWAY_ERRORS[code]:response.status===401?'invite_invalid':'model_failed';
}
async function ready(){const saved=await readKey();if(!saved||saved.enabled===false)throw Error('model_not_ready');return saved;}
/** Checks a key or invite code before or after saving it, with a request that costs nothing. */
export async function testKey(candidate){
 const {provider,key}=candidate||await ready();
 if(!PROVIDERS[provider])throw Error('invalid_key');
 if(!validCredential(provider,key))throw Error(PROVIDERS[provider].hosted?'invalid_invite':'invalid_key');
 const target=PROVIDERS[provider];
 if(target.hosted)await send(target.check,{provider,key,method:'POST',timeout:10000});
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
 * The hosted assistant (stl00/Cardybara#210): posts one /v1/chat request with the invite code and returns the
 * response body, a stream of server-sent events (src/cloudProtocol.js). Only the hosted service has this route.
 * Gateway errors become the same codes as for completions; a connection that fails becomes model_failed.
 */
export async function postAgent(body,{signal,timeout=30000,idle=200000}={}){
 const saved=await ready(),target=PROVIDERS[saved.provider];
 if(!target.hosted)throw Error('model_not_ready');
 if(!await hasPermission(saved.provider))throw Error('model_not_ready');
 // A turn may hold several model calls, so the whole stream has no limit: it fails when the response does not start
 // within timeout, or when nothing arrives for idle (longer than a provider call takes to start streaming).
 const stall=new AbortController();let timer=setTimeout(()=>stall.abort(),timeout);
 let response;
 try{response=await fetch(target.agent,{method:'POST',headers:{Authorization:'Bearer '+saved.key,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([stall.signal,signal].filter(Boolean))});}
 catch(error){clearTimeout(timer);if(signal?.aborted)throw error;throw Error('model_failed');}
 clearTimeout(timer);
 if(!response.ok)throw Error(await gatewayError(response));
 if(!/^text\/event-stream/i.test(response.headers.get('Content-Type')||'')||!response.body)throw Error('model_failed');
 const watch=()=>{clearTimeout(timer);timer=setTimeout(()=>stall.abort(),idle);};watch();
 return response.body.pipeThrough(new TransformStream({transform(chunk,c){watch();c.enqueue(chunk);},flush(){clearTimeout(timer);}}));
}
/** Whether the saved credential is the hosted service's invite code (the assistant then runs in the cloud). */
export async function hostedReady(){const saved=await readKey();return !!saved&&saved.enabled!==false&&!!PROVIDERS[saved.provider]?.hosted;}
