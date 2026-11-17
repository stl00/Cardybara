// The account screens' client for the gateway's `/v2/account` routes (stl00/Cardybara#415, epic #410): sign up with an
// emailed code, sign in, forgot and change password, sign out, delete account. Pure over an injected `fetchFn` and a
// Storage-like `storage`, so tests need no browser. The session (bearer token, expiry, email for display) lives in
// localStorage under ACCOUNT_SESSION_KEY, the key walletSync.js reads; nothing else about the account is kept here.
// Passwords and codes are only ever sent to the gateway, never stored or logged.
import {ACCOUNT_SESSION_KEY,setSyncOn,readSyncState} from './walletSync.js';

export const SYNC_CHANGE_EVENT='cardybara-sync-change';
export const SYNC_STATUS_EVENT='cardybara-sync-status';
export const PASSWORD_MIN=10;

/** Gateway error codes the screens know, each with its own message (src/i18n/account.json); anything else is 'error'. */
const KNOWN=new Set(['bad_request','weak_password','code_invalid','code_expired','invalid_credentials','email_unverified','account_locked','too_many_codes','mail_failed','account_unavailable','unauthorized','too_large']);

export const emailLooksValid=v=>typeof v==='string'&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const passwordLongEnough=v=>typeof v==='string'&&[...v].length>=PASSWORD_MIN;

/** `{email, expiresAt}` of the signed-in account on this device, or null when signed out or the session ran out. */
export function readAccount(storage,nowMs=Date.now()){
 try{
  const v=JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY));
  if(typeof v?.token!=='string'||!v.token)return null;
  if(Number.isFinite(v.expiresAt)&&v.expiresAt*1000<=nowMs)return null;
  return {email:typeof v.email==='string'?v.email:'',expiresAt:Number.isFinite(v.expiresAt)?v.expiresAt:null};
 }catch{return null}
}
const writeSession=(storage,{token,expiresAt},email)=>storage.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token,expiresAt,email}));
const tokenOf=storage=>{try{return JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY))?.token||null}catch{return null}};

/** Turns sync on or off for this device and tells the page, which starts or stops the sync loop. */
export function setSync(storage,on,win=globalThis.window){
 setSyncOn(storage,on);
 win?.dispatchEvent?.(new Event(SYNC_CHANGE_EVENT));
}
export const syncIsOn=storage=>readSyncState(storage).on;

/**
 * `gateway` is the origin; every call answers `{ok:true,...body}` or `{ok:false,code}` and never throws.
 * `code` is a gateway error code, 'offline' when the request did not get through, or 'error'.
 */
export function createAccountClient({gateway,storage=globalThis.localStorage,fetchFn=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),win=globalThis.window}){
 async function call(method,path,body,{auth=false}={}){
  const headers={};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(auth){const t=tokenOf(storage);if(!t)return {ok:false,code:'unauthorized'};headers.Authorization='Bearer '+t;}
  let r;
  try{r=await fetchFn(gateway+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});}
  catch{return {ok:false,code:'offline'};}
  let data=null;try{data=await r.json();}catch{/* an empty body */}
  if(r.ok)return {ok:true,...(data&&typeof data==='object'?data:{})};
  const code=data?.error?.code;
  return {ok:false,code:KNOWN.has(code)?code:r.status===429?'too_many_codes':r.status===503?'account_unavailable':'error',...(Number.isFinite(data?.error?.retryAfter)?{retryAfter:data.error.retryAfter}:{})};
 }
 const norm=e=>String(e).trim();
 /** A session came back: keep it and answer without the token. */
 const keep=(r,email)=>{if(r.ok&&typeof r.token==='string'){writeSession(storage,r,email);forgetSync();return {ok:true,email,expiresAt:r.expiresAt};}return r;};
 /** The account changed: its sync copy is not this device's any more. */
 const forgetSync=()=>setSync(storage,false,win);
 return {
  signUp:(email,password)=>call('POST','/v2/account/signup',{email:norm(email),password}),
  verify:async(email,code)=>keep(await call('POST','/v2/account/verify',{email:norm(email),code:norm(code)}),norm(email)),
  signIn:async(email,password)=>keep(await call('POST','/v2/account/session',{email:norm(email),password}),norm(email)),
  forgot:email=>call('POST','/v2/account/password/forgot',{email:norm(email)}),
  reset:async(email,code,password)=>keep(await call('POST','/v2/account/password/reset',{email:norm(email),code:norm(code),password}),norm(email)),
  changePassword:(currentPassword,newPassword)=>call('POST','/v2/account/password',{currentPassword,newPassword},{auth:true}),
  /** Signs out on the server when it can be reached; the session is dropped here either way. Local data is untouched. */
  async signOut(){
   const r=await call('DELETE','/v2/account/session',undefined,{auth:true});
   storage.removeItem(ACCOUNT_SESSION_KEY);forgetSync();
   return {ok:true,serverSignedOut:r.ok};
  },
  /** Deletes the server account and its wallet copy. Only after the server says so is the local session dropped; the local wallet is never touched. */
  async deleteAccount(password){
   const r=await call('DELETE','/v2/account',{password},{auth:true});
   if(r.ok||r.code==='unauthorized'){storage.removeItem(ACCOUNT_SESSION_KEY);forgetSync();}
   return r;
  },
 };
}
