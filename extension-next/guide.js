// Bank-page guide, in the extension isolated world. No input values, cookies,
// credentials, page scripts or network responses are accessed.
function cardyGuidePageReady(config,doc=document){
 const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 if([...doc.querySelectorAll('input[type=password]')].some(visible))return false;
 if(config.tails.length)return config.tails.some(t=>new RegExp('(?:^|[^0-9])'+t+'(?:[^0-9]|$)').test(doc.body?.innerText||''));
 const selector=config.bank==='Chase'?'#CARD_ACCOUNTS [id^="accounts-name-link-button-"]':'h1,h2,h3,[role="option"],.account-detail-row';
 return [...doc.querySelectorAll(selector)].some(e=>visible(e)&&/(?:[•●*xX]{2,}\s*|\.{3}\s*)(\d{4,5})(?!\d)/.test(e.innerText||''));
}
(()=>{
 if(self.CardyGuide?.build==='new-user-2')return;
 let config,host,root,timer,observer,stopped=false,pending=false,autoAttempted=false,stopWanted=false,syncing=false;
 const phases={queued:'等待其他账户',opening:'正在打开银行官网',navigating:'正在等待银行页面',capturing:'正在读取可见字段',updated:'已读取并回写钱包',partial:'部分字段已读取',needs_login:'等待你登录银行',needs_confirmation:'请在手机上完成银行确认',no_data:'未识别到可读取字段',load_error:'页面暂时无法读取',timeout:'读取超时，可重试',navigation_changed:'页面已切换，可重试',cancelled:'本次读取已取消',interrupted:'本次读取已中断',tab_closed:'银行页面已关闭'};
 const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 const loginVisible=()=>[...document.querySelectorAll('input[type=password]')].some(visible);
 const pageReady=()=>cardyGuidePageReady(config);
 async function command(type){return chrome.runtime.sendMessage({type,requestId:crypto.randomUUID(),runId:config.runId,attemptId:config.attemptId});}
 function paint(info){
  if(!root)return;
  const phaseText=['queued','opening','navigating','capturing'].includes(info.status)&&({reading_all_data:'正在读取卡片与账户',understanding_page:'正在整理页面数据',reading_next_page:'正在读取下一页'})[info.phase];
  root.querySelector('[data-phase]').textContent=loginVisible()?'请在银行官网自行登录':phaseText||phases[info.status]||'等待银行页面';
  root.querySelector('[data-progress]').textContent=info.status==='updated'||info.status==='partial'?'本轮记录已保存 · 未读项目保留原日期':config.bank+' · 登录 → 读取 → 回写钱包';
  root.querySelector('[data-read]').disabled=pending||['queued','opening','navigating','capturing'].includes(info.status);
 }
 async function readPage(manual=false){
  if((stopped&&!manual)||pending||stopWanted)return;
  if(!pageReady()&&!(manual&&!config.tails.length&&!loginVisible())){root.querySelector('[data-phase]').textContent='请先在银行官网完成登录，并打开卡片概览';return;}
  pending=true;root.querySelector('[data-read]').disabled=true;
  try{const r=await command('guide-read');if(!r?.ok){if(manual)root.querySelector('[data-phase]').textContent='暂时不能读取，请等待其他账户完成后重试';return;}config.attemptId=r.guide.attemptId;paint(r.guide);autoAttempted=true;}catch{root.querySelector('[data-phase]').textContent='连接已失效，请从钱包重新打开引导';stopWatching();}finally{pending=false;if(stopWanted)await command('guide-stop').catch(()=>{});}
 }
 function stopWatching(){stopped=true;clearInterval(timer);observer?.disconnect();}
 async function sync(){
  if(!host?.isConnected){stopWatching();return;}if(stopped||pending||syncing)return;
  if(Date.now()>config.expiresAt){root.querySelector('[data-phase]').textContent='引导已到期，请回钱包重新刷新';stopWatching();return;}
  syncing=true;const requestAttempt=config.attemptId;
  try{const r=await command('guide-state');if(!r?.ok){if(requestAttempt!==config.attemptId)return;root.querySelector('[data-phase]').textContent='本次任务已结束，请从钱包重新刷新';stopWatching();return;}config.attemptId=r.guide.attemptId;paint(r.guide);
   if(['cancelled','interrupted','cleared','disconnected','tab_closed','updated','partial'].includes(r.guide.status)){stopWatching();return;}
   if(!autoAttempted&&pageReady()&&['needs_login','needs_confirmation','no_data','timeout','load_error','navigation_changed'].includes(r.guide.status))void readPage();
  }catch{root.querySelector('[data-phase]').textContent='连接已失效，请从钱包重新打开引导';stopWatching();}finally{syncing=false;}
 }
 function mount(next){
  if(host?.isConnected){if(config.runId===next.runId&&config.attemptId===next.attemptId){config={...config,...next};paint(next);return;}clearInterval(timer);observer?.disconnect();host.remove();pending=false;}
  document.querySelectorAll('#cardybara-bank-guide').forEach(el=>el.remove());
  config=next;stopped=false;autoAttempted=false;stopWanted=false;host=document.createElement('div');host.id='cardybara-bank-guide';host.style.cssText='all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;display:block;';root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>:host{all:initial}*{box-sizing:border-box}.panel{width:310px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #91caff;border-radius:14px;padding:16px;box-shadow:0 8px 32px #0002;color:#262626;font:13px/1.6 system-ui}header{display:flex;justify-content:space-between;align-items:center;font-weight:650}header button{padding:0 4px;background:none;color:#595959;border:0}.hint{color:#595959;margin:8px 0}.phase{font-size:15px;font-weight:600;margin:10px 0 2px;color:#0958d9}.progress{color:#8c8c8c;font-size:12px}nav{display:flex;gap:8px;margin-top:12px}button{font:inherit;cursor:pointer;border:1px solid #d9d9d9;border-radius:6px;background:white;padding:5px 9px;color:#262626}button.primary{background:#1677ff;border-color:#1677ff;color:white}button:disabled{cursor:default;opacity:.45}.compact{display:none}.panel.small .body{display:none}.panel.small{width:auto}button:focus-visible{outline:2px solid #1677ff;outline-offset:2px}</style><section class="panel" aria-label="卡疲扒拉银行登录引导"><header><span>卡疲扒拉 · 读取引导</span><button data-fold aria-label="收起或展开引导">收起</button></header><div class="body"><p class="hint">请直接在银行官网登录。密码、验证码只交给银行；卡疲扒拉不填写、不读取这些信息。</p><div class="phase" role="status" aria-live="polite" data-phase></div><div class="progress" data-progress></div><nav><button class="primary" data-read>读取本页</button><button data-wallet>回到钱包</button><button data-stop>停止</button></nav></div></section>`;
  document.documentElement.append(host);paint(config);
  root.querySelector('[data-fold]').onclick=e=>{const small=root.querySelector('section').classList.toggle('small');e.target.textContent=small?'展开':'收起';};
  root.querySelector('[data-read]').onclick=()=>readPage(true);
  root.querySelector('[data-wallet]').onclick=()=>command('guide-wallet').catch(()=>{});
  root.querySelector('[data-stop]').onclick=async()=>{stopWanted=true;stopWatching();if(!pending)await command('guide-stop').catch(()=>{});root.querySelector('[data-phase]').textContent='已停止本账户读取';root.querySelector('[data-read]').disabled=true;};
  // Only watch DOM readiness; never watch key presses or form values.
  observer=new MutationObserver(()=>{if(!pending&&!stopped&&!autoAttempted&&pageReady())void sync();});observer.observe(document.documentElement,{childList:true,subtree:true});
  timer=setInterval(sync,3000);void sync();
 }
 self.CardyGuide={mount,build:'new-user-2'};
})();
