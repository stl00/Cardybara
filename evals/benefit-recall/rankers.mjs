// Rankers for the benefit search analysis in #147. Analysis only: production scoring stays in src/benefitSearch.js.
// rubricSearch(weights) is a copy of the production scoring with every weight as a parameter; the lab checks it returns
// the same rules, order, scores and totals as production at DEFAULT_WEIGHTS, so a drift in either copy fails loudly.
// Only ranking is copied: wordMatches, matched terms and truncation (used by find_benefits suggestions) are not.
// bm25Search(options) ranks the same rule fields with BM25 over the same tokens, with or without the structural signals.
import {queryKnowledge,knowledgeEntities} from '../../src/knowledge.js';
import {matchCardProduct} from '../../src/productCatalog.js';
import {expandQuery,askedText,programmesForFilter,toSimplified} from '../../src/benefitVocabulary.js';
import {unheldProduct} from '../../src/namedProduct.js';

// ---- Copied from src/benefitSearch.js (parity-checked) ----
const concepts=[
 ['hotel',/酒店|饭店|飯店|住宿|住一晚|订房|訂房|入住|hotel|stay|resort|hilton|marriott|hyatt|ihg|accor|radisson|希尔顿|希爾頓|万豪|萬豪|凯悦|凱悅|洲际|洲際/i,['hotel-stay']],
 ['airport',/机场|機場|候机|候機|贵宾|貴賓|休息室|lounge|airport|priority pass|centurion/i,['airport']],
 ['dining',/餐饮|餐飲|餐厅|餐廳|吃饭|吃飯|下馆|下館|饭钱|飯錢|外卖|外賣|订餐|訂餐|restaurant|dining|dinner|meal|resy|dunkin/i,['dining']],
 ['transport',/打车|打車|网约车|網約車|出租车|出租車|uber|lyft|rideshare|taxi/i,['ground-transport']],
 ['entertainment',/追剧|追劇|影音|订阅|訂閱|流媒体|流媒體|streaming|disney|hulu|peacock|subscription/i,['entertainment']],
 ['fitness',/健身|运动|運動|fitness|gym|equinox|lululemon/i,['fitness']],
 ['membership',/会籍|會籍|会员|會員|身份|status|membership/i,[]],
 // Airline spending: the question says airline; a rule names the airline (Air Canada) or says airline or flight. (#161)
 ['airline',/airline|airfare|航空公司|航司|机票|機票|plane ticket|flight ticket/i,[],/air canada|airlines?\b|航空|航司|机票|機票|机上|機上|\bflights?\b|in-?flight/i],
];
const partners=[['hilton',/hilton|希尔顿|希爾頓/i],['marriott',/marriott|万豪|萬豪/i],['hyatt',/hyatt|凯悦|凱悅/i],['ihg',/\bihg\b|洲际|洲際/i],['accor',/accor|雅高/i],['radisson',/radisson|丽笙|麗笙/i],['uber',/uber|优步|優步/i],['disney',/disney|迪士尼/i],['resy',/resy/i],['dunkin',/dunkin/i]];
const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
const STOP_TERMS=['what','which','have','with','your','card','cards','benefits','benefit','我的','哪些','什么','什麼','可以','怎么','怎麼','有没有','福利','权益','權益','帮我','幫我'];
const allTokens=text=>[...norm(text).matchAll(/[a-z][a-z-]{2,}|[㐀-鿿]{2,}/g)].flatMap(([t])=>/^[a-z]/.test(t)?[t]:Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)));
const EN_STOP=new Set('the and for are you can not will this that from any all per may must get use how does did was has its into our their they there when what who why where about also more than then them these those each both after before been would could should one out off own just now been is to of in on at by or an be as it if no do'.split(' '));
const tokens=text=>[...new Set(allTokens(text))].filter(t=>!STOP_TERMS.includes(t)&&!EN_STOP.has(t));
const hasTerm=term=>{if(!/^[a-z]/.test(term))return text=>text.includes(term);const re=new RegExp(term.length>=5?`\\b${term}`:`\\b${term}(?:s|es)?\\b`);return text=>re.test(text);};
const issuerFree=s=>norm(s).replace(/\bamerican express\b/g,' ');
const ruleTexts=r=>[r.content,...(r.original?[r.original]:[]),...Object.values(r.translations||{})];
const GENERIC_ZH=/^(?:我)?(?:有|有哪些|的|全部|所有|持卡|卡片|卡|福利|权益|權益|什么|什麼|\s)*$/,GENERIC_EN=/^(?:what |which )?(?:are |do i have |do i get )?(?:my |all |the )?(?:credit )?(?:cards? ?)?(?:benefits?|perks?)(?: do i (?:have|get)| i have)?\??$/i;
const STOP=new Set(['the','card','cards','credit','debit','my','what','which','are','have','get','and','for','with','your','all','benefits','benefit','perks','perk','american','express']);
const words=s=>(norm(s).match(/[a-z][a-z-]{2,}/g)||[]).filter(w=>!STOP.has(w));
function genericScope(question,cards){
 const q=String(question).trim();if(GENERIC_ZH.test(q)||GENERIC_EN.test(q))return {cards,programmes:[]};
 const names=cards.map(c=>({c,w:new Set([...words(c.name),...words(c.bank)])})),named=words(q).filter(w=>names.some(n=>n.w.has(w)));
 const rest=named.reduce((t,w)=>t.replace(new RegExp(`\\b${w}\\b`,'ig'),' '),q).replace(/\s+/g,' ').replace(/^ | $/g,'').replace(/^(?:(?:what|which) (?:are )?)?(?:my|the) /i,'').replace(/^(?:what|which) are /i,'');
 if(!named.length||!(GENERIC_ZH.test(rest)||GENERIC_EN.test(rest)||/^(?:card )?(?:benefits?|perks?)\??$/i.test(rest)))return null;
 return {cards:names.filter(n=>named.every(w=>n.w.has(w))).map(n=>n.c),programmes:named.flatMap(w=>programmesForFilter(w,{exact:true}))};
}
// #160: weak words and the asked-about thing.
// Words that say what kind of benefit is wanted (yearly, perks, membership, 优惠) but not what it is about.
const WEAK=new Set(['membership','年度','每年','annual','yearly','perks','perk','privileges','会员','优惠','福利','待遇','礼遇','好处']);
// What is left of a question without those words and question fillers: the thing it asks about.
const ZH_FILLER=/我的|我|你|您|有没有|有沒有|有冇|有哪些|有什么|有什麼|有啥|有咩|什么|什麼|哪些|哪张|哪張|怎么|怎麼|如何|多少|可以|能够|能夠|告诉|告訴|看看|列出|所有|全部|今年|每月|[有啥咩乜吗嗎呢的了吧啊呀能会會是都还還和与與跟在用张張卡哪些么麼几幾个個一这這那请請帮幫下查]/g;
const askedThing=question=>{
 const text=toSimplified(norm(question)).replace(/[^\p{L}\p{N}\s]/gu,' ');
 const han=(text.match(/[\u3400-\u9fff]+/g)||[]).map(run=>[...WEAK].reduce((t,w)=>t.replaceAll(w,' '),run).replace(ZH_FILLER,' ')).join(' ').replace(/\s+/g,'');
 const latin=(text.match(/[a-z][a-z-]{2,}/g)||[]).filter(w=>!WEAK.has(w)&&!EN_STOP.has(w)&&!STOP.has(w)&&!['do','does','give','offer','offers','get','what','which','any'].includes(w));
 return han.length>=2||latin.length?[han,...latin].filter(Boolean).join(' '):null;
};
// ---- end of copy ----

