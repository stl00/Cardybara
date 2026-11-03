// Dev-only implementation of the chrome.* APIs extension-next/background.js uses, driving a
// dedicated Chrome over DevTools. It keeps the extension's boundaries: the manifest's
// host permissions, isolated-world injection, tab URLs hidden on other hosts.
import {readFile,rename,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,sep} from 'node:path';
import {ORIGIN} from '../../extension-next/providers.js';

export const WALLET_TAB_ID=1;
export const RUNTIME_ID='cardybara-dev-collector';
const WORLD='cardybara-dev-collector',BINDING='__cardybaraDevSend',MAX_MESSAGE=64000;
// The wallet is not a Chrome tab here, so the service presents it to background.js as the
// extension's trusted page identity. The Vite port is a transport detail.
const WALLET_SENDER={tab:{id:WALLET_TAB_ID},frameId:0,url:ORIGIN+'/'};
const event=()=>{const fns=new Set();return {addListener:f=>fns.add(f),removeListener:f=>fns.delete(f),fire:(...a)=>{for(const f of fns)f(...a);},fns};};

export function tabIdFor(targetId){return 1000+parseInt(String(targetId).slice(0,8),16)%0x7ffff000;}
export function hostPermissions(manifest){
 // Same rule as the release build: loopback is not a bank host.
 return manifest.host_permissions.filter(h=>h.startsWith('https://')).map(h=>new URL(h.replace('/*','/')).hostname);
}
export function funcExpression(func,args=[]){return '('+func.toString()+')(...'+JSON.stringify(args)+')';}
export function isolatedShim(){
 return `(()=>{const waiting=new Map();let next=1;const send=self.${BINDING};
self.__cardybaraDevReply=(id,value)=>{const w=waiting.get(id);if(w){waiting.delete(id);w(value);}};
self.chrome={runtime:{id:${JSON.stringify(RUNTIME_ID)},sendMessage:message=>new Promise(resolve=>{const id=next++;waiting.set(id,resolve);send(JSON.stringify({id,message}));})}};})()`;
}
// Only a server refusal or a well-known block page counts. A login page is not a block.
export function blockSignal({status,title}={}){
 if([403,429,451].includes(status))return 'http_'+status;
 if(/access denied|request blocked|request unsuccessful|attention required|pardon our interruption/i.test(title||''))return 'block_page';
 return null;
}
const BLOCK_PROBE="({status:performance.getEntriesByType('navigation')[0]?.responseStatus,title:document.title})";

export function createStorageArea(path){
 let data=null,tail=Promise.resolve();
 const load=async()=>{if(!data){data=path?JSON.parse(await readFile(path,'utf8').catch(()=> '{}')):{};}return data;};
 const persist=()=>{if(!path)return Promise.resolve();const body=JSON.stringify(data);tail=tail.catch(()=>{}).then(async()=>{await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path+'.tmp',body,{mode:0o600});await rename(path+'.tmp',path);});return tail;};
 return {
  async get(keys){const d=await load();if(keys==null)return structuredClone(d);if(typeof keys==='string')keys=[keys];if(Array.isArray(keys))return structuredClone(Object.fromEntries(keys.filter(k=>k in d).map(k=>[k,d[k]])));return structuredClone(Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,k in d?d[k]:v])));},
  async set(items){const d=await load();Object.assign(d,structuredClone(items));await persist();},
  async remove(keys){const d=await load();for(const k of [].concat(keys))delete d[k];await persist();},
  async setAccessLevel(){}
 };
}

