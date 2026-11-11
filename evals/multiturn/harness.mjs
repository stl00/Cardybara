// Multi-turn reference eval. A dialogue is replayed through the real agent loop (runAgentTurn) with a scripted
// model, so the real tools run, real memory is kept and real context trimming applies. The last question is then
// sent as far as the model boundary: the exact chatRequest the model would receive is captured, and the check asks
// whether the entity the user refers to is still identifiable in it. Synthetic public products only.
import {cards as catalogueCards} from '../fixtures.mjs';
// CARDYBARA_AGENT=cloud replays through the hosted agent (tests/helpers/agent-target.mjs).
import {runAgentTurn} from '../../tests/helpers/agent-target.mjs';
import {chatRequest,SYSTEM} from '../../src/chatProtocol.js';
import {runWalletTool,validateToolCall} from '../../src/walletAgent.js';

// Same-name products in three regions, plus cards that share words with them.
export const PORTFOLIO=['chase-us-sapphire-reserve','chase-us-freedom-unlimited','amex-us-us-american-express-gold-card','amex-us-us-morgan-stanley-platinum-card','amex-us-us-hilton-honors-aspire-card','amex-us-us-the-platinum-card','amex-hk-hk-the-platinum-card','amex-ca-ca-platinum-card','hsbc-hk-hk-red-credit-card','sc-hk-hk-cathay-mastercard'];
export const evalContext={cards:PORTFOLIO.map(id=>catalogueCards.find(c=>c.productId===id)),events:[],day:'2026-10-29'};
const heldByProduct=id=>evalContext.cards.find(c=>c.productId===id);

