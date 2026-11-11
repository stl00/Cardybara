// The one credit query. Code filters, overlaps cycles with the dates, reads manual marks and joins terms; the model only explains the result.
import {queryKnowledge,knowledgeSources,ruleText} from './knowledge.js';
import {benefitPeriod,profileForCard} from './benefitRules.js';
import {matchCardProduct} from './productCatalog.js';
import {taskStatus,dismissedKeys,dismissKey} from './personalBenefits.js';
import {resolveTripDates,addDays,isRealDate} from './tripDates.js';
import {CREDIT_CATEGORIES,creditCategoriesForRule} from './creditCategories.js';
import {creditApplicability} from './creditApplicability.js';
import translations from './translations.json' with {type:'json'};
const MAX_ITEMS=30;
const NO_FIXED_CYCLE=new Set(['ongoing','per-stay','per-trip','event-based']);
const UNKNOWN_CYCLE_REASON={'account-anniversary':'anniversary-date-unknown','activation-based':'activation-date-unknown','rolling-four-years':'last-use-date-unknown','earned-year-plus-next':'earning-year-unknown','fixed-date':'promotion-dates-unverified','promotion-period':'promotion-dates-unverified'};
// A general travel credit may also pay for a hotel, but its terms may not say so; matchKind flags that for the answer.
const travelWideForHotel=(rule,use)=>use==='hotel'&&Number.isFinite(rule.terms.amount)&&creditCategoriesForRule(rule).includes('travel');
const relevant=(rule,use)=>(['credit','promo'].includes(rule.category)||rule.category==='hotel-service'&&Number.isFinite(rule.terms.amount))&&(!use||creditCategoriesForRule(rule).includes(use)||travelWideForHotel(rule,use));
function ruleLookup(){
 const cache=new Map();
 const list=(productId,asOf,includeInactive)=>{const key=[productId,asOf,includeInactive].join('|');if(!cache.has(key))cache.set(key,queryKnowledge({productId,kind:'benefit',asOf,includeInactive}).rules);return cache.get(key);};
 return {list,active:(productId,id,day)=>list(productId,day,false).find(r=>r.id===id)||null,any:(productId,id,day)=>list(productId,day,true).find(r=>r.id===id)||null};
}
/** One row per cycle overlapping the dates, using the rule revision in force on the first overlapping day. */
function tripRows(lookup,productId,id,win,card){
 const rows=[];let day=win.start;
 while(day<=win.end){
  const rule=lookup.active(productId,id,day);
  if(!rule){
   const latest=lookup.any(productId,id,day);if(!latest)break; // A withdrawn rule has no published revision to report.
   const from=latest.validity.effectiveFrom;
   if(from&&from>day&&from<=win.end){rows.push({rule:latest,outside:'rule-not-started',from:day,through:addDays(from,-1)});day=from;continue;}
   rows.push({rule:latest,outside:from&&from>day?'rule-not-started':'rule-expired',from:day,through:win.end});break;
  }
  const period=benefitPeriod(rule.terms,day,{feeDate:card.feeDate});
  if(!period){rows.push({rule});break;}
  rows.push({rule,period,overlap:{start:day,end:period.end<win.end?period.end:win.end}});
  day=addDays(period.end,1);
 }
 return rows;
}
function enrollmentOf(rule){
 if(rule.terms.requiresEnrollment===true)return 'required';
 if(rule.terms.coupon?.enrollment)return rule.terms.coupon.enrollment;
 return rule.terms.requiresEnrollment===false?'not-required':'unknown';
}
function publicLimit(rule,asOf){
 const value=rule.terms.monthlyAmounts?.[Number(asOf.slice(5,7))-1]??rule.terms.amount;
 if(!Number.isFinite(value))return null; // A missing amount stays unknown, never zero.
 return rule.terms.quantity?value*rule.terms.quantity:value;
}
// Other-language titles: the rule's own text in that language (its English original, say), then the dictionary.
const titlesOf=rule=>{const zh=rule.content.title,en=ruleText(rule,'en-US'),tw=ruleText(rule,'zh-TW');return {'zh-TW':tw.lang!=='zh-CN'&&tw.lang!=='en-US'?tw.title:translations['zh-TW']?.[zh]||zh,en:en.lang==='en-US'?en.title:translations['en-US']?.[zh]||null};};
function describe(card,row,destination,asOf,use,brief,purchase){
 const {rule}=row,coupon=rule.terms.coupon,posting=coupon?.posting,zh=rule.content.title;
 const countries=coupon?.eligibleCountries||[];
 return {
  card:card.name,cardRegion:card.region,title:zh,titles:titlesOf(rule),
  publicLimit:publicLimit(rule,asOf),currency:rule.terms.currency||card.currency,
  ...(rule.terms.perTransactionCap?{perTransactionCap:rule.terms.perTransactionCap}:{}),
  ...(rule.terms.spendThreshold?{spendThreshold:rule.terms.spendThreshold}:{}),
  periodType:rule.terms.period,condition:rule.content.summary,
  enrollment:enrollmentOf(rule),...(rule.validity.enrollBy?{enrollBy:rule.validity.enrollBy}:{}),
  channels:coupon?.eligibleChannels?.length?coupon.eligibleChannels:null,
  ...(!brief&&coupon?.excludedPurchases?.length?{excluded:coupon.excludedPurchases}:{}),
  ...(coupon?.minimumNights?{minimumNights:coupon.minimumNights}:{}),
  ...(countries.length?{eligibleCountries:countries,...(destination?{destinationCheck:countries.includes(destination)?'listed':'not-listed'}:{})}:{}),
  // Posting facts come only from rule data; a null field is simply not recorded.
  ...(posting&&(posting.maximumDays!=null||posting.timingBasis&&posting.timingBasis!=='unknown')?{posting:{maximumDays:posting.maximumDays,timingBasis:posting.timingBasis,deadlineTimeZone:posting.deadlineTimeZone}}:{}),
  ...(!brief&&coupon?.refundPolicy?{refundPolicy:coupon.refundPolicy}:{}),
  ...(!brief&&coupon?{coupon:{delivery:coupon.delivery,capScope:coupon.capScope,eligibleMerchants:coupon.eligibleMerchants,conditionalPurchases:coupon.conditionalPurchases,redemption:coupon.redemption,carryover:coupon.carryover,additionalCards:coupon.additionalCards,unresolved:coupon.review.unresolved}}:{}),
  ...(travelWideForHotel(rule,use)&&!creditCategoriesForRule(rule).includes('hotel')?{matchKind:'travel-wide'}:{}),
  // Decided from sourced fields only; without a purchase, channel and nights stay as needs.
  decision:creditApplicability(rule,purchase||{}),
  reviewDue:rule.assessment.reviewDue,...(brief?{}:{sources:knowledgeSources(rule.evidence.sourceIds).map(s=>({title:s.title,url:s.url}))})
 };
}
function latestUsage(key,revisionId,events){
 const event=events.filter(e=>e.key===key).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id))[0];
 return event?.revisionId===revisionId?event.usage||null:null;
}
/** Every name a held card's credits go by, so a claim about one the lookup didn't return can still be checked. */
export function creditNamesForCards(cards,day){
 const names=new Map();
 for(const card of cards){
  const match=matchCardProduct(card);if(match.status!=='matched'||!match.product?.id||!isRealDate(day))continue;
  for(const rule of queryKnowledge({productId:match.product.id,kind:'benefit',asOf:day,includeInactive:true}).rules)if(relevant(rule)){const zh=rule.content.title;names.set(zh,{title:zh,titles:titlesOf(rule)});}
 }
 return [...names.values()];
}
export const CREDIT_USES=CREDIT_CATEGORIES.map(c=>c.id);
export function queryCredits({use,when,destination,reuseRememberedDates},{cards,events=[],day,trip,brief=false,purchase=null}){
 if(!isRealDate(day))throw TypeError('queryCredits needs the wallet day');
 // Without dates the question is about today, which is one day inside each current cycle.
 // Remembered dates keep their precision, so dates the user never stated are still reported as assumed.
 const remembered=reuseRememberedDates&&!when?trip?{ok:true,start:trip.start,end:trip.end,precision:trip.precision,assumptions:trip.precision==='days'&&!trip.assumed?['dates-remembered-from-earlier-turn']:['dates-remembered-from-earlier-turn','dates-were-assumed-earlier'],phrase:null}:{ok:false,reason:'no_remembered_dates'}:null;
 const window=remembered||(when?resolveTripDates(when,day):{ok:true,start:day,end:day,precision:'current-cycle',assumptions:[],phrase:null});
 if(!window.ok)return {tool:'query_credits',today:day,needsDates:true,reason:window.reason,phrase:when,instruction:'The date phrase could not be resolved. Ask the user for the dates; do not guess them.'};
 // dismissedByUser comes last, so a long list drops it first.
 const groups={markedUnused:[],markedUsed:[],unknownStatus:[],noFixedCycle:[],cycleUnknown:[],outsideDates:[],dismissedByUser:[]},unmatchedCards=[],boundaries=new Set();
 const lookup=ruleLookup(),dismissed=dismissedKeys(events);
 for(const card of cards){
  const match=matchCardProduct(card);
  if(match.status!=='matched'||!match.product?.id){unmatchedCards.push(card.name);continue;}
  const productId=match.product.id,profile=profileForCard(card);
  const ids=new Set([...lookup.list(productId,window.start,true),...lookup.list(productId,window.end,true)].filter(r=>relevant(r,use)).map(r=>r.id));
  for(const id of ids){
   const rows=tripRows(lookup,productId,id,window,card),base=profile?.benefits.find(b=>b.knowledgeRuleId===id);
   // The user asked to stop hearing about it: one row, no cycle and no status, so it can be neither used nor unused.
   if(dismissed.has(dismissKey(card.id,id))){
    const row=rows.find(r=>!r.outside)||rows[0];
    if(row){const {publicLimit:_,perTransactionCap:_c,spendThreshold:_s,...item}=describe(card,{rule:row.rule},destination,row.overlap?.start||window.start,use,brief,purchase);groups.dismissedByUser.push({...item,status:'dismissed-by-user'});}
    continue;
   }
   const statusOf=period=>{const task={key:JSON.stringify([card.id,id,period.start,period.end]),revisionId:base?.revisionId};return {task,status:taskStatus(task,events)};};
   const unverified=row=>row.rule.terms.applicability||profile?.coverage==='variant-unconfirmed';
   const cycleRows=rows.filter(r=>r.period&&!unverified(r));
   // An unverified product version has no usable cycle, so one row says so however many cycles the dates cross.
   const firstUnverified=rows.find(r=>!r.outside&&unverified(r));
   for(const row of rows.filter(r=>r.outside||!unverified(r)||r===firstUnverified)){
    const item=describe(card,row,destination,row.overlap?.start||row.from||window.start,use,brief,purchase);
    if(row.outside){groups.outsideDates.push({...item,reason:row.outside,datesOutside:{start:row.from,end:row.through},status:'not-applicable'});continue;}
    if(unverified(row)){groups.cycleUnknown.push({...item,reason:row.rule.terms.applicability?'account-version-unverified':'product-variant-unconfirmed',cycle:null,status:'unknown'});continue;}
    if(!row.period){
     const period=row.rule.terms.period;
     if(NO_FIXED_CYCLE.has(period))groups.noFixedCycle.push({...item,cycle:null,status:'unknown'});
     else groups.cycleUnknown.push({...item,reason:UNKNOWN_CYCLE_REASON[period]||'cycle-dates-unknown',cycle:null,status:'unknown'});
     continue;
    }
    const {task,status}=statusOf(row.period),endsWithinDates=row.period.end<=window.end;
    if(endsWithinDates)boundaries.add(addDays(row.period.end,1));
    const entry={...item,cycle:{start:row.period.start,end:row.period.end},datesInCycle:row.overlap,status,...(endsWithinDates?{cycleEndsWithinDates:true,nextCycleStarts:addDays(row.period.end,1)}:{})};
    if(['used','skipped'].includes(status))groups.markedUsed.push(entry);
    else if(status==='unknown')groups.unknownStatus.push(entry);
    else{
     const usage=latestUsage(task.key,task.revisionId,events);
     groups.markedUnused.push({...entry,...(usage&&Number.isFinite(entry.publicLimit)&&usage.currency===entry.currency?{usedByMark:usage.amount,remainingByMark:entry.publicLimit-usage.amount}:{})});
    }
   }
   // A credit whose current cycle closes before the dates does not carry over to them. Monthly cycles always reset, so saying so adds only noise.
   const nowRule=lookup.active(productId,id,day),current=nowRule&&benefitPeriod(nowRule.terms,day,{feeDate:card.feeDate});
   if(current&&current.end<window.start&&cycleRows.length&&nowRule.terms.period!=='calendar-month')groups.outsideDates.push({...describe(card,{rule:nowRule},destination,day,use,brief,purchase),reason:'current-cycle-ends-before-dates',cycle:{start:current.start,end:current.end},status:statusOf(current).status,datesCycleStarts:cycleRows[0].period.start});
  }
 }
 const conditions=[...groups.markedUnused,...groups.unknownStatus,...groups.noFixedCycle,...groups.cycleUnknown].filter(x=>['required','link-card'].includes(x.enrollment)||x.channels||x.decision?.needs).map(x=>({card:x.card,cardRegion:x.cardRegion,title:x.title,enrollment:x.enrollment,channels:x.channels,...(x.minimumNights?{minimumNights:x.minimumNights}:{}),...(x.decision?.needs?{needs:x.decision.needs}:{})}));
 const counts=Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length]));
 let room=MAX_ITEMS,truncated=false;
 // Cutting dismissed credits hides nothing the user still tracks, so it doesn't mark the answer truncated.
 let dismissedTruncated=false;
 for(const key of Object.keys(groups)){if(groups[key].length>room){if(key==='dismissedByUser')dismissedTruncated=true;else truncated=true;groups[key]=groups[key].slice(0,room);}room-=groups[key].length;}
 return {
  tool:'query_credits',today:day,...(use?{use}:{}),...(destination?{destination}:{}),...(brief?{brief:true}:{}),
  window:{start:window.start,end:window.end,precision:window.precision,assumptions:window.assumptions,phrase:window.phrase},
  statusMeaning:{unknown:'No manual mark exists. Not confirmed used or unused.',unused:'The user marked it unused.',partial:'The user marked part of it used.',used:'The user marked it used up.',skipped:'The user chose not to use it this cycle.','dismissed-by-user':'The user chose to stop reminders for this credit. It is neither used nor unused; its value is not counted.'},
  coverage:'Status comes only from manual marks; banks are not read for benefit use. Public limits are not remaining balances. Enrollment and account eligibility are not known. Cycles are assigned from the dates asked about; where posting.timingBasis is merchant-reported-date, the date the merchant reports decides the cycle. Not an exhaustive benefit inventory.',
  groups,groupCounts:counts,totalItems:Object.values(counts).reduce((a,b)=>a+b,0),truncated,...(dismissedTruncated?{dismissedTruncated:true}:{}),needsEnrollmentOrChannel:conditions,
  dateSensitivity:{exactDatesCouldChangeAnswer:!['days','current-cycle'].includes(window.precision)&&boundaries.size>0,cycleBoundaries:[...boundaries].sort()},
  unmatchedCards
 };
}
