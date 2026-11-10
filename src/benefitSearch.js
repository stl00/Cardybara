import {queryKnowledge,knowledgeEntities} from './knowledge.js';
import {matchCardProduct} from './productCatalog.js';
import {expandQuery,askedText,programmesForFilter,toSimplified} from './benefitVocabulary.js';
import {unheldProduct} from './namedProduct.js';
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
// English function words: rule text now includes English originals, where these words match everything.
const EN_STOP=new Set('the and for are you can not will this that from any all per may must get use how does did was has its into our their they there when what who why where about also more than then them these those each both after before been would could should one out off own just now been is to of in on at by or an be as it if no do'.split(' '));
const tokens=text=>[...new Set([...norm(text).matchAll(/[a-z][a-z-]{2,}|[\u3400-\u9fff]{2,}/g)].flatMap(([t])=>/^[a-z]/.test(t)?[t]:Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2))))].filter(t=>!['what','which','have','with','your','card','cards','benefits','benefit','我的','哪些','什么','什麼','可以','怎么','怎麼','有没有','福利','权益','權益','帮我','幫我'].includes(t)&&!EN_STOP.has(t));
const GENERIC_ZH=/^(?:我)?(?:有|有哪些|的|全部|所有|持卡|卡片|卡|福利|权益|權益|什么|什麼|\s)*$/,GENERIC_EN=/^(?:what |which )?(?:are |do i have |do i get )?(?:my |all |the )?(?:credit )?(?:cards? ?)?(?:benefits?|perks?)(?: do i (?:have|get)| i have)?\??$/i;
// Words that name no card in particular, even when a product name contains them.
const STOP=new Set(['the','card','cards','credit','debit','my','what','which','are','have','get','and','for','with','your','all','benefits','benefit','perks','perk','american','express']);
const words=s=>(norm(s).match(/[a-z][a-z-]{2,}/g)||[]).filter(w=>!STOP.has(w));
// A whole-card question names the card and asks for everything: "Delta perks". The words that name held cards
// are set aside; if the rest is generic, the search lists every benefit of the cards those words name.
function genericScope(question,cards){
 const q=String(question).trim();if(GENERIC_ZH.test(q)||GENERIC_EN.test(q))return {cards,programmes:[]};
 const names=cards.map(c=>({c,w:new Set([...words(c.name),...words(c.bank)])})),named=words(q).filter(w=>names.some(n=>n.w.has(w)));
 const rest=named.reduce((t,w)=>t.replace(new RegExp(`\\b${w}\\b`,'ig'),' '),q).replace(/\s+/g,' ').replace(/^ | $/g,'').replace(/^(?:(?:what|which) (?:are )?)?(?:my|the) /i,'').replace(/^(?:what|which) are /i,'');
 if(!named.length||!(GENERIC_ZH.test(rest)||GENERIC_EN.test(rest)||/^(?:card )?(?:benefits?|perks?)\??$/i.test(rest)))return null;
 // A naming word that is also a programme (Delta, Hyatt) also brings that programme's rules from the other held cards.
 return {cards:names.filter(n=>named.every(w=>n.w.has(w))).map(n=>n.c),programmes:named.flatMap(w=>programmesForFilter(w,{exact:true}))};
}
// English words match from a word start: with English originals in the text, car must not match card, so a short
// word must be whole (plural allowed), while five letters or more may be a prefix (loung finds lounge). Chinese pairs keep substring matching.
const hasTerm=term=>{if(!/^[a-z]/.test(term))return text=>text.includes(term);const re=new RegExp(term.length>=5?`\\b${term}`:`\\b${term}(?:s|es)?\\b`);return text=>re.test(text);};
// The issuer's name is in many originals (American Express Travel) and says nothing about the benefit; left in,
// it ties HK Express or any "express" question to unrelated Amex rules.
const issuerFree=s=>norm(s).replace(/\bamerican express\b/g,' ');
// About one concept match: enough to lead among equals, not enough to bury a rule the words point to.
const FILTER_BONUS=7;
// CONCEPT and OUTSIDE_FILTER_MIN were tuned together on the development set (#161) under constraints: no lower recall,
// no more forbidden hits or no-answer noise, and no lower recall on the real model's stored calls. The other weights
// were shown not to matter (#147) and keep their first values.
const CONCEPT=6,OUTSIDE_FILTER_MIN=10;
// Words are weighted by IDF over every active benefit rule, scaled so a word found in 10 rules keeps the flat points
// (title 5, programme 6, body 1): rare words weigh more, and words in many English originals ("credit") far less.
// A word in more than a quarter of rules is common: it still adds its small weight, but on its own it neither makes a
// rule match nor earns a category boost (#161).
const COMMON_SHARE=0.25;
const ruleTexts=r=>[r.content,...(r.original?[r.original]:[]),...Object.values(r.translations||{})];
const docCache=new Map();
const docOf=r=>{if(!docCache.has(r.revisionId)){const texts=ruleTexts(r);docCache.set(r.revisionId,{title:issuerFree(texts.map(t=>t.title).join(' ')),body:issuerFree([...texts.flatMap(t=>[t.summary,...t.howToUse]),...(r.original?.quotes||[]).map(q=>q.text)].join(' ')),programmes:r.programmeIds.map(id=>norm(knowledgeEntities.programmes.find(p=>p.id===id)?.name||id)).join(' ')});}return docCache.get(r.revisionId);};
const corpusCache=new Map();
function corpus(asOf){
 // One snapshot day at a time; the per-word tables are capped, since their keys are words people type.
 if(!corpusCache.has(asOf)){corpusCache.clear();const rules=queryKnowledge({kind:'benefit',asOf}).rules.map(docOf),vocab=new Set();for(const d of rules)for(const w of (d.title+' '+d.programmes+' '+d.body).match(/[a-z][a-z-]{4,}/g)||[])vocab.add(w);corpusCache.set(asOf,{docs:rules,vocab:[...vocab],df:new Map(),typos:new Map()});}
 const c=corpusCache.get(asOf);if(c.df.size>5000)c.df.clear();if(c.typos.size>5000)c.typos.clear();
 return corpusCache.get(asOf);
}
const idf=(df,n)=>Math.log(1+(n-df+0.5)/(df+0.5));
function wordStats(term,has,asOf){
 const c=corpus(asOf);if(!c.df.has(term))c.df.set(term,c.docs.filter(d=>has(d.title)||has(d.programmes)||has(d.body)).length);
 const df=c.df.get(term),n=c.docs.length;return {weight:idf(df,n)/idf(10,n),common:df>COMMON_SHARE*n,df};
}
// One insertion, deletion or swap of neighbouring letters; no substitution, which turns real words into others (diving → dining).
function oneEdit(a,b){if(Math.abs(a.length-b.length)!==1&&a.length!==b.length||a===b)return false;let i=0;while(i<a.length&&a[i]===b[i])i++;
 if(a.length===b.length)return a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2);
 return a.length<b.length?a.slice(i)===b.slice(i+1):a.slice(i+1)===b.slice(i);}