const normalized=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// The same filter the tools apply to cardName and region (displayed name or catalogue name; eval cards carry the catalogue name).
export const selectCards=(args,cards=evalContext.cards)=>cards.filter(c=>(!args.cardName||normalized(c.name).includes(normalized(args.cardName)))&&(!args.region||c.region===args.region));
// Shorter names a person or a model uses for a card. A form counts only if it would select that card as cardName.
const SHORT_NAMES=['Sapphire Reserve','Freedom Unlimited','Gold Card','Morgan Stanley','Aspire','The Platinum Card','Platinum Card','Red Credit Card','Cathay Mastercard'];
// Names a model can map to a held card through list_cards although they are not substrings of it: translations and
// common short names. The Platinum names fit three regions, so they identify a card only next to a region.
const PLATINUM=['amex-us-us-the-platinum-card','amex-hk-hk-the-platinum-card','amex-ca-ca-platinum-card'];
const NICKNAMES=[
 {re:/Amex Gold|运通金卡|運通金卡|运通 Gold|運通 Gold|(?<!(?:Marriott|Hilton|Visa)\s*)Gold ?卡/gi,products:['amex-us-us-american-express-gold-card']},
 {re:/摩根士丹利/g,products:['amex-us-us-morgan-stanley-platinum-card']},
 {re:/国泰 ?Mastercard|國泰 ?Mastercard|国泰卡|國泰卡/gi,products:['sc-hk-hk-cathay-mastercard']},
 {re:/HSBC Red|汇丰 ?Red|滙豐 ?Red|Red ?卡/gi,products:['hsbc-hk-hk-red-credit-card']},
 {re:/(?<!(?:Morgan Stanley|摩根士丹利|大摩|\bMS)\s*)(?:白金卡|Amex Platinum|Platinum(?! Vacation| Card)(?: cards?)?)/gi,products:PLATINUM},
];
const REGION_MARKS={US:/\bUS\b|\bU\.S\.|美国(?!运通)|美國(?!運通)|United States|American(?! Express)/,HK:/\bHK\b|香港|Hong Kong/i,CA:/\bCA\b|加拿大(?!航空)|(?<!Air )Canad/};
const WINDOW=40;
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// Mentions of a card: a name form not inside a longer held card name ("Platinum Card" inside "The Platinum Card"),
// or a nickname. Each mention carries the held cards it could mean.
function mentions(text,strict=false){
 const found=[],names=evalContext.cards.map(c=>c.name);
 for(const form of [...new Set([...names,...SHORT_NAMES])]){
  const candidates=selectCards({cardName:form}).map(c=>c.productId),longer=names.filter(n=>n.length>form.length&&n.toLowerCase().includes(form.toLowerCase()));
  for(const m of text.matchAll(new RegExp(escape(form),'gi'))){
   // "Marriott Gold card" is a hotel status, not the Amex Gold Card.
   if(form==='Gold Card'&&/(?:Marriott|Hilton|Visa)\s*$/i.test(text.slice(Math.max(0,m.index-12),m.index)))continue;
   const inside=longer.some(n=>{const offset=n.toLowerCase().indexOf(form.toLowerCase());return text.slice(m.index-offset,m.index-offset+n.length).toLowerCase()===n.toLowerCase();});
   if(!inside)found.push({at:m.index,length:m[0].length,candidates});
  }
 }
 if(!strict)for(const n of NICKNAMES)for(const m of text.matchAll(n.re))found.push({at:m.index,length:m[0].length,candidates:n.products});
 return found;
}
// The region mark closest to a mention, within a short window, decides which region it is about.
function nearestRegion(text,at,length){
 let best=null;
 for(const [region,mark] of Object.entries(REGION_MARKS)){
  for(const m of text.matchAll(new RegExp(mark.source,mark.flags.includes('i')?'gi':'g'))){
   const distance=m.index<at?at-(m.index+m[0].length):m.index-(at+length),between=m.index<at?text.slice(m.index,at):text.slice(at,m.index);
   // In structured text a region belongs to the object it is in: a mark across a brace is about another record.
   if(distance>=0&&distance<=WINDOW&&!/[{}]/.test(between)&&(!best||distance<best.distance))best={region,distance};
  }
 }
 return best?.region||null;
}
const regionOf=id=>heldByProduct(id).region;
// A card is identifiable in a source if a mention can only mean it, or can mean it and cards in other regions
// and the nearest region mark (or the question itself) names its region.
function cardIn(text,productId,regionGiven,strict=false){
 return mentions(text,strict).some(m=>{
  if(!m.candidates.includes(productId))return false;
  const sameRegion=m.candidates.filter(id=>regionOf(id)===regionOf(productId));
  if(sameRegion.length>1)return false;
  return m.candidates.length===1||regionGiven||nearestRegion(text,m.at,m.length)===regionOf(productId);
 });
}
export const cardMentioned=cardIn;
const anyIn=(text,alts)=>alts.some(a=>text.toLowerCase().includes(a.toLowerCase()));
const firstAt=(text,alts)=>Math.min(...alts.map(a=>{const i=text.toLowerCase().indexOf(a.toLowerCase());return i<0?Infinity:i;}));
// The k-th item of a list is identifiable if one source shows the list's first k items in that order.
function ordinalIn(text,{index,list}){
 const at=list.slice(0,index).map(alts=>firstAt(text,alts));
 return at.every(Number.isFinite)&&at.every((p,i)=>!i||p>at[i-1]);
}

/** What each part of the referent needs, checked against the sources the model receives. Strict ("tool-ready")
 * accepts only forms a tool argument can use as they stand: a name that selects the card, the record's own title. */
export function resolvable(target,sources,{regionGiven=false,strict=false}={}){
 const missing=[],alts=list=>strict&&!target.toolChecked?list.slice(0,1):list;
 if(target.card&&!sources.some(s=>cardIn(s,target.card,regionGiven,strict)))missing.push('card');
 if(target.item&&!sources.some(s=>anyIn(s,alts(target.item))))missing.push('item');
 if(target.programme&&!sources.some(s=>anyIn(s,alts(target.programme))))missing.push('programme');
 if(target.ordinal&&!sources.some(s=>ordinalIn(s,{...target.ordinal,list:target.ordinal.list.map(alts)})))missing.push('order');
 return {resolvable:!missing.length,missing};
}

const toolCall=(name,args,id)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const STOP=Symbol('captured');

