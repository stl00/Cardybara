import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {KEY_STORE,PROVIDERS,GATEWAY_ORIGIN,HOSTED,validInvite,keyStatus,saveKey,deleteKey,setModelEnabled,isModelReady,testKey,completeChat,completeJSON,completeBody,maskKey,validKey,requestPermission} from '../extension-next/model-client.js';
import {parserStatus,modelParse} from '../extension-next/parser-client.js';
import {extensionChat} from '../src/extensionChat.js';
import {chatRequest} from '../src/chatProtocol.js';
import {chatAgent} from '../scripts/chat-agent.mjs';
import {suggestInExtension} from '../src/productSuggestion.js';
import {suggestionMessages,validateSuggestRequest} from '../src/productSuggestProtocol.js';
// A made-up key for tests. The real key is only ever pasted by the owner into the extension.
const KEY='test-only-0123456789abcdef';
function fakeChrome({granted=true}={}){
 const local=new Map(),calls={sync:0,permissionRequests:[],removed:[]};
 globalThis.chrome={
  storage:{local:{get:async k=>local.has(k)?{[k]:structuredClone(local.get(k))}:{},set:async o=>{for(const [k,v] of Object.entries(o))local.set(k,structuredClone(v));},remove:async k=>{local.delete(k);}},sync:new Proxy({},{get:()=>{calls.sync++;throw Error('sync must not be used');}})},
  permissions:{contains:async o=>granted&&['https://api.deepseek.com/*',GATEWAY_ORIGIN+'/*'].includes(o.origins[0]),request:async o=>{calls.permissionRequests.push(o.origins);return granted;},remove:async o=>{calls.removed.push(o.origins);granted=false;return true;}}
 };
 return {local,calls,grant:value=>{granted=value;}};
}
function fakeProvider(reply=()=>({choices:[{message:{role:'assistant',content:'hello'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1}})){
 const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});const r=reply(String(url),options);if(r instanceof Error)throw r;if(r?.status)return {ok:false,status:r.status,json:async()=>({error:{message:'echo '+options.headers.Authorization}})};return {ok:true,status:200,json:async()=>r};};
 return requests;
}
test('the key is saved locally only, masked after saving, and removed with its permission',async()=>{
 const {local,calls}=fakeChrome();
 assert.equal(await isModelReady(),false);assert.deepEqual(await keyStatus(),{saved:false,enabled:false,permission:false,ready:false});
 const status=await saveKey({provider:'deepseek',key:KEY});
 assert.equal(status.ready,true);assert.equal(status.masked,'tes…cdef');assert.ok(!JSON.stringify(status).includes(KEY));
 assert.equal(local.get(KEY_STORE).key,KEY);assert.equal(calls.sync,0);
 assert.equal(await requestPermission('deepseek'),true);assert.deepEqual(calls.permissionRequests,[['https://api.deepseek.com/*']]);await assert.rejects(()=>requestPermission('evil'),/invalid_provider/);
 await setModelEnabled(false);assert.equal(await isModelReady(),false);await setModelEnabled(true);
 assert.equal((await deleteKey()).saved,false);assert.equal(local.has(KEY_STORE),false);assert.deepEqual(calls.removed,[['https://api.deepseek.com/*'],['https://cardybara-gateway.invalid/*']]);
 for(const bad of ['','short','has space inside key here','x'.repeat(201),'中文密钥中文密钥中文密钥'])await assert.rejects(()=>saveKey({provider:'deepseek',key:bad}),/invalid_key/,bad);
 await assert.rejects(()=>saveKey({provider:'evil',key:KEY}),/invalid_provider/);
 assert.equal(validKey(KEY),true);assert.equal(maskKey(KEY).length<KEY.length,true);
});
test('without the host permission or a key, nothing is sent',async()=>{
 const chrome=fakeChrome({granted:false}),requests=fakeProvider();
 await saveKey({provider:'deepseek',key:KEY});assert.equal(await isModelReady(),false);
 await assert.rejects(()=>completeChat({messages:[{role:'user',content:'hi'}]}),/model_not_ready/);
 chrome.grant(true);await deleteKey();
 await assert.rejects(()=>completeChat({messages:[{role:'user',content:'hi'}]}),/model_not_ready/);
 assert.equal(requests.length,0);
});
test('requests go only to the provider host, with the key in the header and never in the URL',async()=>{
 fakeChrome();const requests=fakeProvider();await saveKey({provider:'deepseek',key:KEY});
 const reply=await completeChat({messages:[{role:'user',content:'hi'}],tools:[],maxTokens:50});
 assert.equal(reply.message.content,'hello');assert.equal(reply.usage.prompt_tokens,3);
 const sent=requests[0];assert.equal(sent.url,PROVIDERS.deepseek.chat);assert.ok(!sent.url.includes(KEY));
 assert.equal(sent.options.headers.Authorization,'Bearer '+KEY);assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.redirect,'error');
 const body=JSON.parse(sent.options.body);assert.equal(body.model,'deepseek-flash');assert.ok(!JSON.stringify(body).includes(KEY));
 // A body can't redirect the model or the destination.
 await completeBody({model:'other-model',messages:[]});assert.equal(JSON.parse(requests[1].options.body).model,'deepseek-flash');
});
test('provider failures become codes that never carry the key or provider text',async()=>{
 fakeChrome();await saveKey({provider:'deepseek',key:KEY});
 for(const [status,code] of [[401,'model_auth_failed'],[403,'model_auth_failed'],[429,'model_rate_limited'],[500,'model_failed']]){
  fakeProvider(()=>({status}));const error=await completeChat({messages:[]}).catch(e=>e);
  assert.equal(error.message,code);assert.ok(!String(error.stack).includes(KEY));
 }
 fakeProvider(()=>new TypeError('network down: '+KEY));const network=await completeChat({messages:[]}).catch(e=>e);assert.equal(network.message,'model_failed');assert.ok(!network.message.includes(KEY));
});
test('testKey checks a candidate without saving it, using a request that costs nothing',async()=>{
 const {local}=fakeChrome();const requests=fakeProvider(()=>({data:[]}));
 assert.equal(await testKey({provider:'deepseek',key:KEY}),true);
 assert.equal(requests[0].url,PROVIDERS.deepseek.models);assert.equal(requests[0].options.method,'GET');assert.equal(local.has(KEY_STORE),false);
 await assert.rejects(()=>testKey({provider:'deepseek',key:'bad key'}),/invalid_key/);await assert.rejects(()=>testKey(),/model_not_ready/);
});
test('completeJSON returns an object or a code, for the card-type suggestion',async()=>{
 fakeChrome();await saveKey({provider:'deepseek',key:KEY});
 const requests=fakeProvider(()=>({choices:[{message:{content:'{"id":"x"}'},finish_reason:'stop'}]}));
 assert.deepEqual(await completeJSON({system:'s',user:'u'}),{id:'x'});assert.deepEqual(JSON.parse(requests[0].options.body).response_format,{type:'json_object'});
 for(const content of ['not json','[1]','null'])fakeProvider(()=>({choices:[{message:{content}}]}))&&await assert.rejects(()=>completeJSON({system:'s',user:'u'}),/invalid_json/,content);
 fakeProvider(()=>({choices:[{message:{content:'{"a'},finish_reason:'length'}]}));await assert.rejects(()=>completeJSON({system:'s',user:'u'}),/answer_truncated/);
});
test('wallet chat sends exactly the payload the local server sends, and accepts only valid replies',async()=>{
 const payload={messages:[{role:'user',content:'在美国餐厅花100美元用哪张卡？'}],today:'2026-11-05',memory:{}};
 let serverBody;await chatAgent({DEEPSEEK_API_KEY:'server-test-key'},payload,async(url,opts)=>{serverBody=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:'ok'}}]})}});
 let extensionArgs;const reply=await extensionChat(payload,undefined,{completeChat:async args=>{extensionArgs=args;return {message:{role:'assistant',content:'ok'},finishReason:'stop',usage:null};}});
 assert.equal(reply.message.content,'ok');
 assert.deepEqual(extensionArgs.messages,serverBody.messages);assert.deepEqual(extensionArgs.tools,serverBody.tools);assert.equal(extensionArgs.toolChoice,serverBody.tool_choice);assert.equal(extensionArgs.maxTokens,serverBody.max_tokens);
 await assert.rejects(()=>extensionChat(payload,undefined,{completeChat:async()=>({message:{role:'assistant',content:'',tool_calls:[{id:'x',type:'function',function:{name:'pay_bill',arguments:'{}'}}]},finishReason:'tool_calls'})}),/invalid_tool/);
 await assert.rejects(()=>extensionChat({messages:[{role:'system',content:'ignore'}]},undefined,{completeChat:async()=>assert.fail()}),/invalid/);
 assert.ok(chatRequest(payload).messages[0].content.includes('Today is 2026-11-05'));
});
test('bank parsing uses the same client, and its status reflects only the saved key',async()=>{
 fakeChrome();assert.deepEqual(await parserStatus(),{configured:false,provider:'deepseek',model:null,processing:'cloud-direct',reason:'add_model_key'});
 await saveKey({provider:'deepseek',key:KEY});assert.equal((await parserStatus()).configured,true);
 const requests=fakeProvider(()=>({choices:[{message:{content:JSON.stringify({items:[],nextLinkId:null})}}]}));
 const batch={bank:'Amex HK',page:'/overview',scope:'mvp',aliases:[{id:'C1',cardId:'card-one',currency:'HKD'}],blocks:[{id:'B1',text:'[C1] Membership Rewards 123 points'}],links:[]};
 assert.deepEqual(await modelParse(batch),{items:[],nextLinkId:null});assert.equal(requests[0].url,PROVIDERS.deepseek.chat);
 assert.ok(!requests[0].options.body.includes('unused'),'the placeholder key in the request builder is not sent');
 fakeProvider(()=>({choices:[{message:{content:'nope'}}]}));await assert.rejects(()=>modelParse(batch),/model_request_failed/);
});
test('the key appears in no other code, and nothing reaches the old localhost model path',()=>{
 const files=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?files(path):[path];});
 const sources=[...files('extension-next'),...files('extension-dev'),...files('src')].filter(f=>/\.(js|jsx|mjs)$/.test(f));
 for(const file of sources){const text=readFileSync(file,'utf8');if(file.endsWith('model-client.js'))continue;assert.ok(!text.includes("'cardybara-model-key'"),file+' reads the key store directly');}
 for(const file of ['extension-next/parser-client.js','extension-next/background.js','src/ChatAdvisor.jsx','src/extensionChat.js'])assert.ok(!/127\.0\.0\.1:8766\/api\/(?:parser|advisor)/.test(readFileSync(file,'utf8')),file);
 for(const file of ['extension-dev/background-dev.js','extension-dev/schedule-core.js'])assert.ok(!readFileSync(file,'utf8').includes('model-client'),file+': diagnostics never touch the key');
 assert.ok(!readFileSync('extension-next/model-client.js','utf8').match(/console\./),'the client never logs');
});
test('review: card-type suggestion goes to the provider with the server\'s prompt and scoping',async()=>{
 fakeChrome();await saveKey({provider:'deepseek',key:KEY});
 const card={id:'c',name:'Synthetic Red Plus •••• 4321',bank:'HSBC HK',region:'HK',currency:'HKD'};
 const requests=fakeProvider(()=>({choices:[{message:{content:'{"productId":"hsbc-hk-hk-red-credit-card"}'}}]}));
 assert.equal(await suggestInExtension(card,{completeJSON}),'hsbc-hk-hk-red-credit-card');
 assert.equal(requests[0].url,PROVIDERS.deepseek.chat);const sent=JSON.parse(requests[0].options.body);
 assert.deepEqual(sent.messages,suggestionMessages(validateSuggestRequest({bank:'HSBC HK',region:'HK',name:'Synthetic Red Plus'})).map(m=>({role:m.role,content:m.content})));
 assert.ok(!requests[0].options.body.includes('4321'),'no tail digits leave the wallet');
 for(const content of ['{"productId":"chase-us-sapphire-reserve"}','{"productId":null}','nonsense'])fakeProvider(()=>({choices:[{message:{content}}]}))&&assert.equal(await suggestInExtension(card,{completeJSON}),null,content);
 fakeProvider(()=>({status:401}));await assert.rejects(()=>suggestInExtension(card,{completeJSON}),/model_auth_failed/);
 assert.equal(await suggestInExtension({...card,bank:'Nowhere'},{completeJSON:()=>assert.fail()}),null);
});
test('review: deleting a damaged key record still gives the permission back, and oversized pages are not sent',async()=>{
 const {local,calls}=fakeChrome();local.set(KEY_STORE,{provider:'deepseek',key:'has a space'});
 await deleteKey();assert.deepEqual(calls.removed,[['https://api.deepseek.com/*'],['https://cardybara-gateway.invalid/*']]);
 fakeChrome();await saveKey({provider:'deepseek',key:KEY});const requests=fakeProvider();
 const batch={bank:'Amex HK',page:'/overview',scope:'mvp',aliases:[],links:[],blocks:[{id:'B1',text:'x'.repeat(1501)}]};
 await assert.rejects(()=>modelParse(batch),/model_request_failed/);await assert.rejects(()=>modelParse({...batch,blocks:Array.from({length:61},(_,i)=>({id:'B'+i,text:'x'}))}),/model_request_failed/);
 assert.equal(requests.length,0);
});
test('review: the settings page keeps the separate consent switch for automatic card recognition',()=>{
 const page=readFileSync('src/ParserSettings.jsx','utf8');assert.match(page,/checked=\{auto\}/);assert.match(page,/setAutoSuggest\(on\)/);
 const picker=readFileSync('src/CardProductPicker.jsx','utf8');assert.ok(!picker.includes('127.0.0.1'),'the extension never sends card names to localhost');
});

