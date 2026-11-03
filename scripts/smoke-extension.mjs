import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const ORIGIN=process.argv[3]||'http://127.0.0.1:8766';
let receive;let store={};
const listeners={};const listener=name=>({addListener:f=>listeners[name]=f});let failStore=false;let bankHref='https://secure.chase.com/web/auth/dashboard#/dashboard/overview';
globalThis.chrome={runtime:{id:'artifact-test',getURL:p=>`chrome-extension://artifact-test/${p}`,onMessage:{addListener:f=>receive=f}},storage:{local:{get:async key=>({[key]:store[key]}),set:async s=>{if(failStore)throw Error('quota');Object.assign(store,structuredClone(s));},remove:async key=>{delete store[key];},setAccessLevel:async()=>{}}},tabs:{onUpdated:listener('updated'),onRemoved:listener('removed'),query:async()=>[],create:async({url})=>({id:20,url}),update:async(id,options)=>{assert.ok([1,20].includes(id));assert.equal(options.active,true);if(options.url)bankHref=options.url;return {id,url:bankHref};},reload:async()=>{for(const status of (process.env.CARDY_SMOKE_LOAD_ONLY?['complete','loading']:['complete','loading','complete','complete']))listeners.updated(20,{status},{id:20,url:bankHref});},get:async id=>({id,url:id===1?ORIGIN+'/':bankHref,status:'complete'}),sendMessage:async()=>{}},scripting:{executeScript:async o=>o.files?[{documentId:'document-one'}]:o.func?.name==='amexClickReadLink'?[{result:false}]:o.func?.name==='renderedBankPage'?[{result:{href:bankHref,ready:true}}]:o.func?.name==='capturePage'?[{documentId:'document-one',result:{error:'no_financial_text'}}]:['chaseCards','amexCards','amexReadMenu'].includes(o.func?.name)?[{documentId:'document-one',result:[]}]:o.args?.length===3?[{documentId:'document-one',result:{status:'updated',patches:[{id:'card-one',fields:{balance:0},locale:'en-US',capturedAt:new Date().toISOString()}]}}]:[{documentId:'document-one',result:true}]},alarms:{onAlarm:listener('alarm'),create:async()=>{}}};
chrome.storage.session=chrome.storage.local;
chrome.permissions={contains:async()=>false};
await import(pathToFileURL(process.argv[2]).href);
const ask=(m,sender)=>new Promise(resolve=>{const accepted=receive(m,sender,resolve);if(accepted===false)resolve(null);});
const trusted={tab:{id:1},frameId:0,url:ORIGIN+'/'};
const hello=await ask({type:'hello',requestId:'artifact-hello'},trusted);assert.equal(hello.version,'1.1.0');assert.equal(hello.state.schema,2);
assert.equal(await ask({type:'hello',requestId:'bad'},{...trusted,url:'https://evil.test'}),null);assert.equal(await ask({type:'hello',requestId:'bad-port'},{...trusted,url:'http://127.0.0.1:8767/'}),null);assert.equal(await ask({type:'hello',requestId:'bad-frame'},{...trusted,frameId:1}),null);
assert.equal((await ask({type:'refresh',requestId:'invalid',banks:['unknown'],cards:[]},trusted)).ok,false);
assert.equal((await ask({type:'hello',requestId:'popup'},{id:'artifact-test',url:'chrome-extension://artifact-test/popup.html'})).ok,true);
assert.equal(await ask({type:'agent-state'},{...trusted,url:'https://evil.test'}),null);
assert.equal(await ask({type:'agent-state'},trusted),null);
const own={id:'artifact-test',url:'chrome-extension://artifact-test/index.html'};
assert.equal((await ask({type:'agent-state'},own)).ok,true);
assert.equal((await ask({type:'hello',requestId:'standalone-hello',ownerTabId:1},own)).ok,true);
console.log('PASS: AI settings reject website senders; standalone wallet bridge accepts only its own extension page.');
console.log('PASS: packaged MV3 module loads; private-origin and popup messages validate; foreign origin rejected.');