// Production since #161: IDF-weighted words with common words gated, typo fixes, concept 6, outsideMin 10.
export const DEFAULT_WEIGHTS=Object.freeze({concept:6,membershipConcept:5,title:5,programme:6,body:1,partner:12,creditBoost:8,membershipBoost:10,loungeBoost:10,filterBonus:7,outsideMin:10,programmeOnly:4,minScore:0,idf:true,commonShare:0.25,typos:true});
// The flat-count rubric before #161, for comparison.
export const FLAT_WEIGHTS=Object.freeze({...DEFAULT_WEIGHTS,concept:7,outsideMin:8,idf:false,typos:false});
const programmeName=id=>norm(knowledgeEntities.programmes.find(p=>p.id===id)?.name||id);

// Caches: the lab runs thousands of searches over the same rules, cards and questions. Results are the same as uncached.
const memo=(map,key,make)=>map.has(key)?map.get(key):(map.set(key,make()),map.get(key));
const rulesCache=new Map(),productCache=new WeakMap(),docCache=new Map(),expandCache=new Map();
const activeRules=asOf=>memo(rulesCache,asOf,()=>queryKnowledge({kind:'benefit',asOf}).rules);
const productOf=c=>{if(!productCache.has(c))productCache.set(c,matchCardProduct(c).product?.id);return productCache.get(c);};
const docOf=r=>memo(docCache,r.revisionId,()=>{const texts=ruleTexts(r);return {r,title:issuerFree(texts.map(t=>t.title).join(' ')),body:issuerFree([...texts.flatMap(t=>[t.summary,...t.howToUse]),...(r.original?.quotes||[]).map(q=>q.text)].join(' ')),programmes:r.programmeIds.map(programmeName).join(' ')};});
const matcherCache=new Map(),dfCache=new Map();
const matcherOf=t=>memo(matcherCache,t,()=>hasTerm(t));
// IDF over every active benefit rule, counting a rule once if the word is anywhere in it. A word's points are scaled
// so that a word in 10 rules keeps the rubric's flat points; rarer words weigh more, common ones ("credit") less.
const idfOf=(df,N)=>Math.log(1+(N-df+0.5)/(df+0.5));
const dfOf=(term,asOf)=>{const all=activeRules(asOf),has=matcherOf(term);return memo(dfCache,asOf+'|'+term,()=>all.filter(r=>{const d=docOf(r);return has(d.title)||has(d.programmes)||has(d.body);}).length);};
function idfWeight(term,asOf){const N=activeRules(asOf).length;return idfOf(dfOf(term,asOf),N)/idfOf(10,N);}
// A word in more than commonShare of all rules ("credit", "card", 登记) tells rules apart too little to count as a match on its own.
const isCommon=(term,asOf,share)=>dfOf(term,asOf)>share*activeRules(asOf).length;
// Typo tolerance: an English query word of five letters or more that no rule contains also matches the rule words one
// edit away (rideshre → rideshare, resturant → restaurant).
const vocabCache=new Map();
const vocabulary=asOf=>memo(vocabCache,asOf,()=>{const v=new Set();for(const r of activeRules(asOf)){const d=docOf(r);for(const w of (d.title+' '+d.programmes+' '+d.body).match(/[a-z][a-z-]{4,}/g)||[])v.add(w);}return [...v];});
// One insertion, deletion or swap of neighbouring letters; no substitution, which turns real words into others (diving → dining).
function oneEdit(a,b){if(Math.abs(a.length-b.length)!==1&&a.length!==b.length||a===b)return false;let i=0;while(i<a.length&&a[i]===b[i])i++;
 if(a.length===b.length)return a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);
 return a.length<b.length?a.slice(i)===b.slice(i+1):a.slice(i+1)===b.slice(i);}
