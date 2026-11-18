// Plaid-linked credit cards (PLAID_PLAN.md at the repository root). Every Plaid call is made here, in the Worker: the
// client id and secret (PLAID_CLIENT_ID, PLAID_SECRET) and PLAID_ENV are Worker secrets/vars, never in the extension,
// and an Item's access token is stored only AES-GCM encrypted (key from PLAID_TOKEN_KEY) and never leaves the Worker.
//
// Flow: the extension (signed in, bearer session) asks POST /v2/plaid/link for a link session; the Worker creates the
// link_token and answers a URL of its own Link page (GET /v2/plaid/link#s=<handle>). That page loads Plaid's
// link-initialize.js (an MV3 extension cannot load remote script), fetches the link_token by the one-time handle, opens
// Link, and posts the public_token back; the Worker exchanges it, stores the Item and runs the first
// /transactions/sync and /liabilities/get. The same page is the OAuth redirect_uri: the handle survives the redirect
// in the page's localStorage and the server hands back the same link_token. Later updates come from Plaid's webhooks
// (POST /v2/plaid/webhook, verified Plaid-Verification JWT): SYNC_UPDATES_AVAILABLE runs /transactions/sync,
// LIABILITIES DEFAULT_UPDATE runs /liabilities/get, ITEM webhooks set the Item's status. POST /v2/plaid/refresh is the
// user's explicit "sync now" (and the reconcile path when webhooks were missed); it is never called on a schedule.
//
// Logged: Plaid request_ids, error codes and link_session_ids only; never a token, secret, amount or merchant.
// Handlers return {status, body} or throw AccountError, so gateway.js wraps them like the account routes.
import {decodeProtectedHeader,importJWK,jwtVerify} from 'jose';
import {AccountError,session,one,run,b64u,randomBytes,sec,accountsConfigured} from './accounts.js';

const fail=(code,extra)=>{throw new AccountError(code,extra);};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v,max=200)=>typeof v==='string'&&v.length<=max?v:null;
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const encoder=new TextEncoder();

export const HOSTS={sandbox:'https://sandbox.plaid.com',production:'https://production.plaid.com'};
export const PLAID_VERSION='2020-09-14';
export const LINK_SESSION_TTL_SECONDS=60*60;
export const REFRESH_COOLDOWN_SECONDS=60;
export const DAYS_REQUESTED=365;
export const WEBHOOK_MAX_AGE_SECONDS=5*60;
export const WEBHOOK_MAX_BYTES=65536;
export const TRANSACTIONS_RETURNED_MAX=2000;
// Item statuses the extension shows.
export const STATUS={ok:'ok',loginRequired:'login_required',pendingDisconnect:'pending_disconnect',revoked:'revoked',error:'error'};

const validSecret=v=>typeof v==='string'&&v.length>=32;
function tokenSecret(env){return validSecret(env.PLAID_TOKEN_KEY)?env.PLAID_TOKEN_KEY:env.LOCAL_DEV==='1'?'local-plaid-token-key-not-a-secret':null;}
/** The one source of the environment: PLAID_ENV picks the host the keys belong to (sandbox or production). */
export const plaidEnv=env=>Object.hasOwn(HOSTS,env.PLAID_ENV)?env.PLAID_ENV:null;
/** Plaid routes answer 503 plaid_unavailable until accounts work and the Plaid keys, environment and token key are set. */
export function plaidConfigured(env){
 return accountsConfigured(env)&&!!plaidEnv(env)&&typeof env.PLAID_CLIENT_ID==='string'&&env.PLAID_CLIENT_ID.length>0
  &&typeof env.PLAID_SECRET==='string'&&env.PLAID_SECRET.length>0&&!!tokenSecret(env);
}

// --- Access token encryption: AES-256-GCM, key derived with HKDF from PLAID_TOKEN_KEY, the Item id as associated data.
async function aesKey(env){
 const base=await crypto.subtle.importKey('raw',encoder.encode(tokenSecret(env)),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode('cardybara-plaid-v1'),info:encoder.encode('access-token')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const fromB64u=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
export async function sealToken(env,itemId,token){
 const iv=randomBytes(12);
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('item|'+itemId)},await aesKey(env),encoder.encode(token));
 return 'v1.'+b64u(iv)+'.'+b64u(new Uint8Array(ct));
}
export async function openToken(env,itemId,sealed){
 const [v,iv,ct]=String(sealed).split('.');
 if(v!=='v1'||!iv||!ct)throw Error('sealed token format');
 const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64u(iv),additionalData:encoder.encode('item|'+itemId)},await aesKey(env),fromB64u(ct));
 return new TextDecoder().decode(pt);
}