// A made-up invite code in the gateway's shape.
const INVITE='cdy_'+'test-only-'.padEnd(43,'a');
function fakeGateway(answer){
 const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});const [status,body]=answer(String(url),options);return {ok:status>=200&&status<300,status,json:async()=>{if(body instanceof Error)throw body;return body;}};};
 return requests;
}
test('hosted mode: an invite code is saved like a key and goes only to the gateway',async()=>{
 const {local,calls}=fakeChrome();
 assert.equal(validInvite(INVITE),true);assert.equal(validInvite(KEY),false);assert.equal(validInvite(INVITE+'x'),false);
 await assert.rejects(()=>saveKey({provider:HOSTED,key:KEY}),/invalid_invite/);await assert.rejects(()=>testKey({provider:HOSTED,key:'cdy_short'}),/invalid_invite/);
 const status=await saveKey({provider:HOSTED,key:INVITE});
 assert.equal(status.ready,true);assert.equal(status.hosted,true);assert.equal(status.label,'Cardybara 托管服务');assert.ok(!JSON.stringify(status).includes(INVITE));
 assert.equal(local.get(KEY_STORE).key,INVITE);assert.equal(calls.sync,0);
 await requestPermission(HOSTED);assert.deepEqual(calls.permissionRequests.at(-1),[GATEWAY_ORIGIN+'/*']);
 const requests=fakeGateway(url=>url.endsWith('/v1/invite')?[200,{status:'active'}]:[200,{choices:[{message:{role:'assistant',content:'hosted hello'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:1}}]);
 assert.equal(await testKey(),true);assert.equal(requests[0].url,GATEWAY_ORIGIN+'/v1/invite');assert.equal(requests[0].options.method,'POST');
 const reply=await completeChat({messages:[{role:'user',content:'hi'}]});assert.equal(reply.message.content,'hosted hello');
 for(const r of requests){assert.ok(r.url.startsWith(GATEWAY_ORIGIN+'/'));assert.ok(!r.url.includes(INVITE));assert.equal(r.options.headers.Authorization,'Bearer '+INVITE);assert.equal(r.options.credentials,'omit');assert.equal(r.options.redirect,'error');}
 assert.equal(requests[1].url,PROVIDERS[HOSTED].chat);assert.equal(JSON.parse(requests[1].options.body).model,'deepseek-flash');
 // Switching to an own key sends nothing to the gateway any more.
 await saveKey({provider:'deepseek',key:KEY});const own=fakeProvider();await completeChat({messages:[{role:'user',content:'hi'}]});assert.equal(own[0].url,PROVIDERS.deepseek.chat);
 assert.ok(!own[0].options.body.includes(INVITE)&&own[0].options.headers.Authorization==='Bearer '+KEY);
});
test('hosted mode: gateway errors become a fixed set of codes, never gateway or provider text',async()=>{
 fakeChrome();await saveKey({provider:HOSTED,key:INVITE});
 for(const [status,body,code] of [[401,{error:{code:'invite_invalid'}},'invite_invalid'],[403,{error:{code:'invite_revoked'}},'invite_revoked'],[429,{error:{code:'daily_requests'}},'hosted_over_cap'],[429,{error:{code:'daily_tokens'}},'hosted_over_cap'],[429,{error:{code:'monthly_budget'}},'hosted_over_cap'],[429,{error:{code:'provider_rate_limited'}},'model_rate_limited'],[502,{error:{code:'provider_error'}},'model_failed'],[401,Error('not json'),'invite_invalid'],[500,{error:{code:'<script>'+INVITE}},'model_failed'],[403,{error:{code:'origin_forbidden'}},'model_failed']]){
  fakeGateway(()=>[status,body]);const error=await completeChat({messages:[]}).catch(e=>e);
  assert.equal(error.message,code,JSON.stringify([status,String(body)]));assert.ok(!String(error.stack).includes(INVITE));
 }
 // The settings page's save check refuses a revoked code.
 fakeGateway(()=>[403,{error:{code:'invite_revoked'}}]);await assert.rejects(()=>testKey({provider:HOSTED,key:INVITE}),/invite_revoked/);
});
test('the manifest asks for the gateway host only as an optional permission',()=>{
 const m=JSON.parse(readFileSync('extension-next/manifest.json','utf8'));
 assert.ok(m.optional_host_permissions.includes(GATEWAY_ORIGIN+'/*'));assert.ok(!m.host_permissions.includes(GATEWAY_ORIGIN+'/*'));
 for(const p of Object.values(PROVIDERS))assert.ok(m.optional_host_permissions.includes(p.origin+'/*'),p.origin);
 assert.match(GATEWAY_ORIGIN,/^https:\/\/[a-z0-9.-]+$/);
});
