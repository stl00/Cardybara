// The same React app runs as a website or as an extension page, with no localhost dependency.
if(location.protocol==='chrome-extension:'&&globalThis.chrome?.runtime?.id){
 const emit=m=>window.postMessage({channel:'cardybara-extension',...m},location.origin);
 chrome.runtime.onMessage.addListener(m=>{if(m.channel==='cardybara-extension')emit(m)});
 window.addEventListener('message',async e=>{if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='cardybara-dashboard')return;
  try{const tab=await chrome.tabs.getCurrent();const r=await chrome.runtime.sendMessage({...e.data,ownerTabId:tab.id});emit({type:e.data.type==='hello'?'ready':'ack',requestId:e.data.requestId,...r});}catch{emit({ok:false,type:'error',requestId:e.data.requestId,error:'扩展连接失败'})}
 });
}
