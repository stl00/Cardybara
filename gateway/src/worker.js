// Cardybara model gateway (Cloudflare Worker). It holds the owner's model key and forwards the extension's
// chat-completion requests to the provider for testers with an invite code. The agent loop, tools and wallet
// data stay in the extension; this only relays one completion at a time.
//
// Treat it as public internet:
// - an invite code is checked by its SHA-256 digest, compared in constant time; codes are never stored or logged;
// - the request body is size-capped, and only allow-listed fields and models are forwarded;
// - every request reserves its worst-case tokens and cost in one Durable Object before it reaches the
//   provider, so parallel requests cannot overrun a per-code daily cap or the global monthly budget;
// - bodies, codes and keys are never logged or echoed: a log line carries the code id, time, tokens and status.

export const ROUTES={chat:'/v1/chat/completions',invite:'/v1/invite'};
export const INVITE_PATTERN=/^cdy_[A-Za-z0-9_-]{43}$/;
const FIELDS=['model','messages','tools','tool_choice','max_tokens','temperature','response_format'];
const ROLES=new Set(['system','user','assistant','tool']);
const MESSAGE_FIELDS=['role','content','name','tool_calls','tool_call_id'];
const RESPONSE_FIELDS=['id','object','created','model','choices','usage'];
// Error codes the extension may show. Nothing else from the gateway or the provider reaches the client.
export const ERRORS={
 bad_request:400,model_not_allowed:400,invite_invalid:401,invite_revoked:403,origin_forbidden:403,not_found:404,method_not_allowed:405,
 too_large:413,unsupported_media_type:415,daily_requests:429,daily_tokens:429,monthly_budget:429,provider_rate_limited:429,
 provider_rejected:502,provider_error:502,provider_unreachable:502,gateway_not_configured:503,gateway_busy:503,provider_timeout:504,
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
  dailyTokens:number(env.DAILY_TOKENS_PER_CODE,1000000,{integer:true}),
  monthlyBudgetMicros:number(env.MONTHLY_BUDGET_USD,10)==null?null:Math.round(number(env.MONTHLY_BUDGET_USD,10)*1e6),
  // USD per million tokens equals micro-USD per token.
  priceInput:number(env.PRICE_INPUT_USD_PER_MTOK,0.6),
  priceOutput:number(env.PRICE_OUTPUT_USD_PER_MTOK,2.4),
  timeoutMs:number(env.PROVIDER_TIMEOUT_MS,60000,{min:1000,integer:true}),
 };
 let url=null;try{url=new URL(c.providerUrl);}catch{}
 // Fail closed: a missing key, binding, origin list or a malformed number disables the gateway.
 c.ready=!!(c.providerKey&&url&&(url.protocol==='https:'||env.ALLOW_HTTP_PROVIDER==='1')&&c.models.length&&c.origins.length&&env.INVITES&&env.USAGE
  &&[c.maxBodyBytes,c.maxOutputTokens,c.dailyRequests,c.dailyTokens,c.monthlyBudgetMicros,c.priceInput,c.priceOutput,c.timeoutMs].every(v=>v!=null));
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

async function readLimited(request,limit){
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
 // Reasoning is always off: its tokens would be spent outside what the client asked for. Streaming, n,
 // logprobs and anything else not listed above are dropped.
 out.thinking={type:'disabled'};out.stream=false;
 return out;
}

