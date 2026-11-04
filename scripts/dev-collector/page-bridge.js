// Dev-only transport for the Vite page; plays the part extension-next/dashboard.js plays with an
// installed extension. Served only by the Vite dev plugin and never part of a build.
(()=>{
 const origin=location.origin,base='/__cardybara/collector/';if(window.top!==window)return;
 // Dev-only messages stay here rather than in src/translations.json so they cannot ship.
 const text={
  bank_blocked:['银行页面拒绝或离开了开发浏览器，已停止本次读取。','銀行頁面拒絕或離開了開發瀏覽器，已停止本次讀取。','The bank refused or left the dev browser. This read has stopped.'],
  browser_closed:['开发浏览器已关闭，已停止本次读取。','開發瀏覽器已關閉，已停止本次讀取。','The dev browser was closed. This read has stopped.'],
  chrome_not_found:['未找到 Chrome，请设置 CARDYBARA_CHROME_PATH。','找不到 Chrome，請設定 CARDYBARA_CHROME_PATH。','Chrome was not found. Set CARDYBARA_CHROME_PATH.'],
  chrome_start_failed:['无法启动开发浏览器，请重试。','無法啟動開發瀏覽器，請重試。','The dev browser could not start. Try again.'],
  collector_restarting:['开发采集服务正在重启，请重试。','開發採集服務正在重新啟動，請重試。','The dev collector is restarting. Try again.'],
  collector_unavailable:['开发采集服务未响应，请检查 npm run dev。','開發採集服務沒有回應，請檢查 npm run dev。','The dev collector is not responding. Check npm run dev.']
 };
 const say=m=>{if(!m.errorCode)return m;let i=0;try{const l=localStorage.getItem('cardybara-language')||'';i=/en/i.test(l)?2:/tw|hant/i.test(l)?1:0;}catch{}const {errorCode,...rest}=m;return {...rest,error:(text[errorCode]||text.collector_unavailable)[i]};};
 const emit=m=>window.postMessage({channel:'cardybara-extension',...m},origin);
 const ask=async m=>{const r=await fetch(base+'message',{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'dev-collector'},body:JSON.stringify(m)});if(!r.ok)throw Error('collector_unavailable');return r.json();};
 const hello=()=>ask({type:'hello',requestId:crypto.randomUUID()}).then(result=>emit({type:'ready',...say(result)})).catch(()=>{});
 const events=new EventSource(base+'events');
 events.onopen=hello;
 events.onmessage=e=>{const m=JSON.parse(e.data);if(m.restarted)void hello();else if(m.channel==='cardybara-extension')window.postMessage(say(m),origin);};
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==origin||e.data?.channel!=='cardybara-dashboard')return;
  const m=e.data;if(!['hello','refresh','cancel','export','disconnect','clear','connect','remove-card'].includes(m.type)||JSON.stringify(m).length>16000)return;
  try{const result=await ask(m);emit({type:m.type==='hello'?'ready':'ack',requestId:m.requestId,...say(result)});}catch{emit(say({type:'error',requestId:m.requestId,errorCode:'collector_unavailable'}));}
 });
})();
