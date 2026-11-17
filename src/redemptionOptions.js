// The assistant's view of an issuer's fixed-value redemptions (#309), from the #307 records.
// Value per point is returned only when a record states a number; "varies" and unknown stay words, and the value of a
// stated number of points is computed here, never by the model.
import {fixedRedemptionsFor,fixedRedemptionSources,fixedRedemptionsCheckedAt} from './fixedRedemptions.js';
import {matchCardProduct} from './productCatalog.js';

// Redemptions that only a named card can use. Other dependsOn values (a points boost, select cards) are conditions
// the wallet cannot verify, so they are given as words with eligibility "unknown".
const NEEDS_PRODUCT={'mr-business-checking-deposit-business-platinum':['amex-us-us-business-platinum-card']};
// Deposits move in blocks of 1,000 points; a leftover is never rounded up.
const BLOCK={deposit:1000};
const ANNUAL_CAP={'mr-business-checking-deposit-business-platinum':1000000};
const view=id=>{const s=fixedRedemptionSources.find(x=>x.id===id);return s?{title:s.title,url:s.url,checkedAt:s.checkedAt,authority:s.authority}:null;};

function valueOf(record,points){
 const cpp=record.centsPerPoint;
 if(cpp==='varies')return {status:'varies',note:'The issuer says the value varies: give no value per point and no dollar amount.'};
 if(cpp===null||typeof cpp!=='number')return {status:'unknown',note:'No value per point is published: give none.'};
 if(points==null)return {status:'rate-only'};
 const cap=ANNUAL_CAP[record.id];
 if(cap&&points>cap)return {status:'above-annual-cap',note:'The stated points exceed the annual limit at this rate; the rest redeems at a different published rate. Give no total.'};
 const block=BLOCK[record.kind]||1,used=Math.floor(points/block)*block,cents=Math.round(used*cpp);
 return {status:'computed',points:used,leftoverPoints:points-used,cents,dollars:cents/100};
}

/** Redemption rows for one programme. heldProductIds: product ids of the held cards, for card-bound options. */
export function redemptionOptions(programmeId,{points=null,heldProductIds=[]}={}){
 return fixedRedemptionsFor(programmeId).map(r=>{
  const need=NEEDS_PRODUCT[r.id],heldOk=need?need.some(id=>heldProductIds.includes(id)):null;
  const value=need&&!heldOk?{status:'needs-card',note:'Needs a card the wallet does not hold: say so and give no value for this wallet.'}:valueOf(r,points);
  return {id:r.id,kind:r.kind,centsPerPoint:r.centsPerPoint,condition:r.dependsOn,eligibility:need?(heldOk?'held-card':'needs-card-not-held'):(r.dependsOn==='any'?'any-card':'unknown'),
   ...(r.unknownReason?{unknownReason:r.unknownReason}:{}),text:r.textEn,value,sources:r.sourceIds.map(view).filter(Boolean),checkedAt:r.checkedAt};
 });
}
export const heldProductIdsOf=cards=>cards.map(c=>matchCardProduct(c).product?.id).filter(Boolean);
export {fixedRedemptionsCheckedAt};
