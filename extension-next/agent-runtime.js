import {capturePage} from './agent-snapshot.js';
import {MODELS,modelRequest,validateModel,mergeRecords,readLink} from './agent-core.js';
import {PROVIDERS,connectable,guidedPage} from './providers.js';
const KEY='cardybara-agent-v1',CONFIG='cardybara-agent-session';
export function createAgent({apply,changed}){
 let chain=Promise.resolve(),inFlight=null;
 const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
 const load=async()=>(await chrome.storage.local.get(KEY))[KEY]||{status:'idle',revision:0,items:[],approved:[],steps:0};
 const save=async s=>{s.revision++;await chrome.storage.local.set({[KEY]:s});return s;};
 const config=async()=>(await chrome.storage.session.get(CONFIG))[CONFIG];
 const view=async()=>{const s=await load(),c=await config();return {...s,configured:!!c?.key,provider:c?.provider||'deepseek',model:c?.model||MODELS.deepseek.model};};
 async function capture(bank,cards,tabId,previous=null){
  if(!PROVIDERS[bank]||!connectable(bank)||!Array.isArray(cards)||!cards.length||cards.some(c=>!c.id||c.bank!==bank||!/^\d{4,5}$/.test(c.tail)||c.currency!==PROVIDERS[bank].currency))throw Error('invalid_scope');
  const tab=await chrome.tabs.get(tabId);if(!guidedPage(bank,tab.url))throw Error('wrong_bank_page');
  const result=await chrome.scripting.executeScript({target:{tabId},func:capturePage,args:[bank,cards]});
  if(result.length!==1||!result[0].documentId)throw Error('document_changed');const raw=result[0].result;
  if(raw?.error)throw Error(raw.error);if(!raw?.blocks?.length)throw Error('no_financial_text');
  const now=await chrome.tabs.get(tabId);if(now.url!==tab.url)throw Error('document_changed');
  const u=new URL(tab.url);const links=[];
  for(const l of raw.links){const href=readLink(l.label,l.href,tab.url);if(href&&guidedPage(bank,href)&&!links.some(x=>x.href===href))links.push({id:'L'+(links.length+1),label:l.label,href});if(links.length>=12)break;}
  const snapshot={bank,region:PROVIDERS[bank].region,page:u.origin+u.pathname,aliases:raw.aliases,blocks:raw.blocks,links,capturedAt:raw.capturedAt};
  await save({status:'preview',revision:previous?.revision||0,id:crypto.randomUUID(),bank,cards,tabId,documentId:result[0].documentId,snapshot,items:[],rejected:[],steps:previous?.steps||0,visited:[...(previous?.visited||[]),snapshot.page],nextLinkId:null});return view();
 }
 async function documentCurrent(s){const tab=await chrome.tabs.get(s.tabId);if(!guidedPage(s.bank,tab.url))throw Error('document_changed');const r=await chrome.scripting.executeScript({target:{tabId:s.tabId,documentIds:[s.documentId]},func:()=>true});if(r.length!==1||r[0].documentId!==s.documentId)throw Error('document_changed');}
 return {
 recover:()=>serial(async()=>{await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});const s=await load();if(s.status==='running'){s.status='interrupted';return save(s);}}),
 invalidate:bank=>serial(async()=>{const s=await load();if(s.bank!==bank)return;if(inFlight?.id===s.id)inFlight.abort.abort();await chrome.storage.local.remove(KEY);}),
 handle:async m=>{
  if(m.type==='agent-state')return view();
  if(m.type==='agent-tabs'){const tabs=await chrome.tabs.query({});return {tabs:tabs.filter(tab=>guidedPage(m.bank,tab.url)).map(tab=>({id:tab.id,label:new URL(tab.url).origin+new URL(tab.url).pathname}))};}
  if(m.type==='agent-config')return serial(async()=>{if(!Object.hasOwn(MODELS,m.provider)||typeof m.key!=='string'||m.key.length<8||m.key.length>512||typeof m.model!=='string'||m.model.length>100||!/^[-a-zA-Z0-9._]+$/.test(m.model))throw Error('invalid_config');if(!await chrome.permissions.contains({origins:[MODELS[m.provider].origin+'/*']}))throw Error('model_permission_required');await chrome.storage.session.set({[CONFIG]:{provider:m.provider,model:m.model,key:m.key}});return view();});
  if(m.type==='agent-clear')return serial(async()=>{const s=await load();if(inFlight?.id===s.id)inFlight.abort.abort();await chrome.storage.local.remove(KEY);return view();});
  if(m.type==='agent-forget')return serial(async()=>{await chrome.storage.session.remove(CONFIG);return view();});
  if(m.type==='agent-preview')return serial(async()=>{const s=await load();if(s.status==='running')throw Error('agent_busy');return capture(m.bank,m.cards,m.tabId);});
  if(m.type==='agent-cancel')return serial(async()=>{const s=await load();if(inFlight?.id===s.id)inFlight.abort.abort();s.id=crypto.randomUUID();s.status='cancelled';s.items=[];await save(s);return view();});
  if(m.type==='agent-run'){
   const start=await serial(async()=>{const s=await load(),c=await config();if(!['preview','error'].includes(s.status)||s.id!==m.id||!c?.key)throw Error('preview_required');await documentCurrent(s);s.status='running';delete s.error;await save(s);return {s,c};});
   // Never hold the serialization lock across a network request. Cancel stays responsive.
   try{
    const req=modelRequest(start.c,start.s.snapshot),abort=new AbortController(),timer=setTimeout(()=>abort.abort(),24000);let body;inFlight={id:start.s.id,abort};
    try{const r=await fetch(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:abort.signal,credentials:'omit',redirect:'error'});if(!r.ok)throw Error(r.status===429?'model_rate_limited':r.status===401||r.status===403?'model_auth_failed':'model_unavailable');const text=await r.text();if(text.length>250000)throw Error('model_output_too_large');body=JSON.parse(text);}finally{clearTimeout(timer);if(inFlight?.id===start.s.id)inFlight=null;}
    const text=start.c.provider==='gemini'?body.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join(''):body.choices?.[0]?.message?.content;
    if(typeof text!=='string')throw Error('empty_model_output');
    const result=validateModel(JSON.parse(text),start.s.snapshot);
    return serial(async()=>{const s=await load();if(s.id!==start.s.id||s.status!=='running')return view();await documentCurrent(s);Object.assign(s,result,{status:'review',steps:s.steps+1});await save(s);return view();});
   }catch(error){return serial(async()=>{const s=await load();if(s.id!==start.s.id||s.status!=='running')return view();s.status='error';s.error=['model_rate_limited','model_auth_failed','model_unavailable','model_output_too_large','empty_model_output','invalid_model_output','document_changed'].includes(error.message)?error.message:error.name==='AbortError'?'model_timeout':'model_parse_failed';await save(s);return view();});}
  }
  if(m.type==='agent-apply')return serial(async()=>{const s=await load();if(s.status!=='review'||s.id!==m.id||!Array.isArray(m.indices)||new Set(m.indices).size!==m.indices.length||m.indices.some(i=>!Number.isInteger(i)||!s.items[i]))throw Error('review_required');await documentCurrent(s);await apply(s.items.filter((_,i)=>m.indices.includes(i)));s.status='saved';await save(s);await changed();return view();});
  if(m.type==='agent-next')return serial(async()=>{const s=await load();if(s.id!==m.id||!['review','saved'].includes(s.status)||s.steps>=5)throw Error('step_limit');const link=s.snapshot.links.find(l=>l.id===s.nextLinkId);if(!link||s.visited.includes(link.href.split('#')[0]))throw Error('no_next_page');await documentCurrent(s);await chrome.tabs.update(s.tabId,{url:link.href,active:true});s.status='navigating';s.nextHref=link.href;await save(s);return view();});
  if(m.type==='agent-continue')return serial(async()=>{const s=await load();if(s.status!=='navigating'||s.id!==m.id)throw Error('invalid_phase');const tab=await chrome.tabs.get(s.tabId);if(tab.status!=='complete')throw Error('page_loading');return capture(s.bank,s.cards,s.tabId,s);});
  throw Error('invalid_agent_action');
 }
 };
}
