import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localGateway} from '../gateway/src/local.mjs';
import {ROUTES,ROUTE_TABLE,SETTINGS_KEY,clientKey,clientId,originAllowed,sanitizeBody,readConfig,handle} from '../gateway/src/gateway.js';

// Synthetic values only. None of them is a real key. CODE is what an extension build from before 2026-11-16 sends.
const ORIGIN='chrome-extension://'+'a'.repeat(32);
const CODE='cdy_'+'test-only-'.padEnd(43,'a'),IP='203.0.113.9',OTHER_IP='198.51.100.7';
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
function post(path,{code=null,ip=IP,origin=ORIGIN,body=chatBody(),headers={},method='POST',raw}={}){
 return new Request('https://gateway.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(code?{Authorization:'Bearer '+code}:{}),...(ip?{'CF-Connecting-IP':ip}:{}),'Content-Type':'application/json',...headers},...(method==='POST'||method==='PUT'?{body:raw??JSON.stringify(body)}:{})});
}
const errorOf=async r=>(await r.json()).error.code;

test('no invite code is needed: a request without one is answered',async()=>{
 const g=setup();
 const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,200);assert.equal((await r.json()).choices[0].message.content,'synthetic answer');
 assert.equal(g.upstream.length,1);
});

test('an older extension that still sends an invite code keeps working; the code is ignored and never forwarded',async()=>{
 const g=setup();
 for(const code of [CODE,'cdy_short','anything at all']){
  const r=await g.handle(post(ROUTES.chat,{code}));assert.equal(r.status,200,code);
 }
 assert.ok(!JSON.stringify(g.upstream.map(u=>u.init)).includes(CODE),'the code never reaches the provider');
 assert.ok(!g.logs.join('\n').includes(CODE),'the code is never logged');
});

test('/v1/invite still answers active for older builds, with or without a code, and costs nothing',async()=>{
 const g=setup();
 for(const code of [CODE,null,'cdy_revoked-or-unknown']){
  const r=await g.handle(post(ROUTES.invite,{code,body:undefined}));assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'active'});
 }
 assert.equal(g.upstream.length,0);assert.equal(g.ledger(),undefined,'no ledger call');
});

test('the gateway runs without the KV binding (the vars caps apply)',async()=>{
 const g=setup();delete g.env.INVITES;
 assert.equal(readConfig(g.env).ready,true);
 assert.equal((await g.handle(post(ROUTES.chat))).status,200);
});

test('CORS: only allowed extension origins, and preflight answers only for them',async()=>{
 const g=setup();
 for(const origin of [null,'https://evil.example','chrome-extension://'+'b'.repeat(32),'chrome-extension://'+'a'.repeat(31),'null']){
  const r=await g.handle(post(ROUTES.chat,{origin}));assert.equal(r.status,403,String(origin));assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
 }
 const ok=await g.handle(post(ROUTES.chat));assert.equal(ok.status,200);assert.equal(ok.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 const pre=await g.handle(new Request('https://gateway.test'+ROUTES.chat,{method:'OPTIONS',headers:{Origin:ORIGIN}}));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.match(pre.headers.get('Access-Control-Allow-Headers'),/Authorization/);
 assert.equal((await g.handle(new Request('https://gateway.test'+ROUTES.chat,{method:'OPTIONS',headers:{Origin:'https://evil.example'}}))).status,403);
 assert.equal(originAllowed('chrome-extension://'+'c'.repeat(32),['chrome-extension://*']),true);
 assert.equal(originAllowed('https://evil.example',['chrome-extension://*']),false);
 // Hosted wallet: exact https origins only.
 const W='https://wallet.example.com';
 assert.equal(originAllowed(W,[W]),true);
 assert.equal(originAllowed('https://other.example.com',[W]),false);
 assert.equal(originAllowed('http://wallet.example.com',['http://wallet.example.com']),false);
 assert.equal(originAllowed('https://wallet.example.com',['https://*']),false);
 assert.equal(originAllowed('https://wallet.example.com',['https://*.example.com']),false);
 assert.equal(originAllowed('https://wallet.example.com/',[W+'/']),false);
 assert.equal(originAllowed('chrome-extension://'+'c'.repeat(32),[W]),false);
 assert.equal(originAllowed('chrome-extension://'+'c'.repeat(32),['chrome-extension://'+'c'.repeat(32),W]),true);
 // No origin list means no client at all.
 const closed=setup({vars:{ALLOWED_ORIGINS:''}});
 assert.equal((await closed.handle(post(ROUTES.chat))).status,403);
});

test('routes, methods, media type and body size are enforced before anything is forwarded',async()=>{
 const g=setup({vars:{MAX_BODY_BYTES:'2048'}});
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
 const g=setup();
 assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{body:chatBody({model:'deepseek-reasoner'})}))),'model_not_allowed');
 for(const bad of [{max_tokens:9000},{max_tokens:0},{max_tokens:1.5},{temperature:5},{messages:[]},{messages:[{role:'admin',content:'x'}]},{messages:[{role:'user',content:[{type:'image_url'}]}]},{tools:[{type:'web_search'}]},{response_format:{type:'json_schema'}},{tool_choice:'everything'},{stream:'yes'}])
  assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{body:chatBody(bad)}))),'bad_request',JSON.stringify(bad));
 assert.equal(g.upstream.length,0);
 const r=await g.handle(post(ROUTES.chat,{body:chatBody({n:8,logprobs:true,user:'x',thinking:{type:'enabled'},messages:[{role:'user',content:'q',extra:'drop'}],tools:[{type:'function',function:{name:'list_cards',parameters:{}}}],tool_choice:'auto',response_format:{type:'json_object',schema:'drop'}})}));
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
 await g.handle(post(ROUTES.chat,{body:{messages:[{role:'user',content:'q'}]}}));assert.equal(g.upstream[1].body.max_tokens,600,'a missing max_tokens is the proxy\'s own cap');assert.equal(g.upstream[1].body.model,'deepseek-flash');
 assert.equal(sanitizeBody({messages:[{role:'user',content:'q'}],max_tokens:10},readConfig({ALLOWED_MODELS:'a,b'})).model,'a','a missing model defaults to the first allowed one');
});

