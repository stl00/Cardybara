// Voice dictation into the assistant composer (#655), without React so it tests with a fake recognizer. Cardybara never
// records, stores or uploads audio: the browser recognises it and hands back text. On the device when the browser can;
// otherwise the browser vendor's speech service, and only after the user accepted a notice (owner decision, #654).
export const VOICE_CLOUD_KEY='cardybara-voice-cloud-v1';
export const VOICE_CHANGE='cardybara-voice-change';
export const speechLang=language=>({'zh-CN':'zh-CN','zh-TW':'zh-TW','en-US':'en-US'})[language]||'zh-CN';

export function readCloudConsent(storage=globalThis.localStorage){try{return storage?.getItem(VOICE_CLOUD_KEY)==='1';}catch{return false;}}
export function setCloudConsent(on,storage=globalThis.localStorage){
 try{on?storage.setItem(VOICE_CLOUD_KEY,'1'):storage.removeItem(VOICE_CLOUD_KEY);}catch{return false;}
 globalThis.window?.dispatchEvent(new Event(VOICE_CHANGE));
 return true;
}

const CJK=/[⺀-鿿豈-﫿＀-￯]/;
// Appends what was heard to what is already in the box; a space only between two words of a script that uses spaces.
export function appendTranscript(text,heard,limit=4000){
 const add=heard.trim();
 if(!add)return text;
 const space=text&&!/\s$/.test(text)&&!CJK.test(text.slice(-1))&&!CJK.test(add[0])&&!/^[,.!?;:]/.test(add)?' ':'';
 return (text+space+add).slice(0,limit);
}

const QUIET={'no-speech':'no-speech','language-not-supported':'language-not-supported','not-allowed':'not-allowed','service-not-allowed':'not-allowed'};

// States: 'idle', 'starting' (asking the browser or the user), 'downloading', 'recording'.
//   consent {get(),set(true)}; confirmCloud() and confirmDownload() resolve true when the user accepts
//   onText(heard) gets the whole text of this recording so far; onError gets 'not-allowed', 'no-speech',
//   'language-not-supported', 'download-failed' or 'failed'
export function createDictation({speech,consent,confirmCloud,confirmDownload,onState=()=>{},onText=()=>{},onError=()=>{}}){
 let state='idle',run=0,recognizer=null;
 // A language whose model would not install in this page: the next try asks for the cloud service instead.
 const installFailed=new Set();
 const set=next=>{if(state!==next){state=next;onState(next);}};
 const detach=()=>{const old=recognizer;recognizer=null;if(old)old.onresult=old.onerror=old.onend=null;return old;};
 // Throws the recording away: nothing it hears afterwards reaches the box.
 const cancel=()=>{run++;const old=detach();try{old?.abort();}catch{/* already ended */}set('idle');};
 const fail=code=>{detach();set('idle');onError(code);};
 const listen=(lang,mode)=>{
  try{
   const next=speech.create(lang,mode);
   recognizer=next;
   next.onresult=event=>onText(Array.from(event.results,result=>result[0].transcript).join(''));
   next.onerror=event=>{if(event.error==='aborted')return;fail(QUIET[event.error]||'failed');};
   next.onend=()=>{detach();set('idle');};
   set('recording');
   next.start();
  }catch{fail('failed');}
 };
 const start=async lang=>{
  const mine=++run,stale=()=>mine!==run;
  set('starting');
  try{
   let info=speech.mode(lang);
   // No await for a plain answer: Safari wants start() inside the click.
   if(typeof info?.then==='function'){info=await info;if(stale())return;}
   if(info.mode==='local'&&info.downloadable&&installFailed.has(lang))info={mode:'cloud'};
   if(info.mode==='local'&&info.downloadable){
    const yes=await confirmDownload();if(stale())return;
    if(!yes)return set('idle');
    const installing=speech.install(lang);
    set('downloading');
    const done=await installing;if(stale())return;
    if(!done){installFailed.add(lang);return fail('download-failed');}
   }
   if(info.mode==='cloud'&&!consent.get()){
    const yes=await confirmCloud();if(stale())return;
    if(!yes)return set('idle');
    consent.set(true);
   }
   listen(lang,info.mode);
  }catch{if(!stale())fail('failed');}
 };
 return {
  get state(){return state;},
  // The mic button: start; while recording, stop and keep what was heard; while waiting, give up.
  toggle(lang){
   if(state==='idle')return start(lang);
   if(state==='recording'){try{recognizer?.stop();}catch{cancel();}return Promise.resolve();}
   cancel();return Promise.resolve();
  },
  cancel
 };
}