// --- The Plaid API: one POST per call, client id and secret in the body, the API version pinned by header.
// The plan's connection cap (Trial plan, or Limited Production's Item cap): no new Item until the plan is upgraded.
// The wallet says so instead of a generic error (plaid_limit).
export const LIMIT_CODES=new Set(['TRIAL_CONNECTION_LIMIT','CREDITS_EXHAUSTED','ADDITION_LIMIT']);
const plaidFail=e=>{if(e instanceof PlaidError)fail(LIMIT_CODES.has(e.code)?'plaid_limit':'plaid_error',{plaidCode:e.code});throw e;};
// A request Plaid refused as malformed (INVALID_REQUEST, INVALID_INPUT) is our bug or our configuration, and its error_code
// alone (INVALID_FIELD) does not say which field: the log line keeps Plaid's error_message for these, cut short. Plaid
// writes it about the request's shape, but we do not control it and it may quote a field value, so it is scrubbed
// (token-shaped strings, long opaque runs, the request's client_user_id) before it is kept: defence in depth, not a guarantee.
const EXPLAINED_TYPES=new Set(['INVALID_REQUEST','INVALID_INPUT']);
const TOKEN_SHAPES=/\b(?:access|public|link)-(?:sandbox|development|production)-[\w-]+|[A-Za-z0-9_-]{24,}/g;
export const explanation=(type,m,userId=null)=>{
 if(!EXPLAINED_TYPES.has(type)||typeof m!=='string'||!m)return null;
 let s=m;
 if(typeof userId==='string'&&userId)s=s.split(userId).join('[redacted]');
 return s.replace(TOKEN_SHAPES,'[redacted]').slice(0,200);
};
export class PlaidError extends Error{
 constructor(data,status,userId=null){super(data?.error_code||'PLAID_ERROR');this.type=data?.error_type||null;this.code=data?.error_code||null;this.requestId=data?.request_id||null;this.display=data?.display_message||null;this.status=status;this.explanation=explanation(this.type,data?.error_message,userId);}
}
// Transient: retried a couple of times with backoff and jitter. Everything else needs the user, or is a bug.
const RETRY_CODES=new Set(['INSTITUTION_DOWN','INSTITUTION_NOT_RESPONDING','INTERNAL_SERVER_ERROR']);
// A plan cap (LIMIT_CODES) is RATE_LIMIT_EXCEEDED too, but waiting does not lift it.
const retryable=e=>e instanceof PlaidError&&!LIMIT_CODES.has(e.code)&&(e.type==='RATE_LIMIT_EXCEEDED'||RETRY_CODES.has(e.code));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
/** ctx: {env, fetch, audit, sleep}. audit.plaid collects request_ids and error codes for the log line. */
export async function plaidCall(ctx,path,body,{attempts=3}={}){
 const host=HOSTS[plaidEnv(ctx.env)];
 const sleep=ctx.sleep||pause;
 for(let attempt=1;;attempt++){
  let data=null,status=0;
  try{
   const r=await ctx.fetch(host+path,{method:'POST',headers:{'Content-Type':'application/json','Plaid-Version':PLAID_VERSION},body:JSON.stringify({client_id:ctx.env.PLAID_CLIENT_ID,secret:ctx.env.PLAID_SECRET,...body})});
   status=r.status;
   try{data=await r.json();}catch{data=null;}
   if(r.ok&&plain(data)){note(ctx,path,data.request_id,null);return data;}
  }catch{data={error_type:'API_ERROR',error_code:'PLAID_UNREACHABLE'};}
  const e=new PlaidError(data,status,body?.user?.client_user_id);
  note(ctx,path,e.requestId,e.code,e.explanation);
  if(attempt>=attempts||!retryable(e))throw e;
  await sleep(250*2**attempt+Math.floor(Math.random()*250));
 }
}
function note(ctx,path,requestId,code,message=null){
 if(!ctx.audit)return;
 (ctx.audit.plaid||=[]).push({call:path,...(requestId?{requestId}:{}),...(code?{error:code}:{}),...(message?{message}:{})});
}

