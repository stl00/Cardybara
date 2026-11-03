import {PROVIDERS} from './providers.js';

// Only masked account identities cross the page boundary. Never read input values.
// This function is serialized into the bank tab and must remain self-contained.
export function discoverVisibleCards(bank,locales){
 const NOT_A_CARD=/\b(?:checking|savings?|deposit|mortgage|loan|brokerage|investment|ira|cd)\b|支票|儲蓄|储蓄|存款|定期|按揭|貸款|贷款|投資|投资/i;
 const visible=e=>!!e?.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 if([...document.querySelectorAll('input[type=password]')].some(visible))return {status:'needs_login',cards:[]};
 const lang=(document.documentElement.lang||'').replaceAll('_','-').split('-').filter(p=>p.length!==4).join('-').toLowerCase();
 // Shared Amex hosts require an exact regional locale before creating identities.
 if(bank.startsWith('Amex ')&&!locales.some(l=>l.toLowerCase()===lang))return {status:'ambiguous',cards:[]};
 const chaseGroup=bank==='Chase'&&!!document.getElementById?.('CARD_ACCOUNTS');
 const selectors=bank==='Chase'?(chaseGroup?'#CARD_ACCOUNTS [id^="accounts-name-link-button-"]':'[id^="accounts-name-link-button-"]'):bank.startsWith('Amex ')?'h1,h2,h3,button[aria-label="rowLevelAriaLabel"],#simple-switcher-listbox [role="option"]':bank==='HSBC HK'?'#account-summary-name,.account-detail-row,[role="option"],h1,h2,h3':'h1,h2,h3,[role="row"],article,[data-account-type="credit-card"]';
 const roots=[document];for(let i=0;i<roots.length&&i<100;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
 const cards=[];
 for(const el of roots.flatMap(r=>[...r.querySelectorAll(selectors)]).filter(visible)){
  const text=(el.innerText||'').trim();if(!text||text.length>700)continue;
  // Reject full account/card numbers before producing any text outside the tab.
  if(/(?:\d[ -]?){9,}/.test(text))continue;
  const matches=[...text.matchAll(/(?:[•●*xX]{2,}\s*|\.{3}\s*|ending\s+(?:in\s+)?|尾號\s*|尾号\s*)(\d{4,5})(?!\d)/gi)];
  if(matches.length!==1)continue;
  // Product names are data. Only account types that are not cards are skipped.
  if(!chaseGroup&&!bank.startsWith('Amex ')&&NOT_A_CARD.test(text))continue;
  const name=text.split('\n').map(s=>s.trim()).find(s=>s&&!/(?:\d[ -]?){9,}/.test(s))||'';
  cards.push({tail:matches[0][1],name:name.slice(0,100)});
 }
 return {status:cards.length?'found':'no_data',cards};
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
