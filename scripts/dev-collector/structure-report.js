// Dev-only. Injected into a bank tab to describe its structure so an unseen page can be fixed, without
// real values. Fails closed: any word outside this generic vocabulary is replaced, so names, products
// and tails cannot pass through. Input values are never read. Must stay self-contained for injection.
export function redactStructureText(text){
 const words=new Set('a about account accounts activity amount amounts and annual apr autopay automatic available back balance balances benefits by card cards cash charges closing credit current cycle date days debit details do does don\'t due earned end ending for from have in interest last limit made make manage minimum miles month new next no not now of offers on off outstanding overview paid past pay payment payments pending period points previous program recent redeem remaining rewards right scheduled sign statement statements summary the this to total transactions unpaid view you your'.split(' '));
 const phrases=['現時結欠','现时结欠','目前結欠','目前结欠','月結單結欠','月结单结欠','賬單結欠','账单结欠','總結欠','总结欠','最低還款額','最低还款额','最低還款','最低还款','最低付款額','可用信貸額','可用信贷额','可用額度','可用额度','信用額度','信用额度','還款到期日','还款到期日','繳款到期日','缴款到期日','到期日','積分','积分','獎賞','奖赏','里數','里数','回贈','回赠','暫時毋須付款','暂时毋须付款','自動轉賬','自动转账','信用卡','賬戶','账户','交易','結單','结单','尾號','尾号'];
 const out=String(text).replace(/\s+/g,' ').trim().slice(0,120);
 if(!out)return '';
 return out.split(' ').map(token=>{
  if(/\d/.test(token))return token.replace(/\d/g,'#').replace(/[A-Za-z\u0080-￿]+/g,m=>/^(?:hk|ca|us|cn|hkd|usd|cad|cny|rmb|cr|dr|¥|\$)$/i.test(m)?m:'[x]');
  const bare=token.replace(/^[^\p{L}]+|[^\p{L}'’]+$/gu,'');
  if(!bare)return token;
  if(words.has(bare.toLowerCase().replace('’',"'")))return token;
  if(/[㐀-鿿]/.test(bare)){let rest=bare,kept='';for(const p of phrases)if(rest.includes(p)){kept=rest.split(p).map(x=>x?'[字]':'').join(p);rest='';break;}return rest?'[字]':kept;}
  return '[word]';
 }).join(' ');
}
export function structureReport(redactSource){
 const redact=(0,eval)('('+redactSource+')');
 const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const maskId=v=>String(v||'').replace(/\d+/g,'#').slice(0,80);
 const roots=[document];for(let i=0;i<roots.length&&i<250;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
 const rows=[];
 for(const [depthRoot,root]of roots.entries())for(const e of root.querySelectorAll('*')){
  if(rows.length>=1500)break;if(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','PATH'].includes(e.tagName.toUpperCase())||!visible(e))continue;
  if(['INPUT','TEXTAREA','SELECT'].includes(e.tagName)){rows.push({tag:e.tagName.toLowerCase(),type:e.type||'',id:maskId(e.id)});continue;}
  const own=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim(),aria=e.getAttribute('aria-label')||'',role=e.getAttribute('role')||'';
  if(!own&&!aria&&!e.id&&!role)continue;
  rows.push({tag:e.tagName.toLowerCase(),...(role?{role}:{}),...(e.id?{id:maskId(e.id)}:{}),...(aria?{aria:redact(aria)}:{}),...(own?{text:redact(own)}:{}),...(depthRoot?{shadow:true}:{})});
 }
 return {schema:1,host:location.hostname,path:location.pathname.replace(/\d+/g,'#').replace(/[a-f0-9-]{16,}/gi,'#'),hashShape:location.hash.replace(/\d+/g,'#').replace(/\?.*$/,'').slice(0,80),lang:document.documentElement.lang||'',title:redact(document.title),rows};
}