// --- Stored rows.
const itemRow=(env,itemId)=>one(env.DB,'SELECT * FROM plaid_items WHERE item_id = ?',itemId);
const itemsOf=async(env,userId)=>(await env.DB.prepare('SELECT * FROM plaid_items WHERE user_id = ?').bind(userId).all()).results;
async function ownItem(env,userId,itemId){
 if(typeof itemId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(itemId))fail('bad_request');
 const row=await itemRow(env,itemId);
 if(!row||row.user_id!==userId)fail('item_not_found');
 return row;
}
async function setStatus(env,itemId,status,errorCode=null){
 await run(env.DB,'UPDATE plaid_items SET status = ?, error_code = ? WHERE item_id = ?',status,errorCode,itemId);
}
/** ITEM_NOT_FOUND: the Item is gone at Plaid (removed or revoked). Forget it here too; a new Link is needed. */
async function purgeItem(env,itemId){
 const st=(sql,...a)=>env.DB.prepare(sql).bind(...a);
 await env.DB.batch([st('DELETE FROM plaid_transactions WHERE item_id = ?',itemId),st('DELETE FROM plaid_link_sessions WHERE item_id = ?',itemId),st('DELETE FROM plaid_items WHERE item_id = ?',itemId)]);
}
/** What an error means for the Item's status (null: no change). */
function statusFor(e){
 if(!(e instanceof PlaidError))return null;
 if(e.code==='ITEM_LOGIN_REQUIRED'||e.code==='INVALID_CREDENTIALS'||e.code==='ITEM_LOCKED')return STATUS.loginRequired;
 if(e.code==='ACCESS_NOT_GRANTED'||e.code==='ADDITIONAL_CONSENT_REQUIRED')return STATUS.error;
 return null;
}

