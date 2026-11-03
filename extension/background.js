importScripts('reader.js');
const ORIGIN='http://127.0.0.1:8766';
const BANKS={
 'Amex US':{url:'https://www.americanexpress.com/en-us/account/login',hosts:['www.americanexpress.com','global.americanexpress.com'],region:/en-us|\/us\//i},
 'Amex HK':{url:'https://www.americanexpress.com/zh-hk/account/login',hosts:['www.americanexpress.com','global.americanexpress.com'],region:/zh-hk|en-hk|\/hk\//i},
 'Amex CA':{url:'https://www.americanexpress.com/en-ca/account/login',hosts:['www.americanexpress.com','global.americanexpress.com'],region:/en-ca|fr-ca|\/canada\//i},
 'Chase':{url:'https://secure.chase.com/web/auth/dashboard#/dashboard/overview',hosts:['secure.chase.com']},
 'BOA':{url:'https://secure.bankofamerica.com/myaccounts/brain/redirect.go',hosts:['secure.bankofamerica.com','www.bankofamerica.com']},
 'HSBC HK':{url:'https://www.hsbc.com.hk/',hosts:['www.hsbc.com.hk','www.ebanking.hsbc.com.hk','www.security.online-banking.hsbc.com.hk']},
 'SC HK':{url:'https://retail.sc.com/hk/nfs/login.htm',hosts:['retail.sc.com','www.sc.com']}
};
let running=false;
const bounded=(promise,ms=8000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Bank page timeout')),ms)})]).finally(()=>clearTimeout(timer))};
const send=async(tabId,payload)=>{try{await bounded(chrome.tabs.sendMessage(tabId,{channel:'cardybara-legacy-extension',...payload}))}catch{}};
async function read(tabId,bank,cards){
 try{
  // Both scripts execute in the isolated world; page JavaScript cannot call Chrome APIs.
  await bounded(chrome.scripting.executeScript({target:{tabId},files:['reader.js']}));
  const result=await bounded(chrome.scripting.executeScript({target:{tabId},func:(b,c)=>cardybaraReadBank(b,c),args:[bank,cards]}));
  return result[0]?.result||{status:'no_data',patches:[]};
 }catch{return {status:'no_data',patches:[]};}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function collect(bank,cards,sourceTab,requestId,cardId){
 const cfg=BANKS[bank];const all=await bounded(chrome.tabs.query({}));
 const tabs=all.filter(t=>{try{const u=new URL(t.url);return u.protocol==='https:'&&!/log.?off|log.?out|signoff|signout/i.test(u.pathname+u.search)&&cfg.hosts.includes(u.hostname)&&(!cfg.region||cfg.region.test(u.pathname+u.search+u.hash));}catch{return false}});
 const targets=tabs.slice(0,6);
 if(!targets.length)targets.push(await bounded(chrome.tabs.create({url:cfg.url,active:false})));
 else for(const tab of targets)await bounded(chrome.tabs.reload(tab.id)).catch(()=>{});
 let best={status:'no_data',patches:[]},merged=new Map();
 const deadline=Date.now()+25000;
 for(let attempt=0;attempt<12&&Date.now()<deadline;attempt++){
  await pause(1500);
  for(const tab of targets){
   if(Date.now()>deadline)break;
   const result=await read(tab.id,bank,cards);
   for(const p of result.patches||[])merged.set(p.id,p);
   if(result.status==='needs_confirmation'||result.status==='needs_login')best=result;
   else if(best.status==='no_data'||result.status==='updated')best=result;
  }
  if(merged.size===cards.length||['needs_confirmation','needs_login'].includes(best.status))break;
 }
 const result={...best,patches:[...merged.values()].filter(p=>!cardId||p.id===cardId),bank,tabId:targets[0].id,attemptedAt:new Date().toISOString()};
 if(!result.patches.length&&result.status==='updated')result.status='no_data';
 if(result.patches.length)result.status=result.patches.length===(cardId?1:cards.length)?'updated':'partial';
 await send(sourceTab,{type:'bank-result',requestId,result});
 return result;
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(!sender.tab||sender.url?.split('/').slice(0,3).join('/')!==ORIGIN)return;
 if(m.type==='hello'){reply({version:'1.0.0',running});return;}
 if(m.type==='focus-bank'&&Number.isInteger(m.tabId)){chrome.tabs.get(m.tabId).then(t=>{if(Object.values(BANKS).some(b=>b.hosts.includes(new URL(t.url).hostname)))chrome.tabs.update(t.id,{active:true})}).catch(()=>{});reply({ok:true});return;}
 if(m.type!=='refresh')return;
 if(running){reply({error:'已有刷新正在运行，请等待完成。'});return;}
 const banks=(m.banks||[]).filter(b=>Object.hasOwn(BANKS,b));
 const cards=(m.cards||[]).filter(c=>banks.includes(c.bank)&&/^[a-z0-9-]{1,64}$/i.test(c.id)&&/^\d{4,5}$/.test(c.tail)).map(({id,bank,tail,currency})=>({id,bank,tail,currency}));
 if(!banks.length||banks.length>7||cards.length>40){reply({error:'无效的刷新请求。'});return;}
 running=true;const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);reply({accepted:true});
 (async()=>{try{for(const bank of banks){await send(sender.tab.id,{type:'bank-start',requestId:m.requestId,bank});try{await collect(bank,cards.filter(c=>c.bank===bank),sender.tab.id,m.requestId,m.cardId);}catch{await send(sender.tab.id,{type:'bank-result',requestId:m.requestId,result:{bank,status:'interrupted',patches:[],attemptedAt:new Date().toISOString()}})}}}finally{clearInterval(keepAlive);running=false;await send(sender.tab.id,{type:'complete',requestId:m.requestId});}})();
});
