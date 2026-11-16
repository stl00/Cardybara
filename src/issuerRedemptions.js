// The issuer's own redemptions for a points balance (#308), shown beside the transfer partners.
// Records come from #307 (fixed-value redemption records). Until that lands there are none, and the page says so.
// Expected record: {id,programmeId,kind,centsPerPoint:number|'varies'|null,productIds:[]|null,conditionText,sourceIds:[],checkedAt}
// productIds lists the cards a redemption depends on; null means any card of the programme can use it.
// A value is only ever computed from a numeric centsPerPoint; 'varies' and null stay words, never a number.
export const REDEMPTION_PROGRAMMES=['programme.amex-membership-rewards-us','programme.chase-ultimate-rewards'];
export const issuerRedemptions=[];
export const redemptionsFor=(programmeId,records=issuerRedemptions)=>REDEMPTION_PROGRAMMES.includes(programmeId)?records.filter(r=>r.programmeId===programmeId):[];
/**
 * One redemption's answer for a balance. heldProductIds is the card set the pool reaches (existing pooling evidence), or
 * null when there is none: a card-dependent option then shows its condition, not a value. Value is in whole cents, rounded
 * half up once at the end, so 1,999 points at 0.7 cents is 1,399 cents (13.99), never accumulated float error.
 */
export function redemptionValue(points,record,heldProductIds=null){
 const cpp=record.centsPerPoint;
 if(record.productIds?.length&&!(heldProductIds||[]).some(id=>record.productIds.includes(id)))return {status:'needs-card'};
 if(cpp==='varies')return {status:'varies'};
 if(typeof cpp!=='number'||!Number.isFinite(cpp)||cpp<0)return {status:'unknown'};
 if(!Number.isSafeInteger(points)||points<=0)return {status:'no-points'};
 return {status:'computed',cents:Math.round(points*cpp)};
}
