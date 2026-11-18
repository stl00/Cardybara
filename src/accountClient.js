// The account screens' client for the gateway's `/v2/account` routes (stl00/Cardybara#415, epic #410): sign up with an
// emailed code, sign in, forgot and change password, sign out, delete account. Pure over an injected `fetchFn` and a
// Storage-like `storage`, so tests need no browser. The session (bearer token, expiry, email for display) lives in
// localStorage under ACCOUNT_SESSION_KEY, the key walletSync.js reads; nothing else about the account is kept here.
// Passwords and codes are only ever sent to the gateway, never stored or logged.
import {ACCOUNT_SESSION_KEY,setSyncOn,readSyncState} from './walletSync.js';
import {redirectWithSession} from './extensionSignIn.js';

export const SYNC_CHANGE_EVENT='cardybara-sync-change';
export const SYNC_STATUS_EVENT='cardybara-sync-status';
// Fired on this page whenever the stored session is written or dropped, so every account view (Settings, the header) agrees.
export const ACCOUNT_CHANGE_EVENT='cardybara-account-change';
const accountChanged=()=>{try{globalThis.window?.dispatchEvent?.(new Event(ACCOUNT_CHANGE_EVENT));}catch{}};
export const PASSWORD_MIN=10;

/** Gateway error codes the screens know, each with its own message (src/i18n/account.json); anything else is 'error'. */
const KNOWN=new Set(['bad_request','weak_password','code_invalid','code_expired','invalid_credentials','email_unverified','account_locked','too_many_codes','mail_failed','account_unavailable','unauthorized','too_large','passkey_invalid','challenge_expired','passkey_unavailable']);


