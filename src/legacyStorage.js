// Compatibility only: preserve older local wallets when the product namespace changes.
export function migrateLegacyWalletStorage(storage){
 const keys=['favorites','auto-sync','import','bank-live-v1'];
 try{for(const suffix of keys){const current='cardybara-'+suffix,old='atlas-'+suffix;if(storage.getItem(current)===null){const value=storage.getItem(old);if(value!==null)storage.setItem(current,value);}}}catch{/* Keep the UI usable when browser storage is unavailable. */}
}
