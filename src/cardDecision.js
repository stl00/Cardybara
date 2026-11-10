// Which card for this purchase. Code compares every held card; the model only collects the facts and explains the result.
// Cash is compared only with cash. Points get a value only from the user. Nothing here is per-card code: new cards join through their earning rules.
import data from './data/earning-categories.json' with {type:'json'};
import {queryKnowledge,knowledgeEntities,knowledgeSources} from './knowledge.js';
import {matchCardProduct} from './productCatalog.js';
import {queryCredits} from './creditQuery.js';
import {resolveTripDates,isRealDate} from './tripDates.js';
export const PURCHASE_CATEGORIES=['dining','supermarket','wholesale','gas','ev-charging','online-retail','drugstore','flight','hotel','vacation-rental','car-rental','transit','streaming','entertainment','travel','utilities','telecom','office','advertising','shipping','fitness','other'];
export const PURCHASE_CHANNELS=['direct','portal','wallet'];
const MAX_ROWS=8;
const CREDIT_USE={dining:'dining',supermarket:'shopping',wholesale:'shopping','online-retail':'shopping',drugstore:'shopping',flight:'airline',hotel:'hotel','vacation-rental':'hotel','car-rental':'travel',transit:'ride-share',travel:'travel',streaming:'entertainment',entertainment:'entertainment',fitness:'fitness'};
const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
const clausesFor=rule=>data.spendCategories[rule.terms.spendCategory]||null;
export const earningClauses=clausesFor;
const expandUses=uses=>(uses||[]).flatMap(u=>u==='any-travel'?data.travelUses:[u]);
export function merchantGroupsFor(merchant){const m=norm(merchant);return m?Object.entries(data.merchantGroups).filter(([,g])=>g.aliases.some(a=>m.includes(a))).map(([name])=>name):[];}
const unitCurrency=unit=>unit==='HKD-per-mile'?'HKD':unit.match(/-per-([A-Z]{3})$/)?.[1]||null;
// Per unit of spend on one scale, since HKD-per-mile runs the other way.
const effectiveRate=terms=>terms.unit==='HKD-per-mile'?1/terms.multiplier:terms.multiplier;
function capOf(terms){
 const spend=terms.spendCap;
 if(spend&&Number.isFinite(spend.amount))return {amount:spend.amount,currency:spend.currency||null,period:spend.period||null};
 if(Number.isFinite(terms.annualSpendCap))return {amount:terms.annualSpendCap,currency:terms.capCurrency||null,period:'calendar-year'};
 if(Number.isFinite(terms.sharedQuarterlySpendCap))return {amount:terms.sharedQuarterlySpendCap,currency:terms.capCurrency||null,period:'calendar-quarter'};
 if(Number.isFinite(terms.monthlySpendCap))return {amount:terms.monthlySpendCap,currency:terms.capCurrency||null,period:'calendar-month'};
 return null;
}
function programmeOf(rule,product){
 const id=rule.programmeIds?.[0]||product.transferProgrammeId,named=id&&knowledgeEntities.programmes.find(p=>p.id===id)?.name;
 return named||product.rewardPrograms?.[0]||null;
}
/** A clause is live, needs something the purchase didn't state, or doesn't apply. */
function matchClause(clause,purchase,card){
 const groups=merchantGroupsFor(purchase.merchant),foreign=isForeign(purchase,card),needs=[];
 if(clause.country&&(purchase.country||card.region)!==clause.country)return null;
 if(clause.country&&!purchase.country)needs.push('country-assumed-domestic');
 if(clause.foreign&&!foreign)return null;
 if(clause.minAmount&&!(Number.isFinite(purchase.amount)&&purchase.currency===unitOrCard(card)&&purchase.amount>=clause.minAmount))return null;
 if(clause.merchants&&!clause.merchants.some(m=>groups.includes(m)))return null;
 if(clause.uses&&!expandUses(clause.uses).includes(purchase.category))return null;
 if(clause.channel&&purchase.channel&&clause.channel!==purchase.channel)return null;
 // A portal rate is the issuer's own portal: booking on another bank's portal doesn't earn it.
 if(clause.channel==='portal'&&!(purchase.channel==='portal'&&samePortal(purchase.portal,clause.via)))return {needs:[...needs,'booked-through-portal'],via:clause.via,optional:true};
 if(clause.channel==='direct'&&!purchase.channel)needs.push('direct-assumed');
 if(clause.condition)return {needs:[...needs,clause.condition],optional:true};
 if(!clause.base&&!clause.minAmount&&!clause.foreign&&!clause.merchants)needs.push('merchant-coding-not-guaranteed');
 return {needs,via:clause.via,optional:false,base:!!clause.base};
}
const unitOrCard=card=>card.currency;
// A portal is named by its issuer, not by a word every portal shares, so "Travel" alone matches none.
const PORTAL_WORDS=new Set(['travel','business','portal','the','and','com','hotels','cars','resorts','entertainment','one']);
const portalTokens=name=>norm(name).replace(/\.com\b/g,' ').replace(/travel/g,' ').split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!PORTAL_WORDS.has(w));
const samePortal=(named,via)=>{const a=portalTokens(named),b=new Set(portalTokens(via));return a.some(w=>b.has(w));};
const isForeign=(purchase,card)=>!!(purchase.country&&purchase.country!==card.region||purchase.currency&&purchase.currency!==card.currency);
function earnFor(rule,purchase,card,spend,baseRate){
 const {multiplier,unit}=rule.terms,currency=unitCurrency(unit),amountKnown=Number.isFinite(spend)&&purchase.currency&&(unit==='cashback-percent'?purchase.currency===card.currency:purchase.currency===currency);
 const cap=capOf(rule.terms);
 const compute=(amount,rate)=>unit==='cashback-percent'?amount*rate/100:unit==='HKD-per-mile'?amount/rate:amount*rate;
 const after=Number.isFinite(rule.terms.afterCapPercent)?rule.terms.afterCapPercent:baseRate;
 const capExceeded=!!cap&&amountKnown&&(!cap.currency||cap.currency===purchase.currency)&&spend>cap.amount;
 let reward=null;
 if(amountKnown){
  if(capExceeded)reward=after==null?null:compute(cap.amount,multiplier)+compute(spend-cap.amount,after);
  else reward=compute(spend,multiplier);
 }
 const rounded=reward==null?null:unit==='cashback-percent'?Math.round(reward*100)/100:Math.floor(reward);
 return {rate:multiplier,unit,reward:rounded,isCash:unit==='cashback-percent',cap,capExceeded,...(cap?{afterCapRate:after}:{})};
}
// The user's merchant must appear in a listed name as a whole word, so "a" or "Ub" never matches.
function merchantListed(merchant,names){
 const m=merchant.trim().replace(/^the /,'');if(!m||m.length<3&&!/[\u3400-\u9fff]{2}/.test(m))return false;
 const latin=/^[\x00-\x7f]+$/.test(m),pattern=latin?new RegExp('(?<![a-z0-9])'+m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z0-9])'):null;
 // It must also be most of the listed name, so "Factory" doesn't stand for The Cheesecake Factory.
 // A bracketed alias, as in Grubhub（含Seamless）, is a name of its own.
 const candidates=names.flatMap(n=>[n.replace(/[（(][^)）]*[)）]/g,''),...[...n.matchAll(/[（(](?:含|incl\.?\s*)?([^)）]+)[)）]/g)].map(x=>x[1])]).map(n=>norm(n).trim().replace(/^the /,'')).filter(Boolean);
 return candidates.some(name=>(latin?pattern.test(name):name.includes(m))&&m.length>=name.length*0.5);
}
function creditsFor(card,purchase,day,events){
 const use=CREDIT_USE[purchase.category];if(!use)return [];
 const result=queryCredits({use,when:purchase.date},{cards:[card],events,day,purchase});if(!result.groups)return [];
 const merchant=norm(purchase.merchant);
 return [...result.groups.markedUnused,...result.groups.unknownStatus].filter(i=>!purchase.currency||i.currency===purchase.currency).map(i=>{
  const listed=merchantListed(merchant,i.coupon?.eligibleMerchants||[]);
  // A partly used credit with no recorded amount has an unknown remainder, so it can't be counted.
  const remaining=i.status==='partial'?i.remainingByMark??null:i.remainingByMark??i.publicLimit,perUse=i.perTransactionCap||i.coupon?.redemption?.perCouponAmount||null;
  const room=[remaining,perUse].filter(Number.isFinite);
  const value=Number.isFinite(purchase.amount)&&room.length?Math.min(purchase.amount,...room):null;
  // A credit its own sourced fields rule out is never counted, whatever the merchant list says.
  const applies=i.decision?.status||'conditional';
  return {title:i.title,titles:i.titles,status:i.status,applies,...(i.decision?.unmet?{notApplicableBecause:i.decision.unmet}:{}),...(i.decision?.needs?{needs:i.decision.needs}:{}),value,currency:i.currency,merchantListed:listed,enrollment:i.enrollment,channels:i.channels,minimumNights:i.minimumNights,condition:i.condition,cycleEnd:i.cycle?.end||null,counted:listed&&applies!=='not-applicable'&&['unused','partial'].includes(i.status)&&value!=null};
 });
}
const round2=n=>Math.round(n*100)/100;
function evaluateCard(card,purchase,{day,events}){
 const match=matchCardProduct(card);
 if(match.status!=='matched'||!match.product?.id)return {excluded:{card:card.name,cardRegion:card.region,reason:'product-unmatched'}};
 const rules=queryKnowledge({productId:match.product.id,kind:'earning-rate',asOf:purchase.date}).rules;
 if(!rules.length)return {excluded:{card:card.name,cardRegion:card.region,reason:'no-earning-rules'}};
 const unclassified=rules.filter(r=>!clausesFor(r)).map(r=>r.id);
 const live=[],optional=[];
 for(const rule of rules){
  for(const clause of clausesFor(rule)||[]){
   const hit=matchClause(clause,purchase,card);if(!hit)continue;
   (hit.optional?optional:live).push({rule,...hit});
  }
 }
 const best=rows=>[...rows].sort((a,b)=>effectiveRate(b.rule.terms)-effectiveRate(a.rule.terms))[0]||null;
 const chosen=best(live);
 if(!chosen)return {excluded:{card:card.name,cardRegion:card.region,reason:'no-rule-for-this-purchase',unclassified}};
 const base=best(live.filter(x=>x.base));
 const credits=creditsFor(card,purchase,day,events),counted=credits.find(c=>c.counted)||null;
 const creditValue=counted?counted.value:0;
 const spend=Number.isFinite(purchase.amount)?purchase.amount-(chosen.rule.terms.creditedSpendMayNotEarn?creditValue:0):null;
 const earn=earnFor(chosen.rule,purchase,card,spend,base?base.rule.terms.multiplier:null);
 const reasons=[...new Set(chosen.needs)];
 if(earn.cap)reasons.push('remaining-cap-unknown');
 if(earn.capExceeded)reasons.push('cap-exceeded');
 const foreign=isForeign(purchase,card);
 if(foreign)reasons.push('foreign-fee-unknown');
 if(chosen.rule.assessment.reviewDue)reasons.push('rule-due-for-review');
 if(counted&&counted.enrollment!=='not-required')reasons.push('credit-enrollment-unconfirmed');
 const programme=earn.isCash?null:programmeOf(chosen.rule,match.product);
 return {row:{
  card:card.name,cardRegion:card.region,currency:card.currency,foreign,
  earn:{...earn,programme,spendCategory:chosen.rule.terms.spendCategory,...(chosen.via?{via:chosen.via}:{})},
  ...(chosen.rule.terms.creditedSpendMayNotEarn&&counted?{creditedSpendMayNotEarn:true}:{}),
  credits,countedCredit:counted?{title:counted.title,value:counted.value}:null,
  certainty:reasons.length?'conditional':'confirmed',reasons,
  optional:optional.map(o=>({rate:o.rule.terms.multiplier,unit:o.rule.terms.unit,spendCategory:o.rule.terms.spendCategory,needs:o.needs,...(o.via?{via:o.via}:{})})),
  sources:knowledgeSources(chosen.rule.evidence.sourceIds).map(s=>({title:s.title,url:s.url})),
  unclassified,_baseRate:base?base.rule.terms:null
 }};
}
const programmeAliases={'membership rewards':['mr','membership rewards'],'ultimate rewards':['ur','ultimate rewards'],'thankyou':['ty','thankyou','thank you'],'cathay':['asia miles','cathay']};
// Only these run separately per region, so only they need the region named.
const REGIONAL=['membership rewards','ultimate rewards','thankyou'];
const REGION_TOKEN=/(?:^|\s)(us|hk|ca)$/;
/** A value is in cents of the card's own currency. A bare MR or UR means the US programme; another region must be named. */
function pointValueFor(programme,card,region,values){
 if(!values)return null;
 // A co-brand card with no recorded programme can still be valued by the name on the card.
 const name=norm(programme||card),nameRegion=name.match(REGION_TOKEN)?.[1]||region.toLowerCase();
 for(const [key,cents] of Object.entries(values)){
  const k=norm(key).trim(),keyRegion=k.match(REGION_TOKEN)?.[1]||'us',base=k.replace(REGION_TOKEN,'').trim();
  if(REGIONAL.some(full=>name.includes(full))&&keyRegion!==nameRegion)continue;
  if(base&&(name.includes(base)||Object.entries(programmeAliases).some(([full,aliases])=>name.includes(full)&&aliases.includes(base))))return cents;
 }
 return null;
}
export const POINT_VALUE_NAMES=new Set([...Object.values(programmeAliases).flat(),...knowledgeEntities.programmes.map(p=>norm(p.name)),...Object.keys(data.merchantGroups),'membership rewards','ultimate rewards','hilton honors','marriott bonvoy','world of hyatt','ihg one rewards','asia miles','avios','aeroplan','atmos','skymiles','mileageplus','rapid rewards','aadvantage','venture','capital one']);
/** Cash a row is sure of. Points count only at the user's own value. */
function valueOf(row,values){
 const credit=row.countedCredit?.value||0,earn=row.earn;
 if(earn.isCash)return {value:earn.reward==null?null:round2(earn.reward+credit),valued:false};
 const cents=pointValueFor(earn.programme,row.card,row.cardRegion,values);
 if(cents!=null&&earn.reward!=null)return {value:round2(earn.reward*cents/100+credit),valued:true,centsPerPoint:cents};
 // No amount: a valued programme still compares as a percent of spend.
 if(cents!=null)return {value:credit||null,valued:true,centsPerPoint:cents,valuedRate:earn.unit==='HKD-per-mile'?cents/earn.rate:earn.rate*cents};
 return {value:credit||(earn.reward==null?null:0),valued:false};
}
function compare(rows,values){
 const comparable=rows.filter(r=>!r.foreign),pool=comparable.length?comparable:rows;
 const scored=pool.map(row=>({row,...valueOf(row,values)}));
 const moneyBasis=scored.some(s=>s.value!=null)&&scored.filter(s=>s.row.earn.isCash).every(s=>s.value!=null);
 // Without an amount, or across currencies, only cash rates can be compared.
 const rank=s=>moneyBasis?(s.value??-1):s.row.earn.isCash?s.row.earn.rate:s.valuedRate??-1;
 const sorted=[...scored].sort((a,b)=>rank(b)-rank(a));
 const lead=sorted.find(s=>moneyBasis?s.value>0:s.row.earn.isCash||s.valuedRate!=null)||null;
 return {sorted,lead,moneyBasis,pool,outside:rows.filter(r=>!pool.includes(r))};
}
function decide(purchase,context,values){
 const rows=[],excluded=[],unclassified=[];
 for(const card of context.cards){
  const result=evaluateCard(card,purchase,context);
  if(result.excluded){excluded.push(result.excluded);unclassified.push(...(result.excluded.unclassified||[]));continue;}
  rows.push(result.row);unclassified.push(...result.row.unclassified);
 }
 return {rows,excluded,unclassified:[...new Set(unclassified)],...compare(rows,values)};
}
function resolvePurchase(raw,day){
 const assumptions=[],groups=merchantGroupsFor(raw.merchant);
 let date=day;
 if(raw.when){const when=resolveTripDates(raw.when,day);if(!when.ok)return {needsDates:true,reason:when.reason};date=when.start;}
 let category=raw.category||null;
 if(!category&&groups.length){category=data.merchantGroups[groups[0]].category;assumptions.push('category-from-merchant');}
 if(!category){category='other';assumptions.push('category-unknown-base-rates-used');}
 if(!raw.channel)assumptions.push('channel-assumed-direct');
 if(!raw.country)assumptions.push('country-assumed-domestic-for-each-card');
 if(raw.categorySource==='inferred')assumptions.push('category-inferred-not-stated');
 if(Number.isFinite(raw.amount)&&!raw.currency)assumptions.push('amount-has-no-currency-so-rates-compared');
 if(raw.channel==='portal'&&!raw.portal)assumptions.push('portal-not-named');
 return {purchase:{category,date,merchant:raw.merchant||null,amount:Number.isFinite(raw.amount)?raw.amount:null,country:raw.country||null,currency:raw.currency||null,channel:raw.channel||null,portal:raw.portal||null,nights:Number.isInteger(raw.nights)?raw.nights:null},assumptions};
}
const publicRow=({_baseRate,unclassified,...row})=>row;
const whoLeads=d=>d.lead?.row||null;
export function chooseCard(raw,{cards,events=[],day}){
 if(!isRealDate(day))throw TypeError('chooseCard needs the wallet day');
 const resolved=resolvePurchase(raw,day);
 if(resolved.needsDates)return {tool:'choose_card',today:day,needsDates:true,reason:resolved.reason,instruction:'The date phrase could not be resolved. Answer for today or ask for the date; do not guess it.'};
 const {purchase,assumptions}=resolved,values=raw.pointValues||null,context={cards,events,day};
 // With cards billed in several currencies and no place or currency given, each currency is its own answer.
 const currencies=[...new Set(cards.filter(c=>matchCardProduct(c).status==='matched').map(c=>c.currency))];
 if(!purchase.country&&!purchase.currency&&currencies.length>1){
  const options=currencies.map(currency=>{const d=decide({...purchase,currency,amount:null},{...context,cards:cards.filter(c=>c.currency===currency)},values),lead=whoLeads(d);return {currency,card:lead?.card||null,rate:lead?.earn.rate??null,unit:lead?.earn.unit||null};});
  return {tool:'choose_card',today:day,purchase,assumptions:[...assumptions,'purchase-currency-not-given'],choice:{kind:'depends-on-currency',options},rows:[],totalRows:0,otherCurrencyCards:[],pointsAlternatives:[],couldChange:[],excluded:[],unclassifiedRules:[],limits:'Cards are billed in different currencies and the purchase currency was not given, so each currency is answered separately. Ask where the purchase is or in which currency.'};
 }
 const main=decide(purchase,context,values);
 const lead=whoLeads(main),leadValue=main.lead?.value??null,couldChange=[];
 // What a different fact would do, computed rather than left for the model to reason out.
 const creditChanges=[];
 for(const s of main.sorted){
  for(const credit of s.row.credits.filter(c=>!c.counted&&c.applies!=='not-applicable'&&Number.isFinite(c.value)&&c.value>0)){
   const wouldLead=main.moneyBasis&&(s.value||0)+credit.value>(leadValue||0)&&s.row!==lead;
   creditChanges.push({kind:'credit-if-it-applies',card:s.row.card,title:credit.title,status:credit.status,value:credit.value,currency:credit.currency,merchantListed:credit.merchantListed,wouldChangeChoice:wouldLead});
  }
  // One line per card: its best rate that needs something more.
  const higher=s.row.optional.filter(o=>o.unit===s.row.earn.unit&&effectiveRate({unit:o.unit,multiplier:o.rate})>effectiveRate({unit:s.row.earn.unit,multiplier:s.row.earn.rate})).sort((a,b)=>effectiveRate({unit:b.unit,multiplier:b.rate})-effectiveRate({unit:a.unit,multiplier:a.rate}))[0];
  if(higher)couldChange.push({kind:'higher-rate-if',card:s.row.card,rate:higher.rate,unit:higher.unit,spendCategory:higher.spendCategory,needs:higher.needs,...(higher.via?{via:higher.via}:{})});
  if(s.row.earn.capExceeded||s.row.reasons.includes('remaining-cap-unknown')&&s.row===lead)couldChange.push({kind:'cap',card:s.row.card,cap:s.row.earn.cap,afterCapRate:s.row.earn.afterCapRate??null,capExceeded:s.row.earn.capExceeded});
 }
 if(lead&&lead.reasons.includes('merchant-coding-not-guaranteed')){
  const fallback=decide({...purchase,category:'other',merchant:null},context,values);
  const other=whoLeads(fallback);
  if(other&&other.card!==lead.card)couldChange.push({kind:'if-coded-differently',card:other.card,cardRegion:other.cardRegion});
 }
 if(lead?.foreign)couldChange.push({kind:'foreign-fee-unknown',card:lead.card});
 if(raw.alternateCategory&&raw.alternateCategory!==purchase.category){
  const other=whoLeads(decide({...purchase,category:raw.alternateCategory},context,values));
  couldChange.push({kind:'if-category-is',category:raw.alternateCategory,card:other?.card||null,wouldChangeChoice:!!other&&other.card!==lead?.card});
 }
 // Credits that would change the choice come first; the list stays short.
 couldChange.push(...creditChanges.sort((a,b)=>Number(b.wouldChangeChoice)-Number(a.wouldChangeChoice)||b.value-a.value).slice(0,4));
 // Points against the lead: the value per point at which each programme overtakes it. No value is assumed.
 const pointsAlternatives=[];
 for(const s of main.sorted.filter(s=>!s.row.earn.isCash&&s.row!==lead&&!s.valued)){
  const credit=s.row.countedCredit?.value||0,points=s.row.earn.reward,gap=main.moneyBasis&&leadValue!=null?leadValue-credit:null;
  pointsAlternatives.push({card:s.row.card,cardRegion:s.row.cardRegion,programme:s.row.earn.programme,rate:s.row.earn.rate,unit:s.row.earn.unit,points,...(gap!=null&&points>0?{breakEvenCentsPerPoint:round2(Math.max(gap,0)/points*100)}:{})});
 }
 const choice=lead
  ?{kind:'use-card',card:lead.card,cardRegion:lead.cardRegion,basis:main.moneyBasis?'money':lead.earn.isCash?'cash-rate':'rate-at-your-point-value',value:main.moneyBasis?leadValue:null,currency:purchase.currency,valuedPoints:!!main.lead.valued,certainty:lead.certainty,reasons:lead.reasons}
  :main.rows.length?{kind:'points-depends',reason:'no-cash-card-and-no-stated-point-value'}:{kind:'none',reason:'no-eligible-card'};
 return {
  tool:'choose_card',today:day,purchase,assumptions,choice,
  rows:main.sorted.slice(0,MAX_ROWS).map(s=>({...publicRow(s.row),...(s.valued?{valueAtYourPointValue:s.value,centsPerPoint:s.centsPerPoint,...(s.valuedRate!=null?{percentAtYourPointValue:round2(s.valuedRate)}:{})}:{})})),totalRows:main.sorted.length,
  otherCurrencyCards:main.outside.map(r=>({card:r.card,cardRegion:r.cardRegion,currency:r.currency,rate:r.earn.rate,unit:r.earn.unit,reason:'different-billing-currency-so-not-compared'})),
  pointsAlternatives:pointsAlternatives.slice(0,MAX_ROWS),couldChange:couldChange.slice(0,20),excluded:main.excluded,unclassifiedRules:main.unclassified,
  limits:'Merchant coding, network acceptance, remaining caps and enrollment are not known. Foreign transaction fees are not recorded, so they are unknown and not zero. Offers are not included. Never a global best: this compares held cards on recorded rules.'
 };
}