const typoCache=new Map();
const corrections=(term,asOf)=>memo(typoCache,asOf+'|'+term,()=>!/^[a-z]{6,}$/.test(term)||dfOf(term,asOf)?[]:vocabulary(asOf).filter(w=>oneEdit(term,w)));
// What every ranker shares: held products, whole-card scope, partner and programme filters, and the scenario/category test.
function prepare(question,cards,asOf,filters){
 const scope=genericScope(question,cards),generic=!!scope?.cards.length,scoped=new Set((scope?.cards||[]).map(productOf).filter(Boolean));
 const text=memo(expandCache,question,()=>expandQuery(question)),products=new Set(cards.map(productOf).filter(Boolean));
 const requestedPartners=generic?[]:partners.filter(([,re])=>re.test(askedText(question))).map(([id])=>id);
 const programmeIds=filters.programme?programmesForFilter(filters.programme):null;
 const rows=activeRules(asOf).filter(r=>r.productIds.some(id=>products.has(id))&&(!generic||r.productIds.some(id=>scoped.has(id))||r.programmeIds.some(id=>scope.programmes.includes(id))));
 const docs=rows.map(docOf);
 const passesHard=d=>{
  if(filters.programme&&!(programmeIds.some(id=>d.r.programmeIds.includes(id))||norm(d.programmes+' '+d.title).includes(norm(filters.programme))))return null;
  const matchedPartners=requestedPartners.filter(id=>norm(d.title+' '+d.body+' '+d.programmes).includes(id));
  if(requestedPartners.length&&!matchedPartners.length)return null;
  return matchedPartners;
 };
 const filtered=!!(filters.scenarioId||filters.category),inFilter=r=>(!filters.scenarioId||r.scenarioIds.includes(filters.scenarioId))&&(!filters.category||r.category===filters.category);
 return {generic,text,docs,passesHard,filtered,inFilter,requestedPartners};
}
const finish=(ranked,filters,asOf)=>{
 ranked.sort((a,b)=>b.retrieval.score-a.retrieval.score||b.retrieval.inFilter-a.retrieval.inFilter||a.id.localeCompare(b.id));
 const limit=Math.max(1,Math.min(24,filters.limit||12));
 return {rules:ranked.slice(0,limit),total:ranked.length,asOf};
};