// An English word of six letters or more that no rule contains also matches rule words one edit away (rideshre → rideshare).
// Fixed words add search terms only: they do not fire concepts or make a question topical.
function typoFixes(text,asOf){
 const c=corpus(asOf);
 return [...new Set(tokens(text).filter(t=>/^[a-z]{6,}$/.test(t)).flatMap(t=>{if(!c.typos.has(t))c.typos.set(t,wordStats(t,hasTerm(t),asOf).df?[]:c.vocab.filter(w=>oneEdit(t,w)));return c.typos.get(t);}))];
}
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
export function searchBenefitKnowledge(question,cards,asOf,filters={}){
 // A product the wallet doesn't hold has no benefits here; the rest of the words must not pull in other cards' rules.
 const unheld=unheldProduct(question,cards,asOf);
 if(unheld)return {rules:[],total:0,wordMatches:0,truncated:false,unheldProduct:unheld,method:'structured-filter+multilingual-idf-ranking',asOf};
 // Scoring runs on the expanded query (Simplified characters, glossary and alias words); the strict partner filter and the generic check use the words as asked.
 const scope=genericScope(question,cards),generic=!!scope?.cards.length,scoped=new Set((scope?.cards||[]).map(c=>matchCardProduct(c).product?.id).filter(Boolean));
 const asked=expandQuery(question),fixes=typoFixes(asked,asOf),text=fixes.length?asked+' '+fixes.join(' '):asked,products=new Set(cards.map(c=>matchCardProduct(c).product?.id).filter(Boolean));
 const signals=concepts.filter(([,re])=>re.test(asked)),requestedPartners=generic?[]:partners.filter(([,re])=>re.test(askedText(question))).map(([id])=>id);
 // A programme filter in any language or alias: 万豪 and Bonvoy both mean Marriott Bonvoy.
 const programmeIds=filters.programme?programmesForFilter(filters.programme):null;
 const terms=generic?[]:tokens(text),matchers=terms.map(term=>{const has=hasTerm(term);return [term,has,wordStats(term,has,asOf)];});
 // Common words count like 年度 or perks when judging whether the question names something no rule mentions.
 const commonTerms=new Set(matchers.filter(([,,st])=>st.common).map(([t])=>t));
 // Scenario and category are soft: a rule outside them still competes on its words, because the model often picks
 // the neighbouring scenario (Global Entry as travel, not airport). A named programme stays a hard filter.
 const rows=queryKnowledge({kind:'benefit',asOf}).rules.filter(r=>r.productIds.some(id=>products.has(id))&&(!generic||r.productIds.some(id=>scoped.has(id))||r.programmeIds.some(id=>scope.programmes.includes(id))));
 const ranked=[];
 for(const r of rows){
  // Every language the rule has is searched: the zh-CN text, the official original with its quotes, and any display translation.
  const {title,body,programmes}=docOf(r);
  if(filters.programme&&!(programmeIds.some(id=>r.programmeIds.includes(id))||norm(programmes+' '+title).includes(norm(filters.programme))))continue;
  // Match any explicitly requested partner so comparisons retain both sides.
  const matchedPartners=requestedPartners.filter(id=>norm(title+' '+body+' '+programmes).includes(id));
  if(requestedPartners.length&&!matchedPartners.length)continue;
  // specific: the rule matched on a concept, a partner or an uncommon word, not on common words alone.
  let score=0,specific=false;const matched=[];
  for(const [key,re,scenarios,ruleRe] of signals){const relevant=scenarios.some(id=>r.scenarioIds.includes(id))||(ruleRe||re).test(title+' '+body)||(key==='membership'&&r.category==='membership');if(relevant){score+=key==='membership'?5:CONCEPT;matched.push(key);specific=true;}}
  for(const [term,has,stats] of matchers){const points=has(title)?5:has(programmes)?6:has(body)?1:0;if(!points)continue;score+=points*stats.weight;matched.push(term);if(!stats.common)specific=true;}
  if(matchedPartners.length){score+=12;matched.push(...matchedPartners);specific=true;}
  if(!specific)score=0;
  const wordScore=score,inFilter=(!filters.scenarioId||r.scenarioIds.includes(filters.scenarioId))&&(!filters.category||r.category===filters.category),filtered=!!(filters.scenarioId||filters.category);
  // Outside the scenario or category, a rule needs a real word match (a concept or two title words) to compete,
  // judged before the category boosts below, and it does not get those boosts.
  if(filtered&&!inFilter&&wordScore<OUTSIDE_FILTER_MIN)continue;
  const boosted=!filtered||inFilter;
  if(boosted&&score&&/省|抵扣|优惠|優惠|credit|save|discount/i.test(text)&&['credit','promo','hotel-service'].includes(r.category))score+=8;
  if(boosted&&score&&/会籍|會籍|status|membership/i.test(text)&&r.category==='membership')score+=10;
  if(boosted&&score&&/休息室|贵宾|貴賓|lounge/i.test(text)&&r.category==='lounge')score+=10;
  // A filtered rule stays in even without a word match, but is counted, so the tool can tell a filter-only result apart.
  const lexical=score>0;
  if(filtered&&inFilter)score+=FILTER_BONUS;
  else if(filters.programme&&!filters.scenarioId&&!filters.category)score+=4;
  if(!score&&!generic)continue;
  ranked.push({...r,retrieval:{score,matched:[...new Set(matched)],lexical,inFilter:filtered&&inFilter}});
 }
 // Only words like 年度 or perks matched, with no scenario, partner or filter: the thing asked about (量子传送舱) is in no
 // rule, and rules that merely mention a year are not an answer.
 // A brand alias or glossary word the vocabulary expanded (沃尔玛 → Walmart+) also makes the question topical.
 const topical=signals.some(([key])=>key!=='membership')||requestedPartners.length||filters.scenarioId||filters.category||filters.programme||asked!==askedText(question);
 // Judged on every candidate, so a real match crowded out of the top of a large wallet still counts.
 // Also when nothing matched at all: a question naming something no rule mentions gets the same answer, not suggestions.
 const thing=!generic&&!topical&&ranked.every(r=>r.retrieval.matched.every(m=>WEAK.has(m)||commonTerms.has(m)))&&askedThing(question);
 if(thing)return {rules:[],total:0,wordMatches:0,truncated:false,unknownSubject:{named:thing},method:'structured-filter+multilingual-idf-ranking',asOf};
 // On equal scores, a rule inside the chosen scenario or category comes first.
 ranked.sort((a,b)=>b.retrieval.score-a.retrieval.score||b.retrieval.inFilter-a.retrieval.inFilter||a.id.localeCompare(b.id));
 const limit=Math.max(1,Math.min(24,filters.limit||12));
 return {rules:ranked.slice(0,limit),total:ranked.length,wordMatches:ranked.filter(r=>r.retrieval.lexical||generic).length,truncated:ranked.length>limit,method:'structured-filter+multilingual-idf-ranking',asOf};
}
