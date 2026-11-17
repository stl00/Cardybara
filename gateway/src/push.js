// Web Push reminders (stl00/Cardybara#380). The gateway keeps, per device, only: a random device id, the push
// subscription (endpoint and keys) and a list of fire times (UTC, whole seconds) each with a reminder kind code.
// Never a card name, bank, tail, amount or date text. Pushes carry no payload: the service worker wakes up and
// writes the notification from the wallet in its own IndexedDB. The Worker's Cron Trigger sends what is due.
//
// Storage: one KV key `push:<device>` in the INVITES namespace (no new resource for the owner to create), with
// the earliest fire time in the key's metadata so the cron lists keys once and reads only the devices that are
// due. Every PUT refreshes a 60-day expiry; a device the wallet stops updating disappears by itself.
//
// This module imports nothing from gateway.js (no cycle): gateway.js wraps these functions as routes.

export const PUSH_PREFIX='push:';
export const KINDS=['payment','fee','credit'];
export const MAX_TIMES=200;
export const MAX_AHEAD_SECONDS=400*86400;
// A time a little in the past is accepted (a reminder set for "now" fires on the next run); older is refused.
export const MAX_PAST_SECONDS=86400;
// A due time that could not be delivered for this long is dropped rather than retried forever.
export const GIVE_UP_SECONDS=2*86400;
export const EXPIRY_SECONDS=60*86400;
export const CRON='*/15 * * * *';
// Devices handled per run: each costs a KV read, a push request and a KV write, and a Worker invocation may make
// at most 1000 subrequests. The rest are due again 15 minutes later.
export const MAX_DEVICES_PER_RUN=200;
const PUSH_TTL_SECONDS=86400;
const JWT_LIFETIME_SECONDS=12*3600;

// The Worker posts to the subscription's endpoint, so it may only be a browser vendor's push service, never an
// address the client picked (server-side request forgery).
export const PUSH_HOSTS=[
 'fcm.googleapis.com',// Chrome, Edge on Android, Opera, Brave
 'updates.push.services.mozilla.com',// Firefox
 '.push.services.mozilla.com',
 '.notify.windows.com',// Edge on Windows
 'web.push.apple.com',// Safari
 '.push.apple.com',
];
const hostAllowed=host=>PUSH_HOSTS.some(h=>h.startsWith('.')?host.endsWith(h)&&host.length>h.length:host===h);

const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(o,keys)=>plain(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const B64URL=/^[A-Za-z0-9_-]+$/;
export const DEVICE_PATTERN=/^[A-Za-z0-9_-]{22,43}$/;
const fail=()=>{throw Error('bad_request');};

export function validEndpoint(value){
 if(typeof value!=='string'||value.length>1024)return false;
 let url;try{url=new URL(value);}catch{return false;}
 return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&hostAllowed(url.hostname);
}

/** {device, subscription:{endpoint,keys:{p256dh,auth}}, times:[{at,kind}]} checked key by key. Throws bad_request. */
export function parsePut(body,nowMs){
 if(!exact(body,['device','subscription','times']))fail();
 if(typeof body.device!=='string'||!DEVICE_PATTERN.test(body.device))fail();
 const s=body.subscription;
 if(!exact(s,['endpoint','keys'])||!validEndpoint(s.endpoint)||!exact(s.keys,['p256dh','auth']))fail();
 const {p256dh,auth}=s.keys;
 // A P-256 public key is 65 bytes (87 base64url characters) and the auth secret 16 bytes (22 characters).
 if(typeof p256dh!=='string'||!B64URL.test(p256dh)||p256dh.length<80||p256dh.length>90)fail();
 if(typeof auth!=='string'||!B64URL.test(auth)||auth.length<22||auth.length>24)fail();
 if(!Array.isArray(body.times)||body.times.length>MAX_TIMES)fail();
 const now=Math.floor(nowMs/1000),seen=new Set(),times=[];
 for(const t of body.times){
  if(!exact(t,['at','kind'])||!Number.isInteger(t.at)||!KINDS.includes(t.kind))fail();
  if(t.at<now-MAX_PAST_SECONDS||t.at>now+MAX_AHEAD_SECONDS)fail();
  const key=t.at+':'+t.kind;
  if(seen.has(key))continue;
  seen.add(key);times.push({at:t.at,kind:t.kind});
 }
 times.sort((a,b)=>a.at-b.at||(a.kind<b.kind?-1:1));
 return {device:body.device,subscription:{endpoint:s.endpoint,keys:{p256dh,auth}},times};
}
export function parseDelete(body){
 if(!exact(body,['device'])||typeof body.device!=='string'||!DEVICE_PATTERN.test(body.device))fail();
 return body.device;
}

/** Full replacement of the device's record. The only fields stored are the ones below. */
// `expires` (epoch seconds) is given only when the cron rewrites a record: it must not extend the 60 days.
export async function storePush(kv,{device,subscription,times},nowMs,expires){
 const exp=expires??Math.floor(nowMs/1000)+EXPIRY_SECONDS;
 await kv.put(PUSH_PREFIX+device,JSON.stringify({subscription,times}),{expiration:exp,metadata:{next:times.length?times[0].at:null,exp}});
}
export async function forgetPush(kv,device){await kv.delete(PUSH_PREFIX+device);}

// --- VAPID (RFC 8292). The private key is a PKCS#8 P-256 key and the public key the raw 65-byte point, both
// base64url, in the Worker secrets VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY (scripts/gateway-set-vapid.sh).
const b64u=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const unb64u=text=>{const s=atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4));return Uint8Array.from(s,c=>c.charCodeAt(0));};
const textB64u=obj=>b64u(new TextEncoder().encode(JSON.stringify(obj)));

