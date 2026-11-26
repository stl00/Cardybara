// #655: voice input in the assistant composer, driven with a fake SpeechRecognition. No microphone and no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {speechCapability} from '../src/platform/speech.js';
import {VOICE_CLOUD_KEY,appendTranscript,createDictation,readCloudConsent,setCloudConsent,speechLang} from '../src/dictation.js';

const LANGS=['zh-CN','zh-TW','en-US'];
// `status`: what available() answers; undefined: a browser without available() (Safari). `installs`: what install() answers.
function fakeBrowser({status,installs=true,startThrows=false,hang=false}={}){
 const made=[],calls=[];
 class Recognition{
  constructor(){made.push(this);this.started=this.stopped=this.aborted=false;}
  start(){if(startThrows)throw Error('InvalidStateError');this.started=true;}
  stop(){this.stopped=true;}
  abort(){this.aborted=true;}
  hear(...parts){this.onresult?.({results:parts.map(transcript=>[{transcript}])});}
  error(code){this.onerror?.({error:code});this.onend?.();}
 }
 if(status!==undefined){
  Recognition.available=options=>{calls.push(['available',options]);return hang?new Promise(()=>{}):Promise.resolve(status);};
  Recognition.install=options=>{calls.push(['install',options]);return hang?new Promise(()=>{}):Promise.resolve(installs);};
 }
 return {scope:{SpeechRecognition:Recognition},made,calls};
}
function setup(browser,{consented=false,cloud=true,download=true,limits}={}){
 const log={states:[],heard:[],errors:[],asked:[]},store={on:consented};
 const answers={cloud,download};
 const dictation=createDictation({speech:speechCapability(browser.scope,limits),
  consent:{get:()=>store.on,set:on=>{store.on=on;}},
  confirmCloud:async()=>{log.asked.push('cloud');assert.equal(browser.made.length,0,'no recognizer exists before consent');return answers.cloud;},
  confirmDownload:async()=>{log.asked.push('download');return answers.download;},
  onState:s=>log.states.push(s),onText:x=>log.heard.push(x),onError:e=>log.errors.push(e)});
 return {dictation,log,store,answers};
}

test('the capability is absent only when the browser has no recognizer',()=>{
 assert.equal(speechCapability({}),undefined);
 assert.ok(speechCapability({SpeechRecognition:class{}}));
 assert.ok(speechCapability({webkitSpeechRecognition:class{}}));
});

test('the recognizer language follows the wallet language',()=>{
 assert.deepEqual(LANGS.map(speechLang),LANGS);
});

test('on-device: every recognizer sets the language and processLocally, and no cloud notice shows',async()=>{
 for(const lang of LANGS){
  const browser=fakeBrowser({status:'available'}),{dictation,log}=setup(browser);
  await dictation.toggle(speechLang(lang));
  const [r]=browser.made;
  assert.equal(browser.made.length,1);
  assert.deepEqual([r.lang,r.processLocally,r.interimResults,r.continuous,r.started],[lang,true,true,false,true]);
  assert.deepEqual(browser.calls[0],['available',{langs:[lang],processLocally:true}]);
  assert.deepEqual(log.asked,[]);
  assert.equal(dictation.state,'recording');
 }
});

test('cloud: no recognizer before consent, declining can ask again, accepting is remembered',async()=>{
 for(const status of ['unavailable',undefined])for(const lang of LANGS){
  const browser=fakeBrowser({status}),{dictation,log,store,answers}=setup(browser,{cloud:false});
  await dictation.toggle(lang);
  assert.equal(browser.made.length,0);
  assert.deepEqual([dictation.state,store.on],['idle',false]);
  await dictation.toggle(lang);
  assert.deepEqual(log.asked,['cloud','cloud'],'asked again after declining');
  assert.equal(browser.made.length,0);
  answers.cloud=true;
  // confirmCloud asserts that nothing was constructed before the answer.
  await dictation.toggle(lang);
  const [r]=browser.made;
  assert.deepEqual([r.lang,r.processLocally,store.on],[lang,undefined,true]);
  r.onend();
  await dictation.toggle(lang);
  assert.equal(log.asked.length,3,'not asked once accepted');
  assert.equal(browser.made[1].lang,lang);
 }
});

test('without available() the recording starts inside the click',()=>{
 const browser=fakeBrowser(),{dictation}=setup(browser,{consented:true});
 dictation.toggle('zh-CN');
 assert.equal(browser.made[0].started,true,'started synchronously');
});

