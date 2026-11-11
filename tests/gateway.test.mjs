import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway} from '../gateway/src/local.mjs';
import {ROUTES,INVITE_PATTERN,originAllowed,sameBytes,sanitizeBody,readConfig} from '../gateway/src/worker.js';

// Synthetic values only. None of them is a real key or invite code.
const ORIGIN='chrome-extension://'+'a'.repeat(32);
const CODE='cdy_'+'test-only-'.padEnd(43,'a'),OTHER='cdy_'+'test-only-'.padEnd(43,'b'),UNKNOWN='cdy_'+'test-only-'.padEnd(43,'z');
const PROVIDER_KEY='synthetic-provider-key-not-real';
const SECRET_TEXT='Synthetic question 4242 about my cards';
const reply=(usage={prompt_tokens:10,completion_tokens:5})=>({id:'x',object:'chat.completion',created:1,model:'deepseek-flash',choices:[{index:0,message:{role:'assistant',content:'synthetic answer'},finish_reason:'stop'}],usage,system_fingerprint:'drop-me'});
function setup({vars={},provider=()=>Response.json(reply()),now}={}){
 const upstream=[],logs=[];
 const fetch=async(url,init)=>{upstream.push({url,init,body:JSON.parse(init.body)});return provider(url,init);};
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN,...vars},fetch,log:l=>logs.push(l),now});
 return {...g,upstream,logs,ledger:()=>g.env.USAGE.instances.get('global')?.storage.data};
}
const chatBody=(extra={})=>({model:'deepseek-flash',messages:[{role:'system',content:'sys'},{role:'user',content:SECRET_TEXT}],max_tokens:100,temperature:0.2,thinking:{type:'disabled'},...extra});
function post(path,{code=CODE,origin=ORIGIN,body=chatBody(),headers={},method='POST',raw}={}){
 return new Request('https://gateway.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(code?{Authorization:'Bearer '+code}:{}),'Content-Type':'application/json',...headers},...(method==='POST'||method==='PUT'?{body:raw??JSON.stringify(body)}:{})});
}
const errorOf=async r=>(await r.json()).error.code;

test('the invite code pattern and constant-time comparison',()=>{
 assert.match(CODE,INVITE_PATTERN);assert.doesNotMatch('cdy_short',INVITE_PATTERN);assert.doesNotMatch(CODE+'x',INVITE_PATTERN);
 assert.equal(sameBytes(new Uint8Array([1,2,3]),new Uint8Array([1,2,3])),true);
 assert.equal(sameBytes(new Uint8Array([1,2,3]),new Uint8Array([1,2,4])),false);
 assert.equal(sameBytes(new Uint8Array([1,2]),new Uint8Array([1,2,3])),false);
});

test('auth: only an active invite code passes; codes are never echoed',async()=>{
 const g=setup();await g.addInvite(CODE,{id:'t01'});await g.addInvite(OTHER,{id:'t02',status:'revoked'});
 assert.equal((await g.handle(post(ROUTES.invite,{body:undefined}))).status,200);
 for(const code of [null,'',UNKNOWN,'cdy_short','Basic '+CODE,CODE.slice(0,-1)]){
  const r=await g.handle(post(ROUTES.chat,{code}));assert.equal(r.status,401,String(code));
  const text=await r.text();assert.equal(JSON.parse(text).error.code,'invite_invalid');assert.ok(!text.includes(CODE));
 }
 const revoked=await g.handle(post(ROUTES.chat,{code:OTHER}));assert.equal(revoked.status,403);assert.equal(await errorOf(revoked),'invite_revoked');
 assert.equal(g.upstream.length,0);
 // A KV record whose stored digest doesn't match the code is not an invite.
 const key=[...g.env.INVITES.data.keys()][0];g.env.INVITES.data.set(key,JSON.stringify({...JSON.parse(g.env.INVITES.data.get(key)),hash:'0'.repeat(64)}));
 assert.equal((await g.handle(post(ROUTES.invite))).status,401);
});

test('CORS: only allowed extension origins, and preflight answers only for them',async()=>{
 const g=setup();await g.addInvite(CODE,{id:'t01'});
 for(const origin of [null,'https://evil.example','chrome-extension://'+'b'.repeat(32),'chrome-extension://'+'a'.repeat(31),'null']){
  const r=await g.handle(post(ROUTES.chat,{origin}));assert.equal(r.status,403,String(origin));assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 }
 const ok=await g.handle(post(ROUTES.chat));assert.equal(ok.status,200);assert.equal(ok.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 const pre=await g.handle(new Request('https://gateway.test'+ROUTES.chat,{method:'OPTIONS',headers:{Origin:ORIGIN}}));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.match(pre.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 assert.equal((await g.handle(new Request('https://gateway.test'+ROUTES.chat,{method:'OPTIONS',headers:{Origin:'https://evil.example'}}))).status,403);
 assert.equal(originAllowed('chrome-extension://'+'c'.repeat(32),['chrome-extension://*']),true);
 assert.equal(originAllowed('https://evil.example',['chrome-extension://*']),false);
 // No origin list means no client at all.
 const closed=setup({vars:{ALLOWED_ORIGINS:''}});await closed.addInvite(CODE,{id:'t01'});
 assert.equal((await closed.handle(post(ROUTES.chat))).status,403);
});

test('routes, methods, media type and body size are enforced before anything is forwarded',async()=>{
 const g=setup({vars:{MAX_BODY_BYTES:'2048'}});await g.addInvite(CODE,{id:'t01'});
 assert.equal((await g.handle(post('/v1/models'))).status,404);
 assert.equal((await g.handle(post('/chat/completions'))).status,404);
 assert.equal((await g.handle(post(ROUTES.chat,{method:'GET'}))).status,405);
 assert.equal((await g.handle(post(ROUTES.chat,{headers:{'Content-Type':'text/plain'}}))).status,415);
 const big=chatBody({messages:[{role:'user',content:'x'.repeat(4000)}]});
 assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{body:big}))),'too_large');
 // A body without a declared length is cut off while streaming.
 const stream=new ReadableStream({start(c){for(let i=0;i<10;i++)c.enqueue(new TextEncoder().encode('x'.repeat(500)));c.close();}});
 const streamed=new Request('https://gateway.test'+ROUTES.chat,{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+CODE,'Content-Type':'application/json'},body:stream,duplex:'half'});
 assert.equal(await errorOf(await g.handle(streamed)),'too_large');
 assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{raw:'{not json'}))),'bad_request');
 assert.equal(g.upstream.length,0);
});

