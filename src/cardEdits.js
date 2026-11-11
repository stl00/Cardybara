import {PROVIDERS} from '../extension-next/providers.js';
import {cleanFeeDate,feeDateFromCycles} from './feeDate.js';
// What the user set on a card by hand: a display name, last digits, region (a manual card only), the
// annual fee date, and whether the card is hidden (still read from the bank, but treated as not held; see heldCards.js). Kept apart from the bank's readings and applied on top of them, so a later bank refresh
// never overwrites a correction, and resetting a field brings back what the bank showed.
export const CARD_EDITS_KEY='cardybara-card-edits-v1';
export const CARD_EDIT_FIELDS=['name','tail','bank','feeDate','hidden'];
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
 if(row.hidden===true)out.hidden=true;
 // Month-days that older card-year records disagreed on when the fee date was taken from them.
 if(fee&&Array.isArray(row.feeDateConflict)&&row.feeDateConflict.length>1&&row.feeDateConflict.length<=20&&row.feeDateConflict.every(d=>typeof d==='string'&&/^\d{2}-\d{2}$/.test(d)))out.feeDateConflict=[...row.feeDateConflict];
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
  // The user setting or clearing the fee date settles any conflict a migration noted.
  if(field==='feeDate')delete row.feeDateConflict;
  // Unhiding is clearing the flag, so a shown card carries no row for it.
  if(value==null||value===''||(field==='hidden'&&value===false)){delete row[field];continue;}
  if(field==='hidden'&&value!==true)throw Error('invalid_card_hidden');
  if(field==='name'&&!validCardName(value))throw Error('invalid_card_name');
  if(field==='tail'&&!validTail(value))throw Error('invalid_card_tail');
  if(field==='bank'&&(card.identitySource==='bank-page'||!validBank(value)||!regionBanks(card.detected?.bank??card.bank).includes(value)))throw Error('invalid_card_bank');
  if(field==='feeDate'&&!cleanFeeDate(value))throw Error('invalid_fee_date');
  row[field]=field==='name'?value.trim():field==='feeDate'?cleanFeeDate(value):value;
 }
 const rest=edits.filter(e=>e.cardId!==card.id);
 return Object.keys(row).length>1?[...rest,row].slice(-MAX):rest;
}
/**
 * Before one fee date drove everything, a card year was recorded with its own start and end in cost tracking.
 * Each card without a fee date takes one from those records (the latest start wins), noting the dates when
 * they disagreed. A card that already has a fee date keeps it.
 */
export function withMigratedFeeDates(edits,cycles){
 const starts=new Map();
 for(const c of cycles||[])if(typeof c?.cardId==='string'&&c.cardId&&c.cardId.length<=100)starts.set(c.cardId,[...(starts.get(c.cardId)||[]),c.start]);
 let next=edits;
 for(const [cardId,list] of starts){
  if(edits.find(e=>e.cardId===cardId)?.feeDate)continue;
  const found=feeDateFromCycles(list);if(!found)continue;
  next=withCardEdit(next,{id:cardId},{feeDate:found.feeDate});
  if(found.conflict)next=next.map(e=>e.cardId===cardId?{...e,feeDateConflict:found.conflict}:e);
 }
 return next;
}
/**
 * The migration runs on every cost-ledger load but takes each card once: `done` lists the cards already
 * handled, so a date the user later clears stays cleared, while records restored from an older backup on
 * another day still get their card a date.
 */
export function migrateFeeDatesOnce(edits,cycles,done){
 const handled=new Set(Array.isArray(done)?done.filter(id=>typeof id==='string'):[]);
 const fresh=(cycles||[]).filter(c=>!handled.has(c?.cardId));
 const next=withMigratedFeeDates(edits,fresh);
 for(const c of fresh)if(typeof c?.cardId==='string'&&c.cardId&&c.cardId.length<=100)handled.add(c.cardId);
 return {edits:next,done:[...handled].slice(-1000),changed:fresh.length>0};
}
export const withoutCardEdits=(edits,cardId)=>edits.filter(e=>e.cardId!==cardId);
/**
 * The cards as the user sees them. `userSet` lists the fields the user changed and `detected` keeps what
 * was there before, so the page can label a correction and offer to reset it. A bank-page card keeps the
 * name the bank showed as `pageName`, so recognising its product still starts from the bank's words.
 */
export function applyCardEdits(cards,edits){
 const byCard=new Map(edits.map(e=>[e.cardId,e]));
 return cards.map(shown=>{
  // Only the user's edit hides a card; a flag arriving with snapshot or bank data is not theirs and is dropped.
  const card='hidden' in shown?(({hidden,...rest})=>rest)(shown):shown;
  const row=byCard.get(card.id);if(!row)return card;
  const next={...card},userSet=[],detected={};
  if(row.bank&&card.identitySource!=='bank-page'&&regionBanks(card.bank).includes(row.bank)&&row.bank!==card.bank){
   const p=PROVIDERS[row.bank];detected.bank=card.bank;Object.assign(next,{bank:row.bank,region:p.region,currency:p.cardCurrencies?.includes(card.currency)?card.currency:p.currency});userSet.push('bank');
  }
  // On a bank-page card the shown name is the product's, so a name equal to the bank's words is still the user's choice.
  if(row.name&&(row.name!==card.name||card.identitySource==='bank-page')){detected.name=card.name;if(card.identitySource==='bank-page')next.pageName=card.pageName??card.name;next.name=row.name;userSet.push('name');}
  if(row.tail&&row.tail!==card.tail){detected.tail=card.tail;next.tail=row.tail;userSet.push('tail');}
  if(row.feeDate){next.feeDate=row.feeDate;userSet.push('feeDate');if(row.feeDateConflict)next.feeDateConflict=row.feeDateConflict;}
  // Hiding is not a correction of the bank's reading, so it is not listed in userSet.
  if(row.hidden)next.hidden=true;
  return userSet.length?{...next,userSet,detected}:row.hidden?next:card;
 });
}
/** Edits from a backup win over this wallet's for the same card; other cards' edits are kept. */
export function mergeCardEdits(edits,backup){
 if(backup?.schema!==1||!Array.isArray(backup.edits)||backup.edits.length>MAX||clean(backup.edits).length!==backup.edits.length)throw Error('invalid_card_edits_backup');
 const merged=new Map(edits.map(e=>[e.cardId,e]));for(const e of clean(backup.edits))merged.set(e.cardId,e);return [...merged.values()].slice(-MAX);
}
