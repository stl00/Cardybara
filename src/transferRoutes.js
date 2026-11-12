// Deterministic answers to "where can these points go and how many units is that?".
// Rates come from transferRate; the assistant's rule view has none until #72 uses this module.
// Every number comes from a verified rule; a missing ratio is never replaced by a familiar one.
import {queryKnowledge,knowledgeEntities,knowledgeManifest} from './knowledge.js';
import {canonicalProgramme} from '../extension-next/bank-adapters.js';
import {matchCardProduct} from './productCatalog.js';
import {pointsReach,poolingRule,poolingExplanation} from './pointsPooling.js';

export const transferProgrammes=[
 {id:'programme.amex-membership-rewards-us',bank:'Amex US',region:'US',reading:'membership rewards',label:'Membership Rewards'},
 {id:'programme.chase-ultimate-rewards',bank:'Chase',region:'US',reading:'ultimate rewards',label:'Ultimate Rewards'},
 {id:'programme.amex-membership-rewards-hk',bank:'Amex HK',region:'HK',reading:'membership rewards',label:'Membership Rewards'},
 {id:'programme.bilt-rewards',bank:'Bilt',region:'US',reading:'bilt rewards',label:'Bilt Rewards'},
 // Citi publishes partners and a minimum but no rate (#181), and the wallet reads no ThankYou balance, so this
 // programme answers the assistant only and gets no tab on the rewards page.
 {id:'programme.citi-thankyou',bank:'Citi US',region:'US',reading:'thankyou points',label:'ThankYou Points',tab:false},
];
const programme=id=>knowledgeEntities.programmes.find(p=>p.id===id);
// Partners of one programme. The same partner has several rows only when its rate differs by card.
export function transferRoutes(programmeId,{asOf=knowledgeManifest.asOf}={}){
 const rows=queryKnowledge({kind:'transfer-relationship',programmeId,asOf}).rules.filter(r=>r.terms.fromProgrammeId===programmeId);
 return rows.map(r=>{const partner=programme(r.terms.toProgrammeId);return {ruleId:r.id,partnerId:partner.id,partner:partner.name,kind:partner.kind,terms:{...r.terms,ratio:r.transferRate?.rate??null,ratioCondition:r.transferRate?.condition??null,ratioStatement:r.transferRate?.statement??null},productIds:r.productIds,sourceIds:r.evidence.sourceIds,checkedAt:r.evidence.checkedAt,reviewDue:r.assessment.reviewDue,effectiveFrom:r.validity.effectiveFrom,summary:r.content.summary,cardSpecific:rows.filter(x=>x.terms.toProgrammeId===r.terms.toProgrammeId).length>1};}).sort((a,b)=>a.partner.localeCompare(b.partner)||a.ruleId.localeCompare(b.ruleId));
}
// With no card chosen every row shows, each labelled with its cards. A chosen card only gets rows that
// list it; otherwise the partner stays visible with its rate hidden, because the evidence does not reach it.
// productIds widens one card to every product its points reach under the pooling rule (#192), such as a held Sapphire for
// a Freedom card's Ultimate Rewards; rows from several products stay labelled with their cards.
export function routesForCard(routes,{hasCard=false,productId=null,productIds=null}={}){
 if(!hasCard)return routes.map(r=>({...r,coverage:'listed'}));
 const reach=productIds||(productId?[productId]:[]),partners=[...new Set(routes.map(r=>r.partnerId))];
 return partners.flatMap(id=>{
  const rows=routes.filter(r=>r.partnerId===id),listed=rows.filter(r=>r.productIds.some(p=>reach.includes(p)));
  if(listed.length)return listed.map(r=>({...r,coverage:'listed',cardSpecific:listed.length>1||!!productId&&!r.productIds.includes(productId)}));
  return [{...rows[0],coverage:'card-not-listed',cardSpecific:false,terms:{...rows[0].terms,ratio:null,ratioCondition:null,ratioStatement:null}}];
 });
}
/** Whole-number transfer maths. Points left over are never rounded up into a transfer. */
export function convertPoints(points,terms){
 const {ratio,minimumPoints,incrementPoints,maximumPoints}=terms||{};
 if(!ratio)return {status:'ratio-unknown'};
 if(!Number.isSafeInteger(points)||points<=0)return {status:'no-points'};
 const step=incrementPoints||null,floor=minimumPoints??step;
 // An unstated minimum is not reported as one: only the increment is known then.
 if(floor&&points<floor)return minimumPoints?{status:'below-minimum',minimumPoints}:{status:'below-increment',incrementPoints:step};
 const capped=maximumPoints!=null&&points>maximumPoints;
 const available=capped?maximumPoints:points;
 const spend=step?(floor||0)+Math.floor((available-(floor||0))/step)*step:available;
 const receive=Math.floor(spend*ratio.to/ratio.from);
 const fees=(terms.fees||[]).map(fee=>fee.perPoint?{...fee,charge:Math.min(Math.round(spend*fee.perPoint*100)/100,fee.maximum)}:{...fee,charge:fee.amount??null});
 return {status:'computed',spend,receive,unusedPoints:points-spend,capped,fees};
}
/** The fewest points that reach a stated number of partner miles, in whole transfer steps (#82).
 * Rounds the transfer up to the next minimum or increment, never down, and stops at a published maximum. */
