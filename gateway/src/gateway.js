// Cardybara model gateway (Cloudflare Worker): the logic. worker.js is the Worker's main module. It holds the owner's
// model key and, for testers with an invite code, runs the hosted assistant (`/v1/chat`, agent.js: the agent loop and
// public-knowledge tools, with wallet tools run in the extension) and relays single completions (`/v1/chat/completions`,
// used for card-type suggestions).
//
// Treat it as public internet:
// - an invite code is checked by its SHA-256 digest, compared in constant time; codes are never stored or logged;
// - the request body is size-capped, and only allow-listed fields and models are forwarded;
// - every request reserves its worst-case tokens and cost in one Durable Object before it reaches the
//   provider, so parallel requests cannot overrun a per-code daily cap or the global monthly budget;
// - bodies, codes and keys are never logged or echoed: a log line carries the code id, time, tokens and status.

// The assistant (agent.js) brings the agent loop and the bundled public knowledge, whose modules build their indexes
// when first evaluated: hundreds of milliseconds of CPU. Workers caps the CPU a script may spend at startup, so that
// code is loaded on the first /v1/chat request, not at startup, and the proxy and invite routes never load it. The
// bundler keeps a dynamically imported module lazy; tests/gateway-startup.test.mjs holds the built Worker to this.
// A failed load stays cached on purpose: a module whose evaluation threw cannot be evaluated again (the bundler's lazy
// init and native ESM both keep the failure), so every /v1/chat then answers agent_unavailable until a redeploy.
import {writeMetrics} from './metrics.js';
let agent=null;
const agentRoute=ctx=>(agent||=import('./agent.js')).then(m=>m.agentRoute(ctx),()=>{throw new Refusal('agent_unavailable');});

export const ROUTES={chat:'/v1/chat/completions',agent:'/v1/chat',invite:'/v1/invite'};
export const INVITE_PATTERN=/^cdy_[A-Za-z0-9_-]{43}$/;
const FIELDS=['model','messages','tools','tool_choice','max_tokens','temperature','response_format'];
const ROLES=new Set(['system','user','assistant','tool']);
const MESSAGE_FIELDS=['role','content','name','tool_calls','tool_call_id'];
const RESPONSE_FIELDS=['id','object','created','model','choices','usage'];
// Error codes the extension may show. Nothing else from the gateway or the provider reaches the client.
export const ERRORS={
 bad_request:400,model_not_allowed:400,invite_invalid:401,invite_revoked:403,origin_forbidden:403,not_found:404,method_not_allowed:405,
 too_large:413,unsupported_media_type:415,rate_limited:429,daily_requests:429,daily_tokens:429,monthly_budget:429,provider_rate_limited:429,
 provider_rejected:502,provider_error:502,provider_unreachable:502,gateway_not_configured:503,gateway_busy:503,provider_timeout:504,
 turn_invalid:400,turn_expired:409,agent_unavailable:503,
};

const number=(value,fallback,{min=0,integer=false}={})=>{const n=Number(value??fallback);return Number.isFinite(n)&&n>=min&&(!integer||Number.isInteger(n))?n:null;};
export function readConfig(env){
 const c={
  providerUrl:env.PROVIDER_URL||'https://api.deepseek.com/chat/completions',
  providerKey:typeof env.PROVIDER_KEY==='string'&&env.PROVIDER_KEY.length>=8?env.PROVIDER_KEY:null,
  models:String(env.ALLOWED_MODELS??'deepseek-flash').split(',').map(s=>s.trim()).filter(Boolean),
  origins:String(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean),
  maxBodyBytes:number(env.MAX_BODY_BYTES,262144,{min:1024,integer:true}),
  maxOutputTokens:number(env.MAX_OUTPUT_TOKENS,8192,{min:1,integer:true}),
  dailyRequests:number(env.DAILY_REQUESTS_PER_CODE,200,{integer:true}),
  dailyTokens:number(env.DAILY_TOKENS_PER_CODE,300000,{integer:true}),
  monthlyBudgetMicros:number(env.MONTHLY_BUDGET_USD,10)==null?null:Math.round(number(env.MONTHLY_BUDGET_USD,10)*1e6),
  // USD per million tokens equals micro-USD per token.
  priceInput:number(env.PRICE_INPUT_USD_PER_MTOK,0.6),
  priceOutput:number(env.PRICE_OUTPUT_USD_PER_MTOK,2.4),
  // Long enough for MAX_OUTPUT_TOKENS without streaming; an abort keeps the worst case charged anyway.
  timeoutMs:number(env.PROVIDER_TIMEOUT_MS,180000,{min:1000,integer:true}),
 };
 let url=null;try{url=new URL(c.providerUrl);}catch{}
 // Fail closed: a missing key, binding, origin list or a malformed number disables the gateway.
 c.ready=!!(c.providerKey&&url&&(url.protocol==='https:'||env.ALLOW_HTTP_PROVIDER==='1')&&c.models.length&&c.origins.length&&env.INVITES&&env.USAGE
  // The rate limiter is required in production; only a local run against an http mock may go without.
  &&(env.RATE_LIMITER||env.ALLOW_HTTP_PROVIDER==='1')
  &&[c.maxBodyBytes,c.maxOutputTokens,c.dailyRequests,c.dailyTokens,c.monthlyBudgetMicros,c.priceInput,c.priceOutput,c.timeoutMs].every(v=>v!=null));
 return c;
}

