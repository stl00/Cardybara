// Cardybara model gateway (Cloudflare Worker): the logic. worker.js is the Worker's main module. It holds the owner's
// model key and runs the hosted assistant (`/v1/chat`, agent.js: the agent loop and
// public-knowledge tools, with wallet tools run in the extension) and relays single completions (`/v1/chat/completions`,
// used for card-type suggestions).
//
// Treat it as public internet:
// - there is no invite code (owner decision 2026-11-16): a client is its network address, kept only as a salted hash
//   that changes every UTC day (clientId), never the address itself;
// - the request body is size-capped, and only allow-listed fields and models are forwarded;
// - every request reserves its worst-case tokens and cost in one Durable Object before it reaches the
//   provider, so parallel requests cannot overrun a per-client daily cap or the global monthly budget;
// - bodies, keys, addresses and client ids are never logged or echoed: a log line carries time, route, tokens and status.

// The assistant (agent.js) brings the agent loop and the bundled public knowledge, whose modules build their indexes
// when first evaluated: hundreds of milliseconds of CPU. Workers caps the CPU a script may spend at startup, so that
// code is loaded on the first /v1/chat request, not at startup, and the proxy and other routes never load it. The
// bundler keeps a dynamically imported module lazy; tests/gateway-startup.test.mjs holds the built Worker to this.
// A failed load stays cached on purpose: a module whose evaluation threw cannot be evaluated again (the bundler's lazy
// init and native ESM both keep the failure), so every /v1/chat then answers agent_unavailable until a redeploy.
import {writeMetrics} from './metrics.js';
import {readSwitches} from './switches.js';
import {parsePut,parseDelete,storePush,forgetPush,pushConfigured,EXPIRY_SECONDS} from './push.js';
import * as accounts from './accounts.js';
import * as passkeys from './passkeys.js';
import * as plaid from './plaid.js';
import {linkPage} from './plaidPage.js';
let agent=null;
const agentRoute=ctx=>(agent||=import('./agent.js')).then(m=>m.agentRoute(ctx),()=>{throw new Refusal('agent_unavailable');});

// `/v1/invite` stays for extension builds from before 2026-11-16, which check a saved invite code there: it always
// answers active. Those builds also send `Authorization: Bearer <code>` on every route; the header is ignored.
export const ROUTES={chat:'/v1/chat/completions',agent:'/v1/chat',invite:'/v1/invite',push:'/v1/push',pushKey:'/v1/push/key',
 // Accounts and the wallet copy (#412, accounts.js). New shapes live under /v2; the /v1 routes are unchanged.
 account:'/v2/account',signUp:'/v2/account/signup',verify:'/v2/account/verify',session:'/v2/account/session',
 password:'/v2/account/password',forgot:'/v2/account/password/forgot',reset:'/v2/account/password/reset',wallet:'/v2/account/wallet',export:'/v2/account/export',
 // Passkeys (#461, passkeys.js). The last one takes the credential id after a slash.
 passkeyStatus:'/v2/account/passkey/status',passkeyRegisterOptions:'/v2/account/passkey/register/options',passkeyRegisterVerify:'/v2/account/passkey/register/verify',
 passkeyLoginOptions:'/v2/account/passkey/login/options',passkeyLoginVerify:'/v2/account/passkey/login/verify',passkeys:'/v2/account/passkey',
 // Plaid-linked credit cards (plaid.js, PLAID_PLAN.md). The link page, its token/complete/exit calls and the webhook are
 // public routes (no extension Origin): the page is the Worker's own origin, the webhook is Plaid's servers.
 plaidLink:'/v2/plaid/link',plaidLinkToken:'/v2/plaid/link/token',plaidLinkComplete:'/v2/plaid/link/complete',plaidLinkExit:'/v2/plaid/link/exit',
 plaidCards:'/v2/plaid/cards',plaidTransactions:'/v2/plaid/transactions',plaidRefresh:'/v2/plaid/refresh',plaidItem:'/v2/plaid/item',plaidWebhook:'/v2/plaid/webhook'};
const FIELDS=['model','messages','tools','tool_choice','max_tokens','temperature','response_format'];
const ROLES=new Set(['system','user','assistant','tool']);
const MESSAGE_FIELDS=['role','content','name','tool_calls','tool_call_id'];
const RESPONSE_FIELDS=['id','object','created','model','choices','usage'];
// Error codes the extension may show. Nothing else from the gateway or the provider reaches the client.
export const ERRORS={
 bad_request:400,model_not_allowed:400,origin_forbidden:403,not_found:404,method_not_allowed:405,
 too_large:413,unsupported_media_type:415,rate_limited:429,daily_requests:429,daily_tokens:429,monthly_budget:429,provider_rate_limited:429,
 push_daily_limit:429,push_capacity:503,
 provider_rejected:502,provider_error:502,provider_unreachable:502,gateway_not_configured:503,gateway_busy:503,provider_timeout:504,
 turn_invalid:400,turn_expired:409,agent_unavailable:503,push_unavailable:503,
 // Accounts (#412). Unknown email and wrong password are both invalid_credentials.
 weak_password:400,code_invalid:400,code_expired:400,invalid_credentials:401,unauthorized:401,email_unverified:403,
 stale_revision:409,invalid_document:422,passkey_invalid:401,challenge_expired:400,passkey_unavailable:503,account_locked:429,too_many_codes:429,mail_failed:502,account_unavailable:503,
 // Plaid (plaid.js).
 plaid_unavailable:503,plaid_error:502,plaid_limit:429,link_expired:410,item_not_found:404,webhook_invalid:401,
};

