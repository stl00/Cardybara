// The assistant's conversation state: one typed object that carries what code knows between turns. Nothing else
// does: old tool results are dropped and chat text is not parsed back. It changes only through pure reducers, one per
// channel, applied to each tool result in order (the way a LangGraph StateGraph applies node updates through
// per-channel reducers), and every value is validated as a whole state before it is used or sent.
import {validateToolCall} from './walletAgent.js';
import {CREDIT_USES} from './creditQuery.js';
import {isRealDate,tripDays,MAX_TRIP_DAYS} from './tripDates.js';
import {queryKnowledge,ruleRevisions,knowledgeEntities} from './knowledge.js';
import {cardProducts,matchCardProduct} from './productCatalog.js';

/**
 * @typedef {{category?:string,amount?:number,currency?:string,country?:string,channel?:string,pointValues?:Object<string,number>}} Purchase
 *   The last purchase compared, as choose_card arguments. A merchant name is free text, so it stays out.
 * @typedef {{use?:string,start:string,end:string,precision:'days'|'part-of-month'|'month'|'holiday',destination?:string,assumed?:true}} Trip
 *   Dates code resolved from the user's words; never dates the model wrote.
 * @typedef {{rule?:string,card?:string}} TopicItem  A knowledge rule id and/or a catalogue product id.
 * @typedef {{card:string,first:number,last:number}} TopicCard  A catalogue product id and the turns (0-based) it was first and last focused in.
 * @typedef {{items:TopicItem[],cards:TopicCard[]}} Topics
 *   items: what the last tool turn returned, in order ("the second one"); cards: cards the chat focused on ("that card", "the first card").
 * @typedef {{completed:number,shownFrom:number}} Turns
 *   completed: turns answered so far; shownFrom: the first turn still shown to the model (earlier ones were trimmed).
 * @typedef {{lastPurchase?:Purchase,trip?:Trip,topics?:Topics,turns?:Turns}} ConversationState
 * @typedef {{name:string,args:object,result:any}} ToolEvent
 */
export const STATE_CHANNELS=['lastPurchase','trip','topics','turns'];
export const MAX_TURNS=10000;
const isTurn=n=>Number.isInteger(n)&&n>=0&&n<=MAX_TURNS;
export const TOPIC_ITEMS=12,TOPIC_CARDS=6;