/** Replays the earlier turns with a scripted model and returns the request the model would get for the last question. */
export async function replay(dialogue,{finalRequest}={}){
 let history=[],memory={};const fixtureIssues=[];
 for(const [i,turn] of dialogue.turns.entries()){
  const calls=(turn.calls||[]).map(([name,args],j)=>toolCall(name,args,`t${i}c${j}`));
  let toolsSent=!calls.length;
  // The scripted model calls the turn's tools once, then gives the turn's answer (again, if a repair is asked).
  const request=async()=>{if(!toolsSent){toolsSent=true;return {message:{role:'assistant',content:'',tool_calls:calls}};}return {message:{role:'assistant',content:turn.answer}};};
  const result=await runAgentTurn({history,memory,question:turn.user,context:evalContext,request});
  if(result.trace.some(t=>t.type==='repair'||t.type==='fallback'))fixtureIssues.push(`turn ${i+1}: answer failed grounding (${result.trace.filter(t=>t.codes).flatMap(t=>t.codes).join(',')})`);
  // What the person saw is the scripted answer, so that is what history keeps.
  result.messages.at(-1).content=turn.answer;
  history=result.messages;memory=result.memory;
 }
 let captured;
 const request=finalRequest||(async payload=>{captured=payload;throw STOP;});
 let finalResult=null;
 try{finalResult=await runAgentTurn({history,memory,question:dialogue.question,context:evalContext,request:async(payload,signal)=>{captured??=structuredClone(payload);return request(payload,signal);}});}
 catch(error){if(error!==STOP)throw error;}
 const sent=chatRequest(captured);
 return {sent,memory,history,fixtureIssues,finalResult};
}

/** The sources a reference can be resolved from: what follows the fixed instructions in the system message, and each earlier message. */
export function contextSources(sent){
 const system=sent.messages[0].content;
 if(!system.startsWith(SYSTEM))throw Error('unexpected_system_prompt');
 return [system.slice(SYSTEM.length),...sent.messages.slice(1,-1).map(m=>m.content||'')];
}

// A wording is tool-ready if using it as the expected call's query (or transfer programme) returns the record.
function retrieves(d,wording,title){
 const tool=d.expect.tool,args=tool==='find_benefits'?{...d.expect.args,query:wording}:tool==='get_card_rules'&&d.expect.args.kind==='transfer-relationship'?{...d.expect.args,programme:wording}:null;
 if(!args)return false;
 try{return JSON.stringify(runWalletTool(toolCall(tool,args,'strict'),evalContext)).includes(title);}catch{return false;}
}
/** The target for the tool-ready level: the record's own title, plus any other wording the tool also finds it by. */
export function strictTarget(d){
 const t=d.target,keep=list=>list.filter((w,i)=>!i||retrieves(d,w,list[0]));
 return {...t,toolChecked:true,...(t.item?{item:keep(t.item)}:{}),...(t.programme?{programme:keep(t.programme)}:{}),...(t.ordinal?{ordinal:{...t.ordinal,list:t.ordinal.list.map(keep)}}:{})};
}

/** Checks the labels themselves: the expected call is valid and selects the referent; the question does not already name it. */
export function checkLabels(d){
 const issues=[],t=d.target;
 try{validateToolCall(toolCall(d.expect.tool,d.expect.args,'label'));}catch(e){issues.push('expected call invalid: '+e.message);return issues;}
 const result=runWalletTool(toolCall(d.expect.tool,d.expect.args,'label'),evalContext);
 if(t.card){
  const card=heldByProduct(t.card);
  if(!card)issues.push('target card not held');
  else if(d.expect.args.cardName&&!selectCards(d.expect.args).some(c=>c.productId===t.card))issues.push('expected cardName/region does not select the target card');
  else if(d.expect.args.cardName&&selectCards(d.expect.args).length!==1)issues.push('expected cardName/region selects more than the target');
  if(cardIn(d.question,t.card,!!d.regionInQuestion))issues.push('question already names the card');
 }
 if(d.expect.args.cardName&&selectCards(d.expect.args).length!==1)issues.push('expected cardName/region does not select exactly one card');
 if(['find_benefits','get_card_rules'].includes(d.expect.tool)&&!result.totalMatches)issues.push('expected call returns nothing');
 if(d.expect.tool==='query_credits'&&!Object.values(result.groups||{}).some(g=>g.length))issues.push('expected call returns no credits');
 const titleOf=t.ordinal?t.ordinal.list[t.ordinal.index-1][0]:t.item?.[0];
 if(titleOf&&d.expect.tool!=='choose_card'&&!JSON.stringify(result).includes(titleOf))issues.push('expected call does not return '+titleOf);
 if(t.item&&anyIn(d.question,t.item))issues.push('question already names the item');
 if(t.programme&&anyIn(d.question,t.programme))issues.push('question already names the programme');
 return issues;
}