export function createChromeAdapter({openBrowser,extensionRoot,storagePath,permittedHosts,devOrigin,notifyWallet=()=>{},onBlocked=()=>{},prepareTab=async()=>{},settleMs=0}){
 const root=resolve(extensionRoot),tabs=new Map(),sessions=new Map(),alarms=new Map(),reported=new Set();
 const onUpdated=event(),onRemoved=event(),onAlarm=event(),onMessage=event();
 let conn=null,connecting=null;
 const permitted=url=>{try{const u=new URL(url);return u.protocol==='https:'&&permittedHosts.includes(u.hostname);}catch{return false;}};
 const visible=t=>({id:t.id,status:t.status,active:t.active===true,...(permitted(t.url)?{url:t.url}:{})});
 const missing=id=>Error('No tab with id: '+id);
 const fire=(t,change)=>{const {url,...rest}=change;onUpdated.fire(t.id,{...rest,...(url!==undefined&&permitted(url)?{url}:{})},visible(t));};
 const remember=info=>{
  const id=tabIdFor(info.targetId);let t=tabs.get(id);
  if(!t){t={id,targetId:info.targetId,url:info.url,status:'complete',sessionId:null,attaching:null,frameId:null,loaderId:null,world:null,pendingUrl:null};tabs.set(id,t);}
  else if(!t.sessionId)t.url=info.url;
  return t;
 };
 async function attach(t){
  if(t.sessionId)return t;
  t.attaching??=(async()=>{
   const {sessionId}=await conn.send('Target.attachToTarget',{targetId:t.targetId,flatten:true});
   t.sessionId=sessionId;sessions.set(sessionId,t);
   await conn.send('Page.enable',{},sessionId);await prepareTab(conn,sessionId);
   const {frameTree}=await conn.send('Page.getFrameTree',{},sessionId);setFrame(t,frameTree.frame);
   return t;
  })().finally(()=>{t.attaching=null;});
  return t.attaching;
 }
 function setFrame(t,frame){
  t.frameId=frame.id;t.url=frame.url+(frame.urlFragment||'');
  if(t.loaderId!==frame.loaderId){t.loaderId=frame.loaderId;t.world=null;}
 }
 function dropTab(t){
  tabs.delete(t.id);if(t.sessionId)sessions.delete(t.sessionId);
  onRemoved.fire(t.id,{isWindowClosing:false});
 }
 function dispatchEvent(method,params,sessionId){
  if(method==='Target.targetCreated'||method==='Target.targetInfoChanged'){
   if(params.targetInfo.type!=='page')return;
   const t=remember(params.targetInfo);if(!t.sessionId&&permitted(t.url))attach(t).catch(()=>{});return;
  }
  if(method==='Target.targetDestroyed'){const t=tabs.get(tabIdFor(params.targetId));if(t)dropTab(t);return;}
  const t=sessions.get(sessionId);if(!t)return;
  if(method==='Runtime.bindingCalled'){if(params.name===BINDING)void pageMessage(t,params);return;}
  if(method==='Page.frameStartedLoading'&&params.frameId===t.frameId){t.status='loading';fire(t,{status:'loading'});return;}
  if(method==='Page.frameNavigated'&&!params.frame.parentId){const before=t.url;t.pendingUrl=null;setFrame(t,params.frame);if(t.url!==before)fire(t,{url:t.url});return;}
  if(method==='Page.navigatedWithinDocument'&&params.frameId===t.frameId){
   // Chrome reports a same-document navigation as loading then complete; background.js relies on it.
   t.pendingUrl=null;if(params.url===t.url)return;t.url=params.url;t.status='loading';fire(t,{status:'loading',url:t.url});
   setTimeout(()=>{if(t.status==='loading'){t.status='complete';fire(t,{status:'complete'});}},settleMs);return;
  }
  if(method==='Page.frameStoppedLoading'&&params.frameId===t.frameId){t.status='complete';fire(t,{status:'complete'});void probeBlock(t);}
 }
 function disconnected(){
  conn=null;for(const t of [...tabs.values()])dropTab(t);
 }
 async function connect({launch=true}={}){
  if(conn)return conn;
  connecting??=(async()=>{
   const c=await openBrowser({launch});conn=c;
   c.on('event',dispatchEvent);c.on('close',disconnected);
   await c.send('Target.setDiscoverTargets',{discover:true});
   for(const info of (await c.send('Target.getTargets')).targetInfos)if(info.type==='page'){const t=remember(info);if(permitted(t.url))await attach(t).catch(()=>{});}
   return c;
  })().finally(()=>{connecting=null;});
  return connecting;
 }
 async function world(t){
  await attach(t);
  const {frameTree}=await conn.send('Page.getFrameTree',{},t.sessionId);setFrame(t,frameTree.frame);
  if(!permitted(t.url))throw Error('Cannot access contents of the page.');
  if(t.world?.loaderId===t.loaderId)return {contextId:await t.world.contextId,loaderId:t.loaderId};
  const loaderId=t.loaderId,contextId=(async()=>{
   const {executionContextId}=await conn.send('Page.createIsolatedWorld',{frameId:t.frameId,worldName:WORLD},t.sessionId);
   // Bound to this one context so the page's own world can never call it. Runtime.enable stays off:
   // it would stream the page's console arguments and exceptions into this process.
   await conn.send('Runtime.addBinding',{name:BINDING,executionContextId},t.sessionId);
   await evaluate(t,executionContextId,isolatedShim());return executionContextId;
  })();
  t.world={loaderId,contextId};
  try{return {contextId:await contextId,loaderId};}catch(error){t.world=null;throw error;}
 }
 async function evaluate(t,contextId,expression){
  const r=await conn.send('Runtime.evaluate',{expression,contextId,awaitPromise:true,returnByValue:true},t.sessionId);
  if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description?.split('\n')[0]||'script_exception');
  return r.result?.value;
 }
 async function pageMessage(t,{payload,executionContextId}){
  // A sender is only a context this adapter created for the tab's current document.
  if(t.world?.loaderId!==t.loaderId||await t.world.contextId!==executionContextId||String(payload).length>MAX_MESSAGE)return;
  const {id,message}=JSON.parse(payload);
  const reply=await dispatch(message,{id:RUNTIME_ID,tab:{id:t.id},frameId:0,url:t.url});
  await evaluate(t,executionContextId,'self.__cardybaraDevReply('+JSON.stringify(id)+','+JSON.stringify(reply??null)+')').catch(()=>{});
 }
 function dispatch(message,sender){
  return new Promise(respond=>{
   let handled=false;
   for(const listener of onMessage.fns)if(listener(message,sender,respond)===true)handled=true;
   if(!handled)respond(null);
  });
 }
 async function probeBlock(t){
  if(!permitted(t.url)||reported.has(t.loaderId))return;
  try{
   const loaderId=t.loaderId,{contextId}=await world(t),reason=blockSignal(await evaluate(t,contextId,BLOCK_PROBE));
   if(reason&&!reported.has(loaderId)){reported.add(loaderId);onBlocked({tabId:t.id,host:new URL(t.url).hostname,reason});}
  }catch{}
 }
 function navigate(t,url){
  // Fired, not awaited: Page.navigate answers only at commit, and background.js waits on tab events.
  t.pendingUrl=url;
  conn.send('Page.navigate',{url},t.sessionId).then(r=>{if(r.errorText&&t.pendingUrl===url)t.pendingUrl=null;}).catch(()=>{});
 }
 const liveTab=async id=>{const t=tabs.get(id);if(!t)throw missing(id);await attach(t);return t;};
 const local=createStorageArea(storagePath),session=createStorageArea(null);
 const chrome={
  runtime:{id:RUNTIME_ID,getURL:path=>'chrome-extension://'+RUNTIME_ID+'/'+path,onMessage,sendMessage:async()=>undefined},
  storage:{local,session},
  // Same default as a package without loopback permission, so a dev run never calls the 8766 parser.
  permissions:{contains:async()=>false},
  alarms:{onAlarm,
   async create(name,{when}){clearTimeout(alarms.get(name));alarms.set(name,setTimeout(()=>{alarms.delete(name);onAlarm.fire({name,scheduledTime:when});},Math.max(0,when-Date.now())));},
   async clear(name){const had=alarms.has(name);clearTimeout(alarms.get(name));alarms.delete(name);return had;}},
  tabs:{onUpdated,onRemoved,
   async query(){await connect();return [...tabs.values()].map(visible);},
   async get(id){if(id===WALLET_TAB_ID)return {id,url:ORIGIN+'/',status:'complete',active:true};const t=tabs.get(id);if(!t)throw missing(id);return visible(t);},
   async create({url,active=true}){
    if(!permitted(url))throw Error('tab_url_not_permitted');
    await connect();
    const {targetId}=await conn.send('Target.createTarget',{url:'about:blank',background:!active});
    const t=remember({targetId,url:'about:blank'});await attach(t);
    navigate(t,url);return visible(t);
   },
   async update(id,{url,active}={}){
    if(id===WALLET_TAB_ID){const w=[...tabs.values()].find(t=>devOrigin&&String(t.url).startsWith(devOrigin+'/'));if(active&&w&&conn)await conn.send('Target.activateTarget',{targetId:w.targetId});return chrome.tabs.get(id);}
    if(url!==undefined&&!permitted(url))throw Error('tab_url_not_permitted');
    const t=await liveTab(id);
    if(active){await conn.send('Target.activateTarget',{targetId:t.targetId});t.active=true;}
    if(url!==undefined)navigate(t,url);
    return visible(t);
   },
   async reload(id){
    const t=await liveTab(id);
    // A reload right after create must restart the pending navigation, not reload about:blank.
    if(t.pendingUrl)navigate(t,t.pendingUrl);else await conn.send('Page.reload',{},t.sessionId);
    // DevTools stays silent when a frame that is already loading restarts, but a caller that binds
    // the tab and then reloads waits for the new cycle's loading event.
    if(t.status==='loading')fire(t,{status:'loading'});
   },
   async sendMessage(id,message){if(id!==WALLET_TAB_ID)throw Error('Could not establish connection. Receiving end does not exist.');notifyWallet(message);}
  },
  scripting:{async executeScript({target,files,func,args}){
   const t=await liveTab(target.tabId);
   const {contextId,loaderId}=await world(t);
   if(target.documentIds&&!target.documentIds.includes(loaderId))throw Error('No document with id');
   let value;
   if(files)for(const file of files){
    const path=resolve(root,file);if(!path.startsWith(root+sep))throw Error('invalid_script_path');
    value=await evaluate(t,contextId,await readFile(path,'utf8'));
   }else value=await evaluate(t,contextId,funcExpression(func,args));
   return [{documentId:loaderId,frameId:0,result:value===undefined?null:value}];
  }}
 };
 return {chrome,connect,fromWallet:message=>dispatch(message,WALLET_SENDER),close(){for(const timer of alarms.values())clearTimeout(timer);conn?.close();}};
}
