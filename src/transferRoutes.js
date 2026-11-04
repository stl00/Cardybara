// Deterministic answers to "where can these points go and how many units is that?".
// Rates come from transferRate; the assistant's rule view has none until #72 uses this module.
// Every number comes from a verified rule; a missing ratio is never replaced by a familiar one.
import {queryKnowledge,knowledgeEntities,knowledgeManifest} from './knowledge.js';
import {canonicalProgramme} from '../extension-next/bank-adapters.js';
import {matchCardProduct} from './productCatalog.js';

export const transferProgrammes=[
 {id:'programme.amex-membership-rewards-us',bank:'Amex US',region:'US',reading:'membership rewards',label:'Membership Rewards'},
 {id:'programme.chase-ultimate-rewards',bank:'Chase',region:'US',reading:'ultimate rewards',label:'Ultimate Rewards'},
 {id:'programme.amex-membership-rewards-hk',bank:'Amex HK',region:'HK',reading:'membership rewards',label:'Membership Rewards'},
];
const programme=id=>knowledgeEntities.programmes.find(p=>p.id===id);
// Partners of one programme. The same partner has several rows only when its rate differs by card.
export function transferRoutes(programmeId,{asOf=knowledgeManifest.asOf}={}){
 const rows=queryKnowledge({kind:'transfer-relationship',programmeId,asOf}).rules.filter(r=>r.terms.fromProgrammeId===programmeId);
 return rows.map(r=>{const partner=programme(r.terms.toProgrammeId);return {ruleId:r.id,partnerId:partner.id,partner:partner.name,kind:partner.kind,terms:{...r.terms,ratio:r.transferRate?.rate??null,ratioCondition:r.transferRate?.condition??null,ratioStatement:r.transferRate?.statement??null},productIds:r.productIds,sourceIds:r.evidence.sourceIds,checkedAt:r.evidence.checkedAt,reviewDue:r.assessment.reviewDue,effectiveFrom:r.validity.effectiveFrom,summary:r.content.summary,cardSpecific:rows.filter(x=>x.terms.toProgrammeId===r.terms.toProgrammeId).length>1};}).sort((a,b)=>a.partner.localeCompare(b.partner)||a.ruleId.localeCompare(b.ruleId));
}
// A rate that differs by card is only applied to a reading from a card that rate names.
export function routesForProduct(routes,productId){return routes.filter(r=>!r.cardSpecific||!productId||r.productIds.includes(productId));}
/** Whole-number transfer maths. Points left over are never rounded up into a transfer. */
export function convertPoints(points,terms){
 const {ratio,minimumPoints,incrementPoints,maximumPoints}=terms||{};
 if(!ratio)return {status:'ratio-unknown'};
 if(!Number.isSafeInteger(points)||points<=0)return {status:'no-points'};
 const step=incrementPoints||null,floor=minimumPoints??step;
 if(floor&&points<floor)return {status:'below-minimum',minimumPoints:floor};
 const capped=maximumPoints!=null&&points>maximumPoints;
 const available=capped?maximumPoints:points;
 const spend=step?(floor||0)+Math.floor((available-(floor||0))/step)*step:available;
 const receive=Math.floor(spend*ratio.to/ratio.from);
 const fees=(terms.fees||[]).map(fee=>fee.perPoint?{...fee,charge:Math.min(Math.round(spend*fee.perPoint*100)/100,fee.maximum)}:{...fee,charge:fee.amount??null});
 return {status:'computed',spend,receive,unusedPoints:points-spend,capped,fees};
}
// Readings stay per card: one card's balance is never added to another's without pool evidence.
export function readingsFor(transferProgramme,accounts,cards=[]){
 return (accounts?.current||[]).filter(r=>r.bank===transferProgramme.bank&&r.region===transferProgramme.region&&r.unit!=='USD'&&canonicalProgramme(r.label||'')===transferProgramme.reading&&Number.isSafeInteger(r.amount)).map(r=>{const card=cards.find(c=>c.id===r.card)||null,match=card?matchCardProduct(card):null;return {...r,cardRecord:card,productId:match?.status==='matched'?match.product.id:null};});
}
