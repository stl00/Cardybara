// The installed web app draws edge to edge only when the page asks for it (`viewport-fit=cover`); until then the
// browser insets it by itself. Ask only when standalone, so a normal tab is left as it was, and let style.css pad
// the safe-area insets. Does nothing without a document (tests, server rendering).
export function coverSafeArea(doc=globalThis.document,win=globalThis.window){
 try{
  const standalone=!!win?.matchMedia?.('(display-mode: standalone)').matches||win?.navigator?.standalone===true;
  const meta=doc?.querySelector?.('meta[name="viewport"]');
  if(!standalone||!meta)return false;
  const content=meta.getAttribute('content')||'';
  if(/viewport-fit\s*=/.test(content))return false;
  meta.setAttribute('content',`${content},viewport-fit=cover`);
  return true;
 }catch{return false;}
}