// --- Transactions: /transactions/sync, all pages buffered, written with the cursor in one batch once has_more is false.
const txnData=t=>({
 date:str(t.date,10),authorizedDate:str(t.authorized_date,10),amount:num(t.amount),
 currency:str(t.iso_currency_code,3)||str(t.unofficial_currency_code,10),
 merchant:str(t.merchant_name),name:str(t.name),pending:t.pending===true,pendingTransactionId:str(t.pending_transaction_id),
 category:plain(t.personal_finance_category)?{primary:str(t.personal_finance_category.primary,80),detailed:str(t.personal_finance_category.detailed,120),confidence:str(t.personal_finance_category.confidence_level,20)}:null,
});
export async function syncTransactions(ctx,row){
 const token=await openToken(ctx.env,row.item_id,row.access_token_enc);
 const start=row.cursor||'';
 for(let restart=0;;restart++){
  let cursor=start,added=new Map(),removed=new Set(),status=null;
  try{
   for(let page=0;;page++){
    if(page>200)throw Error('too many pages');
    const r=await plaidCall(ctx,'/transactions/sync',{access_token:token,cursor:cursor||undefined,count:500,options:{include_original_description:false,personal_finance_category_version:'v2'}});
    for(const t of [...(r.added||[]),...(r.modified||[])])if(plain(t)&&typeof t.transaction_id==='string'){added.set(t.transaction_id,t);removed.delete(t.transaction_id);}
    for(const t of r.removed||[])if(typeof t?.transaction_id==='string'){removed.add(t.transaction_id);added.delete(t.transaction_id);}
    status=r.transactions_update_status||status;cursor=r.next_cursor;
    if(!r.has_more)break;
   }
  }catch(e){
   // Mutation mid-pagination: restart the whole loop from the cursor it started with.
   if(e instanceof PlaidError&&e.code==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'&&restart<3)continue;
   throw e;
  }
  const st=(sql,...a)=>ctx.env.DB.prepare(sql).bind(...a);
  const now=sec(ctx.now());
  const initial=status==='INITIAL_UPDATE_COMPLETE'||status==='HISTORICAL_UPDATE_COMPLETE'||row.initial_complete?1:0;
  const historical=status==='HISTORICAL_UPDATE_COMPLETE'||row.historical_complete?1:0;
  await ctx.env.DB.batch([
   ...[...added.values()].map(t=>st('INSERT OR REPLACE INTO plaid_transactions (transaction_id, user_id, item_id, account_id, date, data) VALUES (?, ?, ?, ?, ?, ?)',
    t.transaction_id,row.user_id,row.item_id,String(t.account_id||''),String(t.date||''),JSON.stringify(txnData(t)))),
   ...[...removed].map(id=>st('DELETE FROM plaid_transactions WHERE transaction_id = ? AND item_id = ?',id,row.item_id)),
   st('UPDATE plaid_items SET cursor = ?, initial_complete = ?, historical_complete = ?, synced_at = ? WHERE item_id = ?',cursor||'',initial,historical,now,row.item_id),
  ]);
  return {added:added.size,removed:removed.size};
 }
}

// --- Liabilities: /liabilities/get for the credit cards (statement balance, minimum, due date, APRs) and their balances.
const accountData=a=>({
 accountId:str(a.account_id),persistentAccountId:str(a.persistent_account_id),name:str(a.name),officialName:str(a.official_name),
 mask:str(a.mask,8),type:str(a.type,40),subtype:str(a.subtype,40),
 balances:{current:num(a.balances?.current),available:num(a.balances?.available),limit:num(a.balances?.limit),
  currency:str(a.balances?.iso_currency_code,3)||str(a.balances?.unofficial_currency_code,10)},
});
const creditData=c=>({
 accountId:str(c.account_id),aprs:Array.isArray(c.aprs)?c.aprs.filter(plain).map(a=>({type:str(a.apr_type,40),percentage:num(a.apr_percentage),balanceSubjectToApr:num(a.balance_subject_to_apr)})):[],
 isOverdue:typeof c.is_overdue==='boolean'?c.is_overdue:null,lastPaymentAmount:num(c.last_payment_amount),lastPaymentDate:str(c.last_payment_date,10),
 lastStatementIssueDate:str(c.last_statement_issue_date,10),lastStatementBalance:num(c.last_statement_balance),
 minimumPaymentAmount:num(c.minimum_payment_amount),nextPaymentDueDate:str(c.next_payment_due_date,10),
});
export async function refreshLiabilities(ctx,row){
 const token=await openToken(ctx.env,row.item_id,row.access_token_enc);
 let r;
 try{r=await plaidCall(ctx,'/liabilities/get',{access_token:token});}
 catch(e){
  // No credit accounts on this Item, or not ready yet: keep what is stored and wait for the webhook.
  if(e instanceof PlaidError&&(e.code==='NO_LIABILITY_ACCOUNTS'||e.code==='PRODUCT_NOT_READY'))return {ready:false,reason:e.code};
  throw e;
 }
 const accounts=(r.accounts||[]).filter(plain).map(accountData).filter(a=>a.accountId);
 const credit=(r.liabilities?.credit||[]).filter(plain).map(creditData).filter(c=>c.accountId);
 await run(ctx.env.DB,'UPDATE plaid_items SET accounts = ?, liabilities = ?, liabilities_at = ? WHERE item_id = ?',JSON.stringify(accounts),JSON.stringify(credit),sec(ctx.now()),row.item_id);
 return {ready:true,cards:credit.length};
}

/** Runs one product refresh and turns a Plaid error into the Item's status; ITEM_NOT_FOUND forgets the Item. */
async function guarded(ctx,row,fn){
 try{const r=await fn(ctx,row);if(row.status!==STATUS.ok&&row.status!==STATUS.pendingDisconnect){await setStatus(ctx.env,row.item_id,STATUS.ok);row.status=STATUS.ok;}return {ok:true,...r};}
 catch(e){
  if(e instanceof PlaidError&&e.code==='ITEM_NOT_FOUND'){await purgeItem(ctx.env,row.item_id);return {ok:false,error:'ITEM_NOT_FOUND',purged:true};}
  const s=statusFor(e);
  if(s){await setStatus(ctx.env,row.item_id,s,e.code);row.status=s;}
  if(e instanceof PlaidError)return {ok:false,error:e.code||'PLAID_ERROR'};
  throw e;
 }
}
/** Sync, then liabilities, one after the other (never fanned out per Item). */
export async function refreshItem(ctx,row){
 const transactions=await guarded(ctx,row,syncTransactions);
 if(transactions.purged)return {transactions};
 const liabilities=await guarded(ctx,row,refreshLiabilities);
 return {transactions,liabilities};
}

// --- Link sessions: a random one-time handle (only its SHA-256 stored) that names the user and the link_token.
const sha256=async text=>b64u(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))));
const HANDLE=/^pls_[A-Za-z0-9_-]{43}$/;
async function linkSession(env,handle,now){
 if(typeof handle!=='string'||!HANDLE.test(handle))fail('link_expired');
 const id=await sha256(handle);
 const row=await one(env.DB,'SELECT id, user_id, item_id, link_token, expires_at FROM plaid_link_sessions WHERE id = ?',id);
 if(!row)fail('link_expired');
 if(row.expires_at<=now){await run(env.DB,'DELETE FROM plaid_link_sessions WHERE id = ?',id);fail('link_expired');}
 return row;
}
/** The page URL is the Worker's own; PLAID_REDIRECT_URI, when set, must be that same URL (registered in the Dashboard). */
export const linkPageUrl=url=>new URL('/v2/plaid/link',url).href;
function webhookUrl(env,url){
 if(typeof env.PLAID_WEBHOOK_URL==='string'&&/^https:\/\//.test(env.PLAID_WEBHOOK_URL))return env.PLAID_WEBHOOK_URL;
 const u=new URL('/v2/plaid/webhook',url);
 return u.protocol==='https:'?u.href:null;
}
function redirectUri(env){
 const v=env.PLAID_REDIRECT_URI;
 if(typeof v!=='string'||!v)return null;
 try{const u=new URL(v);if((u.protocol==='https:'||(env.LOCAL_DEV==='1'&&u.hostname==='localhost'))&&!u.search&&!u.hash)return u.href;}catch{}
 return null;
}

// --- Handlers. Each gets {env, body, token, now (ms), audit, fetch, url, waitUntil}.
const ctxOf=a=>({env:a.env,fetch:a.fetch,audit:a.audit,now:a.now,sleep:a.sleep});
const nowOf=a=>typeof a.now==='function'?a.now():a.now;
const withClock=a=>({...a,now:typeof a.now==='function'?a.now:()=>a.now});

/** POST /v2/plaid/link {} or {itemId} (update mode for a broken login): a link session and the Link page URL. */
export async function startLink(args){
 const a=withClock(args),now=sec(a.now()),{userId}=await session(a.env,a.token,now,a.audit);
 const b=a.body??{};
 if(!plain(b)||Object.keys(b).some(k=>k!=='itemId'))fail('bad_request');
 const req={client_name:'Cardybara',language:'en',country_codes:['US'],user:{client_user_id:userId}};
 const redirect=redirectUri(a.env),hook=webhookUrl(a.env,a.url);
 if(redirect)req.redirect_uri=redirect;
 if(hook)req.webhook=hook;
 let itemId=null;
 if(b.itemId!==undefined){
  // Update mode: the existing access token and no products; Link repairs the login, no new Item, no exchange.
  const row=await ownItem(a.env,userId,b.itemId);itemId=row.item_id;
  req.access_token=await openToken(a.env,row.item_id,row.access_token_enc);
 }else{
  // Transactions is fetched at Link; Liabilities is consented now and billed on first use (credit cards only).
  Object.assign(req,{products:['transactions'],additional_consented_products:['liabilities'],transactions:{days_requested:DAYS_REQUESTED},
   account_filters:{credit:{account_subtypes:['credit card']}}});
 }
 let r;
 try{r=await plaidCall(ctxOf(a),'/link/token/create',req);}
 catch(e){plaidFail(e);}
 const handle='pls_'+b64u(randomBytes(32));
 await run(a.env.DB,'INSERT INTO plaid_link_sessions (id, user_id, item_id, link_token, expires_at) VALUES (?, ?, ?, ?, ?)',await sha256(handle),userId,itemId,r.link_token,now+LINK_SESSION_TTL_SECONDS);
 // The hosted wallet (a web origin the gateway already admitted) gets sent back to itself when Link is done; the page
 // accepts only an origin on its own list (ALLOWED_ORIGINS), so a hand-made URL cannot redirect anywhere else.
 const origin=a.request?.headers?.get('Origin')||'';
 const back=/^https?:\/\//.test(origin)?'&r='+encodeURIComponent(origin):'';
 return {status:200,body:{url:linkPageUrl(a.url)+'#s='+handle+back,expiresAt:now+LINK_SESSION_TTL_SECONDS,mode:itemId?'update':'new'}};
}

/** POST /v2/plaid/link/token {handle} (the Link page, same origin): the session's link_token, the same one every time. */
export async function linkToken(args){
 const a=withClock(args),b=a.body;
 if(!plain(b)||Object.keys(b).length!==1)fail('bad_request');
 const s=await linkSession(a.env,b.handle,sec(a.now()));
 return {status:200,body:{linkToken:s.link_token,mode:s.item_id?'update':'new'}};
}

function cleanMetadata(m){
 if(!plain(m))return {institutionId:null,accounts:[],linkSessionId:null};
 return {
  institutionId:str(m.institution?.institution_id,100),
  accounts:Array.isArray(m.accounts)?m.accounts.filter(plain).slice(0,50).map(x=>({mask:str(x.mask,8),subtype:str(x.subtype,40)})):[],
  linkSessionId:str(m.link_session_id,100),
 };
}
const accountKey=x=>(x.mask||'')+'|'+(x.subtype||'');

/**
 * POST /v2/plaid/link/complete {handle, publicToken, metadata} (the Link page). A new Item: checks for a duplicate at the
 * same institution first, then exchanges, stores the Item and runs the first sync and liabilities fetch. Update mode:
 * no exchange (there is no new public_token), the Item's login is marked repaired.
 */
export async function completeLink(args){
 const a=withClock(args),b=a.body,now=sec(a.now());
 if(!plain(b)||!Object.keys(b).every(k=>['handle','publicToken','metadata'].includes(k)))fail('bad_request');
 const s=await linkSession(a.env,b.handle,now);
 const meta=cleanMetadata(b.metadata);
 if(a.audit){a.audit.userId=s.user_id;if(meta.linkSessionId)a.audit.linkSessionId=meta.linkSessionId;}
 const done=()=>run(a.env.DB,'DELETE FROM plaid_link_sessions WHERE id = ?',s.id);
 if(s.item_id){
  const row=await itemRow(a.env,s.item_id);
  await done();
  if(!row)fail('item_not_found');
  await setStatus(a.env,row.item_id,STATUS.ok);row.status=STATUS.ok;
  const result=await refreshItem(ctxOf(a),row);
  return {status:200,body:{status:'repaired',itemId:row.item_id,sync:summary(result)}};
 }
 if(typeof b.publicToken!=='string'||!/^public-[A-Za-z0-9-]{1,200}$/.test(b.publicToken))fail('bad_request');
 // Plaid never dedupes: the same login at the same institution would be a second, separately billed Item.
 if(meta.institutionId){
  const mine=(await itemsOf(a.env,s.user_id)).filter(r=>r.institution_id===meta.institutionId);
  const wanted=new Set(meta.accounts.map(accountKey));
  const dup=mine.find(r=>{try{return JSON.parse(r.account_keys).some(k=>wanted.has(k));}catch{return false;}});
  if(dup){await done();return {status:200,body:{status:'duplicate',itemId:dup.item_id}};}
 }
 let ex;
 try{ex=await plaidCall(ctxOf(a),'/item/public_token/exchange',{public_token:b.publicToken});}
 catch(e){plaidFail(e);}
 const itemId=str(ex.item_id),accessToken=str(ex.access_token,500);
 if(!itemId||!accessToken)fail('plaid_error');
 // Institution display data from Plaid, not from Link's metadata strings.
 let institutionName=null;
 if(meta.institutionId){
  try{const r=await plaidCall(ctxOf(a),'/institutions/get_by_id',{institution_id:meta.institutionId,country_codes:['US']});institutionName=str(r.institution?.name);}catch{}
 }
 // Persist the exchange before anything else; re-exchanging the same public_token returns this same Item.
 await run(a.env.DB,'INSERT OR IGNORE INTO plaid_items (item_id, user_id, access_token_enc, institution_id, institution_name, account_keys, cursor, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  itemId,s.user_id,await sealToken(a.env,itemId,accessToken),meta.institutionId,institutionName,JSON.stringify(meta.accounts.map(accountKey)),'',STATUS.ok,now);
 await done();
 const row=await itemRow(a.env,itemId);
 if(row.user_id!==s.user_id)fail('item_not_found');
 // The first /transactions/sync starts SYNC_UPDATES_AVAILABLE webhooks; an empty first page is normal.
 const result=await refreshItem(ctxOf(a),row);
 return {status:200,body:{status:'linked',itemId,sync:summary(result)}};
}
const summary=r=>({transactions:r.transactions?.ok?'ok':r.transactions?.error||null,liabilities:r.liabilities?.ok?(r.liabilities.ready?'ok':r.liabilities.reason):r.liabilities?.error||null});

/** POST /v2/plaid/link/exit {handle, error, linkSessionId, status} (the Link page): recorded on the log line only. */
export async function exitLink(args){
 const a=withClock(args),b=a.body;
 if(!plain(b))fail('bad_request');
 await linkSession(a.env,b.handle,sec(a.now()));
 if(a.audit){
  const ls=str(b.linkSessionId,100),code=str(b.error?.error_code,100),st=str(b.status,60);
  if(ls)a.audit.linkSessionId=ls;
  if(code)a.audit.linkError=code;
  if(st)a.audit.linkStatus=st;
 }
 return {status:200,body:{status:'recorded'}};
}

/** GET /v2/plaid/cards: the user's Items and their credit cards, with the billing-cycle fields. No token ever. */
export async function listCards(args){
 const a=withClock(args),{userId}=await session(a.env,a.token,sec(a.now()),a.audit);
 return {status:200,body:await cardsOf(a.env,userId)};
}
export async function cardsOf(env,userId){
 const rows=await itemsOf(env,userId);
 const items=[],cards=[];
 for(const r of rows.sort((x,y)=>x.created_at-y.created_at)){
  items.push({itemId:r.item_id,institutionId:r.institution_id,institution:r.institution_name,status:r.status,errorCode:r.error_code,
   initialComplete:!!r.initial_complete,historicalComplete:!!r.historical_complete,syncedAt:r.synced_at,liabilitiesAt:r.liabilities_at});
  let accounts=[],credit=[];
  try{accounts=JSON.parse(r.accounts||'[]');credit=JSON.parse(r.liabilities||'[]');}catch{}
  for(const acc of accounts){
   if(acc.type!=='credit')continue;
   const c=credit.find(x=>x.accountId===acc.accountId)||null;
   cards.push({itemId:r.item_id,accountId:acc.accountId,persistentAccountId:acc.persistentAccountId,institutionId:r.institution_id,institution:r.institution_name,
    name:acc.name,officialName:acc.officialName,mask:acc.mask,subtype:acc.subtype,currency:acc.balances.currency,
    balance:acc.balances.current,available:acc.balances.available,limit:acc.balances.limit,
    statementBalance:c?.lastStatementBalance??null,statementDate:c?.lastStatementIssueDate??null,minimumPayment:c?.minimumPaymentAmount??null,
    dueDate:c?.nextPaymentDueDate??null,isOverdue:c?.isOverdue??null,lastPaymentAmount:c?.lastPaymentAmount??null,lastPaymentDate:c?.lastPaymentDate??null,
    aprs:c?.aprs??[],readAt:r.liabilities_at});
  }
 }
 return {items,cards};
}

/** GET /v2/plaid/transactions: the newest TRANSACTIONS_RETURNED_MAX synced transactions of the user's cards. */
export async function listTransactions(args){
 const a=withClock(args),{userId}=await session(a.env,a.token,sec(a.now()),a.audit);
 const rows=(await a.env.DB.prepare('SELECT transaction_id, item_id, account_id, date, data FROM plaid_transactions WHERE user_id = ?').bind(userId).all()).results;
 const out=rows.sort((x,y)=>x.date<y.date?1:x.date>y.date?-1:0).slice(0,TRANSACTIONS_RETURNED_MAX).map(r=>{let d={};try{d=JSON.parse(r.data);}catch{}return {id:r.transaction_id,itemId:r.item_id,accountId:r.account_id,...d};});
 if(a.audit)a.audit.size=out.length;
 return {status:200,body:{transactions:out,truncated:rows.length>out.length}};
}

/** POST /v2/plaid/refresh {} or {itemId}: the user's "sync now"; at most once a minute per Item. */
export async function refresh(args){
 const a=withClock(args),now=sec(a.now()),{userId}=await session(a.env,a.token,now,a.audit);
 const b=a.body??{};
 if(!plain(b)||Object.keys(b).some(k=>k!=='itemId'))fail('bad_request');
 const rows=b.itemId!==undefined?[await ownItem(a.env,userId,b.itemId)]:await itemsOf(a.env,userId);
 const results={};
 for(const row of rows){
  if(row.refreshed_at&&now-row.refreshed_at<REFRESH_COOLDOWN_SECONDS){results[row.item_id]={skipped:'cooldown'};continue;}
  await run(a.env.DB,'UPDATE plaid_items SET refreshed_at = ? WHERE item_id = ?',now,row.item_id);
  // Institution display data can change (rebrands, mergers): refreshed with the user's sync.
  if(row.institution_id){try{const r=await plaidCall(ctxOf(a),'/institutions/get_by_id',{institution_id:row.institution_id,country_codes:['US']});const n=str(r.institution?.name);if(n)await run(a.env.DB,'UPDATE plaid_items SET institution_name = ? WHERE item_id = ?',n,row.item_id);}catch{}}
  results[row.item_id]=summary(await refreshItem(ctxOf(a),row));
 }
 return {status:200,body:{results,...await cardsOf(a.env,userId)}};
}

/** Removes one Item at Plaid (/item/remove, so it stops being billed) and every row of it here. */
export async function removeItemEverywhere(ctx,row){
 try{await plaidCall(ctx,'/item/remove',{access_token:await openToken(ctx.env,row.item_id,row.access_token_enc)});}
 catch(e){if(!(e instanceof PlaidError&&e.code==='ITEM_NOT_FOUND'))throw e;}
 await purgeItem(ctx.env,row.item_id);
}
/** DELETE /v2/plaid/item {itemId}: disconnect one card login. */
export async function removeItem(args){
 const a=withClock(args),{userId}=await session(a.env,a.token,sec(a.now()),a.audit);
 const b=a.body;
 if(!plain(b)||Object.keys(b).length!==1)fail('bad_request');
 const row=await ownItem(a.env,userId,b.itemId);
 try{await removeItemEverywhere(ctxOf(a),row);}
 catch(e){plaidFail(e);}
 return {status:200,body:{status:'removed'}};
}
/**
 * Account deletion: /item/remove for every Item first. An Item Plaid would not remove is still deleted here (the user's
 * deletion wins) and named on the log line by its request_id, so the owner can remove it from the Dashboard.
 */
export async function removeAllItems(ctx,userId){
 if(!plaidEnv(ctx.env)||!ctx.fetch)return {removed:0,failed:0};
 let removed=0,failed=0;
 for(const row of await itemsOf(ctx.env,userId)){
  try{await removeItemEverywhere(ctx,row);removed++;}catch{failed++;}
 }
 return {removed,failed};
}

// --- Webhooks: Plaid-Verification JWT (ES256 only, key by kid from /webhook_verification_key/get, cached until it
// expires), at most 5 minutes old, and the SHA-256 of the raw body must match request_body_sha256.
const keyCache=new Map();
export const clearWebhookKeys=()=>keyCache.clear();
async function verificationKey(ctx,kid,nowSec){
 const cached=keyCache.get(kid);
 if(cached&&(cached.expiredAt==null||cached.expiredAt>nowSec))return cached.key;
 const r=await plaidCall(ctx,'/webhook_verification_key/get',{key_id:kid},{attempts:2});
 const jwk=r.key;
 if(!plain(jwk)||jwk.alg!=='ES256'||jwk.kty!=='EC'||jwk.crv!=='P-256')throw Error('bad key');
 const expiredAt=Number.isFinite(jwk.expired_at)?jwk.expired_at:null;
 if(expiredAt!=null&&expiredAt<=nowSec)throw Error('expired key');
 const key=await importJWK({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y},'ES256');
 keyCache.set(kid,{key,expiredAt});
 return key;
}
const hexOf=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
function sameText(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
export async function verifyWebhook(ctx,jwt,raw){
 if(typeof jwt!=='string'||jwt.length>4096)return false;
 const nowMs=ctx.now();
 try{
  const header=decodeProtectedHeader(jwt);
  if(header.alg!=='ES256'||typeof header.kid!=='string')return false;
  const key=await verificationKey(ctx,header.kid,sec(nowMs));
  const {payload}=await jwtVerify(jwt,key,{algorithms:['ES256'],maxTokenAge:WEBHOOK_MAX_AGE_SECONDS,currentDate:new Date(nowMs),clockTolerance:5});
  const digest=hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)));
  return sameText(digest,String(payload.request_body_sha256||'').toLowerCase());
 }catch{return false;}
}