/** Worst-case tokens and cost for a forwarded body. A token is at least one byte, so bytes bound the input. */
export function worstCase(forwarded,c){
 const input=encoder.encode(JSON.stringify(forwarded)).byteLength,output=forwarded.max_tokens;
 return {tokens:input+output,micros:Math.ceil(input*c.priceInput+output*c.priceOutput)};
}
const actualCost=(usage,c)=>{
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
const fail=(code,cors)=>respond(ERRORS[code]||500,{error:{code}},cors);
const today=now=>new Date(now).toISOString().slice(0,10);

/**
 * The gateway. deps: {fetch, log, now} — the upstream fetch, a log sink for one metadata line per request,
 * and a clock; injected so tests and the packaged-extension E2E run this exact code against a fake provider.
 */
export async function handle(request,env,deps={}){
 const upstream=deps.fetch||globalThis.fetch,log=deps.log||(line=>console.log(line)),now=deps.now||Date.now;
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const c=readConfig(env),allowed=originAllowed(origin,c.origins);
 const cors=allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{'Vary':'Origin'};
 const route=Object.entries(ROUTES).find(([,p])=>p===url.pathname)?.[0];
 const record={at:new Date(now()).toISOString(),route:route||'other',code:null,status:0};
 const finish=(response,extra={})=>{Object.assign(record,{status:response.status},extra);log(JSON.stringify(record));return response;};
 if(request.method==='OPTIONS'){
  if(!allowed||!route)return finish(respond(allowed?404:403,null,cors));
  return finish(respond(204,null,{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}));
 }
 if(!allowed)return finish(fail('origin_forbidden',cors),{error:'origin_forbidden'});
 if(!route)return finish(fail('not_found',cors),{error:'not_found'});
 if(request.method!=='POST')return finish(fail('method_not_allowed',{...cors,Allow:'POST'}),{error:'method_not_allowed'});
 if(!c.ready)return finish(fail('gateway_not_configured',cors),{error:'gateway_not_configured'});
 const auth=request.headers.get('Authorization')||'';
 const invite=await findInvite(auth.startsWith('Bearer ')?auth.slice(7):'',env);
 if(!invite)return finish(fail('invite_invalid',cors),{error:'invite_invalid'});
 record.code=invite.id;
 if(invite.status!=='active')return finish(fail('invite_revoked',cors),{error:'invite_revoked'});
 if(route==='invite')return finish(respond(200,{status:'active'},cors));

 if(!/^application\/json(\s*;|$)/i.test(request.headers.get('Content-Type')||''))return finish(fail('unsupported_media_type',cors),{error:'unsupported_media_type'});
 let forwarded;
 try{
  const text=await readLimited(request,c.maxBodyBytes);
  let body;try{body=JSON.parse(text);}catch{throw Error('bad_request');}
  forwarded=sanitizeBody(body,c);
 }catch(e){const code=ERRORS[e.message]?e.message:'bad_request';return finish(fail(code,cors),{error:code});}

 // A per-code override can only lower the caps, never raise them past the gateway's.
 const capOf=(own,global)=>Number.isInteger(own)&&own>=0?Math.min(own,global):global;
 const worst=worstCase(forwarded,c),day=today(now());
 let reservation;
 try{reservation=await callLedger(env,'reserve',{code:invite.id,day,month:day.slice(0,7),tokens:worst.tokens,micros:worst.micros,maxRequests:capOf(invite.dailyRequests,c.dailyRequests),maxTokens:capOf(invite.dailyTokens,c.dailyTokens),maxMicros:c.monthlyBudgetMicros});}
 catch{return finish(fail('gateway_busy',cors),{error:'gateway_busy'});}
 if(!reservation.ok){const code=ERRORS[reservation.reason]?reservation.reason:'gateway_busy';return finish(fail(code,cors),{error:code});}
 const settle=async spent=>{try{await callLedger(env,"settle",{id:reservation.id,...spent});}catch{}};

 let response;
 try{
  response=await upstream(c.providerUrl,{method:'POST',headers:{Authorization:'Bearer '+c.providerKey,'Content-Type':'application/json'},body:JSON.stringify(forwarded),redirect:'manual',signal:AbortSignal.timeout(c.timeoutMs)});
 }catch(e){
  // Nothing was answered, so nothing is charged; the request still counts.
  await settle({tokens:0,micros:0});
  const code=e?.name==='TimeoutError'?'provider_timeout':'provider_unreachable';
  return finish(fail(code,cors),{error:code});
 }
 // Provider text can echo the request or name the owner's account, so only its status class passes through.
 // A redirect is never followed (Workers has no redirect:'error'; 'manual' hands the 3xx back) and counts as a failure.
 if(!response.ok){
  await response.body?.cancel().catch(()=>{});
  // A failed completion is not billed, so its reservation is released; the request still counts toward the daily cap.
  const code=response.status===429?'provider_rate_limited':response.status>=500?'provider_error':'provider_rejected';
  await settle({tokens:0,micros:0});
  return finish(fail(code,cors),{error:code,provider_status:response.status});
 }
 let payload;
 try{payload=JSON.parse(await readLimited(response,4*c.maxBodyBytes+65536));if(!plain(payload))throw Error();}
 catch{return finish(fail('provider_error',cors),{error:'provider_error'});}
 const spent=actualCost(payload.usage,c);
 // Without usage numbers the worst case stays charged.
 if(spent)await settle({tokens:spent.tokens,micros:spent.micros});
 const out=Object.fromEntries(RESPONSE_FIELDS.filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]));
 return finish(respond(200,out,cors),{prompt_tokens:spent?.input??null,completion_tokens:spent?.output??null});
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
  await this.storage.put({[dk]:{requests:d.requests+1,tokens:d.tokens+tokens},[mk]:{micros:m.micros+micros},['r:'+id]:{dk,mk,tokens,micros}});
  return {ok:true,id};
 }
 /** Replaces a reservation's worst case with what was actually spent. */
 async settle({id,tokens,micros}){
  const r=await this.storage.get('r:'+id);if(!r)return {ok:false};
  const d=(await this.storage.get(r.dk))||{requests:0,tokens:0},m=(await this.storage.get(r.mk))||{micros:0};
  await this.storage.put({[r.dk]:{...d,tokens:Math.max(0,d.tokens-r.tokens+tokens)},[r.mk]:{micros:Math.max(0,m.micros-r.micros+micros)}});
  await this.storage.delete('r:'+id);
  return {ok:true};
 }
}

export default {fetch:(request,env)=>handle(request,env)};