export function rubricSearch(weights=DEFAULT_WEIGHTS){
 const W={...DEFAULT_WEIGHTS,...weights};
 return (question,cards,asOf,filters={})=>{
  // #160: a product the wallet doesn't hold has no benefits here.
  if(unheldProduct(question,cards,asOf))return {rules:[],total:0,asOf};
  const {generic,text,docs,passesHard,filtered,inFilter,requestedPartners}=prepare(question,cards,asOf,filters);
  const commonSeen=new Set();
  const fixed=W.typos?[...new Set(tokens(text).flatMap(t=>corrections(t,asOf)))]:[],full=fixed.length?text+' '+fixed.join(' '):text;
  const signals=concepts.filter(([,re])=>re.test(text)),terms=generic?[]:tokens(full),matchers=terms.map(t=>[t,matcherOf(t)]),ranked=[];
  if(W.idf)for(const t of terms)if(isCommon(t,asOf,W.commonShare))commonSeen.add(t);
  for(const d of docs){
   const matchedPartners=passesHard(d);if(!matchedPartners)continue;
   const {r,title,body,programmes}=d;let score=0;const matched=[];
   // specific: the rule matched on something other than common words (a concept, a partner, or a rarer word).
   let specific=false;
   for(const [key,re,scenarios,ruleRe] of signals){const relevant=scenarios.some(id=>r.scenarioIds.includes(id))||(ruleRe||re).test(title+' '+body)||(key==='membership'&&r.category==='membership');if(relevant){score+=key==='membership'?W.membershipConcept:W.concept;specific=true;matched.push(key);}}
   for(const [term,has] of matchers){const k=W.idf?idfWeight(term,asOf):1,hit=has(title)?W.title:has(programmes)?W.programme:has(body)?W.body:0;if(!hit)continue;score+=hit*k;matched.push(term);if(!W.idf||!isCommon(term,asOf,W.commonShare))specific=true;}
   if(matchedPartners.length){score+=W.partner;specific=true;matched.push(...matchedPartners);}
   // With IDF, common words still add their small weight, but alone they neither qualify a rule nor earn a boost.
   if(W.idf&&!specific)score=0;
   const inside=inFilter(r);
   if(filtered&&!inside&&score<W.outsideMin)continue;
   const boosted=!filtered||inside;
   if(boosted&&score&&/省|抵扣|优惠|優惠|credit|save|discount/i.test(text)&&['credit','promo','hotel-service'].includes(r.category))score+=W.creditBoost;
   if(boosted&&score&&/会籍|會籍|status|membership/i.test(text)&&r.category==='membership')score+=W.membershipBoost;
   if(boosted&&score&&/休息室|贵宾|貴賓|lounge/i.test(text)&&r.category==='lounge')score+=W.loungeBoost;
   if(filtered&&inside)score+=W.filterBonus;else if(filters.programme&&!filtered)score+=W.programmeOnly;
   if(!score&&!generic)continue;
   // Not in production: a floor for unfiltered results, to see how much no-answer noise a threshold removes.
   if(!generic&&!(filtered&&inside)&&score<W.minScore)continue;
   ranked.push({...r,retrieval:{score,inFilter:filtered&&inside,matched}});
  }
  const topical=signals.some(([key])=>key!=='membership')||requestedPartners.length||filters.scenarioId||filters.category||filters.programme||text!==askedText(question);
  if(!generic&&!topical&&ranked.every(x=>x.retrieval.matched.every(m=>WEAK.has(m)||(W.idf&&commonSeen.has(m))))&&askedThing(question))return {rules:[],total:0,asOf};
  return finish(ranked,filters,asOf);
 };
}