/** What one verified webhook does. Webhooks are triggers: data is always fetched from the API, never read from the body. */
export async function applyWebhook(ctx,event){
 const row=typeof event.item_id==='string'?await itemRow(ctx.env,event.item_id):null;
 if(!row)return 'unknown_item';
 const type=event.webhook_type,code=event.webhook_code;
 if(type==='TRANSACTIONS'&&code==='SYNC_UPDATES_AVAILABLE'){await guarded(ctx,row,syncTransactions);return 'synced';}
 if(type==='LIABILITIES'&&code==='DEFAULT_UPDATE'){await guarded(ctx,row,refreshLiabilities);return 'liabilities';}
 if(type==='ITEM'){
  if(code==='ERROR'){const c=str(event.error?.error_code,100);if(c==='ITEM_NOT_FOUND'){await purgeItem(ctx.env,row.item_id);return 'purged';}await setStatus(ctx.env,row.item_id,c==='ITEM_LOGIN_REQUIRED'?STATUS.loginRequired:STATUS.error,c);return 'status';}
  if(code==='PENDING_DISCONNECT'||code==='PENDING_EXPIRATION'){await setStatus(ctx.env,row.item_id,STATUS.pendingDisconnect);return 'status';}
  if(code==='LOGIN_REPAIRED'){await setStatus(ctx.env,row.item_id,STATUS.ok);return 'status';}
  if(code==='USER_PERMISSION_REVOKED'||code==='USER_ACCOUNT_REVOKED'){await setStatus(ctx.env,row.item_id,STATUS.revoked,code);return 'status';}
  return 'ignored';
 }
 return 'ignored';
}