test('the per-client daily request cap holds under parallel requests and answers the legacy daily_requests code',async()=>{
 const g=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'5'}});
 const results=await Promise.all(Array.from({length:20},()=>g.handle(post(ROUTES.chat))));
 const statuses=results.map(r=>r.status);
 assert.equal(statuses.filter(s=>s===200).length,5);assert.equal(statuses.filter(s=>s===429).length,15);
 assert.equal(g.upstream.length,5);assert.equal(await errorOf(results.find(r=>r.status===429)),'daily_requests','a code older builds know');
 assert.ok(g.logs.map(l=>JSON.parse(l)).filter(l=>l.error==='daily_requests').every(l=>l.limit==='client_requests'));
 // Sending a code does not get around the cap.
 assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{code:CODE}))),'daily_requests');
 // Another address has its own count; the next day starts again.
 assert.equal((await g.handle(post(ROUTES.chat,{ip:OTHER_IP}))).status,200);
 // The /48 of an IPv6 address is one client: another /64 in it does not get a fresh allowance.
 const v6=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'1'}});
 assert.equal((await v6.handle(post(ROUTES.chat,{ip:'2001:db8:1:2::1'}))).status,200);
 assert.equal((await v6.handle(post(ROUTES.chat,{ip:'2001:db8:1:2::ffff'}))).status,429);
 assert.equal((await v6.handle(post(ROUTES.chat,{ip:'2001:db8:1:3::1'}))).status,429,'same /48');
 assert.equal((await v6.handle(post(ROUTES.chat,{ip:'2001:db8:2::1'}))).status,200);
 // An IPv4-mapped IPv6 address is the same client as its IPv4 address.
 const v4=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'1'}});
 assert.equal((await v4.handle(post(ROUTES.chat,{ip:'203.0.113.50'}))).status,200);
 assert.equal((await v4.handle(post(ROUTES.chat,{ip:'::ffff:203.0.113.50'}))).status,429);
 let at=Date.parse('2026-11-11T23:59:00Z');const later=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'1'}, now:()=>at});
 assert.equal((await later.handle(post(ROUTES.chat))).status,200);assert.equal((await later.handle(post(ROUTES.chat))).status,429);
 at+=120000;assert.equal((await later.handle(post(ROUTES.chat))).status,200);
});

test('the client id is a salted, daily hash: the address is never stored in the ledger',async()=>{
 const g=setup();await g.handle(post(ROUTES.chat));
 const keys=[...g.ledger().keys()],day=new Date().toISOString().slice(0,10);
 assert.ok(!JSON.stringify([...g.ledger().entries()]).includes(IP),'no raw address');
 const id=await clientId(post(ROUTES.chat),g.env,day);assert.match(id,/^c[0-9a-f]{32}$/);
 assert.ok(keys.includes(`d:${day}:${id}`));
 // Another day, another salt or another address gives another id.
 assert.notEqual(await clientId(post(ROUTES.chat),g.env,'2026-01-02'),id);
 assert.notEqual(await clientId(post(ROUTES.chat),{...g.env,CLIENT_SALT:'another-synthetic-salt'},day),id);
 assert.notEqual(await clientId(post(ROUTES.chat,{ip:OTHER_IP}),g.env,day),id);
 // DAILY_*_PER_CODE from an older deploy still applies when the new names are absent.
 assert.equal(readConfig({DAILY_REQUESTS_PER_CODE:'7'}).dailyRequests,7);assert.equal(readConfig({DAILY_REQUESTS_PER_CLIENT:'3',DAILY_REQUESTS_PER_CODE:'7'}).dailyRequests,3);
});

