import {PROVIDERS} from './providers.js';

// Only masked account identities cross the page boundary. Never read input values.
// This function is serialized into the bank tab and must remain self-contained.
export function discoverVisibleCards(bank,locales){
 const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 if([...document.querySelectorAll('input[type=password]')].some(visible))return {status:'needs_login',cards:[]};
 const lang=(document.documentElement.lang||'').replaceAll('_','-').split('-').filter(p=>p.length!==4).join('-').toLowerCase();
 // Shared Amex hosts require an exact regional locale before creating identities.
 if(bank.startsWith('Amex ')&&!locales.some(l=>l.toLowerCase()===lang))return {status:'ambiguous',cards:[]};
 // structural: generic account vocabulary, not product names. A card word settles only the weak words: a name may
 // contain "Banking" or "From", but no card word turns a debit card or a phone number into a credit card.
 const ACCOUNT_LINE=/(?:[•●*xX]{2,}\s*|\.{3}\s*|ending\s+(?:in\s+)?|尾號\s*|尾号\s*)\d{4,5}(?!\d)/i,A_CARD=/\bcard\b|\bvisa\b|\bmastercard\b|\bamerican express\b|信用卡/i;
 const NEVER_A_CARD=/\b(?:debit|mortgage|loan|line of credit|home equity|credit union)\b|按揭|貸款|贷款|扣賬|扣账/i,NOT_AN_ACCOUNT=/\b(?:sent|code|phone|mobile|email|e-mail|statement|payment|transfer|autopay|learn|more|date|period|number)\b|驗證碼|验证码|電話|电话|電郵|电邮|月結單|月结单|付款|轉賬|转账/i;
 const LIKELY_NOT_A_CARD=/\b(?:checking|savings?|deposit|brokerage|investment|ira|cd|money market|current account|integrated account|banking|we|you|your|from)\b|支票|儲蓄|储蓄|存款|定期|投資|投资|往來|往来|基金|綜合|综合/i;
 const skipped=new Set();
 const chaseGroup=bank==='Chase'&&!!document.getElementById?.('CARD_ACCOUNTS');
 const selectors=bank==='Chase'?(chaseGroup?'#CARD_ACCOUNTS [id^="accounts-name-link-button-"]':'[id^="accounts-name-link-button-"]'):bank.startsWith('Amex ')?'h1,h2,h3,button[aria-label="rowLevelAriaLabel"],#simple-switcher-listbox [role="option"]':bank==='HSBC HK'?'#account-summary-name,.account-detail-row,[role="option"],h1,h2,h3':'h1,h2,h3,[role="row"],article,[data-account-type="credit-card"]';
 // SC HK's details page prints the full card number. Only its last four digits leave this function.
 if(bank==='SC HK'&&typeof location!=='undefined'&&/\/card_details\.htm$/.test(location.pathname)){const cell=label=>{for(const r of document.querySelectorAll('tr')){const c=[...r.cells],i=c.findIndex(x=>(x.innerText||'').trim()===label);if(i>=0&&c[i+1])return (c[i+1].innerText||'').trim();}return '';};const digits=(cell('Card Number:').match(/\d(?:[\d\s.\u2013-]*\d){7,}/)?.[0]||'').replace(/\D/g,''),name=cell('Card Type:').replace(/^Credit Card Account\s+/i,'').replace(/\d/g,'').trim().slice(0,100);return digits.length>=12?{status:'found',cards:[{tail:digits.slice(-4),name}]}:{status:'no_data',cards:[]};}
 // Citi lists each card's account details link as "Name-tail". Other accounts link elsewhere.
 const citiLinks=bank==='Citi US'?[...document.querySelectorAll('a[href*="accountdetails"]')].filter(a=>/\/accountdetails(?:\?|$)/.test(a.href||'')):[];
 if(citiLinks.length){const cards=citiLinks.flatMap(a=>{const text=(a.innerText||a.textContent||'').trim(),tail=text.match(/-\s*(\d{4,5})$/)?.[1];return tail&&text.length<=120&&!NEVER_A_CARD.test(text)&&!/(?:\d[ -]?){9,}/.test(text)?[{tail,name:text.replace(/\s*-\s*\d{4,5}$/,'').slice(0,100)}]:[];});return {status:cards.length?'found':'no_data',cards};}
 // BOA lists cards as links under the group headed "Credit cards", separate from deposit accounts.
 const boaGroup=bank==='BOA'?[...document.querySelectorAll('[id^="account-card-container-"]')].find(g=>/^credit cards?$/i.test((g.querySelector?.('h3')?.innerText||'').trim())):null;
 if(boaGroup){const cards=[...boaGroup.querySelectorAll('a')].filter(a=>visible(a)&&/\/myaccounts\/brain\/redirect\.go\?(?:.*&)?target=acctDetails(?:&|$)/.test(a.href||'')).flatMap(a=>{const text=(a.innerText||'').trim(),tail=text.match(/\s-\s(\d{4,5})$/)?.[1];return tail&&text.length<=120&&!/(?:\d[ -]?){9,}/.test(text)?[{tail,name:text.replace(/\s-\s\d{4,5}$/,'').slice(0,100)}]:[];});return {status:cards.length?'found':'no_data',cards};}
 const roots=[document];for(let i=0;i<roots.length&&i<100;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
 const cards=[];
 for(const el of roots.flatMap(r=>[...r.querySelectorAll(selectors)]).filter(visible)){
  const text=(el.innerText||'').trim();if(!text||text.length>700)continue;
  // Reject full account/card numbers before producing any text outside the tab.
  if(/(?:\d[ -]?){9,}/.test(text))continue;
  const matches=[...text.matchAll(/(?:[•●*xX]{2,}\s*|\.{3}\s*|ending\s+(?:in\s+)?|尾號\s*|尾号\s*)(\d{4,5})(?!\d)/gi)];
  if(matches.length!==1)continue;
  // Product names are data. Outside a bank's card group, the account's name line and masked line decide; other words in the row do not.
  if(!chaseGroup&&!bank.startsWith('Amex ')){
   const rows=text.split('\n').map(s=>s.trim()).filter(Boolean),own=rows.find(s=>ACCOUNT_LINE.test(s))||'',identity=[rows[0],own].join('\n');
   if(!own||own.length>90||NEVER_A_CARD.test(identity)||NOT_AN_ACCOUNT.test(own)||(LIKELY_NOT_A_CARD.test(identity)&&!A_CARD.test(identity))){skipped.add(text);continue;}
  }
  const name=text.split('\n').map(s=>s.trim()).find(s=>s&&!/(?:\d[ -]?){9,}/.test(s))||'';
  cards.push({tail:matches[0][1],name:name.slice(0,100)});
 }
 return {status:cards.length?'found':'no_data',cards,...(skipped.size?{skipped:skipped.size}:{})};
}

export function normalizeDiscoveredCards(bank,rows){
 const p=PROVIDERS[bank];if(!p||!Array.isArray(rows)||rows.length>40)throw Error('invalid_discovery');
 const result=new Map();
 for(const row of rows){
  if(!row||Object.keys(row).some(k=>!['tail','name'].includes(k))||typeof row.tail!=='string'||!/^\d{4,5}$/.test(row.tail)||typeof row.name!=='string'||row.name.length>100||/[<>\u0000-\u001f]/.test(row.name)||/(?:\d[ -]?){9,}/.test(row.name))continue;
  const id=`discovered-${bank.toLowerCase().replaceAll(' ','-')}-${row.tail}`;
  result.set(row.tail,{id,bank,region:p.region,currency:p.currency,tail:row.tail,name:row.name||`${p.issuer} •••• ${row.tail}`,identitySource:'bank-page'});
 }
 return [...result.values()];
}
