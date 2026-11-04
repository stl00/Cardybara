import {MVP_KINDS,mvpLink,mvpSummary,requiredReward} from './mvp.js';
import {validateModel,readLink,mergeRecords} from './agent-core.js';
import {PROVIDERS,guidedPage} from './providers.js';
import {amexCards,amexSavedOffers,amexReadMenu,amexAccountHome,boaCards} from './card-navigation.js';
import {hsbcCards,hsbcMoreDetails} from './hsbc-navigation.js';
import {collectCoverage,offerCoverage} from './coverage.js';
import {chaseCards,chaseOpenSection} from './chase-navigation.js';
import {capturePage} from './agent-snapshot.js';
export const PARSER_ORIGIN='http://127.0.0.1:8766';
export const PARSER_SETTINGS='cardybara-parser-settings';
export const SECTION_KEYS=['card','reward','benefit','offer','transaction'];
export async function parserStatus(){
 const permission=await chrome.permissions.contains({origins:['http://127.0.0.1/*']});
 if(!permission)return {configured:false,reason:'connect_local_service'};
 try{const r=await fetch(PARSER_ORIGIN+'/api/parser/status',{credentials:'omit',signal:AbortSignal.timeout(2500),redirect:'error'});if(!r.ok)throw Error();const s=await r.json();return {configured:s.configured===true,provider:s.provider,model:s.model,processing:s.processing};}catch{return {configured:false,reason:'local_service_offline'};}
}
export function sectionSummary(items,reason='not_found',empty=[],cards=[],coverage=[]){
 return Object.fromEntries(SECTION_KEYS.map(kind=>{
  const count=items.filter(i=>i.kind===kind||(kind==='card'&&i.kind==='billing')).length;
  if(kind==='reward'&&count){const readCards=new Set(items.filter(i=>i.kind==='reward').map(i=>i.cardId));return [kind,{status:cards.length&&cards.every(c=>readCards.has(c.id))?'updated':'partial',count,readCards:readCards.size,expectedCards:cards.length}];}
  if(kind==='offer'){
   const scope=offerCoverage(items,coverage,cards);
   if(scope.complete)return [kind,{status:count?'updated':'checked_empty',count,expected:scope.expected}];
   if(count)return [kind,{status:'incomplete',count,expected:scope.expected}];
  }
  return [kind,{status:count?(['reward','benefit'].includes(kind)?'partial':'updated'):(cards.length&&cards.every(c=>empty.some(e=>e.kind===kind&&e.cardId===c.id))?'checked_empty':reason),count}];
 }));
}
// Bounded batches keep long offer lists within the fast model response window.
export function snapshotBatches(snapshot,maxChars=5000){
 const batches=[];let blocks=[],size=0;
 for(const b of snapshot.blocks){if(blocks.length&&size+b.text.length>maxChars){batches.push({...snapshot,blocks});blocks=[];size=0;}blocks.push(b);size+=b.text.length;}
 if(blocks.length)batches.push({...snapshot,blocks});return batches;
}
// Bounded agent: the bank task owns navigation, cancellation, rules and model stages.
export async function enrichBank(ctx,io){
 const settings=(await chrome.storage.local.get(PARSER_SETTINGS))[PARSER_SETTINGS];
 const mvp=settings?.scope!=='full';
 const ready=await parserStatus(),allowModel=ready.configured&&settings?.enabled&&settings?.cloudConsent,modelReason=ready.reason||'setup_required';
 let items=[],pages=0,rejected=0,error=null,stage='capture';const rejectReasons={};const seen=new Set(),queue=new Map();let chaseReadingDetails=ctx.bank==='Chase',chaseAllTails=[];let startingUrl=null;let currentIds=[],switchTails=[],overviewUrl=null,perCardPages=0,savedOffersRead=false,moreDetailsRead=false,chaseOffersRead=false,chaseBenefitsRead=false;const empty=[];let coverage=[];
 const notCollected={},noteOther=(cardId,programme)=>{if(cardId)(notCollected[cardId]??=new Set()).add(programme);};
 // In MVP scope only required programmes are collected; others are reported, not dropped.
 const inScope=(i,cardIdOf)=>{if(!MVP_KINDS.has(i.kind))return false;if(i.kind==='reward'&&!requiredReward(ctx.bank,i.key)){noteOther(cardIdOf(i.cardId),i.key);return false;}return true;};
 const summary=reason=>mvp?mvpSummary(items,ctx.cards,ctx.initialPatches||[],notCollected):sectionSummary(items,reason,empty,ctx.cards,coverage);
 const check=async()=>{if(!await io.current())throw Error('cancelled');};
 const navigator=ctx.bank==='BOA'?boaCards:ctx.bank==='HSBC HK'?hsbcCards:ctx.bank==='Chase'?chaseCards:amexCards,canSwitch=ctx.bank==='BOA'||ctx.bank==='Chase'||ctx.bank==='HSBC HK'||ctx.bank.startsWith('Amex ');
 const advanceCard=async tabUrl=>{if(!switchTails.length||!overviewUrl)return false;await check();if(tabUrl!==overviewUrl)await io.navigate(overviewUrl);const tail=switchTails.shift();const selected=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:navigator,args:['select',tail,ctx.cards]});let selection=selected[0]?.result;if(typeof selection?.href==='string'&&guidedPage(ctx.bank,selection.href)){await io.navigate(selection.href);selection=[tail];}if(!Array.isArray(selection)||!selection.includes(tail)){error=ctx.bank==='Chase'&&['chase_account_button_timeout','chase_detail_timeout','chase_navigation_changed'].includes(selection?.error)?selection.error:'card_not_identified';return false;}currentIds=ctx.cards.filter(c=>c.tail===tail).map(c=>c.id);queue.clear();seen.clear();perCardPages=0;savedOffersRead=false;moreDetailsRead=false;chaseOffersRead=false;chaseBenefitsRead=false;return true;};
 if(canSwitch)await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:navigator,args:['close',null,ctx.cards]}).catch(()=>{});
 if(ctx.bank==='HSBC HK'){const first=ctx.cards.find(c=>c.bank==='HSBC HK');if(first)await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:hsbcCards,args:['select',first.tail,ctx.cards]}).catch(()=>{});}
 try{
  if(ctx.bank==='BOA'){const initial=await chrome.tabs.get(ctx.tabId);if(!/^\/accounts-home\/?$/.test(new URL(initial.url).pathname)){await check();await io.navigate('https://secure.bankofamerica.com/accounts-home/');}}
  if(ctx.bank==='Chase'){const initial=await chrome.tabs.get(ctx.tabId);if(!/^#\/dashboard\/overview(?:[/?]|$)/.test(new URL(initial.url).hash)){await check();await io.navigate(PROVIDERS.Chase.url);}}
  if(ctx.bank==='Amex HK'){const entry=await chrome.tabs.get(ctx.tabId);if(!/^\/(?:dashboard|overview)\/?$/.test(new URL(entry.url).pathname)){const home=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:amexAccountHome});const href=home[0]?.result;if(typeof href==='string'&&guidedPage(ctx.bank,href)){await check();await io.navigate(href);}}}
  for(let n=0;n<40;n++){
   await check();await io.progress(n?'reading_next_page':'reading_all_data',summary('reading'));
   const tab=await chrome.tabs.get(ctx.tabId);startingUrl??=tab.url;if(!guidedPage(ctx.bank,tab.url))throw Error('navigation_changed');
   stage='capture';await chrome.scripting.executeScript({target:{tabId:ctx.tabId},files:['reader.js']});const read=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:capturePage,args:[ctx.bank,ctx.cards,currentIds]});
   if(read.length!==1||!read[0].documentId)throw Error('document_changed');const raw=read[0].result;
   if(raw?.error){error=raw.error;break;}
   tab.url=raw.pageHref||tab.url;if(!guidedPage(ctx.bank,tab.url))throw Error('navigation_changed');
   await check();const capturedTab=await chrome.tabs.get(ctx.tabId),capturedDocument=await chrome.scripting.executeScript({target:{tabId:ctx.tabId,documentIds:[read[0].documentId]},func:()=>true});if(capturedTab.url!==tab.url||capturedDocument[0]?.documentId!==read[0].documentId)throw Error('document_changed');
   coverage=collectCoverage(coverage,raw.coverage,ctx.cards);
   if(raw.aliases?.length===1)currentIds=raw.aliases.map(a=>a.cardId);
   for(const e of raw.empty||[])if(ctx.cards.some(c=>c.id===e.cardId)&&['offer','transaction'].includes(e.kind)&&!empty.some(x=>x.kind===e.kind&&x.cardId===e.cardId))empty.push(e);
   const url=new URL(tab.url),links=[];
   if(canSwitch&&!overviewUrl&&(ctx.bank==='BOA'?/^\/accounts-home\/?$/.test(url.pathname):ctx.bank==='HSBC HK'?/^\/online\/dashboard\/?$/.test(url.pathname):ctx.bank==='Chase'?/^#\/dashboard\/overview(?:[/?]|$)/.test(url.hash):/^\/(?:dashboard|overview)\/?$/.test(url.pathname))){overviewUrl=tab.url;const found=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:navigator,args:['list',null,ctx.cards]});// BOA's overview has no billing fields, so even a single card must open its detail page.
switchTails=(found[0]?.result||[]).filter(t=>ctx.cards.some(c=>c.tail===t&&(ctx.bank==='BOA'||!currentIds.includes(c.id))));if(ctx.bank==='Chase')chaseAllTails=[...switchTails];}
   if(ctx.bank==='Amex HK'){const menu=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:amexReadMenu});raw.links=[...(raw.links||[]),...(Array.isArray(menu[0]?.result)?menu[0].result:[])];}
   // BOA billing is on each card's detail page, reached above; its rewards and statements links add nothing in scope.
   for(const link of ctx.bank==='BOA'?[]:raw.links||[]){if(mvp&&!mvpLink(link))continue;const href=readLink(link.label,link.href,tab.url);if(href&&(mvp||!/\/activity\/statements$/.test(new URL(href).pathname))&&guidedPage(ctx.bank,href)&&!links.some(l=>l.href===href))links.push({id:'L'+(links.length+1),label:link.label,href});if(links.length===12)break;}
   const snapshot={scope:mvp?'mvp':'full',bank:ctx.bank,region:PROVIDERS[ctx.bank].region,page:url.origin+url.pathname,aliases:raw.aliases,blocks:raw.blocks,links,capturedAt:raw.capturedAt};
   if(!snapshot.blocks?.length){error='no_financial_text';break;}
   seen.add(tab.url);await io.progress('understanding_page',summary('reading'));await check();
   let suggested=null;
   if(mvp){const cardIdOf=alias=>(raw.aliases||[]).find(a=>a.id===alias)?.cardId;for(const n of raw.notCollected||[])noteOther(cardIdOf(n.cardId),n.programme);raw.observations=(raw.observations||[]).filter(i=>inScope(i,cardIdOf));}
   if(raw.observations?.length){for(let start=0;start<raw.observations.length;start+=80){const grounded=validateModel({items:raw.observations.slice(start,start+80),nextLinkId:null},snapshot);items=mergeRecords(items,grounded.items.map(i=>({...i,method:'rules'})));rejected+=grounded.rejected.length;for(const reason of grounded.rejected)rejectReasons[reason]=(rejectReasons[reason]||0)+1;await io.checkpoint(items,summary('reading'));}}

   for(const batch of (!allowModel||raw.rulesComplete||raw.observations?.length&&url.pathname.startsWith('/offers')?[]:snapshotBatches(snapshot))){
    await check();stage='parse';const r=await fetch(PARSER_ORIGIN+'/api/parser/parse',{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension'},body:JSON.stringify({snapshot:batch}),credentials:'omit',signal:AbortSignal.timeout(27000),redirect:'error'});
    if(!r.ok){const code=(await r.json().catch(()=>({}))).error;throw Error(['parser_busy','model_request_failed'].includes(code)?code:'parser_unavailable');}const body=await r.json();await check();
    const current=await chrome.tabs.get(ctx.tabId);const same=await chrome.scripting.executeScript({target:{tabId:ctx.tabId,documentIds:[read[0].documentId]},func:()=>true});if(current.url!==tab.url||same[0]?.documentId!==read[0].documentId)throw Error('document_changed');
    const result=validateModel(body.raw,batch);items=mergeRecords(items,mvp?result.items.filter(i=>inScope(i,id=>id)):result.items);suggested??=result.nextLinkId;rejected+=result.rejected.length;for(const reason of result.rejected)rejectReasons[reason]=(rejectReasons[reason]||0)+1;
    await io.checkpoint(items,summary('reading'));
   }
   pages++;perCardPages++;
   for(const l of links)if(!seen.has(l.href))queue.set(l.href,l);
   const priority=l=>/offer|優惠|优惠/i.test(l.label)?0:/transaction|activity|交易/i.test(l.label)?1:/rewards|points|積分|积分|獎賞|奖赏/i.test(l.label)?2:/benefit|福利/i.test(l.label)?3:4;
   let next=[...queue.values()].filter(l=>!seen.has(l.href)).sort((a,b)=>priority(a)-priority(b))[0]||links.find(l=>l.id===suggested&&!seen.has(l.href));
   // Save this document's validated observations before any subsequent navigation.
   if(!mvp&&ctx.bank.startsWith('Amex ')&&url.pathname.startsWith('/offers')&&!savedOffersRead){savedOffersRead=true;const saved=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:amexSavedOffers});if(saved[0]?.result)continue;}
   if(ctx.bank==='HSBC HK'&&currentIds.length===1&&!moreDetailsRead){moreDetailsRead=true;const panel=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:hsbcMoreDetails});if(panel[0]?.result)continue;}
   if(!mvp&&ctx.bank==='Chase'&&!chaseReadingDetails&&currentIds.length===1){const tail=ctx.cards.find(c=>c.id===currentIds[0])?.tail;if(!chaseOffersRead){chaseOffersRead=true;const action=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:chaseOpenSection,args:['offers',tail]});if(action[0]?.result)continue;}if(!chaseBenefitsRead){chaseBenefitsRead=true;const action=await chrome.scripting.executeScript({target:{tabId:ctx.tabId},func:chaseOpenSection,args:['benefits',tail]});if(action[0]?.result)continue;}}
   if(perCardPages>=6)next=null;
   if(!next){if(!mvp&&ctx.bank==='Chase'&&chaseReadingDetails&&!switchTails.length&&overviewUrl){chaseReadingDetails=false;switchTails=[...chaseAllTails];}if(!switchTails.length||!overviewUrl||n===39)break;if(!await advanceCard(tab.url))break;continue;}
   if(n===39)break;
   await check();queue.delete(next.href);stage='navigate';try{await io.navigate(next.href);}catch(e){if(e.message!=='navigation_timeout')throw e;error='navigation_timeout';const current=await chrome.tabs.get(ctx.tabId);if(!guidedPage(ctx.bank,current.url))throw Error('navigation_changed');if(await advanceCard(current.url))continue;break;}await check();
  }
 }catch(e){error=['cancelled','navigation_changed','document_changed','navigation_timeout','parser_busy','model_request_failed'].includes(e.message)?e.message:(e.name==='TimeoutError'?'parser_timeout':stage==='capture'?'page_read_failed':'parser_unavailable');}
 if(startingUrl&&pages&&await io.current()){try{const current=await chrome.tabs.get(ctx.tabId);if(current.url!==startingUrl&&guidedPage(ctx.bank,current.url))await io.navigate(startingUrl);}catch{}}
 return {scope:mvp?'mvp':'full',items,sections:summary(error||(!allowModel?modelReason:'not_found')),pages,rejected,rejectReasons,error};
}