// Global caps the owner can change without a deploy: the KV key `settings` holds
// {dailyRequests, dailyTokens, monthlyBudgetUsd}; each present, valid value replaces the var of the same cap.
export const SETTINGS_KEY='settings';
async function withSettings(base,env){
 const c={...base};
 let s=null;try{s=await env.INVITES.get(SETTINGS_KEY,{type:'json'});}catch{}
 if(plain(s)){
  const whole=v=>Number.isInteger(v)&&v>=0;
  if(whole(s.dailyRequests))c.dailyRequests=s.dailyRequests;
  if(whole(s.dailyTokens))c.dailyTokens=s.dailyTokens;
  if(typeof s.monthlyBudgetUsd==='number'&&s.monthlyBudgetUsd>=0&&Number.isFinite(s.monthlyBudgetUsd))c.monthlyBudgetMicros=Math.round(s.monthlyBudgetUsd*1e6);
 }
 return c;
}

// Exact extension origins only. "chrome-extension://*" admits any extension (for unpacked builds whose id
// varies) but never a web page.
export function originAllowed(origin,origins){
 if(!origin||!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return false;
 return origins.includes(origin)||origins.includes('chrome-extension://*');
}

const encoder=new TextEncoder();
async function sha256(text){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)));}
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
// Constant-time over equal-length inputs; the length is public (always 32 bytes here).
export function sameBytes(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
export async function inviteKey(code){return 'invite:'+hex(await sha256(code));}

async function findInvite(code,env){
 if(typeof code!=='string'||!INVITE_PATTERN.test(code))return null;
 const digest=await sha256(code),key='invite:'+hex(digest);
 const record=await env.INVITES.get(key,{type:'json'});
 if(!record||typeof record!=='object'||typeof record.hash!=='string'||!/^[0-9a-f]{64}$/.test(record.hash))return null;
 // The KV key is the digest already; this repeats the comparison in constant time against the stored value.
 const stored=Uint8Array.from(record.hash.match(/../g),h=>parseInt(h,16));
 if(!sameBytes(digest,stored))return null;
 if(typeof record.id!=='string'||!/^[a-z0-9-]{1,32}$/.test(record.id))return null;
 return record;
}

export async function readLimited(request,limit){
 const declared=request.headers.get('Content-Length');
 if(declared!=null&&!(Number(declared)<=limit))throw Error('too_large');
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let total=0;
 for(;;){
  const {done,value}=await reader.read();if(done)break;
  total+=value.byteLength;if(total>limit){await reader.cancel().catch(()=>{});throw Error('too_large');}
  chunks.push(value);
 }
 const all=new Uint8Array(total);let at=0;for(const c of chunks){all.set(c,at);at+=c.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(all);
}

const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** The provider body forwarded for a client body: allow-listed fields, bounded, thinking off. Throws a code. */
export function sanitizeBody(body,c){
 if(!plain(body))throw Error('bad_request');
 const out={};
 const model=body.model??c.models[0];
 if(typeof model!=='string'||!c.models.includes(model))throw Error('model_not_allowed');
 out.model=model;
 if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>200)throw Error('bad_request');
 out.messages=body.messages.map(m=>{
  if(!plain(m)||!ROLES.has(m.role))throw Error('bad_request');
  if(!(typeof m.content==='string'||(m.content==null&&m.role==='assistant')))throw Error('bad_request');
  if(m.tool_calls!==undefined&&(m.role!=='assistant'||!Array.isArray(m.tool_calls)||m.tool_calls.length>32))throw Error('bad_request');
  if(m.tool_call_id!==undefined&&typeof m.tool_call_id!=='string')throw Error('bad_request');
  if(m.name!==undefined&&typeof m.name!=='string')throw Error('bad_request');
  return Object.fromEntries(MESSAGE_FIELDS.filter(k=>m[k]!==undefined).map(k=>[k,m[k]]));
 });
 if(body.tools!==undefined){if(!Array.isArray(body.tools)||body.tools.length>64||body.tools.some(t=>!plain(t)||t.type!=='function'||!plain(t.function)))throw Error('bad_request');out.tools=body.tools;}
 if(body.tool_choice!==undefined){
  const ok=['auto','none','required'].includes(body.tool_choice)||(plain(body.tool_choice)&&body.tool_choice.type==='function'&&typeof body.tool_choice.function?.name==='string');
  if(!ok)throw Error('bad_request');out.tool_choice=body.tool_choice;
 }
 const max=body.max_tokens??c.maxOutputTokens;
 if(!Number.isInteger(max)||max<1||max>c.maxOutputTokens)throw Error('bad_request');
 out.max_tokens=max;
 if(body.temperature!==undefined){if(typeof body.temperature!=='number'||!(body.temperature>=0&&body.temperature<=2))throw Error('bad_request');out.temperature=body.temperature;}
 if(body.response_format!==undefined){if(!plain(body.response_format)||!['json_object','text'].includes(body.response_format.type))throw Error('bad_request');out.response_format={type:body.response_format.type};}
 // Reasoning is always off: its tokens would be spent outside what the client asked for. n, logprobs and
 // anything else not listed above are dropped. A stream always ends with its usage numbers, which settle it.
 out.thinking={type:'disabled'};
 if(body.stream!==undefined&&typeof body.stream!=='boolean')throw Error('bad_request');
 out.stream=body.stream===true;if(out.stream)out.stream_options={include_usage:true};
 return out;
}

/** Worst-case tokens and cost for a forwarded body. A token is at least one byte, so bytes bound the input. */
export function worstCase(forwarded,c){
 const input=encoder.encode(JSON.stringify(forwarded)).byteLength,output=forwarded.max_tokens;
 return {tokens:input+output,micros:Math.ceil(input*c.priceInput+output*c.priceOutput)};
}
export const actualCost=(usage,c)=>{
 const input=Number.isInteger(usage?.prompt_tokens)&&usage.prompt_tokens>=0?usage.prompt_tokens:null,output=Number.isInteger(usage?.completion_tokens)&&usage.completion_tokens>=0?usage.completion_tokens:null;
 if(input==null||output==null)return null;
 return {input,output,tokens:input+output,micros:Math.ceil(input*c.priceInput+output*c.priceOutput)};
};

const ledger=env=>env.USAGE.get(env.USAGE.idFromName('global'));
async function callLedger(env,op,args){
 const response=await ledger(env).fetch('https://ledger.internal/'+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
 if(!response.ok)throw Error('gateway_busy');
 return response.json();
}

function respond(status,value,cors){
 return new Response(value==null?null:JSON.stringify(value),{status,headers:{...(value==null?{}:{'Content-Type':'application/json; charset=utf-8'}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...cors}});
}
const today=now=>new Date(now).toISOString().slice(0,10);
export class Refusal extends Error{constructor(code,extra={}){super(code);this.extra=extra;}}

// --- Middleware. Each takes the request context and either fills it in or throws a Refusal with an error code.
// The agent route (`/v1/chat`, agent.js) reuses them as they are: authenticate once per request, and reserve and
// settle once per model call.

/** The invite code from the Authorization header; sets ctx.invite and the log's code id. */
export async function authenticate(ctx){
 const auth=ctx.request.headers.get('Authorization')||'';
 const invite=await findInvite(auth.startsWith('Bearer ')?auth.slice(7):'',ctx.env);
 if(!invite)throw new Refusal('invite_invalid');
 ctx.record.code=invite.id;
 if(invite.status!=='active')throw new Refusal('invite_revoked');
 ctx.invite=invite;
}
/** A JSON request body within the size cap. */
export async function readJson(ctx){
 if(!/^application\/json(\s*;|$)/i.test(ctx.request.headers.get('Content-Type')||''))throw new Refusal('unsupported_media_type');
 let text;try{text=await readLimited(ctx.request,ctx.config.maxBodyBytes);}catch(e){throw new Refusal(e.message==='too_large'?'too_large':'bad_request');}
 try{return JSON.parse(text);}catch{throw new Refusal('bad_request');}
}
/**
 * Reserves one model call's worst case against the code's daily caps and the global monthly budget, before
 * anything reaches the provider. Returns settle(spent): {tokens,micros} replaces the worst case; settle(null)
 * keeps it (no usage numbers).
 */
export async function reserve(ctx,worst){
 // A per-code override can only lower the caps, never raise them past the gateway's.
 const capOf=(own,global)=>Number.isInteger(own)&&own>=0?Math.min(own,global):global;
 const c=await withSettings(ctx.config,ctx.env),day=today(ctx.now());let reservation;
 try{reservation=await callLedger(ctx.env,'reserve',{code:ctx.invite.id,day,month:day.slice(0,7),tokens:worst.tokens,micros:worst.micros,maxRequests:capOf(ctx.invite.dailyRequests,c.dailyRequests),maxTokens:capOf(ctx.invite.dailyTokens,c.dailyTokens),maxMicros:c.monthlyBudgetMicros});}
 catch{throw new Refusal('gateway_busy');}
 if(!reservation.ok)throw new Refusal(ERRORS[reservation.reason]?reservation.reason:'gateway_busy');
 let settled=false;
 return async spent=>{
  if(settled)return;settled=true;
  // Actual use above the worst case means the reservation's assumption broke (a model or provider change): it is
  // still charged in full, and the log line says so for the owner.
  if(spent&&(spent.tokens>worst.tokens||spent.micros>worst.micros))ctx.record.overrun=true;
  try{await callLedger(ctx.env,'settle',{id:reservation.id,...(spent?{tokens:spent.tokens,micros:spent.micros}:{keep:true})});}catch{}
 };
}
/** Sends a sanitized body to the provider with the owner's key. Provider failures become codes only. */
export async function callProvider(ctx,forwarded,settle,signal){
 const c=ctx.config;let response,sent=false;
 if(signal?.aborted){await settle({tokens:0,micros:0});throw signal.reason;}
 try{sent=true;response=await ctx.upstream(c.providerUrl,{method:'POST',headers:{Authorization:'Bearer '+c.providerKey,'Content-Type':'application/json'},body:JSON.stringify(forwarded),redirect:'manual',signal:signal?AbortSignal.any([AbortSignal.timeout(c.timeoutMs),signal]):AbortSignal.timeout(c.timeoutMs)});}
 catch(e){
  // Cancelled before the request left: nothing reached the provider, so nothing is charged. Later, the worst case stays.
  if(signal?.aborted){await settle(sent?null:{tokens:0,micros:0});throw signal.reason;}
  // The provider may have received the request and billed it (a timeout often means it is still generating),
  // so the worst case stays charged.
  await settle(null);
  throw new Refusal(e?.name==='TimeoutError'?'provider_timeout':'provider_unreachable');
 }
 // Provider text can echo the request or name the owner's account, so only its status class passes through.
 // A redirect is never followed (Workers has no redirect:'error'; 'manual' hands the 3xx back) and counts as a failure.
 if(!response.ok){
  await response.body?.cancel().catch(()=>{});
  // A 4xx or 429 means the provider refused the request, so its reservation is released (the request still counts
  // toward the daily cap). A 5xx or redirect may follow work the provider billed, so the worst case stays.
  await settle(response.status>=400&&response.status<500?{tokens:0,micros:0}:null);
  throw new Refusal(response.status===429?'provider_rate_limited':response.status>=500?'provider_error':'provider_rejected',{provider_status:response.status});
 }
 return response;
}

/** The rate-limit key for a client: its IPv4 address, or the /64 prefix of an IPv6 address (one subscriber's block). */
export function clientKey(request){
 const ip=request.headers.get('CF-Connecting-IP')||'unknown';
 if(!ip.includes(':'))return ip;
 const [head,tail=''] =ip.split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[];
 const groups=ip.includes('::')?[...h,...Array(Math.max(0,8-h.length-t.length)).fill('0'),...t]:h;
 return groups.slice(0,4).map(g=>(parseInt(g||'0',16)||0).toString(16)).join(':')+'::/64';
}

// --- Routes.

async function inviteRoute(ctx){return respond(200,{status:'active'},ctx.cors);}

/** The model proxy: one completion, as JSON or as server-sent events when the client asks to stream. */
async function completionRoute(ctx){
 let forwarded;
 try{forwarded=sanitizeBody(await readJson(ctx),ctx.config);}catch(e){throw e instanceof Refusal?e:new Refusal(ERRORS[e.message]?e.message:'bad_request');}
 ctx.metrics.model=forwarded.model;
 const settle=await reserve(ctx,worstCase(forwarded,ctx.config));
 const response=await callProvider(ctx,forwarded,settle);
 const limit=4*ctx.config.maxBodyBytes+65536;
 // Each streamed token arrives in its own event of a few hundred bytes.
 if(forwarded.stream)return streamCompletion(ctx,response,settle,Math.max(limit,forwarded.max_tokens*400+65536));
 let payload;
 try{payload=JSON.parse(await readLimited(response,limit));if(!plain(payload))throw Error();}
 // A garbled answer keeps the worst case charged: the provider may have billed it.
 catch{await settle(null);throw new Refusal('provider_error');}
 const spent=actualCost(payload.usage,ctx.config);
 await settle(spent);
 ctx.record.prompt_tokens=spent?.input??null;ctx.record.completion_tokens=spent?.output??null;
 return respond(200,Object.fromEntries(RESPONSE_FIELDS.filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]])),ctx.cors);
}

