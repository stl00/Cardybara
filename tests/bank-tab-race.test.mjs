// A bank page that finishes loading before the extension's own reload must not end the run (#123).
// Synthetic tabs only: the fake replays the event order Chrome produced with an instant synthetic bank.
import test from 'node:test';
import './helpers/provider-fake.mjs';
import assert from 'node:assert/strict';
import {STATE_KEY} from '../extension-next/engine.js';

test('a new bank tab whose first load beats the reload still reads',async()=>{
 const url='https://secure.chase.com/web/auth/dashboard',own='chrome-extension://race-fixture/index.html',store={},listeners={},calls=[];
 let receive,doc=0,replacing=false;
 const listener=name=>({addListener:f=>listeners[name]=f}),fire=(status,tabId=2)=>listeners.updated?.(tabId,{status},{id:tabId,url});
 // A navigation commits a new document; until then the old one is being torn down and refuses scripts.
 const navigate=()=>{replacing=true;setTimeout(()=>{doc++;replacing=false;fire('loading');fire('complete');},30);};
 const gone=o=>replacing||(o.target.documentIds&&!o.target.documentIds.includes('doc'+doc));
 globalThis.chrome={runtime:{id:'race-fixture',getURL:p=>'chrome-extension://race-fixture/'+p,onMessage:{addListener:f=>receive=f},sendMessage:async()=>{}},permissions:{contains:async()=>true},storage:{local:{get:async k=>({[k]:store[k]}),set:async s=>Object.assign(store,structuredClone(s)),remove:async k=>{delete store[k]},setAccessLevel:async()=>{}}},alarms:{onAlarm:listener('alarm'),create:async()=>{}},
  tabs:{onUpdated:listener('updated'),onRemoved:listener('removed'),query:async()=>[],get:async id=>({id,url:id===1?own:url,status:id===2&&replacing?'loading':'complete'}),
   create:async()=>{calls.push('create');navigate();return {id:2,url,status:'loading'};},
   update:async id=>({id,url}),
   // The first load's events were already queued and arrive now, with the old document about to go.
   reload:async()=>{calls.push('reload');fire('loading');fire('complete');navigate();},sendMessage:async()=>{}},
  scripting:{executeScript:async o=>{
   if(gone(o))throw Error('Frame with ID 0 was removed.');
   if(o.files)return [{documentId:'doc'+doc}];
   if(o.func?.name==='discoverVisibleCards')return [{documentId:'doc'+doc,result:{status:'no_data',cards:[]}}];
   if(o.args?.length===3)return [{documentId:'doc'+doc,result:{status:'needs_login',patches:[]}}];
   return [{documentId:'doc'+doc,result:null}];
  }}};
 chrome.storage.session=chrome.storage.local;
 await import('../extension-next/background.js?bank-tab-race');
 const reply=await new Promise(resolve=>receive({type:'refresh',requestId:'race',ownerTabId:1,banks:['Chase'],cards:[{id:'c',bank:'Chase',tail:'3141',currency:'USD'}]},{id:'race-fixture',url:own},resolve));assert.equal(reply.ok,true);
 const deadline=Date.now()+5000;while(Date.now()<deadline&&store[STATE_KEY]?.run?.status==='running')await new Promise(r=>setTimeout(r,20));
 const job=store[STATE_KEY].run.jobs[0];
 assert.equal(job.status,'needs_login',JSON.stringify({status:job.status,diagnostic:job.diagnostic,calls}));
 assert.deepEqual(calls,['create'],'a tab the run opened is not reloaded');
});
