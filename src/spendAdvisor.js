import {searchBenefitKnowledge} from './benefitSearch.js';
import {matchCardProduct} from './productCatalog.js';
import {queryKnowledge,knowledgeSources} from './knowledge.js';
const categories=['dining','supermarket','gas','online-retail','drugstore','flight','hotel','other'];
const bindings={
 'chase-us-sapphire-reserve':{dining:'3',flight:'1',hotel:'2',other:'4'},
 'chase-us-freedom-unlimited':{dining:'dining',drugstore:'drugstore',other:'other'},
 'amex-us-us-american-express-gold-card':{dining:'restaurant',supermarket:'supermarket',flight:'flights'},
 'amex-us-us-morgan-stanley-platinum-card':{flight:'flights',hotel:'prepaid-hotels'},
 'amex-us-us-blue-cash-everyday':{supermarket:'supermarket',gas:'gas','online-retail':'online'},
 'amex-us-us-hilton-honors-aspire-card':{dining:'dining',flight:'travel',other:'other'},
 'boa-us-atmos-rewards-summit-visa-infinite':{dining:'bonus'},
 'boa-us-customized-cash-rewards-visa-signature':{supermarket:'grocery',other:'other'},
 'amex-ca-ca-platinum-card':{dining:'dining',flight:'travel',hotel:'travel',other:'other'},
 'amex-hk-hk-american-express-explorer-credit-card':{other:'base'},
 'amex-hk-hk-the-platinum-card':{other:'base'},
 'sc-hk-hk-cathay-mastercard':{dining:'dining-hotels',hotel:'dining-hotels',other:'local'},
};
export function validateIntent(raw){
 if(!raw||!['recommend','benefits','credits','unsupported'].includes(raw.intent))throw Error('invalid_intent');
 const result={intent:raw.intent,merchant:typeof raw.merchant==='string'?raw.merchant.slice(0,160):'',category:categories.includes(raw.category)?raw.category:null,currency:['USD','CAD','HKD'].includes(raw.currency)?raw.currency:null,country:['US','CA','HK'].includes(raw.country)?raw.country:null,amount:Number.isFinite(raw.amount)&&raw.amount>0&&raw.amount<=1e8?raw.amount:null,query:typeof raw.query==='string'?raw.query.slice(0,500):''};return result;
}
export function parseLocalIntent(text){
 const amount=Number(text.match(/(?:USD|CAD|HKD|HK\$|CA\$|US\$|\$)?\s*(\d+(?:\.\d{1,2})?)\s*(?:美元|港币|加元|元)?/i)?.[1])||null;
 const currency=/HK\$|HKD|港币/i.test(text)?'HKD':/CA\$|CAD|加元/i.test(text)?'CAD':/USD|US\$|美元/i.test(text)?'USD':null;
 const country=/美国|\bUS\b|\bUSA\b/i.test(text)?'US':/加拿大|\bCanada\b/i.test(text)?'CA':/香港|Hong Kong/i.test(text)?'HK':null;
 const category=/餐厅|餐饮|吃饭|restaurant|dining/i.test(text)?'dining':/超市|supermarket|grocery/i.test(text)?'supermarket':/加油|gas station/i.test(text)?'gas':/机票|flight/i.test(text)?'flight':/酒店|hotel/i.test(text)?'hotel':/药店|drugstore/i.test(text)?'drugstore':/网购|online retail/i.test(text)?'online-retail':null;
 return validateIntent({intent:/用掉|没用|未用|credit|本月/i.test(text)?'credits':/福利|会籍|benefit|membership/i.test(text)?'benefits':'recommend',category,currency,country,amount,query:text});
}
const currentDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function recommendCards(cards,intent,{asOf=currentDay(),capAvailable={}}={}){
 const q=validateIntent({...intent,intent:'recommend'}),missing=['category','currency','country','amount'].filter(k=>q[k]==null);if(missing.length)return {kind:'clarify',missing,candidates:[]};
 const candidates=[],excluded=[];
 for(const card of cards){
  const m=matchCardProduct(card);if(m.status!=='matched'||card.currency!==q.currency){excluded.push({cardId:card.id,reason:'currency-or-product-unverified'});continue;}
  const categoryRules=bindings[m.product.id];if(!categoryRules){excluded.push({cardId:card.id,reason:'category-policy-unreviewed'});continue;}
  const key=categoryRules[q.category]||categoryRules.other;if(!key){excluded.push({cardId:card.id,reason:'earning-unverified'});continue;}
  const isCategory=!!categoryRules[q.category];
  if(q.country!==card.region&&!(m.product.id==='amex-us-us-american-express-gold-card'&&q.category==='dining')){excluded.push({cardId:card.id,reason:'country-restriction-unverified'});continue;}
  if(m.product.id==='amex-us-us-american-express-gold-card'&&q.category==='supermarket'&&q.country!=='US')continue;
  // Merchant classification cannot prove a portal, direct booking, remaining cap or account activation.
  const rows=queryKnowledge({productId:m.product.id,kind:'earning-rate',asOf}).rules;
  const r=rows.find(r=>r.id.endsWith('.earning-'+key));if(!r||r.assessment.reviewDue)continue;
  const v=r.terms.multiplier,unit=r.terms.unit,cap=r.terms.annualSpendCap||r.terms.sharedQuarterlySpendCap,capKnown=capAvailable[r.id]===true;
  const conditional=!!cap&&!capKnown||['flight','hotel'].includes(q.category)||r.conditions.all.length>0;
  const reward=cap&&q.amount>cap?null:unit==='cashback-percent'?Math.round(q.amount*v)/100:unit==='HKD-per-mile'?Math.floor(q.amount/v):Math.floor(q.amount*v);
  const rewardLabel=unit==='cashback-percent'?q.currency:card.bank==='Chase'?'UR':m.product.id==='amex-us-us-hilton-honors-aspire-card'?'Hilton Honors':m.product.id==='boa-us-atmos-rewards-summit-visa-infinite'?'Atmos Rewards':card.bank.startsWith('Amex')?`MR (${card.region})`:card.bank==='SC HK'?'Asia Miles':'points';
  candidates.push({rewardLabel,cardId:card.id,name:card.name,productId:m.product.id,rate:v,unit,reward,currency:q.currency,conditional,condition:r.content.summary,ruleId:r.id,revisionId:r.revisionId,checkedAt:r.evidence.checkedAt,sources:knowledgeSources(r.evidence.sourceIds),benefitStateIncluded:false});
 }
 // Compare money only against money. Raw MR, UR and airline miles are never ranked as equivalent.
 const cash=candidates.filter(c=>c.unit==='cashback-percent').sort((a,b)=>Number(a.conditional)-Number(b.conditional)||b.reward-a.reward);
 return {kind:'recommendation',intent:q,cash,candidates,excluded,winner:cash.find(c=>!c.conditional)||null,limitations:['merchant-category-unconfirmed','card-acceptance-unconfirmed','no-point-valuation','caps-and-offers-not-assumed','foreign-fees-unreviewed']};
}
export function searchBenefits(text,cards,asOf=currentDay()){
 return searchBenefitKnowledge(text,cards,asOf).rules;
}
