// Dev-only transport for the Vite page; plays the part extension-next/dashboard.js plays with an
// installed extension. Served only by the Vite dev plugin and never part of a build.
(()=>{
 const origin=location.origin,base='/__cardybara/collector/';if(window.top!==window)return;
 const emit=m=>window.postMessage({channel:'cardybara-extension',...m},origin);
 const ask=async m=>{const r=await fetch(base+'message',{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'dev-collector'},body:JSON.stringify(m)});if(!r.ok)throw Error('collector_unavailable');return r.json();};
 const hello=()=>ask({type:'hello',requestId:crypto.randomUUID()}).then(result=>emit({type:'ready',...result})).catch(()=>{});
 const events=new EventSource(base+'events');
 events.onopen=hello;
 events.onmessage=e=>{const m=JSON.parse(e.data);if(m.restarted)void hello();else if(m.channel==='cardybara-extension')window.postMessage(m,origin);};
 window.addEventListener('message',async e=>{
  if(e.source!==window||e.origin!==origin||e.data?.channel!=='cardybara-dashboard')return;
  const m=e.data;if(!['hello','refresh','cancel','export','disconnect','clear','connect'].includes(m.type)||JSON.stringify(m).length>16000)return;
  try{const result=await ask(m);emit({type:m.type==='hello'?'ready':'ack',requestId:m.requestId,...result});}catch{emit({type:'error',requestId:m.requestId,error:'开发采集服务未响应，请检查 npm run dev。'});}
 });
})();