test('token and monthly budget caps reserve the worst case up front and settle to actual use',async()=>{
 // Worst case for one request is its bytes plus max_tokens; actual use is 15 tokens.
 const g=setup({vars:{DAILY_TOKENS_PER_CLIENT:'2000'}});
 const parallel=await Promise.all(Array.from({length:10},()=>g.handle(post(ROUTES.chat,{body:chatBody({max_tokens:500})}))));
 assert.ok(parallel.filter(r=>r.status===200).length<=2,'parallel requests cannot overrun the token cap');
 assert.equal(await errorOf(parallel.find(r=>r.status===429)),'daily_tokens');
 const day=[...g.ledger().entries()].find(([k])=>k.startsWith('d:'))[1];
 assert.equal(day.tokens,15*parallel.filter(r=>r.status===200).length,'settled to actual tokens');
 assert.equal([...g.ledger().keys()].filter(k=>k.startsWith('r:')).length,0,'no open reservations');
 // The monthly budget is global across clients.
 const b=setup({vars:{MONTHLY_BUDGET_USD:'0.001',DAILY_BUDGET_USD:'1',PRICE_INPUT_USD_PER_MTOK:'1',PRICE_OUTPUT_USD_PER_MTOK:'1'}});
 const small=chatBody({max_tokens:100});
 const results=await Promise.all([...Array(4)].map((_,i)=>b.handle(post(ROUTES.chat,{ip:i%2?OTHER_IP:IP,body:small}))));
 assert.ok(results.filter(r=>r.status===200).length>=1);
 const over=results.find(r=>r.status===429);assert.ok(over,'the budget stops some of them');assert.equal(await errorOf(over),'monthly_budget');
 const month=b.ledger().get('m:'+new Date().toISOString().slice(0,7));assert.ok(month.micros<=1000);
});

test('a global daily budget (monthly / 30 by default) stops all clients together; clients see monthly_budget',async()=>{
 // Each request's worst case is about 300 micro-USD at these prices; the month allows 3000, the default day 100.
 const vars={MONTHLY_BUDGET_USD:'0.003',PRICE_INPUT_USD_PER_MTOK:'1',PRICE_OUTPUT_USD_PER_MTOK:'1'};
 assert.equal(readConfig(vars).dailyBudgetMicros,undefined,'unset: worked out from the monthly budget');
 const {withSettings}=await import('../gateway/src/gateway.js');
 assert.equal((await withSettings(readConfig(vars),{})).dailyBudgetMicros,100);
 const g=setup({vars:{...vars,DAILY_BUDGET_USD:'0.0009'}});
 const small=chatBody({max_tokens:100}),statuses=[];
 // In parallel, so every worst case is reserved at once (settling would bring each down to its actual 15 tokens).
 for(const r of await Promise.all(['203.0.113.1','203.0.113.2','203.0.113.3','203.0.113.4'].map(ip=>g.handle(post(ROUTES.chat,{ip,body:small})))))statuses.push(r.status===429?await errorOf(r):r.status);
 assert.ok(statuses.filter(s=>s===200).length>=1,'some get through');assert.ok(statuses.includes('monthly_budget'),'many addresses still meet the daily budget: '+statuses);
 const refused=g.logs.map(l=>JSON.parse(l)).filter(l=>l.error);assert.ok(refused.every(l=>l.limit==='daily_budget'),'the log says it was the daily budget');
 assert.ok(g.ledger().get('g:'+new Date().toISOString().slice(0,10)).micros<=900);
 // The default: monthly / 30, here 100 micro-USD, below one request's worst case.
 const d=setup({vars});assert.equal(await errorOf(await d.handle(post(ROUTES.chat,{body:small}))),'monthly_budget');
 // KV can set it too.
 const k=setup({vars});await k.env.INVITES.put(SETTINGS_KEY,JSON.stringify({dailyBudgetUsd:1}));assert.equal((await k.handle(post(ROUTES.chat,{body:small}))).status,200);
 assert.equal(readConfig({DAILY_BUDGET_USD:'lots'}).ready,false,'a malformed daily budget fails closed');
});