// BM25 over title, programme names and body as one document, with the title and programme names counted titleWeight
// times. Document frequencies come from every active benefit rule, so a word's weight does not depend on the wallet.
const statsCache=new Map();
function corpusStats(asOf,titleWeight){
 const key=asOf+'|'+titleWeight;if(statsCache.has(key))return statsCache.get(key);
 const docTokens=r=>{const d=docOf(r),t=allTokens(d.title),p=allTokens(d.programmes),b=allTokens(d.body);return [...Array(titleWeight).fill([...t,...p]).flat(),...b];};
 const all=activeRules(asOf),df=new Map(),len=new Map();let total=0;
 for(const r of all){const toks=docTokens(r);len.set(r.id,toks.length);total+=toks.length;for(const t of new Set(toks))df.set(t,(df.get(t)||0)+1);}
 const stats={N:all.length,avg:total/all.length,df,len,docTokens,tfCache:new Map()};statsCache.set(key,stats);return stats;
}
export function bm25Search({structure=false,k1=1.2,b=0.75,titleWeight=2,filterShare=0.5,outsideShare=0.5,minShare=0}={}){
 return (question,cards,asOf,filters={})=>{
  const {generic,text,docs,passesHard,filtered,inFilter}=prepare(question,cards,asOf,filters);
  const S=corpusStats(asOf,titleWeight),terms=tokens(text),idf=t=>Math.log(1+(S.N-(S.df.get(t)||0)+0.5)/((S.df.get(t)||0)+0.5));
  const scored=[];
  for(const d of docs){
   // Plain BM25 ignores the programme, partner and scenario/category filters (so its B and C results are the same), but
   // keeps the held-card and whole-card row selection shared with production. The structured variant applies them all.
   const matchedPartners=structure?passesHard(d):[];if(!matchedPartners)continue;
   const {toks,tf}=memo(S.tfCache,d.r.revisionId,()=>{const toks=S.docTokens(d.r),tf=new Map();for(const t of toks)tf.set(t,(tf.get(t)||0)+1);return {toks,tf};});
   let s=0;for(const t of terms){const f=tf.get(t)||0;if(f)s+=idf(t)*f*(k1+1)/(f+k1*(1-b+b*toks.length/S.avg));}
   scored.push({d,s,partner:matchedPartners.length>0});
  }
  const top=Math.max(0,...scored.map(x=>x.s)),ranked=[];
  for(const {d,s,partner} of scored){
   if(!structure){if(s>0)ranked.push({...d.r,retrieval:{score:s,inFilter:false}});continue;}
   // Structure on the BM25 scale: shares of the best text score stand in for the rubric's fixed points.
   let score=s+(partner?top*0.5:0);const inside=inFilter(d.r);
   if(filtered&&!inside&&s<outsideShare*top)continue;
   if(filtered&&inside)score+=filterShare*top||1;
   if(!generic&&s<=minShare*top&&!(filtered&&inside))continue;
   if(!score&&!generic)continue;
   ranked.push({...d.r,retrieval:{score:generic&&!score?0:score,inFilter:filtered&&inside}});
  }
  return finish(ranked,filters,asOf);
 };
}