test('only allow-listed models and fields are forwarded, with the owner key and thinking off',async()=>{
 const g=setup();await g.addInvite(CODE,{id:'t01'});
 assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{body:chatBody({model:'deepseek-reasoner'})}))),'model_not_allowed');
 for(const bad of [{max_tokens:9000},{max_tokens:0},{max_tokens:1.5},{temperature:5},{messages:[]},{messages:[{role:'admin',content:'x'}]},{messages:[{role:'user',content:[{type:'image_url'}]}]},{tools:[{type:'web_search'}]},{response_format:{type:'json_schema'}},{tool_choice:'everything'}])
  assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{body:chatBody(bad)}))),'bad_request',JSON.stringify(bad));
 assert.equal(g.upstream.length,0);
 const r=await g.handle(post(ROUTES.chat,{body:chatBody({stream:true,n:8,logprobs:true,user:'x',thinking:{type:'enabled'},messages:[{role:'user',content:'q',extra:'drop'}],tools:[{type:'function',function:{name:'list_cards',parameters:{}}}],tool_choice:'auto',response_format:{type:'json_object',schema:'drop'}})}));
 assert.equal(r.status,200);
 const sent=g.upstream[0];
 assert.equal(sent.url,'https://api.deepseek.com/chat/completions');
 assert.equal(sent.init.headers.Authorization,'Bearer '+PROVIDER_KEY);assert.equal(sent.init.redirect,'manual');
 assert.deepEqual(Object.keys(sent.body).sort(),['max_tokens','messages','model','response_format','stream','temperature','thinking','tool_choice','tools']);
 assert.deepEqual(sent.body.thinking,{type:'disabled'});assert.equal(sent.body.stream,false);assert.deepEqual(sent.body.messages,[{role:'user',content:'q'}]);assert.deepEqual(sent.body.response_format,{type:'json_object'});
 assert.ok(!JSON.stringify(sent).includes(CODE),'the invite code never reaches the provider');
 // The reply carries only the completion fields.
 const out=await r.json();assert.equal(out.choices[0].message.content,'synthetic answer');assert.equal(out.system_fingerprint,undefined);
 // A missing max_tokens is bounded by the gateway's cap.
 await g.handle(post(ROUTES.chat,{body:{messages:[{role:'user',content:'q'}]}}));assert.equal(g.upstream[1].body.max_tokens,8192);assert.equal(g.upstream[1].body.model,'deepseek-flash');
 assert.equal(sanitizeBody({messages:[{role:'user',content:'q'}],max_tokens:10},readConfig({ALLOWED_MODELS:'a,b'})).model,'a','a missing model defaults to the first allowed one');
});

