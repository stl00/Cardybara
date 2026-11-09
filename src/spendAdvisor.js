import {searchBenefitKnowledge} from './benefitSearch.js';
const categories=['dining','supermarket','gas','online-retail','drugstore','flight','hotel','other'];
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
export function searchBenefits(text,cards,asOf=currentDay()){
 return searchBenefitKnowledge(text,cards,asOf).rules;
}
