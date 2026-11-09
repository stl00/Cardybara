import {queryKnowledge,knowledgeEntities} from './knowledge.js';
import {matchCardProduct} from './productCatalog.js';
import {expandQuery,askedText,programmesForFilter} from './benefitVocabulary.js';
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
const tokens=text=>[...new Set([...norm(text).matchAll(/[a-z][a-z-]{2,}|[\u3400-\u9fff]{2,}/g)].flatMap(([t])=>/^[a-z]/.test(t)?[t]:Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2))))].filter(t=>!['what','which','have','with','your','card','cards','benefits','benefit','我的','哪些','什么','什麼','可以','怎么','怎麼','有没有','福利','权益','權益','帮我','幫我'].includes(t));
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
// About one concept match: enough to lead among equals, not enough to bury a rule the words point to.
const FILTER_BONUS=7;
// Chosen on the development set: lower lets weak matches in (unanswerable questions return noise), higher loses recall.
const OUTSIDE_FILTER_MIN=8;
export function searchBenefitKnowledge(question,cards,asOf,filters={}){
 // Scoring runs on the expanded query (Simplified characters, glossary and alias words); the strict partner filter and the generic check use the words as asked.
 const scope=genericScope(question,cards),generic=!!scope?.cards.length,scoped=new Set((scope?.cards||[]).map(c=>matchCardProduct(c).product?.id).filter(Boolean));
 const text=expandQuery(question),products=new Set(cards.map(c=>matchCardProduct(c).product?.id).filter(Boolean));
 const signals=concepts.filter(([,re])=>re.test(text)),requestedPartners=generic?[]:partners.filter(([,re])=>re.test(askedText(question))).map(([id])=>id);
 // A programme filter in any language or alias: 万豪 and Bonvoy both mean Marriott Bonvoy.
 const programmeIds=filters.programme?programmesForFilter(filters.programme):null;
 const terms=generic?[]:tokens(text);
 // Scenario and category are soft: a rule outside them still competes on its words, because the model often picks
 // the neighbouring scenario (Global Entry as travel, not airport). A named programme stays a hard filter.
 const rows=queryKnowledge({kind:'benefit',asOf}).rules.filter(r=>r.productIds.some(id=>products.has(id))&&(!generic||r.productIds.some(id=>scoped.has(id))||r.programmeIds.some(id=>scope.programmes.includes(id))));
 const ranked=[];
 for(const r of rows){
  const title=norm(r.content.title),body=norm(r.content.summary+' '+r.content.howToUse.join(' ')),programmes=r.programmeIds.map(id=>norm(knowledgeEntities.programmes.find(p=>p.id===id)?.name||id)).join(' ');
  if(filters.programme&&!(programmeIds.some(id=>r.programmeIds.includes(id))||norm(programmes+' '+title).includes(norm(filters.programme))))continue;
  // Match any explicitly requested partner so comparisons retain both sides.
  const matchedPartners=requestedPartners.filter(id=>norm(title+' '+body+' '+programmes).includes(id));
  if(requestedPartners.length&&!matchedPartners.length)continue;
  let score=0;const matched=[];
  for(const [key,re,scenarios] of signals){const relevant=scenarios.some(id=>r.scenarioIds.includes(id))||re.test(title+' '+body)||(key==='membership'&&r.category==='membership');if(relevant){score+=key==='membership'?5:7;matched.push(key);}}
  for(const term of terms){if(title.includes(term)){score+=5;matched.push(term)}else if(programmes.includes(term)){score+=6;matched.push(term)}else if(body.includes(term)){score+=1;matched.push(term)}}
  if(matchedPartners.length){score+=12;matched.push(...matchedPartners)}
  if(score&&/省|抵扣|优惠|優惠|credit|save|discount/i.test(text)&&['credit','promo','hotel-service'].includes(r.category))score+=8;
  if(score&&/会籍|會籍|status|membership/i.test(text)&&r.category==='membership')score+=10;
  if(score&&/休息室|贵宾|貴賓|lounge/i.test(text)&&r.category==='lounge')score+=10;
  // A filtered rule stays in even without a word match, but is counted, so the tool can tell a filter-only result apart.
  const lexical=score>0,inFilter=(!filters.scenarioId||r.scenarioIds.includes(filters.scenarioId))&&(!filters.category||r.category===filters.category);
  // Outside the scenario or category, a rule needs a real word match (a concept or two title words) to compete.
  if((filters.scenarioId||filters.category)&&!inFilter&&score<OUTSIDE_FILTER_MIN)continue;
  if((filters.scenarioId||filters.category)&&inFilter)score+=FILTER_BONUS;
  else if(filters.programme&&!filters.scenarioId&&!filters.category)score+=4;
  if(!score&&!generic)continue;
  ranked.push({...r,retrieval:{score,matched:[...new Set(matched)],lexical}});
 }
 ranked.sort((a,b)=>b.retrieval.score-a.retrieval.score||a.id.localeCompare(b.id));
 const limit=Math.max(1,Math.min(24,filters.limit||12));
 return {rules:ranked.slice(0,limit),total:ranked.length,wordMatches:ranked.filter(r=>r.retrieval.lexical||generic).length,truncated:ranked.length>limit,method:'structured-filter+multilingual-lexical-ranking',asOf};
}
