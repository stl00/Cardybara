import {PROVIDERS} from '../extension-next/providers.js';
import {cleanFeeDate} from './feeDate.js';
// What the user set on a card by hand: a display name, last digits, region (a manual card only) and the
// annual fee date. Kept apart from the bank's readings and applied on top of them, so a later bank refresh
// never overwrites a correction, and resetting a field brings back what the bank showed.
export const CARD_EDITS_KEY='cardybara-card-edits-v1';
export const CARD_EDIT_FIELDS=['name','tail','bank','feeDate'];
const MAX=200;
/** The same rules as a manually added card's name: no tags, no control characters, nothing like a card number. */
export const validCardName=value=>typeof value==='string'&&!!value.trim()&&value.trim().length<=100&&!/[<>\u0000-\u001f]/.test(value)&&!/(?:\d[ -]?){9,}/.test(value);
export const validTail=value=>typeof value==='string'&&/^\d{4,5}$/.test(value);
const validBank=value=>typeof value==='string'&&!!PROVIDERS[value]&&!PROVIDERS[value].archived;
// Another region of the same issuer is the only bank a manual card can move to.
export const regionBanks=bank=>Object.keys(PROVIDERS).filter(b=>!PROVIDERS[b].archived&&PROVIDERS[b].issuer===PROVIDERS[bank]?.issuer);
function cleanRow(row){
 if(!row||typeof row!=='object'||typeof row.cardId!=='string'||!row.cardId||row.cardId.length>100)return null;
 const out={cardId:row.cardId};
 if(validCardName(row.name))out.name=row.name.trim();
 if(validTail(row.tail))out.tail=row.tail;
 if(validBank(row.bank))out.bank=row.bank;
 const fee=cleanFeeDate(row.feeDate);if(fee)out.feeDate=fee;
 return Object.keys(out).length>1?out:null;
}
const clean=rows=>Array.isArray(rows)?rows.map(cleanRow).filter(Boolean).slice(-MAX):[];
/** A missing, damaged or older value reads as no edits; a damaged row is dropped on its own. */
export function readCardEdits(storage){try{return clean(JSON.parse(storage.getItem(CARD_EDITS_KEY)));}catch{return []}}
/**
 * Sets or clears fields on one card. A null or empty value clears that field, which goes back to what the
 * bank showed (or, for the fee date, to unknown). An invalid value throws, so nothing half-saves.
 */
export function withCardEdit(edits,card,patch){
 if(!card?.id)throw Error('invalid_card');
 const row={...(edits.find(e=>e.cardId===card.id)||{cardId:card.id})};
 for(const [field,value] of Object.entries(patch||{})){
  if(!CARD_EDIT_FIELDS.includes(field))throw Error('invalid_card_edit');
  if(value==null||value===''){delete row[field];continue;}
  if(field==='name'&&!validCardName(value))throw Error('invalid_card_name');
  if(field==='tail'&&!validTail(value))throw Error('invalid_card_tail');
  if(field==='bank'&&(card.identitySource==='bank-page'||!validBank(value)||!regionBanks(card.detected?.bank??card.bank).includes(value)))throw Error('invalid_card_bank');
  if(field==='feeDate'&&!cleanFeeDate(value))throw Error('invalid_fee_date');
  row[field]=field==='name'?value.trim():field==='feeDate'?cleanFeeDate(value):value;
 }
 const rest=edits.filter(e=>e.cardId!==card.id);
 return Object.keys(row).length>1?[...rest,row].slice(-MAX):rest;
}
export const withoutCardEdits=(edits,cardId)=>edits.filter(e=>e.cardId!==cardId);
/**
 * The cards as the user sees them. `userSet` lists the fields the user changed and `detected` keeps what
 * was there before, so the page can label a correction and offer to reset it. A bank-page card keeps the
 * name the bank showed as `pageName`, so recognising its product still starts from the bank's words.
 */
export function applyCardEdits(cards,edits){
 const byCard=new Map(edits.map(e=>[e.cardId,e]));
 return cards.map(card=>{
  const row=byCard.get(card.id);if(!row)return card;
  const next={...card},userSet=[],detected={};
  if(row.bank&&card.identitySource!=='bank-page'&&regionBanks(card.bank).includes(row.bank)&&row.bank!==card.bank){
   const p=PROVIDERS[row.bank];detected.bank=card.bank;Object.assign(next,{bank:row.bank,region:p.region,currency:p.cardCurrencies?.includes(card.currency)?card.currency:p.currency});userSet.push('bank');
  }
  // On a bank-page card the shown name is the product's, so a name equal to the bank's words is still the user's choice.
  if(row.name&&(row.name!==card.name||card.identitySource==='bank-page')){detected.name=card.name;if(card.identitySource==='bank-page')next.pageName=card.pageName??card.name;next.name=row.name;userSet.push('name');}
  if(row.tail&&row.tail!==card.tail){detected.tail=card.tail;next.tail=row.tail;userSet.push('tail');}
  if(row.feeDate){next.feeDate=row.feeDate;userSet.push('feeDate');}
  return userSet.length?{...next,userSet,detected}:card;
 });
}
/** Edits from a backup win over this wallet's for the same card; other cards' edits are kept. */
export function mergeCardEdits(edits,backup){
 if(backup?.schema!==1||!Array.isArray(backup.edits)||backup.edits.length>MAX||clean(backup.edits).length!==backup.edits.length)throw Error('invalid_card_edits_backup');
 const merged=new Map(edits.map(e=>[e.cardId,e]));for(const e of clean(backup.edits))merged.set(e.cardId,e);return [...merged.values()].slice(-MAX);
}