test('/v1/chat/completions takes only what card-type suggestion needs: max_tokens ≤ 600, ≤ 4 messages, bounded length',async()=>{
 const g=setup();
 for(const bad of [{max_tokens:601},{max_tokens:8192},{messages:Array.from({length:5},()=>({role:'user',content:'x'}))},{messages:[{role:'user',content:'x'.repeat(32001)}]},{messages:[{role:'system',content:'x'.repeat(20000)},{role:'user',content:'y'.repeat(12001)}]}])
  assert.equal(await errorOf(await g.handle(post(ROUTES.chat,{body:chatBody(bad)}))),'bad_request',JSON.stringify(bad).slice(0,60));
 assert.equal(g.upstream.length,0);
 assert.equal((await g.handle(post(ROUTES.chat,{body:chatBody({max_tokens:600,messages:[{role:'system',content:'s'.repeat(9000)},{role:'user',content:'u'}],response_format:{type:'json_object'}})}))).status,200);
 // The agent route keeps the gateway's own cap: it is not the proxy.
 assert.equal(readConfig({}).maxOutputTokens,8192);
});

test('provider failures pass through as codes only, release the reservation, and never leak provider text',async()=>{
 for(const [status,code,expect] of [[302,'provider_rejected',502],[401,'provider_rejected',502],[400,'provider_rejected',502],[429,'provider_rate_limited',429],[500,'provider_error',502],[503,'provider_error',502]]){
  const g=setup({provider:()=>new Response(JSON.stringify({error:{message:'echo Bearer '+PROVIDER_KEY+' '+SECRET_TEXT}}),{status})});
  const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,expect,String(status));
  const text=await r.text();assert.deepEqual(JSON.parse(text),{error:{code}});assert.ok(!text.includes(PROVIDER_KEY)&&!text.includes(SECRET_TEXT));
  const month=[...g.ledger().entries()].find(([k])=>k.startsWith('m:'))[1];
  // A refusal (4xx, 429) is released; a 3xx or 5xx may follow billed work, so its worst case stays.
  if(status>=400&&status<500)assert.equal(month.micros,0,'a refused completion is not charged');else assert.ok(month.micros>0,'a '+status+' keeps the worst case');
  assert.equal([...g.ledger().keys()].filter(k=>k.startsWith('r:')).length,0,'the reservation is closed');
 }
 const down=setup({provider:()=>{throw TypeError('fetch failed');}});
 assert.equal(await errorOf(await down.handle(post(ROUTES.chat))),'provider_unreachable');
 const timeout=setup({provider:()=>{const e=Error('t');e.name='TimeoutError';throw e;}});
 const tr=await timeout.handle(post(ROUTES.chat));assert.equal(tr.status,504);assert.equal(await errorOf(tr),'provider_timeout');
 // A timeout or a dropped connection may follow work the provider bills: the worst case stays charged.
 for(const g of [down,timeout])assert.ok([...g.ledger().entries()].find(([k])=>k.startsWith('m:'))[1].micros>0);
 const garbled=setup({provider:()=>new Response('not json')});
 assert.equal(await errorOf(await garbled.handle(post(ROUTES.chat))),'provider_error');
 assert.equal([...garbled.ledger().keys()].filter(k=>k.startsWith('r:')).length,0,'a garbled answer closes its reservation');
 // A completion without usage numbers keeps its worst case charged.
 const blind=setup({provider:()=>Response.json(reply(null))});
 assert.equal((await blind.handle(post(ROUTES.chat))).status,200);
 assert.ok([...blind.ledger().entries()].find(([k])=>k.startsWith('m:'))[1].micros>0);
});

test('without the provider key, bindings or valid numbers the gateway fails closed',async()=>{
 for(const vars of [{RATE_LIMITER:null},{PROVIDER_KEY:''},{MONTHLY_BUDGET_USD:'lots'},{PROVIDER_URL:'http://api.example/chat'},{ALLOWED_MODELS:''}]){
  const g=setup({vars});
  const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,503,JSON.stringify(vars));assert.equal(await errorOf(r),'gateway_not_configured');assert.equal(g.upstream.length,0);
 }
 // Without the usage ledger nothing can be capped, so nothing runs.
 const noLedger=setup();delete noLedger.env.USAGE;
 const r=await noLedger.handle(post(ROUTES.chat));assert.equal(r.status,503);assert.equal(await errorOf(r),'gateway_not_configured');assert.equal(noLedger.upstream.length,0);
});

