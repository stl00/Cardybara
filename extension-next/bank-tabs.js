import {PROVIDERS,allowed,guidedPage} from './providers.js';
import {discoverVisibleCards} from './discovery.js';
// Each check gives up on a slow tab, so many open tabs can't use up the caller's time limit.
const within=(promise,ms=2500)=>Promise.race([promise,new Promise((_,no)=>setTimeout(()=>no(Error('timeout')),ms))]);
export async function chooseBankTab(bank,cards,tabs,scripting){
 const candidates=tabs.filter(t=>guidedPage(bank,t.url)),verified=[],discovered=[];
 for(const tab of candidates){
  try{const result=await within(scripting.executeScript({target:{tabId:tab.id},func:tails=>{if([...document.querySelectorAll('input[type=password]')].some(e=>e.getClientRects().length))return false;const roots=[document];for(let n=0;n<roots.length&&n<100;n++)for(const el of roots[n].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);const headings=roots.flatMap(root=>[...root.querySelectorAll('h1,h2,h3,button,[role=row]')].filter(e=>e.getClientRects().length).map(e=>e.innerText||'')).join('\n');return tails.some(t=>new RegExp('(?:^|[^0-9])'+t+'(?:[^0-9]|$)').test(headings));},args:[cards.map(c=>c.tail)]}));if(result[0]?.result===true){verified.push(tab);continue;}
  // Many banks list cards outside headings, as tiles, links or rows. What discovery accepts is a signed-in tab too, so it is used rather than replaced by a sign-in page or a reload.
  const found=await within(scripting.executeScript({target:{tabId:tab.id},func:discoverVisibleCards,args:[bank,PROVIDERS[bank].locales]}));const seen=found[0]?.result;if(seen?.status==='found'&&(!cards.length||seen.cards?.some(c=>cards.some(x=>x.tail===c.tail))))discovered.push(tab);}catch{}
 }
 // A tab the heading check accepts still wins, as before; discovery decides only when none does.
 const chosen=verified.length?verified:discovered;
 if(chosen.length>1)throw Error('ambiguous_tabs');if(chosen.length===1)return {...chosen[0],verified:true};
 const scoped=candidates.filter(t=>allowed(bank,t.url));if(scoped.length>1)throw Error('ambiguous_tabs');return scoped[0]||null;
}