const number=(value,fallback,{min=0,integer=false}={})=>{const n=Number(value??fallback);return Number.isFinite(n)&&n>=min&&(!integer||Number.isInteger(n))?n:null;};
export function readConfig(env){
 const c={
  providerUrl:env.PROVIDER_URL||'https://api.deepseek.com/chat/completions',
  providerKey:typeof env.PROVIDER_KEY==='string'&&env.PROVIDER_KEY.length>=8?env.PROVIDER_KEY:null,
  models:String(env.ALLOWED_MODELS??'deepseek-flash').split(',').map(s=>s.trim()).filter(Boolean),
  origins:String(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean),
  // A local run (LOCAL_DEV=1) may also list an exact http://localhost or http://127.0.0.1 origin (the PWA's dev server).
  localOrigins:env.LOCAL_DEV==='1',
  maxBodyBytes:number(env.MAX_BODY_BYTES,262144,{min:1024,integer:true}),
  maxOutputTokens:number(env.MAX_OUTPUT_TOKENS,8192,{min:1,integer:true}),
  // Per client (salted hash of its address) per UTC day. The *_PER_CODE names are read for a deploy that still has them.
  dailyRequests:number(env.DAILY_REQUESTS_PER_CLIENT??env.DAILY_REQUESTS_PER_CODE,200,{integer:true}),
  dailyTokens:number(env.DAILY_TOKENS_PER_CLIENT??env.DAILY_TOKENS_PER_CODE,300000,{integer:true}),
  monthlyBudgetMicros:number(env.MONTHLY_BUDGET_USD,10)==null?null:Math.round(number(env.MONTHLY_BUDGET_USD,10)*1e6),
  // All clients together per UTC day; unset, it is the monthly budget / 30 (withSettings works it out).
  dailyBudgetMicros:env.DAILY_BUDGET_USD==null||env.DAILY_BUDGET_USD===''?undefined:number(env.DAILY_BUDGET_USD,0)==null?null:Math.round(number(env.DAILY_BUDGET_USD,0)*1e6),
  // Web Push writes (PUT and DELETE) per client per UTC day, and devices stored in all.
  pushWrites:number(env.PUSH_WRITES_PER_CLIENT,20,{integer:true}),
  maxPushDevices:number(env.MAX_PUSH_DEVICES,5000,{integer:true}),
  // USD per million tokens equals micro-USD per token.
  priceInput:number(env.PRICE_INPUT_USD_PER_MTOK,0.6),
  priceOutput:number(env.PRICE_OUTPUT_USD_PER_MTOK,2.4),
  // Long enough for MAX_OUTPUT_TOKENS without streaming; an abort keeps the worst case charged anyway.
  timeoutMs:number(env.PROVIDER_TIMEOUT_MS,180000,{min:1000,integer:true}),
 };
 let url=null;try{url=new URL(c.providerUrl);}catch{}
 // Fail closed: a missing key, binding, origin list or a malformed number disables the gateway.
 c.ready=!!(c.providerKey&&url&&(url.protocol==='https:'||env.ALLOW_HTTP_PROVIDER==='1')&&c.models.length&&c.origins.length&&env.USAGE
  // The rate limiter is required in production; only a local run against an http mock may go without.
  &&(env.RATE_LIMITER||env.ALLOW_HTTP_PROVIDER==='1')
  // The client-id salt is a required secret; only a local run (LOCAL_DEV=1) may fall back to the provider key.
  &&(validSalt(env.CLIENT_SALT)||env.LOCAL_DEV==='1')
  &&[c.maxBodyBytes,c.maxOutputTokens,c.dailyRequests,c.dailyTokens,c.monthlyBudgetMicros,c.dailyBudgetMicros,c.pushWrites,c.maxPushDevices,c.priceInput,c.priceOutput,c.timeoutMs].every(v=>v!==null));
 return c;
}

const validSalt=v=>typeof v==='string'&&v.length>=16;
// Caps the owner can change without a deploy: the KV key `settings` holds {dailyRequests, dailyTokens} (per client)
// and monthlyBudgetUsd, dailyBudgetUsd (all clients); each present, valid value replaces the var of the same cap.
// Without the KV binding the vars apply. A daily budget set nowhere is the monthly budget / 30.
export const SETTINGS_KEY='settings';
export async function withSettings(base,env){
 const c={...base};
 let s=null;try{s=await env.INVITES.get(SETTINGS_KEY,{type:'json'});}catch{}
 if(plain(s)){
  const whole=v=>Number.isInteger(v)&&v>=0;
  if(whole(s.dailyRequests))c.dailyRequests=s.dailyRequests;
  if(whole(s.dailyTokens))c.dailyTokens=s.dailyTokens;
  const usd=v=>typeof v==='number'&&v>=0&&Number.isFinite(v);
  if(usd(s.monthlyBudgetUsd))c.monthlyBudgetMicros=Math.round(s.monthlyBudgetUsd*1e6);
  if(usd(s.dailyBudgetUsd))c.dailyBudgetMicros=Math.round(s.dailyBudgetUsd*1e6);
 }
 if(c.dailyBudgetMicros===undefined)c.dailyBudgetMicros=Math.floor(c.monthlyBudgetMicros/30);
 return c;
}

