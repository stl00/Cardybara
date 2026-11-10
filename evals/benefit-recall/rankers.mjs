// Rankers for the benefit search analysis in #147. Analysis only: production scoring stays in src/benefitSearch.js.
// rubricSearch(weights) is a copy of the production scoring with every weight as a parameter; the lab checks it returns
// the same rules, order, scores and totals as production at DEFAULT_WEIGHTS, so a drift in either copy fails loudly.
// Only ranking is copied: wordMatches, matched terms and truncation (used by find_benefits suggestions) are not.
// bm25Search(options) ranks the same rule fields with BM25 over the same tokens, with or without the structural signals.
import {queryKnowledge,knowledgeEntities} from '../../src/knowledge.js';
import {matchCardProduct} from '../../src/productCatalog.js';
import {expandQuery,askedText,programmesForFilter} from '../../src/benefitVocabulary.js';

// ---- Copied from src/benefitSearch.js (parity-checked) ----
const concepts=[
 ['hotel',/酒店|饭店|飯店|住宿|住一晚|订房|訂房|入住|hotel|stay|resort|hilton|marriott|hyatt|ihg|accor|radisson|希尔顿|希爾頓|万豪|萬豪|凯悦|凱悅|洲际|洲際/i,['hotel-stay']],
 ['airport',/机场|機場|候机|候機|贵宾|貴賓|休息室|lounge|airport|priority pass|centurion/i,['airport']],
 ['dining',/餐饮|餐飲|餐厅|餐廳|吃饭|吃飯|下馆|下館|饭钱|飯錢|外卖|外賣|订餐|訂餐|restaurant|dining|dinner|meal|resy|dunkin/i,['dining']],
 ['transport',/打车|打車|网约车|網約車|出租车|出租車|uber|lyft|rideshare|taxi/i,['ground-transport']],
 ['entertainment',/追剧|追劇|影音|订阅|訂閱|流媒体|流媒體|streaming|disney|hulu|peacock|subscription/i,['entertainment']],
 ['fitness',/健身|运动|運動|fitness|gym|equinox|lululemon/i,['fitness']],
 ['membership',/会籍|會籍|会员|會員|身份|status|membership/i,[]],
];
const partners=[['hilton',/hilton|希尔顿|希爾頓/i],['marriott',/marriott|万豪|萬豪/i],['hyatt',/hyatt|凯悦|凱悅/i],['ihg',/\bihg\b|洲际|洲際/i],['accor',/accor|雅高/i],['radisson',/radisson|丽笙|麗笙/i],['uber',/uber|优步|優步/i],['disney',/disney|迪士尼/i],['resy',/resy/i],['dunkin',/dunkin/i]];
const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
const STOP_TERMS=['what','which','have','with','your','card','cards','benefits','benefit','我的','哪些','什么','什麼','可以','怎么','怎麼','有没有','福利','权益','權益','帮我','幫我'];
const allTokens=text=>[...norm(text).matchAll(/[a-z][a-z-]{2,}|[㐀-鿿]{2,}/g)].flatMap(([t])=>/^[a-z]/.test(t)?[t]:Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)));
const tokens=text=>[...new Set(allTokens(text))].filter(t=>!STOP_TERMS.includes(t));
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
// ---- end of copy ----

export const DEFAULT_WEIGHTS=Object.freeze({concept:7,membershipConcept:5,title:5,programme:6,body:1,partner:12,creditBoost:8,membershipBoost:10,loungeBoost:10,filterBonus:7,outsideMin:8,programmeOnly:4,minScore:0});
const programmeName=id=>norm(knowledgeEntities.programmes.find(p=>p.id===id)?.name||id);

// Caches: the lab runs thousands of searches over the same rules, cards and questions. Results are the same as uncached.
const memo=(map,key,make)=>map.has(key)?map.get(key):(map.set(key,make()),map.get(key));
const rulesCache=new Map(),productCache=new WeakMap(),docCache=new Map(),expandCache=new Map();
const activeRules=asOf=>memo(rulesCache,asOf,()=>queryKnowledge({kind:'benefit',asOf}).rules);
const productOf=c=>{if(!productCache.has(c))productCache.set(c,matchCardProduct(c).product?.id);return productCache.get(c);};
const docOf=r=>memo(docCache,r.revisionId,()=>({r,title:norm(r.content.title),body:norm(r.content.summary+' '+r.content.howToUse.join(' ')),programmes:r.programmeIds.map(programmeName).join(' ')}));
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
 return {generic,text,docs,passesHard,filtered,inFilter};
}
const finish=(ranked,filters,asOf)=>{
 ranked.sort((a,b)=>b.retrieval.score-a.retrieval.score||b.retrieval.inFilter-a.retrieval.inFilter||a.id.localeCompare(b.id));
 const limit=Math.max(1,Math.min(24,filters.limit||12));
 return {rules:ranked.slice(0,limit),total:ranked.length,asOf};
};

export function rubricSearch(weights=DEFAULT_WEIGHTS){
 const W={...DEFAULT_WEIGHTS,...weights};
 return (question,cards,asOf,filters={})=>{
  const {generic,text,docs,passesHard,filtered,inFilter}=prepare(question,cards,asOf,filters);
  const signals=concepts.filter(([,re])=>re.test(text)),terms=generic?[]:tokens(text),ranked=[];
  for(const d of docs){
   const matchedPartners=passesHard(d);if(!matchedPartners)continue;
   const {r,title,body,programmes}=d;let score=0;
   for(const [key,re,scenarios] of signals){const relevant=scenarios.some(id=>r.scenarioIds.includes(id))||re.test(title+' '+body)||(key==='membership'&&r.category==='membership');if(relevant)score+=key==='membership'?W.membershipConcept:W.concept;}
   for(const term of terms){if(title.includes(term))score+=W.title;else if(programmes.includes(term))score+=W.programme;else if(body.includes(term))score+=W.body;}
   if(matchedPartners.length)score+=W.partner;
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
   ranked.push({...r,retrieval:{score,inFilter:filtered&&inside}});
  }
  return finish(ranked,filters,asOf);
 };
}

// BM25 over title, programme names and body as one document, with the title and programme names counted titleWeight
// times. Document frequencies come from every active benefit rule, so a word's weight does not depend on the wallet.
const statsCache=new Map();
function corpusStats(asOf,titleWeight){
 const key=asOf+'|'+titleWeight;if(statsCache.has(key))return statsCache.get(key);
 const docTokens=r=>{const t=allTokens(r.content.title),p=allTokens(r.programmeIds.map(programmeName).join(' ')),b=allTokens(r.content.summary+' '+r.content.howToUse.join(' '));return [...Array(titleWeight).fill([...t,...p]).flat(),...b];};
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
