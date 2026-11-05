import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {KEY_STORE,PROVIDERS,keyStatus,saveKey,deleteKey,setModelEnabled,isModelReady,testKey,completeChat,completeJSON,completeBody,maskKey,validKey,requestPermission} from '../extension-next/model-client.js';
import {parserStatus,modelParse} from '../extension-next/parser-client.js';
import {extensionChat} from '../src/extensionChat.js';
import {chatRequest} from '../src/chatProtocol.js';
import {chatAgent} from '../scripts/chat-agent.mjs';
// A made-up key for tests. The real key is only ever pasted by the owner into the extension.
const KEY='test-only-0123456789abcdef';
function fakeChrome({granted=true}={}){
 const local=new Map(),calls={sync:0,permissionRequests:[],removed:[]};
 globalThis.chrome={
  storage:{local:{get:async k=>local.has(k)?{[k]:structuredClone(local.get(k))}:{},set:async o=>{for(const [k,v] of Object.entries(o))local.set(k,structuredClone(v));},remove:async k=>{local.delete(k);}},sync:new Proxy({},{get:()=>{calls.sync++;throw Error('sync must not be used');}})},
  permissions:{contains:async o=>granted&&o.origins[0]==='https://api.deepseek.com/*',request:async o=>{calls.permissionRequests.push(o.origins);return granted;},remove:async o=>{calls.removed.push(o.origins);granted=false;return true;}}
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
 assert.equal((await deleteKey()).saved,false);assert.equal(local.has(KEY_STORE),false);assert.deepEqual(calls.removed,[['https://api.deepseek.com/*']]);
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
