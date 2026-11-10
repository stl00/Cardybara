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

const earnOf=row=>row?{rate:row.earn.rate,unit:row.earn.unit,reward:row.earn.reward??null,programme:row.earn.programme||null,isCash:!!row.earn.isCash}:null;

/** Runs chooseCard and keeps what the wallet shows: the choice, a few alternatives and what could change it. */
export function quickChoice(input,{cards=[],events=[],day}){
 const result=chooseCard(purchaseArgs(input),{cards,events,day});
 if(result.needsDates)return {kind:'none',assumptions:[],others:[],points:[],changes:[],excluded:0,otherCurrency:0};
 const {choice}=result,lead=choice.kind==='use-card'?result.rows.find(r=>r.card===choice.card):null;
 return {
  kind:choice.kind,
  card:choice.card||null,
  basis:choice.basis||null,
  value:choice.value??null,
  currency:choice.currency||lead?.currency||null,
  certainty:choice.certainty||null,
  reasons:choice.reasons||[],
  earn:earnOf(lead),
  credit:lead?.countedCredit||null,
  options:choice.options||[],
  others:result.rows.filter(r=>r!==lead).slice(0,MAX_OTHERS).map(r=>({card:r.card,...earnOf(r)})),
  points:result.pointsAlternatives.slice(0,MAX_OTHERS),
  changes:result.couldChange.filter(c=>SIMPLE_CHANGES.has(c.kind)).slice(0,MAX_CHANGES),
  assumptions:result.assumptions,
  excluded:result.excluded.length,
  otherCurrency:result.otherCurrencyCards.length,
  sources:lead?.sources||[]
 };
}