test('production needs CLIENT_SALT and a client address; only LOCAL_DEV goes without',async()=>{
 const SALT='synthetic-client-salt-0123456789';
 // No salt in production: fail closed, with no fallback to the provider key.
 const unsalted=setup({vars:{LOCAL_DEV:''}});
 assert.equal(await errorOf(await unsalted.handle(post(ROUTES.chat))),'gateway_not_configured');
 assert.equal(readConfig({...unsalted.env,CLIENT_SALT:'short'}).ready,false,'a salt under 16 characters is not one');
 const prod=setup({vars:{LOCAL_DEV:'',CLIENT_SALT:SALT}});
 assert.equal((await prod.handle(post(ROUTES.chat))).status,200);
 // No CF-Connecting-IP: every caller would share one bucket, so production refuses before anything else.
 const r=await prod.handle(post(ROUTES.chat,{ip:null}));assert.equal(r.status,400);assert.equal(await errorOf(r),'bad_request');
 assert.equal(JSON.parse(prod.logs.at(-1)).reason,'no_client_address');assert.equal(prod.upstream.length,1);
 // A local run may go without both.
 const local=setup({vars:{LOCAL_DEV:'1'}});assert.equal((await local.handle(post(ROUTES.chat,{ip:null}))).status,200);
 // The salt keys the id; the provider key is not used when a salt is set.
 const day='2026-11-16';
 assert.notEqual(await clientId(post(ROUTES.chat),{CLIENT_SALT:SALT,PROVIDER_KEY:'a'.repeat(20)},day),await clientId(post(ROUTES.chat),{LOCAL_DEV:'1',PROVIDER_KEY:'a'.repeat(20)},day));
 assert.equal(await clientId(post(ROUTES.chat),{CLIENT_SALT:SALT,PROVIDER_KEY:'a'.repeat(20)},day),await clientId(post(ROUTES.chat),{CLIENT_SALT:SALT,PROVIDER_KEY:'b'.repeat(20)},day));
});

test('logs carry time, route, tokens and status — never bodies, codes, addresses, client ids or keys',async()=>{
 const g=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'2'}});
 const consoleLines=[],saved={log:console.log,error:console.error,warn:console.warn,info:console.info};
 for(const k of Object.keys(saved))console[k]=(...a)=>consoleLines.push(a.join(' '));
 try{
  await g.handle(post(ROUTES.chat));await g.handle(post(ROUTES.chat,{code:CODE}));await g.handle(post(ROUTES.chat,{body:chatBody({model:'other'})}));
  await g.handle(post(ROUTES.chat));await g.handle(post(ROUTES.chat));
 }finally{Object.assign(console,saved);}
 assert.equal(consoleLines.length,0,'the gateway writes only through its log sink');
 assert.equal(g.logs.length,5);
 const all=g.logs.join('\n');
 const id=await clientId(post(ROUTES.chat),g.env,new Date().toISOString().slice(0,10));
 for(const secret of [CODE,IP,id,id.slice(1,13),PROVIDER_KEY,SECRET_TEXT,'synthetic answer','sys'])assert.ok(!all.includes(secret),'log leaks '+secret);
 const first=JSON.parse(g.logs[0]);
 assert.deepEqual(Object.keys(first).sort(),['at','completion_tokens','prompt_tokens','route','status']);
 assert.equal(first.status,200);assert.equal(first.prompt_tokens,10);assert.equal(first.completion_tokens,5);
 assert.equal(JSON.parse(g.logs[1]).status,200);assert.equal(JSON.parse(g.logs.at(-1)).error,'daily_requests');assert.equal(JSON.parse(g.logs.at(-1)).limit,'client_requests');
 // The Worker source has no other logging call.
 const source=readFileSync(new URL('../gateway/src/gateway.js',import.meta.url),'utf8');
 assert.equal((source.match(/console\.\w+/g)||[]).length,1);
});

