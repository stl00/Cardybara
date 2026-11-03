(()=>{
const origin='http://127.0.0.1:8766';
if(location.origin!==origin)return;
const emit=payload=>window.postMessage({channel:'cardybara-legacy-extension',...payload},origin);
chrome.runtime.onMessage.addListener(m=>{if(m.channel==='cardybara-legacy-extension')emit(m)});
window.addEventListener('message',async e=>{
 if(e.source!==window||e.origin!==origin||e.data?.channel!=='cardybara-legacy-dashboard')return;
 const m=e.data;if(!['hello','refresh','focus-bank'].includes(m.type))return;
 try{const result=await chrome.runtime.sendMessage(m);emit({type:m.type==='hello'?'ready':'ack',requestId:m.requestId,...result})}catch{emit({type:'error',requestId:m.requestId,error:'扩展连接已断开，请重新加载 Dashboard。'})}
});
emit({type:'ready',version:'1.0.0'});
})();
