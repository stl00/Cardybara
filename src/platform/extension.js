// The Chrome extension's side of the platform: the only file in src/ that calls the browser extension API.
// Shared code imports `platform` from './platform' and never reaches for it directly.
import {signInUrl,sessionFromRedirect} from '../extensionSignIn.js';
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
 // Account and sync (#416): the same `/v2/account` routes as the web wallet. `allow` asks once for the gateway's host permission
 // (a click must be on the stack); `mirror` keeps the session token in chrome.storage.local too, for the background. No passkey
 // sign-in goes through the PWA: `passkeySignIn` opens it with chrome.identity.launchWebAuthFlow (#472) and answers the session or null.
 account:{
  passkeySignIn:async()=>{
   const id=chrome.runtime.id;
   const url=signInUrl(id);
   if(!url)return null;
   return sessionFromRedirect(await chrome.identity.launchWebAuthFlow({url,interactive:true}),id);
  },
  allow:origin=>chrome.permissions.request({origins:[origin+'/*']}),
  mirror:session=>session?chrome.storage.local.set({'cardybara-account-session-v1':session}):chrome.storage.local.remove('cardybara-account-session-v1')
 },
 // Plaid-linked credit cards (PLAID_PLAN.md): the gateway hosts Plaid Link (an MV3 page may not load remote script); the
 // wallet opens that page in a normal tab. The web wallet (web.js) goes there in its own window instead.
 plaid:{
  open:url=>chrome.tabs.create({url})
 },
 // The extension background's assistant and parser: one request in, its answer out.
 assistant:{
  send:(type,extra={})=>chrome.runtime.sendMessage({type,...extra}),
  allowOrigin:origin=>chrome.permissions.request({origins:[origin+'/*']})
 }
};
export default extension;
