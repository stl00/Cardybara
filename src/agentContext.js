import {validateToolCall} from './walletAgent.js';
import {CREDIT_USES} from './creditQuery.js';
import {isRealDate,tripDays,MAX_TRIP_DAYS} from './tripDates.js';
import {queryKnowledge,ruleRevisions,knowledgeEntities} from './knowledge.js';
import {cardProducts,matchCardProduct} from './productCatalog.js';
const TRIP_PRECISIONS=['days','part-of-month','month','holiday'];
// Dates reach memory only after code resolved them; free text never does.
function validateTrip(raw){
 const keys=['use','start','end','precision','destination','assumed'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k))||raw.use!==undefined&&!CREDIT_USES.includes(raw.use)||!TRIP_PRECISIONS.includes(raw.precision)||!isRealDate(raw.start)||!isRealDate(raw.end)||raw.start>raw.end||tripDays(raw.start,raw.end)>MAX_TRIP_DAYS||raw.destination!==undefined&&!/^[A-Z]{2}$/.test(raw.destination)||raw.assumed!==undefined&&typeof raw.assumed!=='boolean')throw Error('invalid_memory');
 return {...(raw.use?{use:raw.use}:{}),start:raw.start,end:raw.end,precision:raw.precision,...(raw.destination?{destination:raw.destination}:{}),...(raw.assumed?{assumed:true}:{})};
}
// A merchant name is free text, so it stays in the conversation and out of memory.
const PURCHASE_KEYS=['category','amount','currency','country','channel','pointValues'];
const VALUE_ALIASES={mr:['membership rewards','美国运通积分','美國運通積分'],ur:['ultimate rewards'],'asia miles':['亚洲万里通','亞洲萬里通','cathay','国泰','國泰'],cathay:['asia miles','亚洲万里通','亞洲萬里通','国泰','國泰'],hilton:['希尔顿','希爾頓','hilton honors'],marriott:['万豪','萬豪','bonvoy'],hyatt:['凯悦','凱悅'],ihg:['洲际','洲際']};
const aliasesFor=key=>{const k=key.toLowerCase().trim(),base=k.replace(/\s+(?:us|hk|ca)$/,'');return [...new Set([k,base,...(VALUE_ALIASES[base]||[])])];};
/** A point value survives only if the user's own words this turn contain it, or memory already held it. */
export function statedPointValues(values,question,remembered={}){
 if(!values)return null;
 const text=question.normalize('NFKC').toLowerCase();
 // The number must be said as a value: next to a cents unit, or right after the programme's name. "Dinner for 2" is not a point value.
 // The value must be said about that programme: its name or a known alias as a whole word, then within a few
 // characters a valuing word or a cents unit, then the number. A bare 分 is never 分钟, and a rating or a price
 // elsewhere in the sentence can't be borrowed.
 const stated=(key,value)=>{
  const n=String(value).replace('.','\\.'),names=aliasesFor(key).map(a=>a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  return names.some(name=>{
   const named=`(?<![a-z])${name}(?![a-z])`,num=`(?<![\\d.])${n}(?![\\d.])`,unit=`\\s*(?:美分|港分|分(?![钟鐘半])|cents?\\b|¢)`;
   return new RegExp(`${named}[^\\d]{0,12}?(?:值|是|估|=|:|：|\\bat\\b|\\bworth\\b|\\bvalued?\\b)[^\\d]{0,4}${num}`).test(text)||new RegExp(`${named}[^\\d]{0,8}${num}${unit}`).test(text);
  });
 };
 const kept=Object.fromEntries(Object.entries(values).filter(([k,v])=>stated(k,v)||remembered?.[k]===v));
 return Object.keys(kept).length?kept:null;
}
export function purchaseMemory(raw,strict=false){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||strict&&Object.keys(raw).some(k=>!PURCHASE_KEYS.includes(k)))throw Error('invalid_memory');
 const kept=Object.fromEntries(PURCHASE_KEYS.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
 try{return validateToolCall({id:'memory',function:{name:'choose_card',arguments:JSON.stringify(kept)}}).args;}catch{throw Error('invalid_memory');}
}
// The topic index lets a follow-up say "the second one" or "that card" without replaying old tool results. It holds
// only public catalogue ids, written by code from tool results; names are rendered from the shipped catalogue when
// the prompt is built, so no text from a chat, a model or a bank page can reach the system message through it.
export const TOPIC_ITEMS=12,TOPIC_CARDS=6;
const productById=new Map(cardProducts.map(p=>[p.id,p]));
const isProduct=id=>typeof id==='string'&&productById.has(id);
// Any published revision in the shipped knowledge, current or not: a tool may have returned it as of the wallet day.
const knownRules=new Map();
const knownRule=id=>{if(!knownRules.has(id))knownRules.set(id,ruleRevisions(id).filter(r=>r.status==='published').at(-1)||null);return knownRules.get(id);};
const isRule=id=>typeof id==='string'&&/^rule\.[a-z0-9.-]{1,160}$/.test(id)&&!!knownRule(id);
function validateTopics(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['items','cards'].includes(k)))throw Error('invalid_memory');
 const items=raw.items??[],cards=raw.cards??[];
 if(!Array.isArray(items)||items.length>TOPIC_ITEMS||!Array.isArray(cards)||cards.length>TOPIC_CARDS||new Set(cards).size!==cards.length||!cards.every(isProduct))throw Error('invalid_memory');
 for(const item of items)if(!item||typeof item!=='object'||Array.isArray(item)||!Object.keys(item).length||Object.keys(item).some(k=>!['rule','card'].includes(k))||item.rule!==undefined&&!isRule(item.rule)||item.card!==undefined&&!isProduct(item.card))throw Error('invalid_memory');
 return {items:items.map(i=>({...(i.rule?{rule:i.rule}:{}),...(i.card?{card:i.card}:{})})),cards:[...cards]};
}
export function validateMemory(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['lastPurchase','trip','topics'].includes(k)))throw Error('invalid_memory');
 return {
  ...(raw.lastPurchase?{lastPurchase:purchaseMemory(raw.lastPurchase,true)}:{}),
  ...(raw.trip?{trip:validateTrip(raw.trip)}:{}),
  ...(raw.topics?{topics:validateTopics(raw.topics)}:{})
 };
}
const productOf=card=>card&&matchCardProduct(card).product?.id||null;
const heldProduct=(cards,name,region)=>productOf(cards.find(c=>c.name===name&&(!region||c.region===region)));
const ruleId=revision=>typeof revision==='string'?revision.split('@')[0]:null;
const normalizedName=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function itemsFrom(name,result,cards){
 const items=[];
 if(name==='find_benefits'||name==='get_card_rules')for(const r of result.rules||[]){
  const rule=ruleId(r.revision),card=r.cards?.length===1?heldProduct(cards,r.cards[0].name,r.cards[0].region):null;
  items.push({...(rule?{rule}:{}),...(card?{card}:{})});
 }
 if(name==='query_credits')for(const group of ['markedUnused','unknownStatus','markedUsed','noFixedCycle','cycleUnknown','outsideDates'])for(const x of result.groups?.[group]||[]){
  const card=heldProduct(cards,x.card,x.cardRegion),rule=card?ruleByTitle(card,x.title):null;
  items.push({...(rule?{rule}:{}),...(card?{card}:{})});
 }
 if(name==='choose_card')for(const row of result.rows||[]){const card=heldProduct(cards,row.card,row.cardRegion);if(card)items.push({card});}
 if(name==='list_cards')for(const c of result)items.push({card:heldProduct(cards,c.name,c.region)});
 return items.filter(i=>(i.rule&&isRule(i.rule))||i.card).map(i=>({...(i.rule&&isRule(i.rule)?{rule:i.rule}:{}),...(i.card?{card:i.card}:{})}));
}
// A credit item carries its card and title, not its rule, so the rule is found by that card's product and title.
const productRules=new Map();
const ruleByTitle=(productId,title)=>{if(!productRules.has(productId))productRules.set(productId,queryKnowledge({productId,includeInactive:true}).rules);return productRules.get(productId).find(r=>r.content?.title===title)?.id||null;};
/**
 * The next topic index after a turn. calls are [{name,args,result}] in the order they ran. Items are what this turn's
 * tools returned, in order; a turn without tools keeps the previous items. Cards are those the turn focused on:
 * a card named in a tool's arguments, the chosen card, or the only card a tool returned, most recent first.
 */