export function pointsToReach(miles,terms){
 const {ratio,minimumPoints,incrementPoints,maximumPoints}=terms||{};
 if(!ratio)return {status:'ratio-unknown'};
 if(!Number.isSafeInteger(miles)||miles<=0)return {status:'no-miles'};
 const step=incrementPoints||null,floor=minimumPoints??step??0;
 let spend=Math.ceil(miles*ratio.from/ratio.to);
 if(step)spend=spend<=floor?floor:floor+Math.ceil((spend-floor)/step)*step;else spend=Math.max(spend,floor);
 // Partner units are floored per transfer, so one more step may be needed to cover the miles.
 while(Math.floor(spend*ratio.to/ratio.from)<miles)spend+=step||1;
 if(maximumPoints!=null&&spend>maximumPoints)return {status:'above-maximum',maximumPoints};
 const done=convertPoints(spend,terms);
 return {status:'computed',spend,receive:done.receive,extraMiles:done.receive-miles,fees:done.fees};
}
// Readings stay per card: one card's balance is never added to another's without pool evidence.
export function readingsFor(transferProgramme,accounts,cards=[]){
 return (accounts?.current||[]).filter(r=>r.bank===transferProgramme.bank&&r.region===transferProgramme.region&&r.unit!=='USD'&&canonicalProgramme(r.label||'')===transferProgramme.reading&&Number.isFinite(r.amount)).map(r=>{const card=cards.find(c=>c.id===r.card)||null,match=card?matchCardProduct(card):null;return {...r,key:[r.id,r.card||'',r.label,r.historical?'historical':'current'].join('|'),usable:Number.isSafeInteger(r.amount),cardRecord:card,productId:match?.status==='matched'?match.product.id:null};});
}
const nameKey=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const partnerMatches=(partnerId,named)=>{if(!named)return true;const p=programme(partnerId),n=nameKey(named);return !!n&&[p?.name,...(p?.aliases||[])].some(x=>x&&nameKey(x).includes(n));};
const ROW_LIMIT=40;
/** The assistant's answer to "where can my points go and how many is that?" for held cards (#72).
 * A card belongs to a programme when a transfer rule lists its product, or when the pooling rule (#192) makes it a member:
 * a shared pool or a combinable programme reaches the partners of every held transfer card of that programme, and a
 * per-card programme only its own. Rates come only from transferRate rules that list a reached card, and a stated
 * points amount is converted by convertPoints. Balances are never added here. */
