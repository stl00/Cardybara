// The wallet's "which card" entry: the same engine as the chat's choose_card tool, with no model in between.
import {chooseCard,PURCHASE_CATEGORIES} from './cardDecision.js';

/** The categories offered on the wallet entry, in display order; each is one the engine knows. */
export const QUICK_CATEGORIES=['dining','supermarket','gas','online-retail','flight','hotel','travel','transit','streaming','drugstore','entertainment','other'].filter(c=>PURCHASE_CATEGORIES.includes(c));
const MAX_OTHERS=3,MAX_CHANGES=3;
const SIMPLE_CHANGES=new Set(['credit-if-it-applies','higher-rate-if','if-coded-differently','cap','foreign-fee-unknown']);

/** Billing currencies of the held cards, so the entry can ask for one only when it matters. */
export function walletCurrencies(cards=[]){return [...new Set(cards.map(c=>c.currency).filter(Boolean))].sort();}

/** The purchase as the engine reads it. Blank fields stay out, so the engine states its own assumptions. */
export function purchaseArgs({category,amount,merchant,currency}={}){
 const args={category:PURCHASE_CATEGORIES.includes(category)?category:'other'};
 if(Number.isFinite(amount)&&amount>0)args.amount=amount;
 const name=String(merchant||'').trim().slice(0,80);if(name)args.merchant=name;
 if(currency)args.currency=currency;
 return args;
}

const earnOf=row=>row?{rate:row.earn.rate,unit:row.earn.unit,reward:row.earn.reward??null,programme:row.earn.programme||null,isCash:!!row.earn.isCash,...(row.earn.nonCash?{nonCash:true,rewardCurrency:row.earn.rewardCurrency}:{})}:null;
const round2=n=>Math.round(n*100)/100;
/**
 * What a row returns per 100 of spend, as the engine valued it: cash at its rate, points at the value per point it
 * used, and null for points with no value. A counted credit is not in it (it is not a rate); a cap the amount runs
 * past blends the rates. Display only: the ranking is the engine's.
 */
export function effectivePercent(row,amount){
 const earn=row?.earn;if(!earn)return null;
 const cents=earn.isCash?null:row.centsPerPoint??null;
 if(!earn.isCash&&cents==null)return null;
 if(earn.capExceeded&&earn.reward!=null&&Number.isFinite(amount)&&amount>0)return round2((earn.isCash?earn.reward:earn.reward*cents/100)/amount*100);
 if(earn.isCash)return earn.rate;
 return round2(earn.unit==='HKD-per-mile'?cents/earn.rate:earn.rate*cents);
}
/** The money a row comes to on a money basis: cash and counted credit, or points at their value; else null. */
function moneyOf(row){
 if(row.earn.isCash)return row.earn.reward==null?null:round2(row.earn.reward+(row.countedCredit?.value||0));
 return row.valueAtPointValue??null;
}
const shown=(row,amount,money)=>({card:row.card,cardRegion:row.cardRegion||null,...earnOf(row),percent:effectivePercent(row,amount),value:money?moneyOf(row):null});

/** Runs chooseCard and keeps what the wallet shows: the choice, a few alternatives and what could change it. */
export function quickChoice(input,{cards=[],events=[],day,pointValues=[],marketDefaults=true}){
 const result=chooseCard(purchaseArgs(input),{cards,events,day,pointValues,marketDefaults});
 if(result.needsDates)return {kind:'none',assumptions:[],others:[],points:[],changes:[],excluded:0,otherCurrency:0};
 const {choice}=result,lead=choice.kind==='use-card'?result.rows.find(r=>r.card===choice.card&&(!choice.cardRegion||r.cardRegion===choice.cardRegion))||result.rows.find(r=>r.card===choice.card):null;
 return {
  kind:choice.kind,
  card:choice.card||null,
  cardRegion:choice.cardRegion||null,
  basis:choice.basis||null,
  value:choice.value??null,
  currency:choice.currency||lead?.currency||null,
  certainty:choice.certainty||null,
  reasons:choice.reasons||[],
  earn:earnOf(lead),
  percent:lead?effectivePercent(lead,input?.amount):null,
  pointValue:choice.pointValue||null,
  holdsAbove:choice.holdsAboveCentsPerPoint??null,
  credit:lead?.countedCredit||null,
  options:choice.options||[],
  others:result.rows.filter(r=>r!==lead).slice(0,MAX_OTHERS).map(r=>shown(r,input?.amount,choice.basis==='money')),
  points:result.pointsAlternatives.slice(0,MAX_OTHERS),
  changes:result.couldChange.filter(c=>SIMPLE_CHANGES.has(c.kind)).slice(0,MAX_CHANGES),
  assumptions:result.assumptions,
  excluded:result.excluded.length,
  otherCurrency:result.otherCurrencyCards.length,
  sources:lead?.sources||[]
 };
}
