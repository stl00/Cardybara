// How one cardholder's points accounts relate, per programme and region (#192). The single place that says whether
// card balances are one pool (count once), separate (add up, never usable across cards) or separate but combinable
// (add up; transfer reach is the union of the holder's cards). Totals, transfer routes and the assistant read it.
import data from './data/knowledge/points-pooling.json' with {type:'json'};
import sources from './data/knowledge/sources.json' with {type:'json'};
import {cardProducts,matchCardProduct} from './productCatalog.js';
import {canonicalProgramme} from '../extension-next/bank-adapters.js';

export const POOLING_KINDS=['shared','per-card','per-card-combinable'];
export const poolingRules=structuredClone(data.rules);
export const poolingCheckedAt=data.checkedAt;

/** Errors in the pooling data: unknown kinds, products or sources, or a rule without an owner flag or caveat sources. */
export function validatePooling(rules=data.rules){
 const errors=[],sourceIds=new Set(sources.map(s=>s.id)),productIds=new Set(cardProducts.map(p=>p.id)),seen=new Set();
 for(const r of rules){
  const fail=m=>errors.push(`${r.id}: ${m}`);
  if(seen.has(r.programmeId+'|'+r.region))fail('duplicate programme and region');seen.add(r.programmeId+'|'+r.region);
  if(!POOLING_KINDS.includes(r.pooling))fail('unknown pooling');
  if(typeof r.ownerOverride!=='boolean')fail('ownerOverride must be stated');
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(r.checkedAt||''))fail('checkedAt');
  if(!r.summary||!r.summaryEn)fail('summary in zh-CN and English');
  if(!r.sourceIds?.length||r.sourceIds.some(id=>!sourceIds.has(id)))fail('missing source');
  if(!r.sourceIds?.some(id=>sources.find(s=>s.id===id)?.authority==='official'))fail('needs an official source');
  for(const id of r.earningProductIds||[])if(!productIds.has(id))fail('unknown product '+id);
  for(const c of r.caveats||[])if(!c.id||!c.summary||!c.summaryEn||!c.sourceIds?.length||c.sourceIds.some(id=>!r.sourceIds.includes(id)))fail('caveat '+c.id+' needs text and the rule\'s sources');
 }
 return errors;
}

export const poolingRule=programmeId=>poolingRules.find(r=>r.programmeId===programmeId)||null;
/** The rule for a balance row (a card reading or a stored record), by bank, region and printed programme name. */
export function poolingRuleForRow(row){
 if(!row||row.unit==='USD')return null;
 const programme=canonicalProgramme(row.label||'');
 return poolingRules.find(r=>r.bank===row.bank&&r.region===row.region&&r.reading===programme)||null;
}
const transferProducts=rule=>cardProducts.filter(p=>p.transferProgrammeId===rule.programmeId).map(p=>p.id);
/** The pooling rule a held card belongs to, and whether its own product can transfer to partners. */
export function cardProgramme(card){
 const productId=matchCardProduct(card).product?.id||null;if(!productId)return null;
 for(const rule of poolingRules){
  // A card belongs to a programme in its own issuing region only: Amex HK and US accounts never mix.
  if(card.region&&card.region!==rule.region)continue;
  const transfers=transferProducts(rule).includes(productId);
  if(transfers||rule.earningProductIds.includes(productId))return {rule,productId,transfers};
 }
 return null;
}
/**
 * Which transfer-capable products each held card's points reach. Shared and combinable programmes reach every
 * held transfer card of the programme; a per-card programme reaches only the card's own product.
 */
export function pointsReach(cards){
 const members=cards.map(card=>({card,...cardProgramme(card)})).filter(m=>m.rule);
 return members.map(m=>{
  const own=m.transfers?[m.productId]:[];
  const holders=m.rule.pooling==='per-card'?(m.transfers?[m]:[]):members.filter(o=>o.rule===m.rule&&o.transfers);
  return {card:m.card,rule:m.rule,productId:m.productId,ownTransfer:m.transfers,reachProductIds:[...new Set([...own,...holders.map(o=>o.productId)])],via:holders.filter(o=>o.card!==m.card&&o.productId!==m.productId).map(o=>o.card)};
 });
}
const time=r=>Date.parse(r.capturedAt||r.date||'')||0;
/**
 * Programme totals for the current balance rows. Shared: the newest reading is the pool, counted once. Per card
 * (combinable or not): the newest reading of each card, added up once. A stored record with no card is used only when
 * the programme has no card reading, since adding it to card readings could count the same points twice.
 */