// held is the whole wallet: a selected Freedom still reaches the Sapphire it can combine into, though only selected cards are listed.
export function transferOptions(cards,{partner=null,points=null}={},{asOf=knowledgeManifest.asOf,held=cards}={}){
 const programmes=new Map(),withoutRecord=[],noTransferCard=[],routesOf=new Map(transferProgrammes.map(p=>[p.id,transferRoutes(p.id,{asOf})]));
 const reachOf=new Map(pointsReach([...new Set([...cards,...held])]).map(r=>[r.card,r]));
 for(const card of cards){
  const productId=matchCardProduct(card).product?.id||null,pooled=reachOf.get(card);
  const tp=pooled?transferProgrammes.find(p=>p.id===pooled.rule.programmeId):productId&&transferProgrammes.find(p=>routesOf.get(p.id).some(r=>r.productIds.includes(productId)));
  if(!tp){withoutRecord.push({name:card.name,region:card.region});continue;}
  const reach=pooled?pooled.reachProductIds:[productId];
  // A member card whose programme holds no transfer card here: its points stay in the programme with no partner.
  if(!reach.length){noTransferCard.push({name:card.name,region:card.region,programme:tp.label,pooling:pooled.rule.pooling});continue;}
  const group=programmes.get(tp.id)||{programme:tp.label,region:tp.region,programmeId:tp.id,cards:[],rows:new Map()};programmes.set(tp.id,group);
  group.cards.push({name:card.name,region:card.region,...(pooled&&!pooled.ownTransfer?{transfersThrough:pooled.via.map(c=>c.name)}:{})});
  for(const r of routesForCard(routesOf.get(tp.id),{hasCard:true,productIds:reach}).filter(r=>partnerMatches(r.partnerId,partner))){
   const key=r.coverage==='listed'?r.ruleId:r.partnerId+'|not-listed';
   // A programme-wide phrase ("1:1 to most partners") is left out: it is not a rate for this partner.
   const row=group.rows.get(key)||(r.coverage==='listed'?{
    partner:r.partner,partnerKind:r.kind,cards:[],rate:r.terms.ratio?'published':'not-published',ratio:r.terms.ratio,
    ...(r.terms.ratioCondition?{ratioCondition:r.terms.ratioCondition}:{}),    minimumPoints:r.terms.minimumPoints??null,incrementPoints:r.terms.incrementPoints??null,maximumPoints:r.terms.maximumPoints??null,
    estimatedTime:r.terms.estimatedTime??null,fees:r.terms.fees||[],
    ...(points!=null?{conversion:convertPoints(points,r.terms)}:{}),
    effectiveFrom:r.effectiveFrom??null,sourceIds:r.sourceIds,checkedAt:r.checkedAt,reviewDue:!!r.reviewDue
   // The partner is in the programme but no rule lists this card: no rate, minimum or conversion reaches it.
   }:{partner:r.partner,partnerKind:r.kind,cards:[],rate:'card-not-listed',ratio:null,sourceIds:r.sourceIds,checkedAt:r.checkedAt});
   // A rate another held card's rule lists reaches this card only through that card (pooled or combined first), so
   // it is named: a Sapphire-only rate is never read as the Freedom's own.
   const through=r.coverage==='listed'&&!r.productIds.includes(productId)?{through:[...new Set([...cards,...held])].filter(c=>c!==card&&reach.includes(matchCardProduct(c).product?.id)&&r.productIds.includes(matchCardProduct(c).product?.id)).map(c=>c.name)}:{};
   row.cards.push({name:card.name,region:card.region,...through});group.rows.set(key,row);
  }
 }
 const pooling=id=>{const rule=poolingRule(id);if(!rule)return {};const e=poolingExplanation(rule);return {pooling:{kind:e.pooling,usableOnAnotherCard:e.usableOnAnotherCard,transferReach:e.transferReach,summary:e.summary,caveats:e.caveats.map(c=>c.summary)}};};
 const all=[...programmes.values()].map(g=>({programme:g.programme,region:g.region,...pooling(g.programmeId),cards:g.cards,partners:[...g.rows.values()]}));
 const total=all.reduce((n,g)=>n+g.partners.length,0);let left=ROW_LIMIT;
 const shown=all.map(g=>{const partners=g.partners.slice(0,Math.max(left,0));left-=partners.length;return {...g,partners};});
 return {programmes:shown,cardsWithoutTransferRecord:withoutRecord,...(noTransferCard.length?{cardsWithoutTransferCard:noTransferCard}:{}),totalPartners:total,truncated:total>ROW_LIMIT,partnerFound:!partner||total>0};
}