/**
 * Passes the provider's server-sent events through unchanged, bounded in size, while reading the usage numbers
 * of the final chunk (stream_options.include_usage). The reservation settles and the log line is written when
 * the stream ends; a stream that ends without usage keeps its worst case charged.
 */
function streamCompletion(ctx,response,settle,limit){
 const decoder=new TextDecoder();let buffer='',total=0,usage=null;
 const scan=line=>{
  if(!line.startsWith('data:'))return;const data=line.slice(5).trim();if(!data||data==='[DONE]')return;
  try{const chunk=JSON.parse(data);if(chunk?.usage)usage=chunk.usage;}catch{}
 };
 let done;const finished=new Promise(r=>{done=r;});
 const end=async ok=>{const spent=ok?actualCost(usage,ctx.config):null;await settle(spent);ctx.record.prompt_tokens=spent?.input??null;ctx.record.completion_tokens=spent?.output??null;if(!ok)ctx.record.error='stream_aborted';done();};
 const relay=new TransformStream({
  transform(chunk,controller){
   total+=chunk.byteLength;
   if(total>limit){controller.error(Error('too_large'));void end(false);return;}
   buffer+=decoder.decode(chunk,{stream:true});
   const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(scan);
   // A line longer than the whole cap can't be a real event.
   if(buffer.length>limit){controller.error(Error('too_large'));void end(false);return;}
   controller.enqueue(chunk);
  },
  async flush(){buffer+=decoder.decode();if(buffer)scan(buffer);await end(true);},
 });
 response.body.pipeTo(relay.writable).catch(()=>end(false));
 ctx.deferLog(finished);
 return new Response(relay.readable,{status:200,headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...ctx.cors}});
}