// Extension origins: exact id, or "chrome-extension://*" for unpacked builds whose id varies (never a web page).
// Web origins (hosted wallet): only an exact, listed https:// origin; no wildcards, no http:// (except an exact, listed
// http://localhost or http://127.0.0.1 origin when `local`, i.e. LOCAL_DEV=1).
export function originAllowed(origin,origins,{local=false}={}){
 if(!origin)return false;
 if(/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return origins.includes(origin)||origins.includes('chrome-extension://*');
 if(/^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/.test(origin))return origins.includes(origin);
 if(local&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin))return origins.includes(origin);
 return false;
}
/** The listed web origins (the hosted wallet): where the Plaid Link page may send the user back to. */
export const webOrigins=config=>config.origins.filter(o=>originAllowed(o,config.origins,{local:config.localOrigins})&&!o.startsWith('chrome-extension:'));

const encoder=new TextEncoder();
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');

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
 // The forceModel switch (switches.js) is already checked against ALLOWED_MODELS and replaces what the client asked for.
 const model=c.forceModel||(body.model??c.models[0]);
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
export async function callLedger(env,op,args){
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
// The agent route (`/v1/chat`, agent.js) reuses them as they are: reserve and
// settle once per model call.

/**
 * The client id: HMAC-SHA256 of the UTC day and the client's address (clientKey), keyed by the secret CLIENT_SALT
 * (required in production; a local run, LOCAL_DEV=1, falls back to a key derived from PROVIDER_KEY). The address
 * itself is never stored; the id changes every day, so a day's counters cannot be linked to another day's or turned
 * back into an address without the secret. Never logged.
 */
export async function clientId(request,env,day){
 const secret=validSalt(env.CLIENT_SALT)?env.CLIENT_SALT:env.LOCAL_DEV==='1'?'local:'+(env.PROVIDER_KEY||''):null;
 if(secret==null)throw new Refusal('gateway_not_configured');
 const key=await crypto.subtle.importKey('raw',encoder.encode('cardybara-client-v1:'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return 'c'+hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(day+'|'+clientKey(request))))).slice(0,32);
}
/** A JSON request body within the size cap (MAX_BODY_BYTES unless a route gives its own). */
export async function readJson(ctx,limit=ctx.config.maxBodyBytes){
 if(!/^application\/json(\s*;|$)/i.test(ctx.request.headers.get('Content-Type')||''))throw new Refusal('unsupported_media_type');
 let text;try{text=await readLimited(ctx.request,limit);}catch(e){throw new Refusal(e.message==='too_large'?'too_large':'bad_request');}
 try{return JSON.parse(text);}catch{throw new Refusal('bad_request');}
}
/**
 * Reserves one model call's worst case against the client's daily caps and the global monthly budget, before
 * anything reaches the provider. Returns settle(spent): {tokens,micros} replaces the worst case; settle(null)
 * keeps it (no usage numbers).
 */
