// #533: the Points Boost "up to" limits (#532) of the cards the user holds, for display beside Chase Travel.
// An upper bound is never a value: nothing here feeds redemptionOptions, bestPointsOption or the value of entered points.
import {fixedRedemptionSources} from './fixedRedemptions.js';
import {cardProducts} from './productCatalog.js';

export function heldPointsBoostLimits(record,heldProductIds,{sources=fixedRedemptionSources,products=cardProducts}={}){
 const held=new Set(heldProductIds||[]),seen=new Set();
 return (record?.upToByProduct||[]).filter(u=>held.has(u.productId)&&!seen.has(u.productId)&&seen.add(u.productId)).map(u=>({
  productId:u.productId,name:products.find(p=>p.id===u.productId)?.name||u.productId,upToCentsPerPoint:u.upToCentsPerPoint,
  textEn:u.textEn,textZh:u.textZh,source:sources.find(s=>s.id===u.sourceId)||null}));
}
