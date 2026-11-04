import {amexClickReadLink,amexCards} from './card-navigation.js';
import {discoverVisibleCards} from './discovery.js';
import {BUILD_ID} from './build-info.js';
import {waitBankPage,renderedBankPage} from './bank-page-wait.js';
import {chooseBankTab} from './bank-tabs.js';
import {enrichBank,parserStatus,PARSER_SETTINGS} from './parser-client.js';
import {createAgent} from './agent-runtime.js';
import {Engine,STATE_KEY} from './engine.js';
import {ORIGIN,PROVIDERS,VERSION,allowed,guidedPage} from './providers.js';
import {trusted,request} from './protocol.js';
const engine=new Engine({load:async()=>(await chrome.storage.local.get(STATE_KEY))[STATE_KEY],save:s=>chrome.storage.local.set({[STATE_KEY]:s}),uuid:()=>crypto.randomUUID(),now:()=>Date.now()});
const agent=createAgent({apply:items=>engine.approve(items),changed:async()=>notify(await engine.load())});
const ownPage=sender=>sender.id===chrome.runtime.id&&sender.url?.split('#')[0]===chrome.runtime.getURL('index.html');
const walletUrl=()=>chrome.runtime.getURL('index.html');
const isWallet=url=>{try{return new URL(url).origin===ORIGIN||url.split('#')[0]===walletUrl();}catch{return false;}};
const ready=(async()=>{await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await agent.recover();return engine.recover();})();
const bounded=(promise,ms=8000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation_timeout')),ms)})]).finally(()=>clearTimeout(timer));};
function publicState(s){return {schema:2,runtimeBuild:BUILD_ID,revision:s.revision,discoveredCards:s.discoveredCards||[],run:s.run?{id:s.run.id,status:s.run.status,jobs:s.run.jobs.map(({bank,status,received,finishedAt,phase,sections,pages,rejected,rejectReasons,tabId,diagnostic,readError})=>({bank,status,received,finishedAt,phase,sections,pages,rejected,rejectReasons,tabId,diagnostic,readError}))}:null,records:s.records,disabled:s.disabled,lastBankJobs:s.lastBankJobs||{},agentRecords:s.agentRecords||[]};}
async function exposedState(s){const d=await chrome.storage.local.get('cardybara:last-capture-error');return {...publicState(s),lastCaptureError:d['cardybara:last-capture-error']||null};}
async function notify(s){if(s?.run)try{const tab=await bounded(chrome.tabs.get(s.run.owner),2000);if(isWallet(tab.url)){const m={channel:'cardybara-extension',type:'state',version:VERSION,state:await exposedState(s)};await bounded(tab.url.split('#')[0]===walletUrl()?chrome.runtime.sendMessage(m):chrome.tabs.sendMessage(tab.id,m),2000);}}catch{}}
async function publish(s){if(s){await notify(s);for(const j of s.run?.jobs||[])if(j.tabId!=null)void showGuide({...j,runId:s.run.id});void next();}}
async function next(){
 await ready;const ctx=await engine.claim();if(!ctx)return;
 try{
  await chrome.alarms.create('cardybara:'+ctx.attemptId,{when:ctx.deadline});
  const tabs=await bounded(chrome.tabs.query({})),existing=await bounded(chooseBankTab(ctx.bank,ctx.cards,tabs,chrome.scripting));
  const owned=!existing,tab=existing||await bounded(chrome.tabs.create({url:PROVIDERS[ctx.bank].url,active:false}));
  // Bank SPAs may suspend loading in background tabs. Activate before reload.
  await bounded(chrome.tabs.update(tab.id,{active:true}));
  const s=await engine.bind(ctx,tab.id,owned);if(!s)return;
  await notify(s);await showGuide({...s.run.jobs.find(j=>j.attemptId===ctx.attemptId),runId:s.run.id});if(existing?.verified){if(ctx.bank.startsWith('Amex ')&&!/^\/(dashboard|overview)(?:\/|$)/.test(new URL(tab.url).pathname)){await engine.loading({...ctx,...s.run.jobs.find(j=>j.attemptId===ctx.attemptId)});await bounded(chrome.tabs.update(tab.id,{url:'https://global.americanexpress.com/dashboard',active:true}));}else{await engine.loading({...ctx,...s.run.jobs.find(j=>j.attemptId===ctx.attemptId)});void loaded(tab.id,tab.url);}}else await bounded(chrome.tabs.reload(tab.id));
 }catch{await publish(await engine.fail(ctx,'load_error',{stage:'open_bank',code:'bank_tab_unavailable'}));}
}
async function active(tabId){const s=await engine.load(),j=s.run?.jobs.find(j=>j.tabId===tabId&&['navigating','capturing'].includes(j.status));return s.run?.status==='running'&&j?{...j,generation:s.run.generation,runId:s.run.id}:null;}
const readPageTried=new Set();
async function loaded(tabId,url){
 let stage='prepare';
 await ready;let ctx=await active(tabId);if(!ctx||ctx.status!=='navigating')return;
 if(!guidedPage(ctx.bank,url)){await publish(await engine.fail(ctx,'navigation_changed'));return;}
 // Once per run for a bank, since a retry starts a new attempt: a server sending the details page back must not become a loop.
 const readPage=PROVIDERS[ctx.bank].readPage;if(readPage?.from.test(new URL(url).pathname)&&!readPageTried.has(ctx.runId+'|'+ctx.bank)){readPageTried.add(ctx.runId+'|'+ctx.bank);try{await bounded(chrome.tabs.update(tabId,{url:readPage.url,active:true}));}catch{await publish(await engine.fail(ctx,'load_error',{stage:'open_bank',code:'bank_tab_unavailable'}));}return;}
 try{
  const s=await engine.capture(ctx);if(!s)return;ctx={...ctx,...s.run.jobs.find(j=>j.attemptId===ctx.attemptId)};
  await notify(s);stage='inject_reader';const injection=await bounded(chrome.scripting.executeScript({target:{tabId},files:['reader.js']}));
  const doc=injection[0]?.documentId;if(!doc)throw Error('missing_document');
  stage='discover_cards';
  const identities=await bounded(chrome.scripting.executeScript({target:{tabId,documentIds:[doc]},func:discoverVisibleCards,args:[ctx.bank,PROVIDERS[ctx.bank].locales]}));
  const discovery=identities[0]?.result;
  if(identities[0]?.documentId===doc&&discovery?.status==='found'){
   if(ctx.bank.startsWith('Amex ')){
    const menu=await bounded(chrome.scripting.executeScript({target:{tabId,documentIds:[doc]},func:amexCards,args:['discover']}),5000).catch(()=>[]);
    if(menu[0]?.documentId===doc&&Array.isArray(menu[0]?.result))discovery.cards.push(...menu[0].result);
   }
   const discovered=await engine.discover(ctx,discovery.cards);if(!discovered)return;
   ctx={...ctx,...discovered.run.jobs.find(j=>j.attemptId===ctx.attemptId)};await notify(discovered);
  }
  stage='read_page';const results=await bounded(chrome.scripting.executeScript({target:{tabId,documentIds:[doc]},func:async(bank,cards,locales)=>self.CardyReader.observe(bank,cards,locales),args:[ctx.bank,ctx.cards,PROVIDERS[ctx.bank].locales]}),15000);
  if(results.length!==1||results[0].documentId!==doc)throw Error('document_changed');
  const current=await bounded(chrome.tabs.get(tabId));if(!guidedPage(ctx.bank,current.url))throw Error('navigation_changed');
  const diag=await bounded(chrome.scripting.executeScript({target:{tabId,documentIds:[doc]},func:()=>self.CardyReader?.lastDiagnostic||null}));if(diag[0]?.result)await chrome.storage.local.set({'cardybara:last-read-diagnostic':{bank:ctx.bank,...diag[0].result}});
  stage='validate_result';const checkpoint=await engine.checkpointRead(ctx,results[0].result);if(!checkpoint)return;await notify(checkpoint);let enrichment=null;
  if(!['needs_login','needs_confirmation','ambiguous'].includes(results[0].result.status)){
   enrichment=await enrichBank({...ctx,initialPatches:results[0].result.patches||[]},{
    current:()=>engine.current(ctx),
    progress:async(phase,sections)=>{const state=await engine.progress(ctx,phase,sections);if(state){await chrome.alarms.create('cardybara:'+ctx.attemptId,{when:state.run.jobs.find(j=>j.attemptId===ctx.attemptId).deadline});await notify(state);}},
    checkpoint:async(items,sections)=>{const state=await engine.checkpoint(ctx,items,sections);if(state)await notify(state);},
    navigate:async href=>{let clicked=false;if(ctx.bank==='Amex HK'){const action=await bounded(chrome.scripting.executeScript({target:{tabId},func:amexClickReadLink,args:[href]})).catch(()=>[]);clicked=action[0]?.result===true;}if(!clicked)await bounded(chrome.tabs.update(tabId,{url:href,active:true}));await waitBankPage(ctx.bank,href,{now:()=>Date.now(),current:()=>engine.current(ctx),getTab:()=>bounded(chrome.tabs.get(tabId)),rendered:async()=>{const ready=await bounded(chrome.scripting.executeScript({target:{tabId},func:renderedBankPage}),2000).catch(()=>[]);return ready[0]?.result||null;},pause:ms=>new Promise(resolve=>setTimeout(resolve,ms))});}
   });
   if(enrichment.scope!=='mvp'&&results[0].result.patches?.length)enrichment.sections.card={status:'updated',count:new Set([...results[0].result.patches.map(p=>p.id),...enrichment.items.filter(i=>i.kind==='card').map(i=>i.cardId)]).size};
  }
  await publish(await engine.finish(ctx,results[0].result,enrichment));
  await chrome.storage.local.remove('cardybara:last-capture-error');
 }catch(error){const known=['invalid_result','invalid_fields','invalid_amount','document_changed','missing_document','navigation_changed','operation_timeout','invalid_agent_scope','agent_storage_limit'];const code=known.find(k=>error?.message===k)||(String(error?.message).includes('CardyReader')?'missing_reader':'reader_exception');await chrome.storage.local.set({'cardybara:last-capture-error':{bank:ctx.bank,stage,code,name:['TypeError','ReferenceError','SyntaxError'].includes(error?.name)?error.name:'Error',at:new Date().toISOString()}});await publish(await engine.fail(ctx,'load_error',{stage,code}));}
}
function guideView(s,j){return {bank:j.bank,status:j.status,received:j.received||0,attemptId:j.attemptId,runId:s.run.id,phase:j.phase,sections:j.sections};}
async function showGuide(ctx){
 try{if(['cancelled','interrupted','cleared','disconnected','tab_closed'].includes(ctx.status))return;const tab=await bounded(chrome.tabs.get(ctx.tabId));if(!guidedPage(ctx.bank,tab.url))return;
  const injected=await bounded(chrome.scripting.executeScript({target:{tabId:ctx.tabId},files:['guide.js']}));const documentId=injected[0]?.documentId;if(!documentId)return;
  await bounded(chrome.scripting.executeScript({target:{tabId:ctx.tabId,documentIds:[documentId]},func:config=>self.CardyGuide.mount(config),args:[{bank:ctx.bank,status:ctx.status,received:ctx.received||0,phase:ctx.phase,sections:ctx.sections,runId:ctx.runId,attemptId:ctx.attemptId,tails:ctx.cards.map(c=>c.tail),expiresAt:ctx.guideExpiresAt||Date.now()+900000}]}));
 }catch{}
}
async function guideCommand(raw,sender){
 if(sender.id!==chrome.runtime.id||sender.frameId!==0||!Number.isInteger(sender.tab?.id)||!raw||Object.keys(raw).some(k=>!['type','requestId','runId','attemptId'].includes(k))||![raw.requestId,raw.runId,raw.attemptId].every(v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(v)))throw Error('guide_request');
 const old=await engine.load(),job=old.run?.jobs.find(j=>j.attemptId===raw.attemptId);
 if(!job||old.run.id!==raw.runId||job.tabId!==sender.tab.id||!guidedPage(job.bank,sender.url))throw Error('guide_scope');
 if(raw.type==='guide-wallet'){const owner=await bounded(chrome.tabs.get(old.run.owner)).catch(()=>null);if(owner&&isWallet(owner.url))await chrome.tabs.update(owner.id,{active:true});else await chrome.tabs.create({url:walletUrl()+'#connections',active:true});return {ok:true,guide:guideView(old,job)};}
 const action=raw.type==='guide-read'?'read':raw.type==='guide-stop'?'stop':'state';
 const state=await engine.guide(raw,sender.tab.id,action),j=state.run.jobs.find(j=>j.bank===job.bank);
 if(action==='read'){await chrome.alarms.create('cardybara:'+j.attemptId,{when:j.deadline});void notify(state);void loaded(j.tabId,sender.url);}
 if(action==='stop')void publish(state);
 return {ok:true,guide:guideView(state,j)};
}
let tabEvents=Promise.resolve();
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{tabEvents=tabEvents.then(async()=>{await ready;const currentState=await engine.load(),guideJob=currentState.run?.jobs.find(j=>j.tabId===tabId);if(guideJob&&['loading','complete'].includes(change.status))void showGuide({...guideJob,runId:currentState.run.id});const ctx=await active(tabId);if(!ctx)return;if(change.url&&!guidedPage(ctx.bank,change.url)){await publish(await engine.fail(ctx,'navigation_changed'));return;}// An allowed bank SPA may load again or change its hash after initial complete.
// Restart its document generation within the existing deadline; reject old results/errors.
if(ctx.enriching)return;
if(change.status==='loading'){const state=await engine.loading(ctx);if(state){const current=await bounded(chrome.tabs.get(tabId));if(current.status==='complete')void loaded(tabId,current.url);}return;}if(change.status==='complete'&&ctx.loadStarted)void loaded(tabId,tab.url);}).catch(()=>{});});
chrome.tabs.onRemoved.addListener(tabId=>{void(async()=>{await ready;const ctx=await active(tabId);if(ctx)await publish(await engine.fail(ctx,'tab_closed'));})().catch(()=>{});});
chrome.alarms.onAlarm.addListener(alarm=>{if(!alarm.name.startsWith('cardybara:'))return;void(async()=>{await ready;const s=await engine.load(),j=s.run?.jobs.find(j=>j.attemptId===alarm.name.slice(10));if(j&&s.run.status==='running')await publish(await engine.fail({...j,generation:s.run.generation},'timeout'));})().catch(()=>{});});
chrome.runtime.onMessage.addListener((raw,sender,reply)=>{
 if(['guide-state','guide-read','guide-stop','guide-wallet'].includes(raw?.type)){void(async()=>{await ready;reply(await guideCommand(raw,sender));})().catch(()=>reply({ok:false,error:'本次引导已结束或账户正在读取，请重试。'}));return true;}
 if(raw?.type?.startsWith('parser-')){if(!ownPage(sender))return false;void(async()=>{await ready;if(raw.type==='parser-state'){reply({ok:true,result:{...await parserStatus(),settings:(await chrome.storage.local.get(PARSER_SETTINGS))[PARSER_SETTINGS]||{}}});return;}if(raw.type==='parser-config'&&typeof raw.enabled==='boolean'&&typeof raw.cloudConsent==='boolean'){await chrome.storage.local.set({[PARSER_SETTINGS]:{enabled:raw.enabled,cloudConsent:raw.cloudConsent,scope:raw.scope==='full'?'full':'mvp'}});reply({ok:true,result:{...await parserStatus(),settings:{enabled:raw.enabled,cloudConsent:raw.cloudConsent,scope:raw.scope==='full'?'full':'mvp'}}});return;}reply({ok:false,error:'invalid_parser_request'});})().catch(()=>reply({ok:false,error:'parser_unavailable'}));return true;}
 if(raw?.type?.startsWith('agent-')){if(!ownPage(sender))return false;void(async()=>{await ready;reply({ok:true,result:await agent.handle(raw)});})().catch(error=>reply({ok:false,error:['needs_login','card_not_identified','no_financial_text','document_changed','wrong_bank_page','agent_busy','preview_required','review_required','model_permission_required','step_limit','no_next_page','page_loading'].includes(error.message)?error.message:'agent_action_failed'}));return true;}
 const popup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
 if(!trusted(sender)&&!popup&&!ownPage(sender))return false;
 void(async()=>{await ready;let ownerTab=sender.tab?.id;if(ownPage(sender)){const tab=await chrome.tabs.get(raw.ownerTabId);if(!isWallet(tab.url))throw Error('invalid_owner');ownerTab=tab.id;}const {ownerTabId,...body}=raw;const m=request(body);if(popup&&m.type==='refresh')throw Error('dashboard_required');const owner=popup?(await engine.load()).run?.owner??-1:ownerTab;let s;
  if(m.type==='refresh'){s=await engine.start(m,owner);void notify(s);void next();}
  else if(m.type==='focus-bank'){s=await engine.load();const job=s.run?.jobs.find(j=>j.bank===m.bank);if(!Number.isInteger(job?.tabId))throw Error('bank_tab_missing');const tab=await chrome.tabs.get(job.tabId);if(!guidedPage(m.bank,tab.url))throw Error('bank_tab_changed');await chrome.tabs.update(tab.id,{active:true});}
  else if(m.type==='cancel'){s=await engine.cancel(owner);await notify(s);}
  else if(['disconnect','clear','connect'].includes(m.type)){s=await engine.bank(m.bank,m.type,owner);if(['clear','disconnect'].includes(m.type))await agent.invalidate(m.bank);await publish(s);}
  else if(m.type==='remove-card'){s=await engine.removeCard(m,owner);await agent.invalidate(m.bank);await publish(s);}
  else s=await engine.load();
  reply({ok:true,requestId:m.requestId,version:VERSION,state:await exposedState(s)});
 })().catch(()=>reply({ok:false,error:'操作未完成，请检查扩展状态或重试。'}));
 return true;
});
