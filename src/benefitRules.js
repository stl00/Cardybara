import {benefitProfileView,benefitSourceView,hsbcRewardCashView} from './knowledge.js';
const data={profiles:benefitProfileView(),sources:benefitSourceView,hsbcRewardCash:hsbcRewardCashView};
import {matchCardProduct} from './productCatalog.js';
export const benefitProfiles=data.profiles;
export const benefitSources=data.sources;
export const hsbcRewardCash=data.hsbcRewardCash;
export function profileForCard(card){const m=matchCardProduct(card);return m.status==='matched'?data.profiles.find(p=>p.productId===m.product.id)||null:null;}
const isDate=value=>typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function benefitPeriod(rule,asOf){
 if(!isDate(asOf))return null;const [y,m]=asOf.split('-').map(Number);
 if(rule.period==='calendar-year')return {start:`${y}-01-01`,end:`${y}-12-31`};
 if(rule.period==='calendar-quarter'){const start=Math.floor((m-1)/3)*3+1,end=start+2;return {start:`${y}-${String(start).padStart(2,'0')}-01`,end:`${y}-${String(end).padStart(2,'0')}-${new Date(Date.UTC(y,end,0)).getUTCDate()}`};}
 if(rule.period==='calendar-half-year')return {start:`${y}-${m<=6?'01':'07'}-01`,end:`${y}-${m<=6?'06-30':'12-31'}`};
 if(rule.period==='calendar-month'){const end=new Date(Date.UTC(y,m,0)).getUTCDate();return {start:`${y}-${String(m).padStart(2,'0')}-01`,end:`${y}-${String(m).padStart(2,'0')}-${end}`};}
 return null; // Anniversary and rolling periods require account-specific dates.
}
export function benefitStatus(rule,asOf,account={}){
 if(rule.validFrom&&asOf<rule.validFrom)return 'not_started';
 if(rule.validThrough&&asOf>rule.validThrough)return 'expired';
 if(rule.applicability==='new-public-version-holder-transition-unverified')return 'account_version_unverified';
 if(rule.enrollBy&&asOf>rule.enrollBy&&account.enrolled!==true)return 'enrollment_closed';
 if(rule.spendThreshold&&rule.period==='account-anniversary')return 'spend_unverified';
 if(rule.spendThreshold){if(account.spendYear!==Number(asOf.slice(0,4))||!Number.isFinite(account.eligibleSpend))return 'spend_unverified';if(account.eligibleSpend<rule.spendThreshold)return 'spend_required';}
 if(rule.requiresEnrollment&&account.enrolled!==true)return 'enrollment_required';
 if(rule.verification==='summary-only')return 'terms_summary';
 return 'rules_valid';
}
export function currentBenefitProgress(rule,records,asOf){
 const period=benefitPeriod(rule,asOf);if(!period)return null;
 const localDay=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):null;};
 const aliases=new Set(rule.bankAliases||[]);const rows=(records||[]).filter(r=>{const day=typeof r.capturedAt==='string'?localDay(r.capturedAt):null;return aliases.has(r.name)&&r.metric==='credit_progress'&&r.validThrough===period.end&&day>=period.start&&day<=period.end&&day<=asOf&&Number.isFinite(r.value)&&r.value>=0&&r.currency===rule.currency;}).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt));
 return rows[0]||null;
}
