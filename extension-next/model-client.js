// The one model client for the extension: wallet chat, card-type suggestions and model-assisted bank parsing.
// The owner pastes the key. It lives only in chrome.storage.local, goes only to the provider's API host, and is
// never logged, exported, synced or shown in full after saving.
export const KEY_STORE='cardybara-model-key';
export const PROVIDERS={deepseek:{label:'DeepSeek',origin:'https://api.deepseek.com',chat:'https://api.deepseek.com/chat/completions',models:'https://api.deepseek.com/models',model:'deepseek-flash'}};
const local=()=>globalThis.chrome?.storage?.local||null;
const permissionFor=provider=>({origins:[PROVIDERS[provider].origin+'/*']});
export const validKey=key=>typeof key==='string'&&/^[\x21-\x7e]{16,200}$/.test(key);
export const maskKey=key=>key.slice(0,3)+'…'+key.slice(-4);
async function readKey(){
 const store=local();if(!store)return null;
 const saved=(await store.get(KEY_STORE))[KEY_STORE];
 return saved&&PROVIDERS[saved.provider]&&validKey(saved.key)?saved:null;
}
export async function hasPermission(provider){try{return !!(await chrome.permissions.contains(permissionFor(provider)));}catch{return false;}}
/** Must run from a click: Chrome only shows the permission prompt for a user gesture. */
export async function requestPermission(provider){if(!PROVIDERS[provider])throw Error('invalid_provider');return !!(await chrome.permissions.request(permissionFor(provider)));}
export async function keyStatus(){
 const saved=await readKey();if(!saved)return {saved:false,enabled:false,permission:false,ready:false};
 const permission=await hasPermission(saved.provider),enabled=saved.enabled!==false;
 return {saved:true,provider:saved.provider,label:PROVIDERS[saved.provider].label,model:PROVIDERS[saved.provider].model,masked:maskKey(saved.key),savedAt:saved.savedAt,enabled,permission,ready:enabled&&permission};
}
export async function isModelReady(){return (await keyStatus()).ready;}
export async function saveKey({provider,key}){
 if(!PROVIDERS[provider])throw Error('invalid_provider');if(!validKey(key))throw Error('invalid_key');
 const store=local();if(!store)throw Error('storage_unavailable');
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
 // Error codes only. Provider text can echo the request, so it never travels further.
 if(response.status===401||response.status===403)throw Error('model_auth_failed');
 if(response.status===429)throw Error('model_rate_limited');
 if(!response.ok)throw Error('model_failed');
 try{return await response.json();}catch{throw Error('model_failed');}
}
async function ready(){const saved=await readKey();if(!saved||saved.enabled===false)throw Error('model_not_ready');return saved;}
/** Checks a key before or after saving it, with a request that costs nothing. */
export async function testKey(candidate){
 const {provider,key}=candidate||await ready();
 if(!PROVIDERS[provider]||!validKey(key))throw Error('invalid_key');
 await send(PROVIDERS[provider].models,{provider,key,method:'GET',timeout:10000});return true;
}
/** A provider request body as built by agent-core or the chat protocol. */
export async function completeBody(body,{signal,timeout}={}){
 const saved=await ready(),target=PROVIDERS[saved.provider];
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
