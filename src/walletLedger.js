import {creditLedger} from './creditLedger.js';
// Wallet-wide credit summary (#568): one creditLedger call over all held cards, each on its own current card year.
// A card without a usable fee date has no card year, so it is listed with a "set the fee date" flag and no figures
// (never zeros). Totals are kept per currency; amounts of different currencies are never added together.
const cents=n=>Math.round(n*100)/100;
/**
 * @param {object[]} cards held (non-hidden) wallet cards
 * @param {object[]} events the user's credit marks
 * @param {string} asOf wallet day, YYYY-MM-DD
 * @returns {{rows:{cardId:string,currency:string,needsFeeDate:boolean,period:object|null,available:number|null,used:number|null,notCaptured:number|null}[],totals:{currency:string,available:number,used:number,notCaptured:number,cards:number}[]}}
 */
export function walletLedgerSummary(cards,events,asOf){
 const rows=creditLedger(cards,events,asOf,{basis:'card-year'}).map(l=>{
  const missing=l.needsFeeDate||!l.period;
  return {cardId:l.cardId,currency:l.currency,needsFeeDate:missing,period:missing?null:l.period,available:missing?null:l.available,used:missing?null:l.used,notCaptured:missing?null:l.notCaptured};
 });
 const byCurrency=new Map();
 for(const r of rows){
  if(r.needsFeeDate)continue;
  const t=byCurrency.get(r.currency)||{currency:r.currency,available:0,used:0,notCaptured:0,cards:0};
  t.available=cents(t.available+r.available);t.used=cents(t.used+r.used);t.notCaptured=cents(t.notCaptured+r.notCaptured);t.cards++;
  byCurrency.set(r.currency,t);
 }
 return {rows,totals:[...byCurrency.values()]};
}