// The router. A route names its path, method and handler; `auth: true` runs authenticate first.
export const ROUTE_TABLE=[
 {path:ROUTES.invite,name:'invite',method:'POST',auth:true,handler:inviteRoute},
 {path:ROUTES.agent,name:'agent',method:'POST',auth:true,handler:agentRoute},
 {path:ROUTES.chat,name:'chat',method:'POST',auth:true,handler:completionRoute},
];

/**
 * The gateway. deps: {fetch, log, now, waitUntil, observe} — the upstream fetch, a log sink for one metadata line per
 * request, a clock and the runtime's waitUntil; injected so tests and the packaged-extension E2E run this
 * exact code against a fake provider.
 */
export async function handle(request,env,deps={}){
 const now=deps.now||Date.now,log=deps.log||(line=>console.log(line));
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const config=readConfig(env),allowed=originAllowed(origin,config.origins);
 const cors=allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{'Vary':'Origin'};
 const route=ROUTE_TABLE.find(r=>r.path===url.pathname);
 const record={at:new Date(now()).toISOString(),route:route?.name||'other',code:null,status:0};
 let deferred=null;
 const ctx={request,env,config,cors,record,url,now,// Called as a plain function: Workers' fetch throws "Illegal invocation" when called as a method of another object.
  upstream:deps.fetch||((...a)=>globalThis.fetch(...a)),invite:null,deferLog:p=>{deferred=p;},
  // Tests only: sees each agent model call's payload before it becomes a provider request. The Worker never sets it.
  observe:deps.observe||null,
  // What the metrics data point needs beyond the log record (model, prompt hash, repair, tool counts); never logged.
  metrics:{}};
 const started=now();
 // The log line first, then the metrics data point (metrics.js): neither can make the other fail.
 const write=()=>{log(JSON.stringify(record));writeMetrics(ctx,now()-started);};
 const finish=response=>{record.status=response.status;if(deferred){const p=deferred.then(write);deps.waitUntil?deps.waitUntil(p):void p;}else write();return response;};
 const refuse=(code,extra={})=>{Object.assign(record,{error:code},extra);return finish(respond(ERRORS[code]||500,{error:{code}},code==='method_not_allowed'?{...cors,Allow:route.method}:cors));};
 if(request.method==='OPTIONS'){
  if(!allowed||!route)return finish(respond(allowed?404:403,null,cors));
  return finish(respond(204,null,{...cors,'Access-Control-Allow-Methods':route.method,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}));
 }
 if(!allowed)return refuse('origin_forbidden');
 if(!route)return refuse('not_found');
 if(request.method!==route.method)return refuse('method_not_allowed');
 if(!config.ready)return refuse('gateway_not_configured');
 try{
  // Per client address, before any KV read, so guessing codes can't exhaust KV or the Workers quota. The
  // binding is optional (local runs and tests have none); gateway/wrangler.jsonc declares it.
  if(env.RATE_LIMITER){const {success}=await env.RATE_LIMITER.limit({key:clientKey(request)});if(!success)throw new Refusal('rate_limited');}
  if(route.auth)await authenticate(ctx);
  return finish(await route.handler(ctx));
 }catch(e){
  if(e instanceof Refusal)return refuse(e.message,e.extra);
  return refuse('gateway_busy');
 }
}