test('the per-code daily request cap holds under parallel requests',async()=>{
 const g=setup({vars:{DAILY_REQUESTS_PER_CODE:'5'}});await g.addInvite(CODE,{id:'t01'});await g.addInvite(OTHER,{id:'t02'});
 const results=await Promise.all(Array.from({length:20},()=>g.handle(post(ROUTES.chat))));
 const statuses=results.map(r=>r.status);
 assert.equal(statuses.filter(s=>s===200).length,5);assert.equal(statuses.filter(s=>s===429).length,15);
 assert.equal(g.upstream.length,5);assert.equal(await errorOf(results.find(r=>r.status===429)),'daily_requests');
 // Another code has its own count; the next day starts again.
 assert.equal((await g.handle(post(ROUTES.chat,{code:OTHER}))).status,200);
 let at=Date.parse('2026-11-11T23:59:00Z');const later=setup({vars:{DAILY_REQUESTS_PER_CODE:'1'}, now:()=>at});await later.addInvite(CODE,{id:'t01'});
 assert.equal((await later.handle(post(ROUTES.chat))).status,200);assert.equal((await later.handle(post(ROUTES.chat))).status,429);
 at+=120000;assert.equal((await later.handle(post(ROUTES.chat))).status,200);
});

test('a per-code override can lower the caps but never raise them',async()=>{
 const g=setup({vars:{DAILY_REQUESTS_PER_CODE:'3'}});await g.addInvite(CODE,{id:'t01',dailyRequests:1});await g.addInvite(OTHER,{id:'t02',dailyRequests:1000});
 assert.equal((await g.handle(post(ROUTES.chat))).status,200);assert.equal((await g.handle(post(ROUTES.chat))).status,429);
 for(let i=0;i<3;i++)assert.equal((await g.handle(post(ROUTES.chat,{code:OTHER}))).status,200);
 assert.equal((await g.handle(post(ROUTES.chat,{code:OTHER}))).status,429);
});

test('token and monthly budget caps reserve the worst case up front and settle to actual use',async()=>{
 // Worst case for one request is its bytes plus max_tokens; actual use is 15 tokens.
 const g=setup({vars:{DAILY_TOKENS_PER_CODE:'2000'}});await g.addInvite(CODE,{id:'t01'});
 const parallel=await Promise.all(Array.from({length:10},()=>g.handle(post(ROUTES.chat,{body:chatBody({max_tokens:900})}))));
 assert.ok(parallel.filter(r=>r.status===200).length<=2,'parallel requests cannot overrun the token cap');
 assert.equal(await errorOf(parallel.find(r=>r.status===429)),'daily_tokens');
 const day=[...g.ledger().entries()].find(([k])=>k.startsWith('d:'))[1];
 assert.equal(day.tokens,15*parallel.filter(r=>r.status===200).length,'settled to actual tokens');
 assert.equal([...g.ledger().keys()].filter(k=>k.startsWith('r:')).length,0,'no open reservations');
 // The monthly budget is global across codes.
 const b=setup({vars:{MONTHLY_BUDGET_USD:'0.001',PRICE_INPUT_USD_PER_MTOK:'1',PRICE_OUTPUT_USD_PER_MTOK:'1'}});await b.addInvite(CODE,{id:'t01'});await b.addInvite(OTHER,{id:'t02'});
 const small=chatBody({max_tokens:100});
 const results=await Promise.all([...Array(4)].map((_,i)=>b.handle(post(ROUTES.chat,{code:i%2?OTHER:CODE,body:small}))));
 assert.ok(results.filter(r=>r.status===200).length>=1);
 const over=results.find(r=>r.status===429);assert.ok(over,'the budget stops some of them');assert.equal(await errorOf(over),'monthly_budget');
 const month=b.ledger().get('m:'+new Date().toISOString().slice(0,7));assert.ok(month.micros<=1000);
});

