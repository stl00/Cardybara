// Web Push reminders for the web wallet (stl00/Cardybara#381; gateway half in gateway/src/push.js, docs/GATEWAY.md).
// The page subscribes, and tells the gateway only WHEN to send an empty push, one fire time and a kind code each. The
// card names, dates and amounts stay in this browser: the service worker (web/push-worker.js) writes the text from the
// plan the page keeps in IndexedDB (pushMirror.js). No browser APIs are touched at import time.
export const PUSH_STATE_KEY='cardybara-web-push-v1';
export const MAX_TIMES=200,DEBOUNCE_MS=20000;
const DAY=86400,MARGIN=3600,MAX_AHEAD=400*DAY;
const B64URL=/^[A-Za-z0-9_-]+$/;

/** Fire time list for the gateway from the plan the extension would also use. Kind codes only; nothing else leaves. */
export function pushTimes(schedule,nowMs){
 const now=Math.floor(nowMs/1000),seen=new Set(),out=[];
 for(const e of schedule?.entries||[]){
  const at=Math.floor(e.fireAt/1000),kind=e.group==='credits'?'credit':String(e.id).startsWith('fee:')?'fee':'payment';
  if(!Number.isFinite(at)||at<now-DAY+MARGIN||at>now+MAX_AHEAD-MARGIN)continue;
  const key=at+':'+kind;
  if(seen.has(key))continue;
  seen.add(key);out.push({at,kind});
 }
 out.sort((a,b)=>a.at-b.at||(a.kind<b.kind?-1:1));
 return out.slice(0,MAX_TIMES);
}

const b64u=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export const keyBytes=text=>{const s=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0));};
/** A random 22 character base64url id (16 bytes), the shape the gateway accepts. */
export function newDeviceId(random=n=>crypto.getRandomValues(new Uint8Array(n))){return b64u(random(16));}

export function readState(storage){try{const v=JSON.parse(storage.getItem(PUSH_STATE_KEY));return v&&typeof v.device==='string'?{device:v.device,subscribed:v.subscribed===true,sent:typeof v.sent==='string'?v.sent:null}:null;}catch{return null}}
function writeState(storage,state){try{if(state)storage.setItem(PUSH_STATE_KEY,JSON.stringify(state));else storage.removeItem(PUSH_STATE_KEY);}catch{/* the next sync just sends again */}}

/**
 * 'ready' (show the button), 'install' (iOS outside the Home Screen: explain, no button) or 'unsupported' (show nothing).
 * iOS 16.4+ delivers Web Push only to a web app added to the Home Screen.
 */
export function pushSupport({nav=globalThis.navigator,win=globalThis.window,Notification=globalThis.Notification}={}){
 if(!nav)return 'unsupported';
 const ios=/iPad|iPhone|iPod/.test(nav.userAgent||'')||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1);
 const standalone=isStandalone({nav,win});
 if(ios&&!standalone)return 'install';
 return nav.serviceWorker&&win?.PushManager&&typeof Notification!=='undefined'?'ready':'unsupported';
}

/** True when the page runs as an installed web app (iOS Home Screen or any display-mode: standalone). */
export function isStandalone({nav=globalThis.navigator,win=globalThis.window}={}){
 return nav?.standalone===true||!!win?.matchMedia?.('(display-mode: standalone)')?.matches;
}

/**
 * Support is not fixed at mount: an iOS user adds the app to the Home Screen, or changes permission in Settings, and comes
 * back to this page. Calls `recheck` on visibilitychange (page shown again) and pageshow (back/forward cache). Returns the unsubscribe.
 */
export function watchSupport(recheck,{doc=globalThis.document,win=globalThis.window}={}){
 const onVisible=()=>{if(!doc||doc.visibilityState!=='hidden')recheck();};
 doc?.addEventListener?.('visibilitychange',onVisible);win?.addEventListener?.('pageshow',recheck);
 return()=>{doc?.removeEventListener?.('visibilitychange',onVisible);win?.removeEventListener?.('pageshow',recheck);};
}

/** One debounced runner: the last call within `ms` wins. */
export function debounce(fn,ms=DEBOUNCE_MS,timers={set:setTimeout,clear:clearTimeout}){
 let id=null;
 const wrapped=(...args)=>{if(id!=null)timers.clear(id);id=timers.set(()=>{id=null;fn(...args);},ms);};
 wrapped.cancel=()=>{if(id!=null)timers.clear(id);id=null;};
 return wrapped;
}

export function createWebPush({gateway,fetchFn=(...a)=>globalThis.fetch(...a),storage=globalThis.localStorage,nav=globalThis.navigator,win=globalThis.window,Notification=globalThis.Notification,random}={}){
 const url=path=>gateway+path;
 const send=async(method,path,body)=>{
  const r=await fetchFn(url(path),{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
  if(!r.ok)throw Error('push_'+r.status);
  return r;
 };
 const registration=()=>nav.serviceWorker.ready;
 return {
  support:()=>gateway?pushSupport({nav,win,Notification}):'unsupported',
  /** True once this browser has a subscription the gateway was told about (or will be on the next sync). */
  active:()=>readState(storage)?.subscribed===true,
  /** Must run from a click: asks permission (when not yet granted), subscribes with the gateway's key. Throws when refused. */
  async enable(){
   if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted')throw Error('push_denied');
   const reg=await registration(),{publicKey}=await (await send('GET','/v1/push/key')).json();
   if(typeof publicKey!=='string'||!B64URL.test(publicKey))throw Error('push_key');
   const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
   const before=readState(storage);
   writeState(storage,{device:before?.device||newDeviceId(random),subscribed:true,sent:null});
   return sub;
  },
  /** Sends the full list (PUT replaces the device's record). Skips the request when nothing changed since the last one. */
  async sync(times){
   const state=readState(storage);
   if(!state?.subscribed)return false;
   const sub=await (await registration()).pushManager.getSubscription();
   if(!sub)return false;
   const json=sub.toJSON(),body={device:state.device,subscription:{endpoint:json.endpoint,keys:{p256dh:json.keys?.p256dh,auth:json.keys?.auth}},times};
   const digest=JSON.stringify(body);
   if(digest===state.sent)return false;
   await send('PUT','/v1/push',body);
   writeState(storage,{...state,sent:digest});
   return true;
  },
  /** Removes the device from the gateway but keeps the subscription: used when no card is left. */
  async forget(){
   const state=readState(storage);
   if(!state?.subscribed||state.sent==null)return false;
   await send('DELETE','/v1/push',{device:state.device});
   writeState(storage,{...state,sent:null});
   return true;
  },
  /** Reminders off: unsubscribes this browser and tells the gateway to delete the device. */
  async disable(){
   const state=readState(storage);
   if(!state)return false;
   let failure=null;
   try{await send('DELETE','/v1/push',{device:state.device});}catch(e){failure=e;}
   try{await (await (await registration()).pushManager.getSubscription())?.unsubscribe();}catch{}
   writeState(storage,null);
   if(failure)throw failure;
   return true;
  },
 };
}
