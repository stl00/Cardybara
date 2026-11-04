(()=>{
 const origin='http://127.0.0.1:8766';if(location.origin!==origin||window.top!==window)return;
 const emit=m=>window.postMessage({channel:'cardybara-extension',...m},origin);
 // Bootstrap from the content script too: React may send hello before document_idle.
 chrome.runtime.sendMessage({type:'hello',requestId:crypto.randomUUID()}).then(result=>emit({type:'ready',...result})).catch(()=>emit({type:'error',error:'扩展启动失败，请重新加载。'}));
 chrome.runtime.onMessage.addListener(m=>{if(m.channel==='cardybara-extension'&&m.type==='state'&&JSON.stringify(m).length<150000)emit(m);});
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==origin||e.data?.channel!=='cardybara-dashboard')return;
  const m=e.data;if(!['hello','refresh','cancel','export','disconnect','clear','connect','remove-card'].includes(m.type)||JSON.stringify(m).length>16000)return;
  try{const result=await chrome.runtime.sendMessage(m);emit({type:m.type==='hello'?'ready':'ack',requestId:m.requestId,...result});}catch{emit({type:'error',requestId:m.requestId,error:'扩展未能保存或响应，请重试。'});}
 });
})();