const TRIP_PRECISIONS=['days','part-of-month','month','holiday'];
// Dates reach memory only after code resolved them; free text never does.
function validateTrip(raw){
 const keys=['use','start','end','precision','destination','assumed'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k))||raw.use!==undefined&&!CREDIT_USES.includes(raw.use)||!TRIP_PRECISIONS.includes(raw.precision)||!isRealDate(raw.start)||!isRealDate(raw.end)||raw.start>raw.end||tripDays(raw.start,raw.end)>MAX_TRIP_DAYS||raw.destination!==undefined&&!/^[A-Z]{2}$/.test(raw.destination)||raw.assumed!==undefined&&typeof raw.assumed!=='boolean')throw Error('invalid_memory');
 return {...(raw.use?{use:raw.use}:{}),start:raw.start,end:raw.end,precision:raw.precision,...(raw.destination?{destination:raw.destination}:{}),...(raw.assumed?{assumed:true}:{})};
}
// A merchant name is free text, so it stays in the conversation and out of state.
const PURCHASE_KEYS=['category','amount','currency','country','channel','pointValues'];
export function purchaseMemory(raw,strict=false){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||strict&&Object.keys(raw).some(k=>!PURCHASE_KEYS.includes(k)))throw Error('invalid_memory');
 const kept=Object.fromEntries(PURCHASE_KEYS.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
 try{return validateToolCall({id:'memory',function:{name:'choose_card',arguments:JSON.stringify(kept)}}).args;}catch{throw Error('invalid_memory');}
}
// The topic index lets a follow-up say "the second one" or "that card" without replaying old tool results. It holds
// only public catalogue ids, written by code from tool results; names are rendered from the shipped catalogue when
// the prompt is built, so no text from a chat, a model or a bank page can reach the system message through it.
const productById=new Map(cardProducts.map(p=>[p.id,p]));
const isProduct=id=>typeof id==='string'&&productById.has(id);
// Any published revision in the shipped knowledge, current or not: a tool may have returned it as of the wallet day.
const knownRules=new Map();
// Only hits are cached: a miss can come from client memory, and must not grow the cache.
const knownRule=id=>{if(knownRules.has(id))return knownRules.get(id);const rule=ruleRevisions(id).filter(r=>r.status==='published').at(-1)||null;if(rule)knownRules.set(id,rule);return rule;};
const isRule=id=>typeof id==='string'&&/^rule\.[a-z0-9.-]{1,160}$/.test(id)&&!!knownRule(id);
function validateTopics(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['items','cards'].includes(k)))throw Error('invalid_memory');
 const items=raw.items??[],cards=raw.cards??[];
 if(!Array.isArray(items)||items.length>TOPIC_ITEMS||!Array.isArray(cards)||cards.length>TOPIC_CARDS)throw Error('invalid_memory');
 // A bare product id is the shape before turns were recorded; it reads as a card from the first turn.
 const entries=cards.map(c=>typeof c==='string'?{card:c,first:0,last:0}:c);
 if(entries.some(c=>!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['card','first','last'].includes(k))||!isProduct(c.card)||!isTurn(c.first)||!isTurn(c.last)||c.first>c.last)||new Set(entries.map(c=>c.card)).size!==entries.length)throw Error('invalid_memory');
 for(const item of items)if(!item||typeof item!=='object'||Array.isArray(item)||!Object.keys(item).length||Object.keys(item).some(k=>!['rule','card'].includes(k))||item.rule!==undefined&&!isRule(item.rule)||item.card!==undefined&&!isProduct(item.card))throw Error('invalid_memory');
 return {items:items.map(i=>({...(i.rule?{rule:i.rule}:{}),...(i.card?{card:i.card}:{})})),cards:entries.map(c=>({card:c.card,first:c.first,last:c.last}))};
}
function validateTurns(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['completed','shownFrom'].includes(k))||!isTurn(raw.completed)||!isTurn(raw.shownFrom)||raw.shownFrom>raw.completed)throw Error('invalid_memory');
 return {completed:raw.completed,shownFrom:raw.shownFrom};
}
const productOf=card=>card&&matchCardProduct(card).product?.id||null;
const heldProduct=(cards,name,region)=>productOf(cards.find(c=>c.name===name&&(!region||c.region===region)));
const ruleId=revision=>typeof revision==='string'?revision.split('@')[0]:null;
const normalizedName=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
/** The items a tool result adds to the topic index, in the order returned. */
export function topicItems({name,result},cards){
 const items=[];
 if(!result||typeof result!=='object')return items;
 if(name==='find_benefits'||name==='get_card_rules')for(const r of result.rules||[]){
  const rule=ruleId(r.revision),card=r.cards?.length===1?heldProduct(cards,r.cards[0].name,r.cards[0].region):null;
  items.push({...(rule?{rule}:{}),...(card?{card}:{})});
 }
 if(name==='query_credits')for(const group of ['markedUnused','unknownStatus','markedUsed','noFixedCycle','cycleUnknown','outsideDates'])for(const x of result.groups?.[group]||[]){
  const card=heldProduct(cards,x.card,x.cardRegion),rule=card?ruleByTitle(card,x.title):null;
  items.push({...(rule?{rule}:{}),...(card?{card}:{})});
 }
 if(name==='choose_card')for(const row of result.rows||[]){const card=heldProduct(cards,row.card,row.cardRegion);if(card)items.push({card});}
 if(name==='list_cards'&&Array.isArray(result))for(const c of result)items.push({card:heldProduct(cards,c.name,c.region)});
 return items.filter(i=>(i.rule&&isRule(i.rule))||i.card).map(i=>({...(i.rule&&isRule(i.rule)?{rule:i.rule}:{}),...(i.card?{card:i.card}:{})}));
}
// A credit item carries its card and title, not its rule, so the rule is found by that card's product and title.
const productRules=new Map();
const ruleByTitle=(productId,title)=>{if(!productRules.has(productId))productRules.set(productId,queryKnowledge({productId,includeInactive:true}).rules);return productRules.get(productId).find(r=>r.content?.title===title)?.id||null;};
/** What the model sees: names, regions, titles and programmes from the shipped catalogue, never memory text. */
// Cards are listed in the order they were first discussed, so "the first card" has an answer; turns count from 1.
export function topicContext(topics,turns){
 if(!topics||!topics.items.length&&!topics.cards.length)return null;
 const shownFrom=turns?.shownFrom||0;
 const product=id=>{const p=productById.get(id);return {card:p.name,region:p.region};};
 const programme=id=>id&&knowledgeEntities.programmes.find(p=>p.id===id)?.name||null;
 return {
  lastResults:topics.items.map((item,i)=>{const rule=item.rule&&knownRule(item.rule),to=programme(rule?.terms?.toProgrammeId);return {n:i+1,...(rule?{title:rule.content.title}:{}),...(item.card?product(item.card):{}),...(to?{programme:to}:{})};}),
  recentCards:topics.cards.toSorted((a,b)=>a.first-b.first||a.last-b.last).map(c=>({...product(c.card),firstTurn:c.first+1,lastTurn:c.last+1,...(c.last<shownFrom?{onlyInDroppedTurns:true}:{})}))
 };
}

/** Validates a whole state, and returns a fresh copy with only the fields code writes. Throws invalid_memory. */
export function validateState(raw={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!STATE_CHANNELS.includes(k)))throw Error('invalid_memory');
 return {
  ...(raw.lastPurchase?{lastPurchase:purchaseMemory(raw.lastPurchase,true)}:{}),
  ...(raw.trip?{trip:validateTrip(raw.trip)}:{}),
  ...(raw.topics?{topics:validateTopics(raw.topics)}:{}),
  ...(raw.turns?{turns:validateTurns(raw.turns)}:{})
 };
}