const sse=events=>new Response(new ReadableStream({start(c){for(const e of events)c.enqueue(new TextEncoder().encode(e));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});
const chunk=(content,usage)=>'data: '+JSON.stringify({id:'s',object:'chat.completion.chunk',choices:content==null?[]:[{index:0,delta:{content}}],...(usage?{usage}:{})})+'\n\n';
test('streaming: server-sent events pass through, and the stream settles to its final usage',async()=>{
 const waits=[];
 const g=setup({provider:()=>sse([chunk('Hel'),chunk('lo'),chunk(null,{prompt_tokens:7,completion_tokens:2}),'data: [DONE]\n\n'])});
 const r=await handle(post(ROUTES.chat,{body:chatBody({stream:true})}),g.env,{fetch:async(url,init)=>{g.upstream.push({url,init,body:JSON.parse(init.body)});return sse([chunk('Hel'),chunk('lo'),chunk(null,{prompt_tokens:7,completion_tokens:2}),'data: [DONE]\n\n']);},log:l=>g.logs.push(l),waitUntil:p=>waits.push(p)});
 assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/text\/event-stream/);assert.equal(r.headers.get('Access-Control-Allow-Origin'),ORIGIN);
 assert.equal(g.upstream[0].body.stream,true);assert.deepEqual(g.upstream[0].body.stream_options,{include_usage:true});
 const text=await r.text();assert.match(text,/Hel/);assert.match(text,/\[DONE\]/);
 await Promise.all(waits);
 const line=JSON.parse(g.logs.at(-1));assert.equal(line.status,200);assert.equal(line.prompt_tokens,7);assert.equal(line.completion_tokens,2);assert.ok(!g.logs.join().includes('Hel'));
 const day=[...g.ledger().entries()].find(([k])=>k.startsWith('d:'))[1];assert.equal(day.tokens,9);
 assert.equal([...g.ledger().keys()].filter(k=>k.startsWith('r:')).length,0);
});
test('streaming: a stream without usage keeps its worst case, and an oversized stream is cut off',async()=>{
 const run=async(events,vars={})=>{const g=setup({vars});const waits=[];
  const r=await handle(post(ROUTES.chat,{body:chatBody({stream:true})}),g.env,{fetch:async()=>sse(events),log:l=>g.logs.push(l),waitUntil:p=>waits.push(p)});
  const body=await r.text().catch(e=>e);await Promise.all(waits);return {g,body,month:[...g.ledger().entries()].find(([k])=>k.startsWith('m:'))[1]};};
 const blind=await run([chunk('a'),'data: [DONE]\n\n']);assert.ok(blind.month.micros>0,'no usage keeps the worst case');
 const big=await run(Array.from({length:150},()=>chunk('x'.repeat(1000))),{MAX_BODY_BYTES:'1024'});
 assert.ok(big.body instanceof Error,'the client sees the stream fail');assert.equal(JSON.parse(big.g.logs.at(-1)).error,'stream_aborted');assert.ok(big.month.micros>0);
});
test('caps can be changed in KV without a deploy; bad values are ignored',async()=>{
 const g=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'5'}});
 await g.env.INVITES.put(SETTINGS_KEY,JSON.stringify({dailyRequests:1}));
 assert.equal((await g.handle(post(ROUTES.chat))).status,200);assert.equal((await g.handle(post(ROUTES.chat))).status,429);
 await g.env.INVITES.put(SETTINGS_KEY,JSON.stringify({monthlyBudgetUsd:0}));
 const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,429);assert.equal(await errorOf(r),'monthly_budget');
 const h=setup({vars:{DAILY_REQUESTS_PER_CLIENT:'1'}});await h.env.INVITES.put(SETTINGS_KEY,JSON.stringify({dailyRequests:-5,monthlyBudgetUsd:'lots'}));
 assert.equal((await h.handle(post(ROUTES.chat))).status,200);assert.equal((await h.handle(post(ROUTES.chat))).status,429);
});
test('the router lists each route once per method; the agent route sits beside the proxy',()=>{
 // The /v1 routes are unchanged (older builds keep working); the account routes (#412) are all under /v2/account.
 const v1=ROUTE_TABLE.filter(r=>r.path.startsWith('/v1/')),v2=ROUTE_TABLE.filter(r=>!r.path.startsWith('/v1/'));
 assert.deepEqual(v1.map(r=>[r.path,r.method]),[[ROUTES.invite,'POST'],[ROUTES.agent,'POST'],[ROUTES.chat,'POST'],[ROUTES.push,'PUT'],[ROUTES.push,'DELETE'],[ROUTES.pushKey,'GET']]);
 assert.ok(v2.length&&v2.every(r=>r.path===ROUTES.account||r.path.startsWith(ROUTES.account+'/')));
 assert.equal(new Set(ROUTE_TABLE.map(r=>r.path+' '+r.method)).size,ROUTE_TABLE.length);
 assert.ok(ROUTE_TABLE.every(r=>!('auth' in r)),'no route needs a credential');
});

