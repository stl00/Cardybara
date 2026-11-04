// The wallet follows the system setting; there is no separate preference to store.
const QUERY='(prefers-color-scheme: dark)';
const media=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'?window.matchMedia(QUERY):null;
export function systemPrefersDark(){return media()?.matches===true}
export function subscribeSystemDark(listener){
 const query=media();if(!query)return ()=>{};
 query.addEventListener('change',listener);
 return ()=>query.removeEventListener('change',listener);
}