// One reducer per channel: (previous value, tool event, context) → next value. Each returns the previous value when
// the event does not concern it, and never modifies its inputs.
const reducers={
 lastPurchase:(previous,{name,args})=>name==='choose_card'?purchaseMemory(args):previous,
 // Only dates that code resolved reach state, so a failed resolution keeps the previous trip.
 trip:(previous,{name,result})=>{
  const w=name==='query_credits'&&result?.window;
  if(!w||w.precision==='current-cycle')return previous;
  return {...(result.use?{use:result.use}:{}),start:w.start,end:w.end,precision:w.precision,...(result.destination?{destination:result.destination}:{}),...(w.assumptions.some(a=>a!=='dates-remembered-from-earlier-turn')?{assumed:true}:{})};
 },
 // Items: the first tool of a turn replaces the list, even with nothing, so an older list never passes for the last
 // results; later tools in that turn append.
 // Cards: a card named in the arguments, the chosen card, or the only card returned goes to the front.
 turns:previous=>previous,
 topics:(previous,event,{cards=[],appendItems=false,turn=0}={})=>{
  // An event without a result is a call replayed from history (prepareAgentContext), not a tool that ran: the
  // index already reflects it.
  if(event.result===undefined)return previous;
  const before=previous||{items:[],cards:[]},items=topicItems(event,cards),{name,args,result}=event,focus=[];
  if(args?.cardName){const named=cards.filter(x=>[x.name,x.pageName].some(n=>n&&normalizedName(n).includes(normalizedName(args.cardName)))&&(!args.region||x.region===args.region));if(named.length&&named.length<=2)focus.push(...named.map(productOf));}
  if(name==='choose_card'&&result?.choice?.card)focus.push(heldProduct(cards,result.choice.card,result.rows?.find(r=>r.card===result.choice.card)?.cardRegion));
  const returned=[...new Set(items.map(i=>i.card).filter(Boolean))];
  if(name!=='list_cards'&&returned.length===1)focus.push(returned[0]);
  const nextItems=appendItems?(items.length?[...before.items,...items]:before.items):items;
  // A focused card keeps the turn it was first discussed in and moves its last turn on; the least recently
  // discussed card leaves first when the list is full.
  const byCard=new Map(before.cards.map(c=>[c.card,c]));
  for(const id of focus.filter(Boolean)){const had=byCard.get(id);byCard.set(id,{card:id,first:had?had.first:turn,last:Math.max(turn,had?.last??turn)});}
  const nextCards=[...byCard.values()].toSorted((a,b)=>b.last-a.last||b.first-a.first).slice(0,TOPIC_CARDS);
  const sameCards=nextCards.length===before.cards.length&&nextCards.every(c=>{const b=before.cards.find(x=>x.card===c.card);return b&&b.first===c.first&&b.last===c.last;});
  // Same list object only when appending nothing; then, with the same cards, the channel is unchanged.
  if(nextItems===before.items&&sameCards)return previous;
  return {items:nextItems.slice(0,TOPIC_ITEMS),cards:nextCards};
 },
};

/**
 * The state after one tool result. Pure: returns a new validated state and leaves the input unchanged.
 * @param {ConversationState} state
 * @param {ToolEvent} event
 * @param {{cards?:object[],appendItems?:boolean}} context  held cards; appendItems for every tool after the turn's first
 * @returns {ConversationState}
 */
export function reduceToolResult(state,event,context={}){
 const before=validateState(state),next={},turn=before.turns?.completed??0;
 for(const channel of STATE_CHANNELS){const value=reducers[channel](before[channel],event,{...context,turn});if(value!==undefined&&value!==null)next[channel]=value;}
 return validateState(next);
}

// What a trace may show of a channel: the fields that changed, not the user's amounts or point values.
const summary={
 lastPurchase:v=>v&&{fields:Object.keys(v).sort(),...(v.category?{category:v.category}:{}),...(v.currency?{currency:v.currency}:{}),...(v.country?{country:v.country}:{})},
 trip:v=>v&&{start:v.start,end:v.end,precision:v.precision},
 topics:v=>v&&{items:v.items.length,cards:v.cards.map(c=>c.card)},
 turns:v=>v,
};
/** The state as a turn starts: how many earlier turns the model will not see. Pure. */
export function startTurn(state,{shownFrom}){
 const before=validateState(state),completed=before.turns?.completed??0;
 return validateState({...before,turns:{completed,shownFrom:Math.min(shownFrom,completed)}});
}
/** The state once a turn is answered. Pure. */
export function endTurn(state){
 const before=validateState(state),turns=before.turns??{completed:0,shownFrom:0};
 return validateState({...before,turns:{...turns,completed:Math.min(turns.completed+1,MAX_TURNS)}});
}
/** Channel-by-channel change between two states, for the trace: [{channel,before,after}]. */
export function diffState(before={},after={}){
 return STATE_CHANNELS.filter(c=>JSON.stringify(before[c]??null)!==JSON.stringify(after[c]??null)).map(c=>({channel:c,before:summary[c](before[c])??null,after:summary[c](after[c])??null}));
}
