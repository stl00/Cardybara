import {guidedPage} from './providers.js';
// The bank can render its SPA while slow auxiliary resources keep readyState loading.
// This only permits capture to start; card identity and evidence checks still run there.
export function renderedBankPage(){
 const main=document.querySelector('main');
 return {href:location.origin+location.pathname+location.hash,ready:document.readyState!=='loading'||!!main&&(main.innerText||'').trim().length>200};
}
export async function waitBankPage(bank,href,io){
 const target=new URL(href),deadline=io.now()+45000;
 while(io.now()<deadline){
  if(!await io.current())throw Error('cancelled');
  const tab=await io.getTab();if(!guidedPage(bank,tab.url))throw Error('navigation_changed');
  const rendered=await io.rendered();
  if(rendered&&typeof rendered==='object'){
   if(!guidedPage(bank,rendered.href))throw Error('navigation_changed');
   const actual=new URL(rendered.href);
   if(actual.origin===target.origin&&actual.pathname.replace(/\/$/,'')===target.pathname.replace(/\/$/,'')&&(bank!=='Chase'||actual.hash===target.hash)&&rendered.ready===true)return;
  }
  await io.pause(250);
 }
 throw Error('navigation_timeout');
}
