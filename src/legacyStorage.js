import {rematchCards,rematchRemovals} from './manualBanks.js';
import {WALLET_CARDS_KEY,WALLET_REMOVED_KEY} from './walletRegistry.js';

// This device's own stores carry no format version, so the version 3 move to the Barclays bank (#694,
// walletDocument.js) is applied to them here. Running it again changes nothing.
function rematchStores(storage){
 const rewrite=(key,change)=>{try{
  const old=JSON.parse(storage.getItem(key));if(!old)return;
  const next=change(old);if(JSON.stringify(next)!==JSON.stringify(old))storage.setItem(key,JSON.stringify(next));
 }catch{/* A damaged or unwritable store is left as it is. */}};
 rewrite(WALLET_CARDS_KEY,rematchCards);
 rewrite(WALLET_REMOVED_KEY,rematchRemovals);
 rewrite('cardybara-import',snapshot=>Array.isArray(snapshot.cards)?{...snapshot,cards:rematchCards(snapshot.cards)}:snapshot);
}
// Compatibility only: preserve older local wallets when the product namespace changes.
export function migrateLegacyWalletStorage(storage){
 const keys=['favorites','auto-sync','import','bank-live-v1'];
 try{for(const suffix of keys){const current='cardybara-'+suffix,old='atlas-'+suffix;if(storage.getItem(current)===null){const value=storage.getItem(old);if(value!==null)storage.setItem(current,value);}}}catch{/* Keep the UI usable when browser storage is unavailable. */}
 rematchStores(storage);
}