test('provider failures pass through as codes only, release the reservation, and never leak provider text',async()=>{
 for(const [status,code,expect] of [[302,'provider_rejected',502],[401,'provider_rejected',502],[400,'provider_rejected',502],[429,'provider_rate_limited',429],[500,'provider_error',502],[503,'provider_error',502]]){
  const g=setup({provider:()=>new Response(JSON.stringify({error:{message:'echo Bearer '+PROVIDER_KEY+' '+SECRET_TEXT}}),{status})});await g.addInvite(CODE,{id:'t01'});
  const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,expect,String(status));
  const text=await r.text();assert.deepEqual(JSON.parse(text),{error:{code}});assert.ok(!text.includes(PROVIDER_KEY)&&!text.includes(SECRET_TEXT));
  const month=[...g.ledger().entries()].find(([k])=>k.startsWith('m:'))[1];assert.equal(month.micros,0,'a failed completion is not charged');
 }
 const down=setup({provider:()=>{throw TypeError('fetch failed');}});await down.addInvite(CODE,{id:'t01'});
 assert.equal(await errorOf(await down.handle(post(ROUTES.chat))),'provider_unreachable');
 const timeout=setup({provider:()=>{const e=Error('t');e.name='TimeoutError';throw e;}});await timeout.addInvite(CODE,{id:'t01'});
 const tr=await timeout.handle(post(ROUTES.chat));assert.equal(tr.status,504);assert.equal(await errorOf(tr),'provider_timeout');
 const garbled=setup({provider:()=>new Response('not json')});await garbled.addInvite(CODE,{id:'t01'});
 assert.equal(await errorOf(await garbled.handle(post(ROUTES.chat))),'provider_error');
 // A completion without usage numbers keeps its worst case charged.
 const blind=setup({provider:()=>Response.json(reply(null))});await blind.addInvite(CODE,{id:'t01'});
 assert.equal((await blind.handle(post(ROUTES.chat))).status,200);
 assert.ok([...blind.ledger().entries()].find(([k])=>k.startsWith('m:'))[1].micros>0);
});

test('without the provider key, bindings or valid numbers the gateway fails closed',async()=>{
 for(const vars of [{PROVIDER_KEY:''},{MONTHLY_BUDGET_USD:'lots'},{PROVIDER_URL:'http://api.example/chat'},{ALLOWED_MODELS:''}]){
  const g=setup({vars});await g.addInvite(CODE,{id:'t01'});
  const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,503,JSON.stringify(vars));assert.equal(await errorOf(r),'gateway_not_configured');assert.equal(g.upstream.length,0);
 }
});

test('logs carry the code id, time, tokens and status — never bodies, codes or keys',async()=>{
 const g=setup({vars:{DAILY_REQUESTS_PER_CODE:'2'}});await g.addInvite(CODE,{id:'t01'});
 const consoleLines=[],saved={log:console.log,error:console.error,warn:console.warn,info:console.info};
 for(const k of Object.keys(saved))console[k]=(...a)=>consoleLines.push(a.join(' '));
 try{
  await g.handle(post(ROUTES.chat));await g.handle(post(ROUTES.chat,{code:UNKNOWN}));await g.handle(post(ROUTES.chat,{body:chatBody({model:'other'})}));
  await g.handle(post(ROUTES.chat));await g.handle(post(ROUTES.chat));
 }finally{Object.assign(console,saved);}
 assert.equal(consoleLines.length,0,'the gateway writes only through its log sink');
 assert.equal(g.logs.length,5);
 const all=g.logs.join('\n');
 for(const secret of [CODE,UNKNOWN,PROVIDER_KEY,SECRET_TEXT,'synthetic answer','sys'])assert.ok(!all.includes(secret),'log leaks '+secret);
 const first=JSON.parse(g.logs[0]);
 assert.deepEqual(Object.keys(first).sort(),['at','code','completion_tokens','prompt_tokens','route','status']);
 assert.equal(first.code,'t01');assert.equal(first.status,200);assert.equal(first.prompt_tokens,10);assert.equal(first.completion_tokens,5);
 assert.equal(JSON.parse(g.logs[1]).code,null);assert.equal(JSON.parse(g.logs.at(-1)).error,'daily_requests');
 // The Worker source has no other logging call.
 const source=readFileSync(new URL('../gateway/src/worker.js',import.meta.url),'utf8');
 assert.equal((source.match(/console\.\w+/g)||[]).length,1);
});