test('a downloadable model is installed only after the user agrees',async()=>{
 const browser=fakeBrowser({status:'downloadable'}),{dictation,log,answers}=setup(browser,{download:false});
 await dictation.toggle('zh-TW');
 assert.equal(browser.made.length,0);
 assert.ok(!browser.calls.some(c=>c[0]==='install'));
 answers.download=true;
 await dictation.toggle('zh-TW');
 assert.deepEqual(browser.calls.find(c=>c[0]==='install'),['install',{langs:['zh-TW'],processLocally:true}]);
 assert.deepEqual([browser.made[0].processLocally,browser.made[0].lang],[true,'zh-TW']);
 assert.deepEqual(log.asked,['download','download']);
 assert.deepEqual(log.states.slice(-3),['starting','downloading','recording']);
});

test('a download that fails or never answers ends quietly; the next try asks before using the cloud',async()=>{
 for(const options of [{installs:false},{installs:'hang'}]){
  const browser=fakeBrowser({status:'downloadable'});
  if(options.installs==='hang')browser.scope.SpeechRecognition.install=()=>new Promise(()=>{});
  else browser.scope.SpeechRecognition.install=()=>Promise.resolve(false);
  const {dictation,log}=setup(browser,{limits:{installLimitMs:10},cloud:false});
  await dictation.toggle('en-US');
  assert.deepEqual([log.errors,dictation.state,browser.made.length],[['download-failed'],'idle',0]);
  await dictation.toggle('en-US');
  assert.deepEqual(log.asked,['download','cloud']);
  assert.equal(browser.made.length,0);
 }
});

test('a browser that never answers available() counts as cloud',async()=>{
 const browser=fakeBrowser({status:'available',hang:true}),{dictation,log}=setup(browser,{limits:{availableLimitMs:10},cloud:false});
 await dictation.toggle('en-US');
 assert.deepEqual([log.asked,browser.made.length],[['cloud'],0]);
});

test('the text follows the recording, stopping keeps it and cancelling drops what comes later',async()=>{
 const browser=fakeBrowser({status:'available'}),{dictation,log}=setup(browser);
 await dictation.toggle('en-US');
 browser.made[0].hear('which');
 await dictation.toggle('en-US');
 assert.equal(browser.made[0].stopped,true);
 browser.made[0].hear('which card');
 browser.made[0].onend();
 assert.deepEqual([log.heard,dictation.state],[['which','which card'],'idle']);
 await dictation.toggle('en-US');
 const second=browser.made[1],late=second.onresult;
 dictation.cancel();
 assert.deepEqual([second.aborted,second.onresult,dictation.state],[true,null,'idle']);
 assert.ok(late);
 assert.equal(log.heard.length,2);
});

test('errors map to quiet codes and the button can be used again',async()=>{
 for(const [error,code] of [['not-allowed','not-allowed'],['service-not-allowed','not-allowed'],['no-speech','no-speech'],['language-not-supported','language-not-supported'],['network','failed'],['aborted',null]]){
  const browser=fakeBrowser({status:'available'}),{dictation,log}=setup(browser);
  await dictation.toggle('zh-CN');
  browser.made[0].error(error);
  assert.deepEqual([log.errors,dictation.state],[code?[code]:[],'idle'],error);
  await dictation.toggle('zh-CN');
  assert.equal(dictation.state,'recording');
 }
 const browser=fakeBrowser({status:'available',startThrows:true}),{dictation,log}=setup(browser);
 await dictation.toggle('zh-CN');
 assert.deepEqual([log.errors,dictation.state],[['failed'],'idle']);
});

test('what was heard is appended to the text in the box',()=>{
 assert.equal(appendTranscript('','  which card '),'which card');
 assert.equal(appendTranscript('For dinner,','which card?'),'For dinner, which card?');
 assert.equal(appendTranscript('For dinner ','which card?'),'For dinner which card?');
 assert.equal(appendTranscript('今晚吃饭','刷哪张卡'),'今晚吃饭刷哪张卡');
 assert.equal(appendTranscript('kept',''),'kept');
 assert.equal(appendTranscript('a'.repeat(3999),'bbb').length,4000);
});

test('the cloud consent is stored on this device and can be revoked',()=>{
 const mem=new Map(),storage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
 assert.equal(readCloudConsent(storage),false);
 setCloudConsent(true,storage);
 assert.deepEqual([readCloudConsent(storage),[...mem.keys()]],[true,[VOICE_CLOUD_KEY]]);
 setCloudConsent(false,storage);
 assert.deepEqual([readCloudConsent(storage),mem.size],[false,0]);
});
