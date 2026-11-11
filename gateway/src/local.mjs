// In-memory stand-ins for the Worker's KV namespace and Durable Object binding, so the unit tests and the
// packaged-extension E2E run the gateway's own code in Node. Never imported by the Worker itself.
import {handle,UsageLedger,inviteKey} from './gateway.js';

export function memoryKV(){
 const data=new Map();
 return {data,async get(key,options){const v=data.get(key);if(v==null)return null;return options?.type==='json'||options==='json'?JSON.parse(v):v;},async put(key,value){data.set(key,String(value));},async delete(key){data.delete(key);},async list(prefix=''){return [...data.keys()].filter(k=>k.startsWith(prefix));}};
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
 const env={PROVIDER_KEY:'synthetic-provider-key-not-real',ALLOWED_MODELS:'deepseek-flash',RATE_LIMITER:{limit:async()=>({success:true})},...vars,INVITES:memoryKV(),USAGE:memoryDurableObject()};
 return {env,handle:request=>handle(request,env,{fetch,log,now,observe}),addInvite:(code,record)=>addInvite(env.INVITES,code,record)};
}