// Passkeys (stl00/Cardybara#422): WebAuthn options and credentials cross the gateway as JSON with base64url binary fields.
const b64uToBuf=s=>{const b=atob(String(s).replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(s).length/4)*4,'='));return Uint8Array.from(b,c=>c.charCodeAt(0)).buffer;};
const bufToB64u=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
/** Gateway options (base64url strings) -> the shape navigator.credentials wants (ArrayBuffers). */
export function decodePublicKeyOptions(pk){
 const o={...pk,challenge:b64uToBuf(pk.challenge)};
 if(pk.user)o.user={...pk.user,id:b64uToBuf(pk.user.id)};
 for(const k of ['allowCredentials','excludeCredentials'])if(Array.isArray(pk[k]))o[k]=pk[k].map(c=>({...c,id:b64uToBuf(c.id)}));
 return o;
}
/** A PublicKeyCredential -> plain JSON for the gateway. */
export function encodeCredential(c){
 const r=c.response,out={id:c.id,rawId:bufToB64u(c.rawId),type:c.type,response:{clientDataJSON:bufToB64u(r.clientDataJSON)}};
 if(r.attestationObject)out.response.attestationObject=bufToB64u(r.attestationObject);
 if(r.authenticatorData)out.response.authenticatorData=bufToB64u(r.authenticatorData);
 if(r.signature)out.response.signature=bufToB64u(r.signature);
 if(r.userHandle)out.response.userHandle=bufToB64u(r.userHandle);
 if(typeof r.getTransports==='function')out.response.transports=r.getTransports();
 return out;
}
export const passkeySupported=(creds=globalThis.navigator?.credentials)=>typeof creds?.get==='function'&&typeof creds?.create==='function'&&typeof globalThis.PublicKeyCredential!=='undefined';

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
// `mirror(session|null)` lets a platform keep a second copy of the session where its background can read it (the
// extension's own storage area, src/platform/extension.js). It never throws into the screens.
const writeSession=(storage,{token,expiresAt},email,mirror)=>{storage.setItem(ACCOUNT_SESSION_KEY,JSON.stringify({token,expiresAt,email}));try{Promise.resolve(mirror?.({token,expiresAt,email})).catch(()=>{});}catch{}accountChanged();};
const dropSession=(storage,mirror)=>{storage.removeItem(ACCOUNT_SESSION_KEY);try{Promise.resolve(mirror?.(null)).catch(()=>{});}catch{}accountChanged();};
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
export function createAccountClient({gateway,storage=globalThis.localStorage,fetchFn=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),win=globalThis.window,mirror=null,credentials=globalThis.navigator?.credentials,webSignIn=null}){
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
 const keep=(r,email)=>{if(r.ok&&typeof r.token==='string'){writeSession(storage,r,email,mirror);forgetSync();return {ok:true,email,expiresAt:r.expiresAt};}return r;};
 /** The account changed: its sync copy is not this device's any more. */
 const forgetSync=()=>setSync(storage,false,win);
 return {
  // Passkeys. The gateway's /v2/account/passkey routes answer 404 until they ship; the screens then hide the passkey controls.
  /** True when the browser can do passkeys and the gateway has the routes. Never throws. */
  async passkeysAvailable(){if(!webSignIn&&!passkeySupported(credentials))return false;const r=await call('GET','/v2/account/passkey/status');return r.ok&&r.enabled===true;},
  async listPasskeys(){const r=await call('GET','/v2/account/passkey',undefined,{auth:true});return r.ok?{ok:true,passkeys:Array.isArray(r.passkeys)?r.passkeys:[]}:r;},
  async removePasskey(id){return call('DELETE','/v2/account/passkey/'+encodeURIComponent(id),undefined,{auth:true});},
  /** Signed in: asks the browser for a new passkey and registers it. A cancelled prompt answers `{ok:false,code:'cancelled'}`. */
  async addPasskey(name){
   const o=await call('POST','/v2/account/passkey/register/options',{},{auth:true});
   if(!o.ok)return o;
   let cred;
   try{cred=await credentials.create({publicKey:decodePublicKeyOptions(o.publicKey)});}catch{return {ok:false,code:'cancelled'};}
   if(!cred)return {ok:false,code:'cancelled'};
   return call('POST','/v2/account/passkey/register/verify',{challengeId:o.challengeId,credential:encodeCredential(cred),name:String(name||'').trim().slice(0,60)},{auth:true});
  },
  /** Signed out: sign in with a passkey. `conditional` uses the browser's autofill UI and can be aborted with `signal`. */
  async signInWithPasskey({conditional=false,signal}={}){
   // The extension cannot use a passkey itself (its rpId is the PWA's): `webSignIn()` runs the PWA flow and answers a session or null.
   if(webSignIn){
    let s;try{s=await webSignIn();}catch{return {ok:false,code:'cancelled'};}
    if(typeof s?.token!=='string'||!s.token)return {ok:false,code:'cancelled'};
    const email=typeof s.email==='string'?s.email:'';
    writeSession(storage,s,email,mirror);forgetSync();
    return {ok:true,email,expiresAt:s.expiresAt};
   }
   const o=await call('POST','/v2/account/passkey/login/options',{});
   if(!o.ok)return o;
   let cred;
   try{cred=await credentials.get({publicKey:decodePublicKeyOptions(o.publicKey),...(conditional?{mediation:'conditional'}:{}),signal});}catch{return {ok:false,code:'cancelled'};}
   if(!cred)return {ok:false,code:'cancelled'};
   const r=await call('POST','/v2/account/passkey/login/verify',{challengeId:o.challengeId,credential:encodeCredential(cred)});
   return keep(r,typeof r.email==='string'?r.email:'');
  },
  /**
   * The PWA's half of the extension sign-in: a passkey sign-in here, then the URL to send the browser to
   * (https://<extension-id>.chromiumapp.org/ with the session in the fragment). `{ok:false,code}` for a bad id or a failed sign-in.
   */
  async passkeyHandoff(extensionId){
   if(!redirectWithSession(extensionId,{token:'x'}))return {ok:false,code:'bad_request'};
   const r=await this.signInWithPasskey();
   if(!r.ok)return r;
   let s=null;try{s=JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY));}catch{/* unreadable */}
   const url=redirectWithSession(extensionId,s);
   return url?{ok:true,url}:{ok:false,code:'error'};
  },
  signUp:(email,password)=>call('POST','/v2/account/signup',{email:norm(email),password}),
  verify:async(email,code)=>keep(await call('POST','/v2/account/verify',{email:norm(email),code:norm(code)}),norm(email)),
  signIn:async(email,password)=>keep(await call('POST','/v2/account/session',{email:norm(email),password}),norm(email)),
  forgot:email=>call('POST','/v2/account/password/forgot',{email:norm(email)}),
  reset:async(email,code,password)=>keep(await call('POST','/v2/account/password/reset',{email:norm(email),code:norm(code),password}),norm(email)),
  changePassword:(currentPassword,newPassword)=>call('POST','/v2/account/password',{currentPassword,newPassword},{auth:true}),
  /** Signs out on the server when it can be reached; the session is dropped here either way. Local data is untouched. */
  async signOut(){
   const r=await call('DELETE','/v2/account/session',undefined,{auth:true});
   dropSession(storage,mirror);forgetSync();
   return {ok:true,serverSignedOut:r.ok};
  },
  /** Deletes the server account and its wallet copy. Only after the server says so is the local session dropped; the local wallet is never touched. */
  async deleteAccount(password){
   const r=await call('DELETE','/v2/account',{password},{auth:true});
   if(r.ok||r.code==='unauthorized'){dropSession(storage,mirror);forgetSync();}
   return r;
  },
 };
}
