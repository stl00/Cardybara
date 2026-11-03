// Viewing controls observed in Chase's own UI; never invokes Pay/Add/Activate.
export async function chaseCards(action,tail,cards=[]){
 if(location.hostname!=='secure.chase.com'||location.pathname!=='/web/auth/dashboard')return [];
 if(action==='close')return [];
 const overview=()=>/^#\/dashboard\/overview(?:[/?]|$)/.test(location.hash),registered=new Set(cards.filter(c=>c.bank==='Chase').map(c=>c.tail));
 const rows=()=>[...document.querySelectorAll('[id^="accounts-name-link-button-"]')].map(e=>({e,tail:(e.innerText||e.textContent||'').match(/\(\.\.\.(\d{4})\)/)?.[1]})).filter(r=>registered.has(r.tail));
 if(action==='list')return overview()?[...new Set(rows().map(r=>r.tail))]:[];
 if(action!=='select'||!registered.has(tail))return [];
 const buttonDeadline=Date.now()+12000;let found=[];
 while(Date.now()<buttonDeadline){if(overview())found=rows().filter(r=>r.tail===tail&&r.e.getClientRects().length);if(found.length===1)break;await new Promise(r=>setTimeout(r,100));}
 if(found.length!==1)return {error:'chase_account_button_timeout'};found[0].e.click();
 // Rendering a detail gets its own bounded budget after the bank handles its SPA click.
 const detailDeadline=Date.now()+25000;
 // A hash update does not mean the old card's financial body has been replaced.
 while(Date.now()<detailDeadline){
  if(location.hostname!=='secure.chase.com'||location.pathname!=='/web/auth/dashboard')return {error:'chase_navigation_changed'};
  const roots=[document];for(let i=0;i<roots.length&&i<250;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
  const titles=roots.flatMap(r=>[...r.querySelectorAll('h1,[role="heading"][aria-level="1"]')]).filter(e=>e.getClientRects().length).map(e=>(e.innerText||e.textContent||'').trim());
  if(/\/summary\//.test(location.hash)&&titles.some(t=>new RegExp('\\.\\.\\.'+tail+'(?![0-9])').test(t)))return [tail];
  await new Promise(r=>setTimeout(r,100));
 }
 return {error:'chase_detail_timeout'};
}
export async function chaseOpenSection(section,tail){
 if(location.hostname!=='secure.chase.com'||location.pathname!=='/web/auth/dashboard'||!/^\d{4}$/.test(tail||''))return false;
 const roots=()=>{const a=[document];for(let i=0;i<a.length&&i<250;i++)for(const e of a[i].querySelectorAll('*'))if(e.shadowRoot)a.push(e.shadowRoot);return a;},q=s=>roots().flatMap(r=>[...r.querySelectorAll(s)]),text=e=>(e.getAttribute('aria-label')||e.innerText||e.textContent||'').trim(),visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const until=async fn=>{const end=Date.now()+4000;while(Date.now()<end){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,100));}return null;};
 if(section==='offers'){
  if(!/\/summary\//.test(location.hash))return false;
  const title=q('h1,[role="heading"][aria-level="1"]').map(text).join('\n');if(!new RegExp('\\.\\.\\.'+tail).test(title))return false;
  const links=q('a,[role="link"]').filter(e=>visible(e)&&/^Chase Offers\b/.test(text(e)));if(!links.length)return false;links[0].click();return true;
 }
 if(section==='benefits'){
  const menu=q('button,[role="button"]').find(e=>visible(e)&&text(e)==='Benefits & travel');if(!menu)return false;
  if(menu.getAttribute('aria-expanded')!=='true')menu.click();const link=await until(()=>q('a,[role="link"]').find(e=>visible(e)&&text(e)==='Benefits'));if(!link)return false;link.click();
  const choice=await until(()=>{const links=q('a,[role="link"]').filter(e=>visible(e)&&new RegExp('\\(\\.\\.\\.'+tail+'\\)$').test(text(e)));return links.length===1?links[0]:null;});if(!choice)return false;choice.click();return true;
 }
 return false;
}
