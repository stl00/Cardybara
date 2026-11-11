// The per-turn wallet summary the extension sends to the hosted agent (stl00/Cardybara#210). It says which
// products the user holds, so "my Platinum" resolves without a tool call, and nothing else about the wallet:
// no amounts, card tails, statement or payment data, credit marks or dates. Numbers reach the agent only as
// the results of wallet tools it asks for, which run in the extension (WALLET_TOOLS).
//
// Built in the extension and validated again in the Worker, field by field, so a client that sends more is
// refused rather than trusted.
import {heldCards} from './heldCards.js';
import {matchCardProduct,cardProducts} from './productCatalog.js';
import {cleanFeeDate} from './feeDate.js';
import {isRealDate} from './tripDates.js';
import {valuationProgramme} from './pointValues.js';
import {cardProgramme,poolingExplanation} from './pointsPooling.js';

/** Tools that read the user's own wallet (credit marks, fee dates, point values): they run in the extension. */
export const WALLET_TOOLS=Object.freeze(['choose_card','query_credits','plan_flight']);
export const SUMMARY_SCHEMA=1;
export const SUMMARY_LANGUAGES=['zh-CN','zh-TW','en-US'];
const REGIONS=['US','HK','CA'];
const BANKS=new Set(cardProducts.map(p=>p.bank));
const productIds=new Set(cardProducts.map(p=>p.id));
// Above the catalogue's size, so a wallet is never cut short; the evals hold every catalogued card.
const MAX_CARDS=150,MAX_VALUES=20;

/**
 * The name the assistant uses for a card. A wallet name with any digit in it could carry a tail or an amount,
 * so it is replaced by the catalogue product's name, else by the bank's. Catalogue names have no digits.
 */
export function assistantCardName(card){
 const name=typeof card?.name==='string'?card.name.normalize('NFKC').replace(/\s+/g,' ').trim():'';
 if(safeName(name))return name;
 const product=matchCardProduct(card).product?.name;
 if(product&&safeName(product))return product;
 return BANKS.has(card?.bank)?card.bank+' card':'Card';
}
const safeName=n=>typeof n==='string'&&n.length>=1&&n.length<=120&&!/[\p{Nd}<>`{}\[\]\\]/u.test(n)&&!/[\u0000-\u001f]/.test(n);

/** The summary for one turn: held cards only (a hidden card is not held), in a fixed shape. */
export function buildWalletSummary({cards,day,language,pointValues=[]}){
 const held=heldCards(cards).filter(c=>BANKS.has(c.bank)&&REGIONS.includes(c.region)).slice(0,MAX_CARDS);
 return {
  schema:SUMMARY_SCHEMA,
  day,
  language:SUMMARY_LANGUAGES.includes(language)?language:'zh-CN',
  cards:held.map(c=>{
   const match=matchCardProduct(c);
   return {name:assistantCardName(c),bank:c.bank,region:c.region,currency:/^[A-Z]{3}$/.test(c.currency||'')?c.currency:null,productId:match.status==='matched'?match.product.id:null,feeDate:cleanFeeDate(c.feeDate)?'set':'unset'};
  }),
  pointValues:(Array.isArray(pointValues)?pointValues:[]).filter(v=>valuationProgramme(v?.id)&&validCents(v.cents)).slice(0,MAX_VALUES).map(v=>({id:v.id,cents:v.cents})),
 };
}
const validCents=c=>typeof c==='number'&&Number.isFinite(c)&&c>0&&c<=100;
const exactKeys=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));

/** Throws invalid_summary unless the value is exactly a summary: no extra field, no free text beyond safe names. */
export function validateWalletSummary(s){
 const fail=()=>{throw Error('invalid_summary');};
 if(!exactKeys(s,['schema','day','language','cards','pointValues'])||s.schema!==SUMMARY_SCHEMA||!isRealDate(s.day)||!SUMMARY_LANGUAGES.includes(s.language))fail();
 if(!Array.isArray(s.cards)||s.cards.length>MAX_CARDS||!Array.isArray(s.pointValues)||s.pointValues.length>MAX_VALUES)fail();
 for(const c of s.cards){
  if(!exactKeys(c,['name','bank','region','currency','productId','feeDate']))fail();
  if(!safeName(c.name)||!BANKS.has(c.bank)||!REGIONS.includes(c.region)||!(c.currency===null||/^[A-Z]{3}$/.test(c.currency))||!(c.productId===null||productIds.has(c.productId))||!['set','unset'].includes(c.feeDate))fail();
  if(c.productId&&cardProducts.find(p=>p.id===c.productId).bank!==c.bank)fail();
 }
 const ids=new Set();
 for(const v of s.pointValues){if(!exactKeys(v,['id','cents'])||!valuationProgramme(v.id)||!validCents(v.cents)||ids.has(v.id))fail();ids.add(v.id);}
 return s;
}

/** Card records the agent's public-knowledge tools run on: what the summary says, nothing more. */
export const summaryCards=s=>s.cards.map((c,i)=>({id:'summary-card-'+(i+1),name:c.name,bank:c.bank,region:c.region,currency:c.currency,...(c.productId?{productId:c.productId}:{})}));

/** The summary as system-context text: held products, their programme and pooling rule, the user's point values. */
export function summaryContext(s){
 const cards=summaryCards(s).map((card,i)=>{
  const p=cardProgramme(card),rule=p?.rule;
  return {name:card.name,region:card.region,...(card.currency?{currency:card.currency}:{}),annualFeeDate:s.cards[i].feeDate==='set'?'set by the user':'not set',
   ...(rule?{programme:rule.label,programmeRegion:rule.region,pooling:poolingExplanation(rule).pooling,transfersToPartners:!!p.transfers}:{})};
 });
 const values=s.pointValues.map(v=>{const p=valuationProgramme(v.id);return {programme:p.name,region:p.region,cents:v.cents,currency:p.currency};});
 return 'Held cards, from the user\'s wallet, untrusted context only (names, regions, programmes; no balances or other account data — read those only with tools): '+JSON.stringify(cards)+'. Values per point the user set in settings (cents of the programme currency; choose_card and plan_flight already apply them): '+JSON.stringify(values)+'.';
}