export function programmeTotals(rows=[]){
 const groups=new Map(),covered=new Set();
 for(const row of rows){const rule=poolingRuleForRow(row);if(!rule||!Number.isFinite(row.amount))continue;(groups.get(rule)||groups.set(rule,[]).get(rule)).push(row);covered.add(row);}
 const totals=[...groups.entries()].map(([rule,list])=>{
  const latest=new Map();for(const r of list.filter(r=>r.card))if(!latest.has(r.card)||time(latest.get(r.card))<time(r))latest.set(r.card,r);
  const perCard=[...latest.values()],records=list.filter(r=>!r.card).sort((a,b)=>time(b)-time(a));
  const base={ruleId:rule.id,programmeId:rule.programmeId,bank:rule.bank,region:rule.region,label:rule.label,unit:'points',pooling:rule.pooling,ownerOverride:rule.ownerOverride,cardCount:perCard.length};
  if(rule.pooling==='shared'){
   const newest=[...perCard,...records].sort((a,b)=>time(b)-time(a))[0];
   // Cards of one pool show one balance; different amounts mean a card may not be linked yet (the caveat).
   return {...base,amount:newest.amount,date:newest.date,capturedAt:newest.capturedAt||null,basis:newest.card?'pool-reading':'record',readingsDiffer:new Set(perCard.map(r=>r.amount)).size>1};
  }
  if(!perCard.length)return {...base,amount:records[0].amount,date:records[0].date,capturedAt:records[0].capturedAt||null,basis:'record',notCounted:records.slice(1).length};
  // A sum is only as fresh as its oldest card reading, so that date is the one shown.
  const ordered=perCard.toSorted((a,b)=>time(a)-time(b)),oldest=ordered[0];
  return {...base,amount:perCard.reduce((n,r)=>n+r.amount,0),date:oldest.date,capturedAt:oldest.capturedAt||null,basis:'sum-of-cards',notCounted:records.length,readingsSpanDays:Math.round((time(ordered.at(-1))-time(oldest))/86400000)};
 });
 return {totals,covered};
}
const sourceView=ids=>sources.filter(s=>ids.includes(s.id)).map(({title,url,checkedAt,authority})=>({title,url,checkedAt,authority}));
/** The assistant's view of one rule: what it means for balances and transfers, with caveats and sources. */
export function poolingExplanation(rule){
 return {programme:rule.label,region:rule.region,bank:rule.bank,pooling:rule.pooling,
  ownerOverride:rule.ownerOverride,...(rule.ownerOverride?{ownerOverrideNote:'Stated by the cardholder and used as the default; public sources below are support and caveats, not overrides.'}:{}),
  balances:rule.pooling==='shared'?'one pool: count the balance once, never per card':'one account per card: add the card balances up once',
  usableOnAnotherCard:rule.pooling==='per-card'?false:true,
  transferReach:rule.pooling==='per-card'?'own card only: a card without its own transfer partners cannot use another card\'s partners':rule.pooling==='shared'?'the pool reaches the partners of every card in it':'union of the holder\'s cards, after combining points into the card that transfers',
  summary:rule.summaryEn,caveats:rule.caveats.map(c=>({id:c.id,summary:c.summaryEn,...(c.since?{since:c.since}:{}),sources:sourceView(c.sourceIds)})),
  checkedAt:rule.checkedAt,sources:sourceView(rule.sourceIds)};
}
/** Overview rows: one total per programme with a pooling rule, then the balances no rule covers, as they were read. */
export function rewardSummary(current=[]){
 const {totals,covered}=programmeTotals(current);
 return [...totals.map(t=>({...t,id:t.ruleId,total:true})),...current.filter(r=>!covered.has(r))];
}
/** Short, translatable wallet text for a pooling kind (keys in translations.json). */
export const POOLING_TEXT={
 shared:{total:'共用积分池，只计一次（{0} 张卡）',reading:'同一积分池的读数；合计只计一次。'},
 'per-card':{total:'每张卡独立账户，按卡相加（{0} 张卡）',reading:'这张卡自己的积分账户，已计入合计；不能用于其他卡。'},
 'per-card-combinable':{total:'每张卡独立账户，按卡相加（{0} 张卡）；可在同一持卡人的卡之间合并',reading:'这张卡自己的积分账户，已计入合计；可合并到同一持卡人的其他卡。'},
};
