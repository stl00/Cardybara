// The browser's speech recognition (Web Speech API), shared by the web and extension platforms (#655). `speechCapability`
// answers undefined when the browser has no recognizer at all: the capability is then absent, not faked.
//   mode(lang)     {mode:'local',downloadable} when the browser can recognise this language on the device, else {mode:'cloud'}
//                  (the browser vendor's speech service). A plain object, not a promise, when the browser has no
//                  `available()` (Safari), so the caller can start inside the click.
//   install(lang)  downloads the on-device voice model; resolves false when it fails or never answers
//   create(lang,mode)  a recognizer. The caller must have the user's consent before asking for a cloud one.
const AVAILABLE_LIMIT_MS=3000;
// Some builds never answer install() (#654); stop waiting rather than leave the button busy for good.
const INSTALL_LIMIT_MS=180000;
const within=(promise,ms,fallback)=>new Promise(resolve=>{
 const timer=setTimeout(()=>resolve(fallback),ms);
 Promise.resolve(promise).then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);resolve(fallback);});
});
export function speechCapability(scope=globalThis,{availableLimitMs=AVAILABLE_LIMIT_MS,installLimitMs=INSTALL_LIMIT_MS}={}){
 const Recognition=scope.SpeechRecognition||scope.webkitSpeechRecognition;
 if(!Recognition)return undefined;
 const cloud={mode:'cloud'};
 const local=lang=>({langs:[lang],processLocally:true});
 return {
  mode(lang){
   if(typeof Recognition.available!=='function')return cloud;
   let asked;
   try{asked=Recognition.available(local(lang));}catch{return cloud;}
   return within(asked,availableLimitMs,null).then(status=>status==='available'||status==='downloadable'?{mode:'local',downloadable:status==='downloadable'}:cloud);
  },
  install(lang){
   if(typeof Recognition.install!=='function')return Promise.resolve(false);
   // Called without an await before it: the browser wants the click that confirmed the download.
   let asked;
   try{asked=Recognition.install(local(lang));}catch{return Promise.resolve(false);}
   return within(asked,installLimitMs,false).then(Boolean);
  },
  create(lang,mode){
   const recognizer=new Recognition();
   recognizer.lang=lang;
   if(mode==='local')recognizer.processLocally=true;
   recognizer.interimResults=true;
   recognizer.continuous=false;
   return recognizer;
  }
 };
}
