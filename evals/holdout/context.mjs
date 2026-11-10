// The held-out wallet, kept apart from evals/fixtures.mjs so a development change cannot move held-out results unnoticed.
// It is part of the frozen hash. Synthetic public products only: no account snapshot, balance, tail digits or ledger.
// No spend history: cap expectations assume an untouched yearly cap.
import {cardProducts} from '../../src/productCatalog.js';
import {knowledgeManifest} from '../../src/knowledge.js';
import {profileForCard} from '../../src/benefitRules.js';
const ids=knowledgeManifest.profileProductIds||knowledgeManifest.pilotProductIds;
export const cards=cardProducts.filter(p=>ids.includes(p.id)).map(p=>({id:'holdout-'+p.id,productId:p.id,name:p.name,bank:p.bank,region:p.region,currency:{US:'USD',CA:'CAD',HK:'HKD'}[p.region]}));
export const context={cards,events:[],day:'2026-10-29'};
export const referenceContext={...context,cards:ids.slice(0,22).map(id=>cards.find(c=>c.productId===id))};
// A synthetic manual mark, shaped exactly as the wallet stores one. Not any person's usage.
export function creditMark(productId,ruleId,start,end,status){
 const card=cards.find(c=>c.productId===productId),revisionId=profileForCard(card).benefits.find(b=>b.knowledgeRuleId===ruleId).revisionId;
 return {schema:1,id:[ruleId,start,status].join('-'),key:JSON.stringify([card.id,ruleId,start,end]),status,at:'2026-10-20T00:00:00.000Z',revisionId};
}