test('a rate limiter, when bound, refuses before any KV or ledger call, keyed by the hashed client id',async()=>{
 const g=setup();let reads=0;const get=g.env.INVITES.get;g.env.INVITES.get=(...a)=>{reads++;return get(...a);};
 const seen=[];g.env.RATE_LIMITER={limit:async({key})=>{seen.push(key);return {success:seen.length<=2};}};
 assert.equal((await g.handle(post(ROUTES.chat))).status,200);assert.equal((await g.handle(post(ROUTES.chat))).status,200);
 const before=reads,calls=g.upstream.length;const r=await g.handle(post(ROUTES.chat));assert.equal(r.status,429);assert.equal(await errorOf(r),'rate_limited');
 assert.equal(reads,before,'no KV read once limited');assert.equal(g.upstream.length,calls);
 const id=await clientId(post(ROUTES.chat),g.env,new Date().toISOString().slice(0,10));
 assert.deepEqual(seen,[id,id,id],'the limiter sees the hashed id, never the address');
 // A refused origin reads nothing from KV either.
 const r0=reads;await g.handle(post(ROUTES.chat,{origin:'https://evil.example'}));assert.equal(reads,r0);
});
test('use above the worst case is charged in full and flagged; reservations never stay open',async()=>{
 const g=setup({provider:()=>Response.json(reply({prompt_tokens:5000000,completion_tokens:1}))});
 assert.equal((await g.handle(post(ROUTES.chat))).status,200);
 assert.equal(JSON.parse(g.logs.at(-1)).overrun,true);
 assert.equal([...g.ledger().entries()].find(([k])=>k.startsWith('d:'))[1].tokens,5000001);
 const blind=setup({provider:()=>Response.json(reply(null))});await blind.handle(post(ROUTES.chat));
 assert.equal([...blind.ledger().keys()].filter(k=>k.startsWith('r:')).length,0);
});
test('the first request of a day prunes earlier days\' client counters and reservations older than yesterday',async()=>{
 let at=Date.parse('2026-11-01T12:00:00Z');const g=setup({now:()=>at,provider:()=>new Response('nope',{status:200})});
 await g.handle(post(ROUTES.chat));
 const store=g.ledger(),first=[...store.keys()].find(k=>k.startsWith('d:2026-11-01:'));assert.ok(first);
 store.set('r:stale',{dk:first,mk:'m:2026-11',tokens:1,micros:1,day:'2026-11-01'});
 // The next day: yesterday's client ids are gone even though yesterday's open reservation may still settle.
 at=Date.parse('2026-11-02T00:05:00Z');await g.handle(post(ROUTES.chat,{ip:OTHER_IP}));
 assert.ok(!store.has(first),'a client id is kept for its own day only');assert.ok(store.has('r:stale'));
 assert.deepEqual(store.get('r:stale'),{mk:'m:2026-11',tokens:1,micros:1,day:'2026-11-01'},'the open reservation keeps only what the month needs: no client id');
 assert.ok(!JSON.stringify([...store.entries()]).includes(first.slice(13)),'the client id is nowhere in the ledger');
 assert.ok([...store.keys()].some(k=>k.startsWith('d:2026-11-02:')));
 at=Date.parse('2026-11-05T12:00:00Z');await g.handle(post(ROUTES.chat));
 assert.ok(!store.has('r:stale'));assert.ok(store.has('m:2026-11'));
 assert.deepEqual([...store.keys()].filter(k=>k.startsWith('d:')).map(k=>k.slice(0,13)),['d:2026-11-05:']);
});

test('a reservation settled after midnight does not bring back the pruned day, and the ledger alarm prunes with no traffic',async()=>{
 const {UsageLedger}=await import('../gateway/src/gateway.js');const {memoryStorage}=await import('../gateway/src/local.mjs');
 const storage=memoryStorage();let alarm=null,at=Date.parse('2026-11-01T10:00:00Z');storage.setAlarm=async t=>{alarm=t;};
 const ledger=new UsageLedger({storage,now:()=>at});
 const r=await ledger.reserve({code:'cA',day:'2026-11-01',month:'2026-11',tokens:10,micros:10,maxRequests:5,maxTokens:100,maxMicros:100,maxDayMicros:100});assert.equal(r.ok,true);
 await ledger.push({code:'cA',day:'2026-11-01',action:'put',device:'D'.repeat(22),exp:Math.floor(at/1000)+86400*60,now:Math.floor(at/1000),maxWrites:5,maxDevices:5});
 assert.equal(alarm,Date.parse('2026-11-02T00:01:00Z'),'an alarm just after the next UTC midnight');
 assert.ok(storage.data.has('d:2026-11-01:cA')&&storage.data.has('p:2026-11-01:cA'));
 // The alarm fires after midnight with no request: the previous day's client keys go, and the next alarm is set.
 at=Date.parse('2026-11-02T00:01:00Z');await ledger.alarm();
 assert.equal(storage.data.has('d:2026-11-01:cA'),false);assert.equal(storage.data.has('p:2026-11-01:cA'),false);
 assert.equal(storage.data.get('pruned'),'2026-11-02');assert.equal(alarm,Date.parse('2026-11-03T00:01:00Z'),'the next alarm');
 assert.equal(storage.data.get('r:'+r.id).dk,undefined,'the open reservation lost its client key');
 assert.ok(storage.data.has('v:'+'D'.repeat(22)),'a live push device keeps its place');
 await ledger.settle({id:r.id,tokens:3,micros:3});
 assert.equal(storage.data.has('d:2026-11-01:cA'),false,'not written back');assert.equal(storage.data.get('m:2026-11').micros,3);assert.equal(storage.data.get('g:2026-11-01').micros,3);
 // A device whose KV record expired gives its place back at the next prune.
 at=Date.parse('2027-02-01T00:01:00Z');await ledger.alarm();assert.equal(storage.data.has('v:'+'D'.repeat(22)),false);assert.equal(storage.data.get('devices'),0);
});

test('the Worker main module exports only what Workers accepts: the fetch handler and the Durable Object class',async()=>{
 const main=await import('../gateway/src/worker.js');
 assert.deepEqual(Object.keys(main).sort(),['UsageLedger','default']);assert.equal(typeof main.default.fetch,'function');assert.equal(typeof main.UsageLedger,'function');
});

