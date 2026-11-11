import {canonicalProgramme} from '../extension-next/bank-adapters.js';
// The bank of a legacy reward row that names only its programme id.
export const REWARD_ROW_BANKS={'us-mr':'Amex US','hk-mr':'Amex HK','ca-mr':'Amex CA',ur:'Chase',hilton:'Hilton',ihg:'Chase','boa-cash-rewards':'BOA'};
const banks=REWARD_ROW_BANKS;
const region=r=>['US','HK','CA'].includes(r.region)?r.region:({'hk-mr':'HK','ca-mr':'CA'})[r.id]||'US';
const scope=r=>[r.bank||banks[r.id]||'',region(r),canonicalProgramme(r.label||'')].join('|');
// Fresh card readings take the main position. Pools are summed only by pointsPooling.js from its rules (#192).
export function rewardAccounts(data){
 const latest=new Map();for(const r of data.rewardObservations||[]){const card=data.cards.find(c=>c.id===r.card&&c.bank===r.bank);if(!card||!Number.isFinite(r.amount)||r.amount<0||!Number.isFinite(Date.parse(r.capturedAt)))continue;const value={...r,region:card.region,unit:r.unit||'points',cardReading:true},key=card.id+'|'+canonicalProgramme(r.label||'');if(!latest.has(key)||Date.parse(latest.get(key).capturedAt)<Date.parse(r.capturedAt))latest.set(key,value);}
 const readings=[...latest.values()],historical=[],current=[];
 for(const r of data.rewards||[]){const newer=readings.some(n=>scope(n)===scope(r)&&Date.parse(n.capturedAt)>=Date.parse(r.date||''));if(newer)historical.push({...r,region:region(r),bank:r.bank||banks[r.id]});else current.push({...r,region:region(r),bank:r.bank||banks[r.id],historical:true});}
 return {current:[...readings,...current],historical};
}