/**
 * Usage counters in one Durable Object instance. Each operation runs to completion before the next starts
 * (an explicit queue on top of the runtime's input gates), so a check and its increment cannot interleave.
 * Keys: d:<day>:<code> {requests,tokens}; m:<month> {micros}; r:<id> an open reservation.
 */
export class UsageLedger{
 constructor(state){this.storage=state.storage;this.queue=Promise.resolve();}
 run(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
 async fetch(request){
  const op=new URL(request.url).pathname.slice(1);let args;
  try{args=await request.json();}catch{return new Response('bad',{status:400});}
  if(op!=='reserve'&&op!=='settle')return new Response('bad',{status:404});
  try{return Response.json(await this.run(()=>this[op](args)));}catch{return new Response('bad',{status:500});}
 }
 async reserve({code,day,month,tokens,micros,maxRequests,maxTokens,maxMicros}){
  const dk=`d:${day}:${code}`,mk=`m:${month}`;
  const d=(await this.storage.get(dk))||{requests:0,tokens:0},m=(await this.storage.get(mk))||{micros:0};
  if(d.requests+1>maxRequests)return {ok:false,reason:'daily_requests'};
  if(d.tokens+tokens>maxTokens)return {ok:false,reason:'daily_tokens'};
  if(m.micros+micros>maxMicros)return {ok:false,reason:'monthly_budget'};
  const id=crypto.randomUUID();
  await this.storage.put({[dk]:{requests:d.requests+1,tokens:d.tokens+tokens},[mk]:{micros:m.micros+micros},['r:'+id]:{dk,mk,tokens,micros,day}});
  // The first request of a day for a code clears day counters and open reservations older than yesterday (an
  // open reservation is a request whose worker never settled; its worst case is already counted).
  if(d.requests===0&&this.storage.list)await this.prune(day);
  return {ok:true,id};
 }
 async prune(day){
  const cutoff=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  for(const prefix of ['d:','r:']){
   const old=[...(await this.storage.list({prefix})).entries()].filter(([k,v])=>(prefix==='d:'?k.slice(2,12):v?.day||'')<cutoff).map(([k])=>k);
   for(let i=0;i<old.length;i+=128)await this.storage.delete(old.slice(i,i+128));
  }
 }
 /** Replaces a reservation's worst case with what was actually spent. */
 async settle({id,tokens,micros,keep}){
  const r=await this.storage.get('r:'+id);if(!r)return {ok:false};
  if(keep){await this.storage.delete('r:'+id);return {ok:true};}
  const d=(await this.storage.get(r.dk))||{requests:0,tokens:0},m=(await this.storage.get(r.mk))||{micros:0};
  await this.storage.put({[r.dk]:{...d,tokens:Math.max(0,d.tokens-r.tokens+tokens)},[r.mk]:{micros:Math.max(0,m.micros-r.micros+micros)}});
  await this.storage.delete('r:'+id);
  return {ok:true};
 }
}
