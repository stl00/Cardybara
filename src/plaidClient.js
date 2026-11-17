// The wallet's client (extension and PWA) for the gateway's `/v2/plaid` routes (PLAID_PLAN.md): start a Link session (the gateway hosts
// the Link page; the extension only opens its URL in a tab), list the linked credit cards with their billing-cycle
// fields, list synced transactions, "sync now", disconnect. Pure over an injected `fetchFn` and a Storage-like `storage`.
// It sends the account's bearer session (walletSync.js's ACCOUNT_SESSION_KEY) and nothing Plaid-related is ever sent
// from here except an Item id: no Plaid key, no access token. The last card list is cached in PLAID_CACHE_KEY so the
// wallet shows it offline; only the fields below are kept.
import {ACCOUNT_SESSION_KEY} from './walletSync.js';

export const PLAID_CACHE_KEY='cardybara-plaid-cards-v1';
export const PLAID_CHANGE_EVENT='cardybara-plaid-change';
const KNOWN=new Set(['unauthorized','plaid_unavailable','plaid_limit','account_unavailable','plaid_error','item_not_found','link_expired','rate_limited']);
const tokenOf=storage=>{try{return JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY))?.token||null}catch{return null}};
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string'?v:null;
const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;

/** The card fields the wallet keeps (and nothing else from the answer). */
export function cleanCards(body){
 const items=(Array.isArray(body?.items)?body.items:[]).filter(plain).map(i=>({itemId:str(i.itemId),institution:str(i.institution),status:str(i.status),errorCode:str(i.errorCode),
  historicalComplete:i.historicalComplete===true,syncedAt:num(i.syncedAt),liabilitiesAt:num(i.liabilitiesAt)})).filter(i=>i.itemId);
 const cards=(Array.isArray(body?.cards)?body.cards:[]).filter(plain).map(c=>({itemId:str(c.itemId),accountId:str(c.accountId),institution:str(c.institution),
  name:str(c.name),officialName:str(c.officialName),mask:str(c.mask),currency:str(c.currency),balance:num(c.balance),available:num(c.available),limit:num(c.limit),
  statementBalance:num(c.statementBalance),statementDate:day(c.statementDate),minimumPayment:num(c.minimumPayment),dueDate:day(c.dueDate),
  isOverdue:typeof c.isOverdue==='boolean'?c.isOverdue:null,lastPaymentAmount:num(c.lastPaymentAmount),lastPaymentDate:day(c.lastPaymentDate),
  aprs:(Array.isArray(c.aprs)?c.aprs:[]).filter(plain).map(a=>({type:str(a.type),percentage:num(a.percentage)})).filter(a=>a.type&&a.percentage!=null),
  readAt:num(c.readAt)})).filter(c=>c.accountId&&c.itemId);
 return {items,cards};
}
export function readPlaidCache(storage){
 try{const v=JSON.parse(storage.getItem(PLAID_CACHE_KEY));return plain(v)?{...cleanCards(v),fetchedAt:num(v.fetchedAt)}:{items:[],cards:[],fetchedAt:null};}
 catch{return {items:[],cards:[],fetchedAt:null}}
}
function writeCache(storage,value,now,win){
 try{storage.setItem(PLAID_CACHE_KEY,JSON.stringify({...value,fetchedAt:now}));}catch{}
 try{win?.dispatchEvent?.(new Event(PLAID_CHANGE_EVENT));}catch{}
}
export function clearPlaidCache(storage,win=globalThis.window){try{storage.removeItem(PLAID_CACHE_KEY);}catch{}try{win?.dispatchEvent?.(new Event(PLAID_CHANGE_EVENT));}catch{}}

/** Every call answers `{ok:true,...}` or `{ok:false,code}` and never throws. `code` 'offline' when nothing got through. */
export function createPlaidClient({gateway,storage=globalThis.localStorage,fetchFn=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),win=globalThis.window}){
 async function call(method,path,body){
  const t=tokenOf(storage);if(!t)return {ok:false,code:'unauthorized'};
  const headers={Authorization:'Bearer '+t};if(body!==undefined)headers['Content-Type']='application/json';
  let r;
  try{r=await fetchFn(gateway+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});}
  catch{return {ok:false,code:'offline'};}
  let data=null;try{data=await r.json();}catch{}
  if(r.ok)return {ok:true,...(plain(data)?data:{})};
  const code=data?.error?.code;
  return {ok:false,code:KNOWN.has(code)?code:r.status===503?'plaid_unavailable':'error'};
 }
 const keep=r=>{if(r.ok){const v=cleanCards(r);writeCache(storage,v,now(),win);return {ok:true,...v};}return r;};
 return {
  /** A Link session; `url` is the gateway's Link page to open in a tab. `itemId` repairs a broken login (update mode). */
  async startLink(itemId){const r=await call('POST','/v2/plaid/link',itemId?{itemId}:{});return r.ok&&typeof r.url==='string'&&r.url.startsWith(gateway+'/v2/plaid/link#s=')?{ok:true,url:r.url,mode:r.mode}:r.ok?{ok:false,code:'error'}:r;},
  cards:async()=>keep(await call('GET','/v2/plaid/cards')),
  /** The user's explicit "sync now": the gateway pulls /transactions/sync and /liabilities/get, then answers the cards. */
  refresh:async itemId=>keep(await call('POST','/v2/plaid/refresh',itemId?{itemId}:{})),
  async transactions(){const r=await call('GET','/v2/plaid/transactions');return r.ok?{ok:true,transactions:Array.isArray(r.transactions)?r.transactions:[]}:r;},
  async remove(itemId){const r=await call('DELETE','/v2/plaid/item',{itemId});if(r.ok)await this.cards();return r;},
 };
}
