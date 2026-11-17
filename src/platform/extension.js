// The Chrome extension's side of the platform: the only file in src/ that calls the browser extension API.
// Shared code imports `platform` from './platform' and never reaches for it directly.
const NOTIFICATIONS={permissions:['notifications']};
export const extension={
 kind:'extension',
 // The reminder worker keeps its schedule here, so it can fire when the wallet page is closed.
 notifications:{
  worker:true,
  area:()=>chrome.storage.local,
  contains:()=>chrome.permissions.contains(NOTIFICATIONS),
  request:()=>chrome.permissions.request(NOTIFICATIONS),
  drop:()=>chrome.permissions.remove(NOTIFICATIONS).catch(()=>{}),
  test:(title,message)=>chrome.notifications.create('cardybara-test',{type:'basic',iconUrl:chrome.runtime.getURL('icons/128.png'),title,message})
 },
 // Bank collection: page messages in, extension messages out. start() runs once, when the wallet starts.
 collection:{
  start(){
   const emit=m=>window.postMessage({channel:'cardybara-extension',...m},location.origin);
   chrome.runtime.onMessage.addListener(m=>{if(m.channel==='cardybara-extension')emit(m)});
   window.addEventListener('message',async e=>{if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='cardybara-dashboard')return;
    try{const tab=await chrome.tabs.getCurrent();const r=await chrome.runtime.sendMessage({...e.data,ownerTabId:tab.id});emit({type:e.data.type==='hello'?'ready':'ack',requestId:e.data.requestId,...r});}catch{emit({ok:false,type:'error',requestId:e.data.requestId,error:'扩展连接失败'})}
   });
  }
 },
 // The extension background's assistant and parser: one request in, its answer out.
 assistant:{
  send:(type,extra={})=>chrome.runtime.sendMessage({type,...extra}),
  allowOrigin:origin=>chrome.permissions.request({origins:[origin+'/*']})
 }
};
export default extension;
