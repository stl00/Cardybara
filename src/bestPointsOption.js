// #485: which known option is worth the most for a stated number of points, across partner transfers and the issuer's
// own redemptions. Only options with a known value are ranked; a null or varying value is counted, never ranked.
// Everything is in whole US cents: an issuer redemption by its published rate, a transfer by the partner's units at
// the user's own or default per-point value (#193). A partner valued in another currency is left out, since there is
// no exchange rate here.
import {convertPoints} from './transferRoutes.js';
import {redemptionOptions} from './redemptionOptions.js';
import {resolvePointValue,valuationTable} from './pointValues.js';

const partnerEntry=id=>valuationTable.programmes.find(p=>p.knowledgeProgrammeId===id)||null;

/**
 * rows: the transfer rows shown for the chosen card (routesForCard). Returns null when the summary should not show:
 * no stated points, or fewer than two options with a known value.
 */
export function bestPointsOption({programmeId,region='US',points,heldProductIds=[],rows=[],overrides=[]}){
 // Values are US cents; points of a Hong Kong programme are never priced in them.
 if(region!=='US'||!Number.isSafeInteger(points)||points<=0)return null;
 const known=[];let total=0;
 for(const o of redemptionOptions(programmeId,{points,heldProductIds})){
  total++;
  if(o.value.status==='computed')known.push({type:'issuer',id:o.id,kind:o.kind,cents:o.value.cents,basis:'issuer'});
 }
 for(const r of rows){
  total++;
  const done=convertPoints(points,r.terms),entry=partnerEntry(r.partnerId),pv=entry?resolvePointValue(entry,overrides):null;
  if(done.status!=='computed'||!pv||pv.currency!=='USD')continue;
  known.push({type:'transfer',id:r.ruleId,partner:r.partner,cents:Math.round(done.receive*pv.cents),basis:pv.basis,receive:done.receive,unitCents:pv.cents});
 }
 if(known.length<2)return null;
 const top=Math.max(...known.map(k=>k.cents));
 return {best:known.filter(k=>k.cents===top),cents:top,known:known.length,notRanked:total-known.length};
}
