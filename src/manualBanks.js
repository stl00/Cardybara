// Issuers whose cards can be in the wallet but are never read from a bank page (#231, #676). They are not collector
// providers: no connection row, no refresh, no adapter. A card of one keeps its product's benefits, credits,
// rewards and transfer partners like any other card.
import {PROVIDERS} from '../extension-next/providers.js';

const us=(issuer,url)=>({issuer,region:'US',currency:'USD',url});
// US issuers the catalogue knows that have no bank adapter.
export const MANUAL_BANKS={
 'Capital One':us('Capital One','https://www.capitalone.com/'),
 Discover:us('Discover','https://www.discover.com/'),
 'U.S. Bank':us('U.S. Bank','https://www.usbank.com/'),
 'Wells Fargo':us('Wells Fargo','https://www.wellsfargo.com/'),
 Bilt:us('Bilt','https://www.bilt.com/'),
 Barclays:us('Barclays','https://cards.barclaycardus.com/'),
};
export const MANUAL_BANK_NAMES=Object.keys(MANUAL_BANKS);
// Plaid's institution names for Barclays US ("Barclays - Cards", "Barclaycard US"). Link offers US institutions only.
export const BARCLAYS_US=/^\s*barclay(?:s|card)\b(?!.*\buk\b)/i;
/**
 * A card stored as a generic issuer before Barclays was mapped (#694), moved to the Barclays bank so it matches the
 * catalogue. Any other card is returned as it is.
 */
export function rematchCard(card){
 if(card?.genericBank!==true||!BARCLAYS_US.test(card.bank))return card;
 const {genericBank,...rest}=card;return {...rest,bank:'Barclays'};
}
// A removal row has no genericBank mark; it follows its card so the removed card is still recognised.
const rematchRemoved=row=>typeof row?.bank==='string'&&row.bank!=='Barclays'&&BARCLAYS_US.test(row.bank)?{...row,bank:'Barclays'}:row;
export const rematchCards=rows=>Array.isArray(rows)?rows.map(rematchCard):rows;
export const rematchRemovals=rows=>Array.isArray(rows)?rows.map(rematchRemoved):rows;
export const manualOnly=bank=>typeof bank==='string'&&!Object.hasOwn(PROVIDERS,bank);
/**
 * The bank name stored for a card of an issuer the wallet does not know (a Plaid institution name, #676): trimmed, or
 * null when it cannot be stored (empty, too long, markup, control characters, a long number, or a known bank's key).
 */
export function genericBankName(value){
 const name=typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
 if(!name||name.length>100||/[<>\u0000-\u001f\u007f]/.test(name)||/(?:\d[ -]?){5,}/.test(name))return null;
 return Object.hasOwn(PROVIDERS,name)||Object.hasOwn(MANUAL_BANKS,name)||name in {}?null:name;
}
/**
 * Region, currency and issuer of a bank a card can belong to: a collector provider or a manual-only issuer. With
 * `genericBank` (a stored card carries it), any other storable name is a US issuer in USD with no catalogue products.
 */
export function bankProfile(bank,{genericBank}={}){
 if(Object.hasOwn(PROVIDERS,bank))return PROVIDERS[bank];
 if(Object.hasOwn(MANUAL_BANKS,bank))return MANUAL_BANKS[bank];
 return genericBank===true&&genericBankName(bank)===bank?{issuer:bank,region:'US',currency:'USD',generic:true}:null;
}
