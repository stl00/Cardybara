import {allowed,guidedPage} from './providers.js';
export async function chooseBankTab(bank,cards,tabs,scripting){
 const candidates=tabs.filter(t=>guidedPage(bank,t.url)),verified=[];
 for(const tab of candidates){
  try{const result=await scripting.executeScript({target:{tabId:tab.id},func:tails=>{if([...document.querySelectorAll('input[type=password]')].some(e=>e.getClientRects().length))return false;const roots=[document];for(let n=0;n<roots.length&&n<100;n++)for(const el of roots[n].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);const headings=roots.flatMap(root=>[...root.querySelectorAll('h1,h2,h3,button,[role=row]')].filter(e=>e.getClientRects().length).map(e=>e.innerText||'')).join('\n');return tails.some(t=>new RegExp('(?:^|[^0-9])'+t+'(?:[^0-9]|$)').test(headings));},args:[cards.map(c=>c.tail)]});if(result[0]?.result===true)verified.push(tab);}catch{}
 }
 if(verified.length>1)throw Error('ambiguous_tabs');if(verified.length===1)return {...verified[0],verified:true};
 const scoped=candidates.filter(t=>allowed(bank,t.url));if(scoped.length>1)throw Error('ambiguous_tabs');return scoped[0]||null;
}
