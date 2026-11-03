import {queryKnowledge,knowledgeEntities} from './knowledge.js';
import {matchCardProduct} from './productCatalog.js';
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
export function searchBenefitKnowledge(text,cards,asOf,filters={}){
 const products=new Set(cards.map(c=>matchCardProduct(c).product?.id).filter(Boolean));
 const signals=concepts.filter(([,re])=>re.test(text)),requestedPartners=partners.filter(([,re])=>re.test(text)).map(([id])=>id);
 const terms=tokens(text),generic=/^(?:我)?(?:有|有哪些|的|全部|所有|持卡|卡片|福利|权益|權益|什么|什麼|\s)*$/.test(text)||/^(?:my |all )?(?:card )?benefits?\??$/i.test(text.trim());
 const rows=queryKnowledge({kind:'benefit',asOf,...(filters.scenarioId?{scenarioId:filters.scenarioId}:{}),...(filters.category?{category:filters.category}:{})}).rules.filter(r=>r.productIds.some(id=>products.has(id)));
 const ranked=[];
 for(const r of rows){
  const title=norm(r.content.title),body=norm(r.content.summary+' '+r.content.howToUse.join(' ')),programmes=r.programmeIds.map(id=>norm(knowledgeEntities.programmes.find(p=>p.id===id)?.name||id)).join(' ');
  if(filters.programme&&!norm(programmes+' '+title).includes(norm(filters.programme)))continue;
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
  if(filters.scenarioId||filters.programme||filters.category)score+=4;
  if(!score&&!generic)continue;
  ranked.push({...r,retrieval:{score,matched:[...new Set(matched)]}});
 }
 ranked.sort((a,b)=>b.retrieval.score-a.retrieval.score||a.id.localeCompare(b.id));
 const limit=Math.max(1,Math.min(24,filters.limit||12));
 return {rules:ranked.slice(0,limit),total:ranked.length,truncated:ranked.length>limit,method:'structured-filter+multilingual-lexical-ranking',asOf};
}
