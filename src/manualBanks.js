// Issuers whose cards can be added by hand but never read from a bank page (#231). They are not collector
// providers: no connection row, no refresh, no adapter. A card of one keeps its product's benefits, credits,
// rewards and transfer partners like any other card.
import {PROVIDERS} from '../extension-next/providers.js';

export const MANUAL_BANKS={
 Bilt:{issuer:'Bilt',region:'US',currency:'USD',url:'https://www.bilt.com/'},
};
export const MANUAL_BANK_NAMES=Object.keys(MANUAL_BANKS);
export const manualOnly=bank=>Object.hasOwn(MANUAL_BANKS,bank);
/** Region, currency and issuer of a bank a card can belong to: a collector provider or a manual-only issuer. */
export const bankProfile=bank=>(Object.hasOwn(PROVIDERS,bank)?PROVIDERS[bank]:null)||(manualOnly(bank)?MANUAL_BANKS[bank]:null);
