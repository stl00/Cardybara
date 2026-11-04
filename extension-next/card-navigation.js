// Exact, read-only account selector observed on the Amex dashboard.
// Never accepts model-generated selectors or clicks financial action controls.
export async function amexCards(action,tail){
 if(location.hostname!=='global.americanexpress.com'||!/^\/(?:dashboard|overview|rewards(?:\/summary)?|offers(?:\/(?:eligible|enrolled|redeemed))?)\/?$/.test(location.pathname))return [];
 const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const toggle=[...document.querySelectorAll('button[aria-label="open_title"],[role="combobox"][aria-label="Open to manage your other accounts"]')].find(visible);if(!toggle)return [];
 let existing=[...document.querySelectorAll('button[aria-label="rowLevelAriaLabel"],#simple-switcher-listbox [role="option"]')].filter(visible);
 if(action!=='close'&&!existing.length)toggle.click();
 const until=Date.now()+3000;let rows=[];
 while(Date.now()<until){rows=[...document.querySelectorAll('button[aria-label="rowLevelAriaLabel"],#simple-switcher-listbox [role="option"]')].filter(visible);if(rows.length||action==='close')break;await new Promise(r=>setTimeout(r,150));}
 const tails=rows.map(e=>(e.innerText||'').match(/[•*]{2,}\s*(\d{4,5})(?!\d)/)?.[1]).filter(Boolean);
 const close=()=>{if(toggle.getAttribute('role')==='combobox'&&toggle.getAttribute('aria-expanded')==='true'){toggle.click();return;}const e=[...document.querySelectorAll('button')].find(e=>visible(e)&&/^(關閉|关闭|Close)$/i.test((e.getAttribute('aria-label')||e.innerText).trim()));e?.click();};
 if(action==='close'){if(rows.length)close();return [];}
 if(action==='list'){close();return tails;}
 if(action==='discover'){
  const cards=rows.flatMap(e=>{const text=(e.innerText||'').trim();if(text.length>700||/(?:\d[ -]?){9,}/.test(text))return [];const tail=text.match(/[•*]{2,}\s*(\d{4,5})(?!\d)/)?.[1];const name=text.split('\n').map(s=>s.trim()).find(Boolean)||'';return tail?[{tail,name:name.slice(0,100)}]:[];});close();return cards;
 }
 if(action==='select'&&/^\d{4,5}$/.test(tail||'')){
  const matches=rows.filter(e=>new RegExp('[•*]{2,}\\s*'+tail+'(?!\\d)').test(e.innerText||''));
  if(matches.length===1){matches[0].click();return [tail];}
 }
 close();return [];
}
export function amexSavedOffers(){
 if(location.hostname!=='global.americanexpress.com'||!/^\/offers(?:\/|$)/.test(location.pathname))return false;
 const text=e=>(e.innerText||e.getAttribute('aria-label')||(e.id?document.querySelector('label[for="'+CSS.escape(e.id)+'"]')?.innerText:'')||'').trim();
 const tab=[...document.querySelectorAll('[role=radio],input[type=radio],[role=tab]')].find(e=>/^(?:已儲存至卡中|Added to Card|Registered to Card)(?:\s*\(\d+\))?$/i.test(text(e)));
 if(!tab||tab.getAttribute('aria-checked')==='true'||tab.getAttribute('aria-selected')==='true'||tab.checked||!tab.getClientRects().length)return false;
 tab.click();return true;
}
// Opens the observed HK account-view menu solely to discover its viewing URLs.
export function amexReadMenu(){
 if(location.hostname!=='global.americanexpress.com'||!/^\/(?:dashboard|overview|rewards|offers|activity|card-benefits)(?:\/|$)/.test(location.pathname))return [];
 const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const toggle=[...document.querySelectorAll('button')].find(e=>visible(e)&&e.innerText.trim()==='賬戶概況');if(!toggle)return [];
 const opened=toggle.getAttribute('aria-expanded')!=='true';if(opened)toggle.click();
 const links=[...document.querySelectorAll('main a[href]')].filter(visible).flatMap(a=>{const label=a.innerText.trim();try{const u=new URL(a.href,location.href);return u.origin===location.origin&&((label==='禮品換領'&&u.pathname==='/rewards')||(label==='賬項'&&u.pathname==='/activity'))?[{label,href:u.href}]:[];}catch{return [];}});
 if(opened)toggle.click();return links;
}
// HK read subpages may retain a previous account_key. Switch cards from the bank's own home URL.
export function amexAccountHome(){
 if(location.hostname!=='global.americanexpress.com')return null;
 const link=[...document.querySelectorAll('a[href]')].find(a=>a.getClientRects().length&&a.innerText.trim()==='首頁');
 try{const u=new URL(link?.href);return u.origin===location.origin&&/^\/(?:dashboard|overview)\/?$/.test(u.pathname)?u.href:null;}catch{return null;}
}
// Use the bank's own SPA link when it is visibly present instead of forcing a full reload.
export function amexClickReadLink(href){
 if(location.hostname!=='global.americanexpress.com')return false;
 const canonical=value=>{try{const u=new URL(value,location.href);for(const k of ['inav','linknav'])u.searchParams.delete(k);return u.href;}catch{return null;}};
 const target=new URL(href);if(target.origin!==location.origin||!/^\/(?:dashboard|overview|rewards(?:\/summary)?|activity(?:\/(?:recent|transactions|statement|statements))?)\/?$/.test(target.pathname)||target.hash)return false;
 const links=[...document.querySelectorAll('main a[href]')].filter(a=>a.getClientRects().length&&getComputedStyle(a).visibility!=='hidden'&&canonical(a.href)===canonical(href));
 if(!links.length)return false;links[0].click();return true;
}

// BOA accounts overview: card links sit in the group headed "Credit cards". Returns a detail link to open, never a payment control.
export async function boaCards(action,tail){
 if(location.hostname!=='secure.bankofamerica.com'||!/^\/accounts-home\/?$/.test(location.pathname))return [];
 if(action==='close')return [];
 const rowsNow=()=>{const group=[...document.querySelectorAll('[id^="account-card-container-"]')].find(g=>/^credit cards?$/i.test((g.querySelector('h3')?.innerText||'').trim()));return group?[...group.querySelectorAll('a[href]')].map(a=>({a,tail:(a.innerText||'').trim().match(/\s-\s(\d{4,5})$/)?.[1]})).filter(r=>r.tail):[];};
 // The overview renders after the document loads.
 const end=Date.now()+12000;let rows=rowsNow();while(!rows.length&&Date.now()<end){await new Promise(r=>setTimeout(r,200));rows=rowsNow();}
 if(action==='list')return [...new Set(rows.map(r=>r.tail))];
 if(action==='select'){const found=rows.filter(r=>r.tail===tail);return found.length===1?{href:found[0].a.href,tail}:[];}
 return [];
}
