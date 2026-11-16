// In-memory stand-ins for the Worker's KV namespace and Durable Object binding, so the unit tests and the
// packaged-extension E2E run the gateway's own code in Node. Never imported by the Worker itself.
import {handle,UsageLedger,inviteKey} from './gateway.js';

export function memoryKV({now=Date.now}={}){
 const data=new Map(),meta=new Map(),expires=new Map();
 const live=key=>{const e=expires.get(key);if(e!=null&&e<=now()/1000){data.delete(key);meta.delete(key);expires.delete(key);}return data.has(key);};
 const read=(key,options)=>{if(!live(key))return null;const v=data.get(key);return options?.type==='json'||options==='json'?JSON.parse(v):v;};
 return {data,meta,
  async get(key,options){return read(key,options);},
  async getWithMetadata(key,options){return {value:read(key,options),metadata:live(key)?meta.get(key)??null:null};},
  async put(key,value,options={}){
   data.set(key,String(value));meta.delete(key);expires.delete(key);
   if(options.metadata!==undefined)meta.set(key,structuredClone(options.metadata));
   if(Number.isInteger(options.expiration))expires.set(key,options.expiration);else if(Number.isInteger(options.expirationTtl))expires.set(key,Math.floor(now()/1000)+options.expirationTtl);
  },
  async delete(key){data.delete(key);meta.delete(key);expires.delete(key);},
  // A string prefix gives the key names (the tests' own helper); an options object gives KV's {keys,list_complete,cursor}.
  async list(arg=''){
   const prefix=typeof arg==='string'?arg:arg.prefix||'';
   const names=[...data.keys()].filter(k=>k.startsWith(prefix)&&live(k));
   if(typeof arg==='string')return names;
   return {keys:names.map(name=>({name,...(meta.has(name)?{metadata:structuredClone(meta.get(name))}:{})})),list_complete:true};
  }};
}
// Storage that yields between every call, the way real storage I/O does, so a ledger without its queue
// would interleave under parallel requests.
export function memoryStorage(){
 const data=new Map(),tick=()=>new Promise(r=>setTimeout(r,1));
 return {data,
  async get(key){await tick();return data.has(key)?structuredClone(data.get(key)):undefined;},
  async put(key,value){await tick();if(typeof key==='object')for(const [k,v] of Object.entries(key))data.set(k,structuredClone(v));else data.set(key,structuredClone(value));},
  async delete(key){await tick();if(Array.isArray(key))return key.filter(k=>data.delete(k)).length;return data.delete(key);},
  async list({prefix=''}={}){await tick();return new Map([...data.entries()].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));},
 };
}
export function memoryDurableObject(Class=UsageLedger){
 const instances=new Map();
 return {instances,idFromName:name=>name,get(id){if(!instances.has(id))instances.set(id,new Class({storage:memoryStorage()}));const obj=instances.get(id);return {fetch:(url,init)=>obj.fetch(new Request(url,init))};}};
}
export async function addInvite(kv,code,record){
 const key=await inviteKey(code);
 await kv.put(key,JSON.stringify({hash:key.slice('invite:'.length),status:'active',...record}));
 return key;
}
/** A gateway on in-memory bindings. vars override the defaults; fetch is the upstream provider. */
export function localGateway({vars={},fetch,log=()=>{},now,observe}={}){
 // A rate limiter that always allows; tests pass their own, or null to check the gateway refuses to run without one.
 const env={PROVIDER_KEY:'synthetic-provider-key-not-real',ALLOWED_MODELS:'deepseek-flash',RATE_LIMITER:{limit:async()=>({success:true})},...vars,INVITES:memoryKV({now:now||Date.now}),USAGE:memoryDurableObject()};
 return {env,handle:request=>handle(request,env,{fetch,log,now,observe}),addInvite:(code,record)=>addInvite(env.INVITES,code,record)};
}