export function nextTopics(previous,calls,cards){
 const before=previous?validateTopics(previous):{items:[],cards:[]};
 const items=calls.flatMap(c=>itemsFrom(c.name,c.result,cards));
 const focus=[];
 for(const c of calls){
  if(c.args?.cardName){const named=cards.filter(x=>[x.name,x.pageName].some(n=>n&&normalizedName(n).includes(normalizedName(c.args.cardName)))&&(!c.args.region||x.region===c.args.region));if(named.length&&named.length<=2)focus.push(...named.map(productOf));}
  if(c.name==='choose_card'&&c.result?.choice?.card)focus.push(heldProduct(cards,c.result.choice.card,c.result.rows?.find(r=>r.card===c.result.choice.card)?.cardRegion));
  const returned=[...new Set(itemsFrom(c.name,c.result,cards).map(i=>i.card).filter(Boolean))];
  if(c.name!=='list_cards'&&returned.length===1)focus.push(returned[0]);
 }
 const recent=[...focus.filter(Boolean).reverse(),...before.cards];
 return validateTopics({items:(items.length?items:before.items).slice(0,TOPIC_ITEMS),cards:[...new Set(recent)].slice(0,TOPIC_CARDS)});
}
/** What the model sees: names, regions, titles and programmes from the shipped catalogue, never memory text. */
export function topicContext(topics){
 if(!topics||!topics.items.length&&!topics.cards.length)return null;
 const product=id=>{const p=productById.get(id);return {card:p.name,region:p.region};};
 const programme=id=>id&&knowledgeEntities.programmes.find(p=>p.id===id)?.name||null;
 return {
  lastResults:topics.items.map((item,i)=>{const rule=item.rule&&knownRule(item.rule),to=programme(rule?.terms?.toProgrammeId);return {n:i+1,...(rule?{title:rule.content.title}:{}),...(item.card?product(item.card):{}),...(to?{programme:to}:{})};}),
  recentCards:topics.cards.map(product)
 };
}
export function prepareAgentContext(history,memory={},{maxTurns=6,maxChars=22000}={}){
 const state=validateMemory(memory),turns=[];let turn;
 for(const m of history){
  if(m.role==='user'){turn=[];turns.push(turn);turn.push({role:'user',content:m.content});}
  else if(m.role==='assistant'){
   for(const c of m.tool_calls||[]){const checked=validateToolCall(c);if(checked.name==='choose_card')state.lastPurchase=purchaseMemory(checked.args);}
   if(m.content?.trim()&&turn)turn.push({role:'assistant',content:m.content.slice(0,5000)});
  }
 }
 // Historical tool evidence is deliberately discarded: mutable wallet state must be read afresh.
 const selected=[];let chars=0;
 for(const t of turns.slice(-maxTurns).reverse()){
  const size=JSON.stringify(t).length;if(chars+size>maxChars)break;selected.unshift(...t);chars+=size;
 }
 return {messages:selected,memory:state,droppedTurns:turns.length-selected.filter(m=>m.role==='user').length,chars};
}