export async function reserve(ctx,worst){
 const c=await withSettings(ctx.config,ctx.env),day=today(ctx.now());let reservation;
 const code=await clientId(ctx.request,ctx.env,day);
 try{reservation=await callLedger(ctx.env,'reserve',{code,day,month:day.slice(0,7),tokens:worst.tokens,micros:worst.micros,maxRequests:c.dailyRequests,maxTokens:c.dailyTokens,maxMicros:c.monthlyBudgetMicros,maxDayMicros:c.dailyBudgetMicros});}
 catch{throw new Refusal('gateway_busy');}
 if(!reservation.ok){
  // Clients see the codes extension builds have always known: daily_requests / daily_tokens for the client's own
  // caps, monthly_budget for either budget. The log line's `limit` says exactly which cap it was.
  const limit={daily_requests:'client_requests',daily_tokens:'client_tokens',monthly_budget:'monthly_budget',daily_budget:'daily_budget'}[reservation.reason];
  if(!limit)throw new Refusal('gateway_busy');
  throw new Refusal(reservation.reason==='daily_budget'?'monthly_budget':reservation.reason,{limit});
 }
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

/**
 * What a client is, before hashing: its IPv4 address, or the /48 prefix of an IPv6 address (a whole site's
 * allocation, so one subscriber cannot spread across 65,536 /64s). An IPv4-mapped IPv6 address counts as its IPv4.
 */
export function clientKey(request){
 let ip=(request.headers.get('CF-Connecting-IP')||'').trim().toLowerCase();
 if(!ip)return 'unknown';
 const mapped=ip.match(/^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
 if(mapped)return mapped[1];
 const hexMapped=ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
 if(hexMapped){const a=parseInt(hexMapped[1],16),b=parseInt(hexMapped[2],16);return [a>>8,a&255,b>>8,b&255].join('.');}
 if(!ip.includes(':'))return ip;
 const [head,tail=''] =ip.split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[];
 const groups=ip.includes('::')?[...h,...Array(Math.max(0,8-h.length-t.length)).fill('0'),...t]:h;
 return groups.slice(0,3).map(g=>(parseInt(g||'0',16)||0).toString(16)).join(':')+'::/48';
}

// --- Routes.

/** Older extension builds check a saved invite code here before using the assistant. Any code, or none, is fine. */
async function inviteRoute(ctx){return respond(200,{status:'active'},ctx.cors);}

// Web Push reminders (push.js, docs/GATEWAY.md "Web Push"). The log line gets the number of fire times, never the endpoint.
function pushReady(ctx){if(!pushConfigured(ctx.env))throw new Refusal('push_unavailable');}
/** The VAPID public key the web wallet subscribes with. */
async function pushKeyRoute(ctx){pushReady(ctx);return respond(200,{publicKey:ctx.env.VAPID_PUBLIC_KEY},ctx.cors);}
/**
 * Counts one push write against the client's daily cap and, for a PUT, holds the device's place under the global
 * device cap, in the ledger, before KV is touched.
 */
async function pushLedger(ctx,action,device,exp){
 const c=ctx.config,day=today(ctx.now());let r;
 try{r=await callLedger(ctx.env,'push',{code:await clientId(ctx.request,ctx.env,day),day,action,device,exp,now:Math.floor(ctx.now()/1000),maxWrites:c.pushWrites,maxDevices:c.maxPushDevices});}
 catch(e){throw e instanceof Refusal?e:new Refusal('gateway_busy');}
 if(!r.ok)throw new Refusal(ERRORS[r.reason]?r.reason:'gateway_busy');
}
/** Replaces the device's subscription and its whole list of fire times. */
async function pushPutRoute(ctx){
 pushReady(ctx);
 const body=await readJson(ctx);let record;
 try{record=parsePut(body,ctx.now());}catch{throw new Refusal('bad_request');}
 await pushLedger(ctx,'put',record.device,Math.floor(ctx.now()/1000)+EXPIRY_SECONDS);
 await storePush(ctx.env.INVITES,record,ctx.now());
 ctx.record.times=record.times.length;
 return respond(200,{status:'stored',times:record.times.length},ctx.cors);
}
/** Forgets the device. Deleting a device that is not there is not an error. */
async function pushDeleteRoute(ctx){
 pushReady(ctx);
 let device;try{device=parseDelete(await readJson(ctx));}catch(e){throw e instanceof Refusal?e:new Refusal('bad_request');}
 await pushLedger(ctx,'delete',device);
 await forgetPush(ctx.env.INVITES,device);
 ctx.record.times=0;
 return respond(200,{status:'forgotten'},ctx.cors);
}

// The proxy's one real use is card-type suggestion (two short messages, a JSON answer of a few hundred tokens), so it
// takes nothing larger: a public, credential-free route must not be a general-purpose model.
export const COMPLETION_LIMITS={maxTokens:600,messages:4,chars:32000};
export function checkCompletionSize(body){
 if(!plain(body)||!Array.isArray(body.messages)||body.messages.length>COMPLETION_LIMITS.messages)throw Error('bad_request');
 if(body.max_tokens!==undefined&&!(Number.isInteger(body.max_tokens)&&body.max_tokens<=COMPLETION_LIMITS.maxTokens))throw Error('bad_request');
 const chars=body.messages.reduce((n,m)=>n+(typeof m?.content==='string'?m.content.length:0),0)+(body.tools===undefined?0:JSON.stringify(body.tools).length);
 if(chars>COMPLETION_LIMITS.chars)throw Error('bad_request');
}
/** The model proxy: one completion, as JSON or as server-sent events when the client asks to stream. */
async function completionRoute(ctx){
 let forwarded;
 try{const body=await readJson(ctx);checkCompletionSize(body);forwarded=sanitizeBody(body,{...ctx.config,maxOutputTokens:Math.min(ctx.config.maxOutputTokens,COMPLETION_LIMITS.maxTokens),forceModel:(await ctx.switches()).forceModel});}catch(e){throw e instanceof Refusal?e:new Refusal(ERRORS[e.message]?e.message:'bad_request');}
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

// Account routes (accounts.js, docs/GATEWAY.md "Accounts"). The handler gets the JSON body (if the route takes one) and
// the bearer session token; the user is always the session's, never an id from the client. The log line keeps the
// route, status, error code, a hash of the session's user id and the blob size: no email, password, code, token or wallet content.
const WALLET_ENVELOPE_BYTES=4096;
function accountRoute(op,{body=true,plaid:needsPlaid=false,sameOrigin=false}={}){
 return async ctx=>{
  if(!accounts.accountsConfigured(ctx.env))throw new Refusal('account_unavailable');
  if(needsPlaid&&!plaid.plaidConfigured(ctx.env))throw new Refusal('plaid_unavailable');
  // The Link page's own calls: same origin only (a page elsewhere cannot spend a link session).
  if(sameOrigin&&ctx.request.headers.get('Origin')!==ctx.url.origin)throw new Refusal('origin_forbidden');
  const limit=op===accounts.putWallet?accounts.walletMaxBytes(ctx.env)+WALLET_ENVELOPE_BYTES:ctx.config.maxBodyBytes;
  const json=body?await readJson(ctx,limit):null;
  try{
   const audit={};
   try{
    const r=await op({env:ctx.env,body:json,token:accounts.bearer(ctx.request),now:ctx.now(),clock:ctx.now,audit,params:ctx.params,fetch:ctx.upstream,url:ctx.url,request:ctx.request,ctx});
    return respond(r.status,r.body,ctx.cors);
   }finally{
    // The log line gets a hash of the session's user and the blob size; set also when the call is refused.
    if(audit.userId)ctx.record.user=await accounts.logUserHash(ctx.env,audit.userId);
    if(Number.isInteger(audit.size))ctx.record.size=audit.size;
    // Plaid: request_ids and error codes (support needs them), the Link session id; never a token.
    if(audit.plaid)ctx.record.plaid=audit.plaid.slice(0,20);
    for(const k of ['linkSessionId','linkError','linkStatus'])if(audit[k])ctx.record[k]=audit[k];
   }
  }catch(e){
   if(e instanceof accounts.AccountError){
    // Only these two say more than a code: when to try again, and the revision to pull before a retry.
    const extra=Number.isInteger(e.extra?.retryAfter)?{retryAfter:e.extra.retryAfter}:Number.isInteger(e.extra?.revision)?{revision:e.extra.revision}:typeof e.extra?.plaidCode==='string'?{plaidCode:e.extra.plaidCode}:{};
    ctx.record.error=e.message;
    return respond(ERRORS[e.message]||400,{error:{code:e.message,...extra}},{...ctx.cors,...(extra.retryAfter?{'Retry-After':String(extra.retryAfter)}:{})});
   }
   throw e;
  }
 };
}

// Plaid handlers take a clock function (args.clock) and the request context's deferLog for webhook work.
const plaidOp=op=>args=>op({...args,now:args.clock,deferLog:args.ctx.deferLog});
/** DELETE /v2/account also removes the user's Plaid Items at Plaid (/item/remove), after the password check. */
const deleteAccountWithPlaid=args=>accounts.deleteAccount({...args,beforeDelete:async userId=>{
 const r=await plaid.removeAllItems({env:args.env,fetch:args.fetch,audit:args.audit,now:args.clock},userId);
 if(r.failed)args.audit.plaidRemoveFailed=r.failed;
}});
/** GET /v2/plaid/link: the Link page (plaidPage.js). 503 until Plaid is set up. */
async function plaidPageRoute(ctx){
 if(!plaid.plaidConfigured(ctx.env))throw new Refusal('plaid_unavailable');
 return linkPage({returnOrigins:webOrigins(ctx.config)});
}
/** POST /v2/plaid/webhook: no Origin, no session, its own size cap; the signature is the credential. */
async function plaidWebhookRoute(ctx){
 const audit={};
 try{
  const r=await plaid.webhook({env:ctx.env,request:ctx.request,now:ctx.now,audit,fetch:ctx.upstream,deferLog:ctx.deferLog});
  return respond(r.status,r.body,{});
 }catch(e){
  if(e instanceof accounts.AccountError){ctx.record.error=e.message;return respond(ERRORS[e.message]||400,{error:{code:e.message}},{});}
  throw e;
 }finally{
  if(audit.plaid)ctx.record.plaid=audit.plaid.slice(0,20);
  if(audit.webhook)ctx.record.webhook=audit.webhook;
 }
}

// The router. A route names its path, method and handler. No /v1 route needs a credential; /v2/account routes other
// than sign-up, verify, sign-in and the password-reset pair need a bearer session.
export const ROUTE_TABLE=[
 {path:ROUTES.invite,name:'invite',method:'POST',handler:inviteRoute},
 {path:ROUTES.agent,name:'agent',method:'POST',handler:agentRoute},
 {path:ROUTES.chat,name:'chat',method:'POST',handler:completionRoute},
 {path:ROUTES.push,name:'push',method:'PUT',handler:pushPutRoute},
 {path:ROUTES.push,name:'push',method:'DELETE',handler:pushDeleteRoute},
 {path:ROUTES.pushKey,name:'push_key',method:'GET',handler:pushKeyRoute},
 {path:ROUTES.signUp,name:'account_signup',method:'POST',handler:accountRoute(accounts.signUp)},
 {path:ROUTES.verify,name:'account_verify',method:'POST',handler:accountRoute(accounts.verify)},
 {path:ROUTES.session,name:'account_session',method:'POST',handler:accountRoute(accounts.signIn)},
 {path:ROUTES.session,name:'account_session',method:'DELETE',handler:accountRoute(accounts.signOut,{body:false})},
 {path:ROUTES.forgot,name:'account_forgot',method:'POST',handler:accountRoute(accounts.forgotPassword)},
 {path:ROUTES.reset,name:'account_reset',method:'POST',handler:accountRoute(accounts.resetPassword)},
 {path:ROUTES.password,name:'account_password',method:'POST',handler:accountRoute(accounts.changePassword)},
 {path:ROUTES.wallet,name:'account_wallet',method:'GET',handler:accountRoute(accounts.getWallet,{body:false})},
 {path:ROUTES.wallet,name:'account_wallet',method:'PUT',handler:accountRoute(accounts.putWallet)},
 {path:ROUTES.export,name:'account_export',method:'GET',handler:accountRoute(accounts.exportAccount,{body:false})},
 {path:ROUTES.account,name:'account',method:'DELETE',handler:accountRoute(deleteAccountWithPlaid)},
 {path:ROUTES.passkeyStatus,name:'passkey_status',method:'GET',handler:accountRoute(passkeys.status,{body:false})},
 {path:ROUTES.passkeyRegisterOptions,name:'passkey_register_options',method:'POST',handler:accountRoute(passkeys.registerOptions)},
 {path:ROUTES.passkeyRegisterVerify,name:'passkey_register_verify',method:'POST',handler:accountRoute(passkeys.registerVerify)},
 {path:ROUTES.passkeyLoginOptions,name:'passkey_login_options',method:'POST',handler:accountRoute(passkeys.loginOptions)},
 {path:ROUTES.passkeyLoginVerify,name:'passkey_login_verify',method:'POST',handler:accountRoute(passkeys.loginVerify)},
 {path:ROUTES.passkeys,name:'passkey_list',method:'GET',handler:accountRoute(passkeys.list,{body:false})},
 {path:ROUTES.passkeys,name:'passkey_remove',method:'DELETE',param:true,handler:accountRoute(passkeys.remove,{body:false})},
 // Plaid (plaid.js). Signed in, from the extension:
 {path:ROUTES.plaidLink,name:'plaid_link_start',method:'POST',handler:accountRoute(plaidOp(plaid.startLink),{plaid:true})},
 {path:ROUTES.plaidCards,name:'plaid_cards',method:'GET',handler:accountRoute(plaidOp(plaid.listCards),{body:false,plaid:true})},
 {path:ROUTES.plaidTransactions,name:'plaid_transactions',method:'GET',handler:accountRoute(plaidOp(plaid.listTransactions),{body:false,plaid:true})},
 {path:ROUTES.plaidRefresh,name:'plaid_refresh',method:'POST',handler:accountRoute(plaidOp(plaid.refresh),{plaid:true})},
 {path:ROUTES.plaidItem,name:'plaid_item_remove',method:'DELETE',handler:accountRoute(plaidOp(plaid.removeItem),{plaid:true})},
 // Public: the Link page (GET, no Origin) and its same-origin calls; the webhook (Plaid's servers, signed).
 {path:ROUTES.plaidLink,name:'plaid_link_page',method:'GET',public:true,handler:plaidPageRoute},
 {path:ROUTES.plaidLinkToken,name:'plaid_link_token',method:'POST',public:true,limited:true,handler:accountRoute(plaidOp(plaid.linkToken),{plaid:true,sameOrigin:true})},
 {path:ROUTES.plaidLinkComplete,name:'plaid_link_complete',method:'POST',public:true,limited:true,handler:accountRoute(plaidOp(plaid.completeLink),{plaid:true,sameOrigin:true})},
 {path:ROUTES.plaidLinkExit,name:'plaid_link_exit',method:'POST',public:true,limited:true,handler:accountRoute(plaidOp(plaid.exitLink),{plaid:true,sameOrigin:true})},
 {path:ROUTES.plaidWebhook,name:'plaid_webhook',method:'POST',public:true,handler:plaidWebhookRoute},
];

/**
 * The gateway. deps: {fetch, log, now, waitUntil, observe} — the upstream fetch, a log sink for one metadata line per
 * request, a clock and the runtime's waitUntil; injected so tests and the packaged-extension E2E run this
 * exact code against a fake provider.
 */
export async function handle(request,env,deps={}){
 const now=deps.now||Date.now,log=deps.log||(line=>console.log(line));
 const url=new URL(request.url),origin=request.headers.get('Origin');
 const config=readConfig(env),allowed=originAllowed(origin,config.origins,{local:config.localOrigins});
 const cors=allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{'Vary':'Origin'};
 // A path may have several methods; `route` is the entry for this request's method, or the path's first entry for a wrong method.
 const credentialId=url.pathname.startsWith(ROUTES.passkeys+'/')?url.pathname.slice(ROUTES.passkeys.length+1):'';
 const params=/^[A-Za-z0-9_-]{1,1024}$/.test(credentialId)?{id:credentialId}:null;
 const onPath=ROUTE_TABLE.filter(r=>r.param?!!params&&r.path===ROUTES.passkeys:r.path===url.pathname),route=onPath.find(r=>r.method===request.method)||onPath[0];
 const record={at:new Date(now()).toISOString(),route:route?.name||'other',status:0};
 let deferred=null,switchesRead=null;
 const ctx={request,env,config,cors,record,url,now,params,// Called as a plain function: Workers' fetch throws "Illegal invocation" when called as a method of another object.
  upstream:deps.fetch||((...a)=>globalThis.fetch(...a)),deferLog:p=>{deferred=p;},
  // Tests only: sees each agent model call's payload before it becomes a provider request. The Worker never sets it.
  observe:deps.observe||null,
  // The KV switches, read once per request through a short cache (switches.js).
  switches:()=>(switchesRead||=readSwitches({env,config,now,log})),
  // What the metrics data point needs beyond the log record (model, prompt hash, repair, tool counts); never logged.
  metrics:{}};
 const started=now();
 // The log line first, then the metrics data point (metrics.js): neither can make the other fail.
 const write=()=>{log(JSON.stringify(record));writeMetrics(ctx,now()-started);};
 const finish=response=>{record.status=response.status;if(deferred){const p=deferred.then(write);deps.waitUntil?deps.waitUntil(p):void p;}else write();return response;};
 const refuse=(code,extra={})=>{Object.assign(record,{error:code},extra);return finish(respond(ERRORS[code]||500,{error:{code}},code==='method_not_allowed'?{...cors,Allow:onPath.map(r=>r.method).join(', ')}:cors));};
 if(request.method==='OPTIONS'){
  if(!allowed||!route)return finish(respond(allowed?404:403,null,cors));
  return finish(respond(204,null,{...cors,'Access-Control-Allow-Methods':onPath.map(r=>r.method).join(', '),'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}));
 }
 // Public routes (the Plaid Link page and webhook) skip the extension Origin list and the model-proxy setup; each
 // handler checks its own caller (same origin, or Plaid's signature).
 if(route?.public&&request.method!=='OPTIONS'){
  const own=onPath.find(r=>r.method===request.method&&r.public);
  if(own){
   try{
    if(own.limited&&env.RATE_LIMITER){const {success}=await env.RATE_LIMITER.limit({key:await clientId(request,env,today(now()))});if(!success)throw new Refusal('rate_limited');}
    record.route=own.name;
    return finish(await own.handler(ctx));
   }catch(e){
    if(e instanceof Refusal)return refuse(e.message,e.extra);
    return refuse('gateway_busy');
   }
  }
 }
 if(!allowed)return refuse('origin_forbidden');
 if(!route)return refuse('not_found');
 if(request.method!==route.method)return refuse('method_not_allowed');
 if(!config.ready)return refuse('gateway_not_configured');
 // Cloudflare always sets the client's address. Without it every caller would share one bucket, so production
 // refuses; only a local run (LOCAL_DEV=1: wrangler dev, tests, the E2E) may go without.
 if(!request.headers.get('CF-Connecting-IP')&&env.LOCAL_DEV!=='1')return refuse('bad_request',{reason:'no_client_address'});
 try{
  // Per client, before any KV or ledger call. The limiter is given the hashed client id, never the address. The
  // binding is optional (local runs and tests have none); gateway/wrangler.jsonc declares it.
  if(env.RATE_LIMITER){const {success}=await env.RATE_LIMITER.limit({key:await clientId(request,env,today(now()))});if(!success)throw new Refusal('rate_limited');}
  return finish(await route.handler(ctx));
 }catch(e){
  if(e instanceof Refusal)return refuse(e.message,e.extra);
  return refuse('gateway_busy');
 }
}

/**
 * Usage counters in one Durable Object instance. Each operation runs to completion before the next starts
 * (an explicit queue on top of the runtime's input gates), so a check and its increment cannot interleave.
 * Keys: d:<day>:<client id> {requests,tokens}; p:<day>:<client id> {writes} (push); g:<day> {micros} (all clients);
 * m:<month> {micros}; r:<id> an open reservation; v:<device> {exp} a stored push device, and `devices` their count;
 * pruned: the last day pruned. A client id is only ever kept for its own UTC day: the first request of the next
 * day, or the alarm set for just after midnight UTC, deletes every earlier day's d: and p: keys and strips the
 * client's day key from older open reservations.
 */
export class UsageLedger{
 constructor(state){this.storage=state.storage;this.now=state.now||Date.now;this.queue=Promise.resolve();}
 /** Durable Object alarm: prunes when no request arrives after midnight. */
 async alarm(){await this.run(()=>this.prune(new Date(this.now()).toISOString().slice(0,10)));}
 run(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
 async fetch(request){
  const op=new URL(request.url).pathname.slice(1);let args;
  try{args=await request.json();}catch{return new Response('bad',{status:400});}
  if(!['reserve','settle','month','push','forget'].includes(op))return new Response('bad',{status:404});
  try{return Response.json(await this.run(()=>this[op](args)));}catch{return new Response('bad',{status:500});}
 }
 async reserve({code,day,month,tokens,micros,maxRequests,maxTokens,maxMicros,maxDayMicros=Infinity}){
  await this.pruneOnce(day);
  const dk=`d:${day}:${code}`,mk=`m:${month}`,gk=`g:${day}`;
  const d=(await this.storage.get(dk))||{requests:0,tokens:0},m=(await this.storage.get(mk))||{micros:0},g=(await this.storage.get(gk))||{micros:0};
  if(d.requests+1>maxRequests)return {ok:false,reason:'daily_requests'};
  if(d.tokens+tokens>maxTokens)return {ok:false,reason:'daily_tokens'};
  if(m.micros+micros>maxMicros)return {ok:false,reason:'monthly_budget'};
  if(g.micros+micros>(maxDayMicros??Infinity))return {ok:false,reason:'daily_budget'};
  const id=crypto.randomUUID();
  await this.storage.put({[dk]:{requests:d.requests+1,tokens:d.tokens+tokens},[mk]:{micros:m.micros+micros},[gk]:{micros:g.micros+micros},['r:'+id]:{dk,mk,gk,tokens,micros,day}});
  return {ok:true,id};
 }
 // The first call of a day prunes (an open reservation is a request whose worker never settled; its worst case is
 // already counted in the month and the day's budget).
 async pruneOnce(day){if(this.storage.list&&(await this.storage.get('pruned'))!==day)await this.prune(day);}
 async prune(day){
  const yesterday=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const all=async prefix=>[...(await this.storage.list({prefix})).entries()];
  const drop=async keys=>{for(let i=0;i<keys.length;i+=128)await this.storage.delete(keys.slice(i,i+128));};
  // Client ids: only today's.
  await drop((await all('d:')).filter(([k])=>k.slice(2,12)<day).map(([k])=>k));
  await drop((await all('p:')).filter(([k])=>k.slice(2,12)<day).map(([k])=>k));
  await drop((await all('g:')).filter(([k])=>k.slice(2,12)<yesterday).map(([k])=>k));
  const reservations=await all('r:');
  await drop(reservations.filter(([,v])=>(v?.day||'')<yesterday).map(([k])=>k));
  // An open reservation from an earlier day keeps only what settling the month and day budget needs.
  const strip=reservations.filter(([,v])=>v?.dk&&(v.day||'')<day&&(v.day||'')>=yesterday);
  for(const [k,v] of strip){const {dk,...rest}=v;await this.storage.put(k,rest);}
  // Push devices whose KV record has expired no longer hold a place.
  const nowSec=Math.floor(this.now()/1000),expired=(await all('v:')).filter(([,v])=>!(v?.exp>nowSec)).map(([k])=>k);
  if(expired.length){await drop(expired);const n=(await this.storage.get('devices'))||0;await this.storage.put('devices',Math.max(0,n-expired.length));}
  await this.storage.put('pruned',day);
  // Run again just after the next UTC midnight, so a day's client ids go even when no request comes the next day.
  if(typeof this.storage.setAlarm==='function')await this.storage.setAlarm(Date.parse(day+'T00:00:00Z')+86400000+60000);
 }
 /** Month-to-date spend in micro-USD (settled use plus open reservations' worst case), for the hourly alert check. */
 async month({month}){const m=(await this.storage.get('m:'+month))||{micros:0};return {micros:m.micros};}
 /** Replaces a reservation's worst case with what was actually spent. */
 async settle({id,tokens,micros,keep}){
  const r=await this.storage.get('r:'+id);if(!r)return {ok:false};
  if(keep){await this.storage.delete('r:'+id);return {ok:true};}
  const d=r.dk?await this.storage.get(r.dk):null,m=(await this.storage.get(r.mk))||{micros:0},g=r.gk?await this.storage.get(r.gk):null;
  // A day's counters pruned since the reservation (it settled after midnight) are not written back.
  await this.storage.put({...(d?{[r.dk]:{...d,tokens:Math.max(0,d.tokens-r.tokens+tokens)}}:{}),...(g?{[r.gk]:{micros:Math.max(0,g.micros-r.micros+micros)}}:{}),[r.mk]:{micros:Math.max(0,m.micros-r.micros+micros)}});
  await this.storage.delete('r:'+id);
  return {ok:true};
 }
 /**
  * One push write: counts it against the client's daily cap, and for a PUT of a device not yet stored, takes one of
  * the global device places (refused when they are all taken). A DELETE gives the place back.
  */
 async push({code,day,action,device,exp,now,maxWrites,maxDevices}){
  await this.pruneOnce(day);
  const pk=`p:${day}:${code}`,vk='v:'+device;
  const p=(await this.storage.get(pk))||{writes:0};
  if(p.writes+1>maxWrites)return {ok:false,reason:'push_daily_limit'};
  const known=await this.storage.get(vk),n=(await this.storage.get('devices'))||0;
  if(action==='put'){
   if(!known&&n>=maxDevices)return {ok:false,reason:'push_capacity'};
   await this.storage.put({[pk]:{writes:p.writes+1},[vk]:{exp},...(known?{}:{devices:n+1})});
  }else{
   await this.storage.put({[pk]:{writes:p.writes+1},...(known?{devices:Math.max(0,n-1)}:{})});
   if(known)await this.storage.delete(vk);
  }
  return {ok:true};
 }
 /** The cron deleted a device (gone at its push service): its place is free again. */
 async forget({device}){
  const vk='v:'+device;if(!await this.storage.get(vk))return {ok:true};
  const n=(await this.storage.get('devices'))||0;
  await this.storage.delete(vk);await this.storage.put('devices',Math.max(0,n-1));
  return {ok:true};
 }
}