test('without an injected fetch the gateway calls the global fetch unbound, as Workers requires',async()=>{
 const g=setup();const saved=globalThis.fetch;let self='unset';
 globalThis.fetch=function(){self=this;return Promise.resolve(Response.json(reply()));};
 try{const r=await handle(post(ROUTES.chat),g.env,{log:()=>{}});assert.equal(r.status,200);}finally{globalThis.fetch=saved;}
 assert.ok(self===undefined||self===globalThis,'fetch was called as a method of another object');
});

test('client keys (hashed before use): an IPv4 address (also when IPv4-mapped), or the /48 of an IPv6 address',()=>{
 const key=ip=>clientKey(new Request('https://g.test',{headers:ip?{'CF-Connecting-IP':ip}:{}}));
 assert.equal(key('203.0.113.9'),'203.0.113.9');
 assert.equal(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd'),'2001:db8:1::/48');assert.equal(key('2001:db8:1:ffff::9'),'2001:db8:1::/48');
 assert.equal(key('2001:db8::1'),'2001:db8:0::/48');assert.equal(key(null),'unknown');
 for(const mapped of ['::ffff:203.0.113.9','::FFFF:203.0.113.9','0:0:0:0:0:ffff:203.0.113.9','::ffff:cb00:7109'])assert.equal(key(mapped),'203.0.113.9',mapped);
});
test('a long stream may exceed the JSON reply cap, within what max_tokens allows',async()=>{
 const g=setup({vars:{MAX_BODY_BYTES:'1024'}});const waits=[];
 const events=[...Array.from({length:150},()=>chunk('x'.repeat(500))),chunk(null,{prompt_tokens:5,completion_tokens:150}),'data: [DONE]\n\n'];
 const r=await handle(post(ROUTES.chat,{body:chatBody({stream:true,max_tokens:200})}),g.env,{fetch:async()=>sse(events),log:l=>g.logs.push(l),waitUntil:p=>waits.push(p)});
 assert.ok((await r.text()).includes('[DONE]'));await Promise.all(waits);assert.equal(JSON.parse(g.logs.at(-1)).completion_tokens,150);
});
test('an agent that fails to load answers agent_unavailable, not a crash',async()=>{
 const src=readFileSync(new URL('../gateway/src/gateway.js',import.meta.url),'utf8');
 assert.match(src,/import\('\.\/agent\.js'\)\)\.then\(m=>m\.agentRoute\(ctx\),\(\)=>\{throw new Refusal\('agent_unavailable'\);\}\)/);
 assert.equal((await import('../gateway/src/gateway.js')).ERRORS.agent_unavailable,503);
});

test('metrics: the model proxy writes one data point per request, with no text, and a failing binding changes nothing',async()=>{
 const points=[];
 const g=setup({vars:{AGENT_METRICS:{writeDataPoint:p=>points.push(structuredClone(p))},CF_VERSION_METADATA:{id:'ver-proxy-1'}}});
 assert.equal((await g.handle(post(ROUTES.chat))).status,200);
 assert.equal((await g.handle(post(ROUTES.invite))).status,200,'the invite check is not metered');
 assert.equal((await g.handle(post(ROUTES.chat,{origin:'https://evil.example'}))).status,403);
 assert.equal(points.length,2);
 assert.deepEqual(points[0].indexes,['chat'],'the index is the route, never a client');
 assert.deepEqual([points[0].blobs[0],points[0].blobs[1],points[0].blobs[4],points[0].blobs[5]],['chat','ver-proxy-1','deepseek-flash','']);
 assert.deepEqual([points[0].doubles[0],points[0].doubles[4],points[0].doubles[5],points[0].doubles[9]],[200,10,5,1]);
 // A refused request is metered too.
 assert.deepEqual([points[1].indexes[0],points[1].blobs[5],points[1].doubles[0],points[1].doubles[9]],['chat','origin_forbidden',403,0]);
 for(const text of [SECRET_TEXT,CODE,IP,PROVIDER_KEY,'synthetic answer'])assert.ok(!JSON.stringify(points).includes(text),'a data point carries '+text);
 const broken=setup({vars:{AGENT_METRICS:{writeDataPoint(){throw Error('boom');}}}});
 assert.equal((await broken.handle(post(ROUTES.chat))).status,200);
});

test('metrics: the Worker config declares the Analytics Engine and version bindings the code reads',()=>{
 const config=readFileSync(new URL('../gateway/wrangler.jsonc',import.meta.url),'utf8');
 assert.match(config,/"analytics_engine_datasets":\s*\[\{"binding":\s*"AGENT_METRICS"/);
 assert.match(config,/"version_metadata":\s*\{"binding":\s*"CF_VERSION_METADATA"\}/);
});