/**
 * POST /v2/plaid/webhook (Plaid's servers; no Origin, no session). 200 once verified: the work runs after the answer
 * (waitUntil) so Plaid gets it inside 10 seconds. 401 for a bad signature (not retried by Plaid), 503 when not set up.
 */
export async function webhook(args){
 const a=withClock(args);
 if(!plaidConfigured(a.env))fail('plaid_unavailable');
 const raw=await readRaw(a.request,WEBHOOK_MAX_BYTES);
 const ctx=ctxOf(a);
 const jwt=a.request.headers.get('plaid-verification');
 if(!(await verifyWebhook(ctx,jwt,raw)))fail('webhook_invalid');
 let event;try{event=JSON.parse(new TextDecoder().decode(raw));}catch{fail('bad_request');}
 if(!plain(event))fail('bad_request');
 if(a.audit){a.audit.webhook=`${str(event.webhook_type,40)}:${str(event.webhook_code,60)}`;}
 const work=applyWebhook(ctx,event).then(r=>{if(a.audit)a.audit.outcome=r;},()=>{if(a.audit)a.audit.outcome='failed';});
 // The gateway's deferLog keeps the request alive (waitUntil) until the work is done and logs its outcome then.
 if(a.deferLog)a.deferLog(work);else await work;
 return {status:200,body:{status:'received'}};
}
async function readRaw(request,limit){
 const length=Number(request.headers.get('Content-Length')||0);
 if(length>limit)fail('too_large');
 const buf=new Uint8Array(await request.arrayBuffer());
 if(buf.byteLength>limit)fail('too_large');
 return buf;
}