const good={type:'refresh',requestId:'run-smoke',banks:['Chase'],cards:[{id:'card-one',bank:'Chase',tail:'1234',currency:'USD'}]};
assert.equal((await ask(good,trusted)).ok,true);
for(let i=0;i<100&&store['cardybara-state-v2']?.run?.status==='running';i++)await new Promise(r=>setTimeout(r,5));
assert.equal(store['cardybara-state-v2'].run.status,'complete');assert.equal(store['cardybara-state-v2'].records.Chase['card-one'].balance.value,0);
const job=store['cardybara-state-v2'].run.jobs[0],guideMessage={type:'guide-state',requestId:'guide-state-test',runId:store['cardybara-state-v2'].run.id,attemptId:job.attemptId},bankSender={id:'artifact-test',tab:{id:20},frameId:0,url:bankHref};
assert.equal((await ask(guideMessage,bankSender)).ok,true);
for(const sender of [{...bankSender,tab:{id:99}},{...bankSender,frameId:1},{...bankSender,url:'https://evil.test'},{...bankSender,id:'foreign-extension'}])assert.equal((await ask(guideMessage,sender)).ok,false);
assert.equal((await ask({...guideMessage,type:'guide-stop'},bankSender)).ok,true);assert.equal((await ask({...guideMessage,type:'guide-read'},bankSender)).ok,false);assert.equal((await ask({...guideMessage,type:'guide-wallet'},bankSender)).ok,true);assert.equal(store['cardybara-state-v2'].records.Chase['card-one'].balance.value,0);
console.log('PASS: bank guide binds sender, frame, run and tab; stop preserves readings and rejects resume.');
failStore=true;assert.equal((await ask({...good,requestId:'quota-run'},trusted)).ok,false);
console.log('PASS: packaged worker navigates, captures by document ID, persists zero correctly, handles duplicate load events, and rejects quota failure.');

// A separate blank store exercises the fresh-user path of the actual packaged worker.
// This is still a Chrome-API simulation, never installation/bank acceptance evidence.
store={};failStore=false;
const originalScript=chrome.scripting.executeScript;
chrome.scripting.executeScript=async o=>{
 if(o.func?.name==='discoverVisibleCards')return [{documentId:'document-one',result:{status:'found',cards:[{name:'Sapphire Reserve (...1234)',tail:'1234'}]}}];
 if(o.args?.length===3&&typeof o.args[0]==='string'&&Array.isArray(o.args[1]))return [{documentId:'document-one',result:{status:'updated',patches:[{id:o.args[1][0].id,fields:{balance:23},locale:'en-US',capturedAt:new Date().toISOString()}]}}];
 return originalScript(o);
};
assert.equal((await ask({type:'refresh',requestId:'fresh-wallet',banks:['Chase'],cards:[],ownerTabId:1},own)).ok,true);
for(let i=0;i<100&&store['cardybara-state-v2']?.run?.status==='running';i++)await new Promise(r=>setTimeout(r,5));
const fresh=store['cardybara-state-v2'];assert.equal(fresh.run.status,'complete');
assert.equal(fresh.discoveredCards.length,1);assert.equal(fresh.discoveredCards[0].tail,'1234');
assert.equal(fresh.records.Chase[fresh.discoveredCards[0].id].balance.value,23);
assert.equal(fresh.discoveredCards[0].minimum,undefined);
const readback=await ask({type:'hello',requestId:'fresh-readback',ownerTabId:1},own);
assert.equal(readback.state.discoveredCards[0].id,fresh.discoveredCards[0].id);
assert.notEqual(fresh.run.jobs[0].sections?.reward?.status,'updated');
console.log('PASS: packaged worker starts from an empty wallet, discovers a scoped card, persists the observed balance and exposes it to its own wallet without inventing rewards.');

store={};let loggedIn=false;
const signedInScript=chrome.scripting.executeScript;
chrome.scripting.executeScript=async o=>{
 if(!loggedIn&&o.func?.name==='discoverVisibleCards')return [{documentId:'document-one',result:{status:'needs_login',cards:[]}}];
 if(!loggedIn&&o.args?.length===3&&typeof o.args[0]==='string'&&Array.isArray(o.args[1]))return [{documentId:'document-one',result:{status:'needs_login',patches:[]}}];
 return signedInScript(o);
};
await ask({type:'refresh',requestId:'login-then-discover',banks:['Chase'],cards:[],ownerTabId:1},own);
for(let i=0;i<100&&store['cardybara-state-v2']?.run?.status==='running';i++)await new Promise(r=>setTimeout(r,5));
assert.equal(store['cardybara-state-v2'].run.jobs[0].status,'needs_login');
const loginRun=store['cardybara-state-v2'].run;loggedIn=true;
assert.equal((await ask({type:'guide-read',requestId:'after-login',runId:loginRun.id,attemptId:loginRun.jobs[0].attemptId},{id:'artifact-test',tab:{id:20},frameId:0,url:bankHref})).ok,true);
for(let i=0;i<100&&store['cardybara-state-v2']?.run?.status==='running';i++)await new Promise(r=>setTimeout(r,5));
assert.equal(store['cardybara-state-v2'].discoveredCards.length,1);
assert.equal(store['cardybara-state-v2'].records.Chase['discovered-chase-1234'].balance.value,23);
console.log('PASS: empty wallet reports needs-login, then a bank guide retry discovers cards and persists readings after sign-in.');
