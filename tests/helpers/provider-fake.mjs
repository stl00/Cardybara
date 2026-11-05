// Older tests fake the local parse server. The extension now calls the provider itself, so this adapter
// presents their fakes as the provider: a saved test key, and chat completions carrying the same raw JSON.
import {KEY_STORE} from '../../extension-next/model-client.js';
export const TEST_KEY={provider:'deepseek',key:'test-key-not-real-0000',savedAt:'2026-11-05T00:00:00.000Z',enabled:true};
let fake=null,chromeFake=null;
// The getter captures the fake in place now, so a test that wraps the current fetch doesn't recurse.
Object.defineProperty(globalThis,'fetch',{configurable:true,get:()=>{const current=fake;return async(url,options)=>{
 const parse=String(url)==='https://api.deepseek.com/chat/completions';
 // The old fakes read the snapshot they were sent; the provider body carries it as the user message.
 const sent=parse?{...options,body:JSON.stringify({snapshot:JSON.parse(JSON.parse(options.body).messages.at(-1).content)})}:options;
 const response=await current(parse?'http://test.invalid/api/parser/parse':url,sent);
 if(!parse||!response.ok)return response;
 const body=await response.json();
 return {ok:true,status:200,json:async()=>body.raw?{choices:[{message:{content:JSON.stringify(body.raw)}}]}:body};
};},set:fn=>{fake=fn;}});
Object.defineProperty(globalThis,'chrome',{configurable:true,get:()=>chromeFake,set:value=>{
 if(!value?.storage?.local?.get){chromeFake=value;return;}
 const get=value.storage.local.get;
 chromeFake={...value,storage:{...value.storage,local:{...value.storage.local,get:async key=>key===KEY_STORE?{[KEY_STORE]:TEST_KEY}:get(key)}}};
}});