export function pushConfigured(env){
 return !!(env.INVITES&&typeof env.VAPID_PRIVATE_KEY==='string'&&B64URL.test(env.VAPID_PRIVATE_KEY)&&typeof env.VAPID_PUBLIC_KEY==='string'&&B64URL.test(env.VAPID_PUBLIC_KEY));
}
const subjectOf=env=>typeof env.VAPID_SUBJECT==='string'&&/^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT)?env.VAPID_SUBJECT:'https://github.com/stl00/Cardybara';

/** The Authorization header for one push service origin. */
export async function vapidHeader(env,audience,nowMs){
 const key=await crypto.subtle.importKey('pkcs8',unb64u(env.VAPID_PRIVATE_KEY),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const input=textB64u({typ:'JWT',alg:'ES256'})+'.'+textB64u({aud:audience,exp:Math.floor(nowMs/1000)+JWT_LIFETIME_SECONDS,sub:subjectOf(env)});
 // WebCrypto's ECDSA signature is the raw r||s form that JWT ES256 uses.
 const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(input)));
 return `vapid t=${input}.${b64u(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * Sends the pushes that are due. Never throws and never logs an endpoint: the log line has counts only.
 * deps: {fetch, now, log}. Returns the counts.
 */
export async function sendDuePushes(env,{fetch=(...a)=>globalThis.fetch(...a),now=Date.now,log=l=>console.log(l)}={}){
 const counts={due:0,sent:0,gone:0,failed:0,expired:0};
 const say=o=>log(JSON.stringify({push:o}));
 if(!pushConfigured(env)){return {skipped:true};}
 try{
  const nowSec=Math.floor(now()/1000),due=[];let cursor;
  do{
   const page=await env.INVITES.list({prefix:PUSH_PREFIX,cursor});
   for(const k of page.keys)if(Number.isInteger(k.metadata?.next)&&k.metadata.next<=nowSec)due.push({name:k.name,next:k.metadata.next,exp:k.metadata.exp});
   cursor=page.list_complete?undefined:page.cursor;
  }while(cursor);
  due.sort((a,b)=>a.next-b.next);
  counts.due=due.length;
  const headers=new Map();
  for(const {name,exp} of due.slice(0,MAX_DEVICES_PER_RUN)){
   let record=null;try{record=await env.INVITES.get(name,{type:'json'});}catch{}
   if(!plain(record)||!validEndpoint(record.subscription?.endpoint)||!Array.isArray(record.times)){await env.INVITES.delete(name).catch(()=>{});counts.failed++;continue;}
   const firing=record.times.filter(t=>t.at<=nowSec);
   if(!firing.length)continue;
   const endpoint=record.subscription.endpoint,audience=new URL(endpoint).origin;
   let status=0;
   try{
    if(!headers.has(audience))headers.set(audience,await vapidHeader(env,audience,now()));
    const r=await fetch(endpoint,{method:'POST',headers:{Authorization:headers.get(audience),TTL:String(PUSH_TTL_SECONDS),Urgency:'normal','Content-Length':'0'},redirect:'manual'});
    status=r.status;await r.body?.cancel().catch(()=>{});
   }catch{status=0;}
   if(status===404||status===410){await env.INVITES.delete(name);counts.gone++;continue;}
   // Sent: the due times go. Not sent: they stay for the next run, unless they have waited too long.
   const ok=status>=200&&status<300;
   if(ok)counts.sent++;else counts.failed++;
   const dropped=ok?firing:firing.filter(t=>t.at<nowSec-GIVE_UP_SECONDS);
   if(!ok)counts.expired+=dropped.length;
   if(!dropped.length)continue;
   // Re-read, so a replacement the wallet sent meanwhile loses only the entries that were just dealt with.
   let fresh=null,meta=null;try{({value:fresh,metadata:meta}=await env.INVITES.getWithMetadata(name,{type:'json'}));}catch{}
   if(!plain(fresh)||!Array.isArray(fresh.times))continue;
   const gone=new Set(dropped.map(t=>t.at+':'+t.kind));
   const times=fresh.times.filter(t=>!gone.has(t.at+':'+t.kind));
   await storePush(env.INVITES,{device:name.slice(PUSH_PREFIX.length),subscription:fresh.subscription,times},now(),Number.isInteger(meta?.exp)?meta.exp:exp);
  }
 }catch(e){say({failed:String(e?.message||'error').slice(0,40)});return {failed:true,...counts};}
 say(counts);
 return counts;
}
