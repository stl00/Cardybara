import {ACTIVE_BANKS,PROVIDERS} from '../extension-next/providers.js';
import {cleanPageName} from './cardName.js';
// An archived bank shows only for a wallet already holding its cards, and never joins a refresh-all.
export const visibleConnections=data=>data.connections.filter(c=>!PROVIDERS[c.bank]?.archived||data.cards.some(card=>card.bank===c.bank));
export const selectableBanks=(banks,cards)=>banks.filter(b=>!PROVIDERS[b]?.archived||cards.some(c=>c.bank===b));
export const defaultRefreshBanks=cards=>[...new Set(cards.map(c=>c.bank))].filter(b=>ACTIVE_BANKS.includes(b));
export const WALLET_CARDS_KEY='cardybara-wallet-cards-v1';
export function newWalletCard({bank,name,tail,currency},id=crypto.randomUUID()){
 const p=PROVIDERS[bank];const label=String(name||'').trim();
 if(!p||!label||label.length>100||/[<>\u0000-\u001f]/.test(label)||/(?:\d[ -]?){9,}/.test(label)||typeof tail!=='string'||!/^\d{4,5}$/.test(tail)||typeof id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(id))throw Error('invalid_card');
 return {id,bank,name:label,tail,region:p.region,currency:p.cardCurrencies?.includes(currency)?currency:p.currency,identitySource:'manual'};
}
export function mergeWalletCards(base,extra=[]){
 if(!Array.isArray(extra)||extra.length>40)throw Error('invalid_registry');
 const cards=base.cards.map(c=>c.identitySource==='bank-page'&&typeof c.name==='string'?{...c,name:cleanPageName(c.name)||c.name}:c);
 for(const c of extra){
  // A bank page's name keeps no last digits, currency side or trademark signs once it is stored.
  const clean=newWalletCard(c.identitySource==='bank-page'?{...c,name:cleanPageName(c.name)||c.name}:c,c.id);
  // The bank page is the authority on a card it listed, so a stored currency follows it rather than failing every reading.
  const held=cards.findIndex(old=>old.id===clean.id&&old.identitySource==='bank-page'&&c.identitySource==='bank-page'&&c.currency&&old.currency!==clean.currency);
  if(held>=0){cards[held]={...cards[held],currency:clean.currency};continue;}
  // The registry is where a manual card is edited, so its row wins over an older copy of the same card (a snapshot or import).
  const own=c.identitySource==='bank-page'?-1:cards.findIndex(old=>old.id===clean.id&&old.identitySource!=='bank-page');
  if(own>=0){const {name,tail,bank,region,currency}=clean;cards[own]={...cards[own],name,tail,bank,region,currency};continue;}
  if(cards.some(old=>old.id===clean.id||old.bank===clean.bank&&old.tail===clean.tail))continue;
  if(cards.length>=40)throw Error('card_limit');
  cards.push({...clean,identitySource:c.identitySource==='bank-page'?'bank-page':'manual'});
 }
 // A saved seed can be older than the product, and an upgrade can drop a held bank: every active or held bank needs its row.
 const connections=Array.isArray(base.connections)?[...base.connections,...[...new Set([...ACTIVE_BANKS,...cards.map(c=>c.bank)])].filter(b=>!base.connections.some(c=>c.bank===b)).map(bank=>({bank,note:''}))]:base.connections;
 return {...base,cards,connections};
}
/**
 * Edits a manual card in the registry, where the collector, discovery and duplicate checks read it. Bank-page
 * cards are never edited here: their corrections are an overlay (cardEdits.js) so the bank stays the source.
 * `others` are the wallet's other cards as shown; a bank and tail that another card already has is refused.
 */
export function editManualCard(registry,card,patch,others=[]){
 const i=registry.findIndex(c=>c.id===card.id&&c.identitySource!=='bank-page');
 const old=i>=0?registry[i]:card;if(old.identitySource==='bank-page')throw Error('invalid_card');
 const next=newWalletCard({bank:patch.bank??old.bank,name:patch.name??old.name,tail:patch.tail??old.tail,currency:old.currency},old.id);
 if([...registry,...others].some(c=>c.id!==card.id&&c.bank===next.bank&&(c.tail===next.tail||c.detected?.tail===next.tail)))throw Error('duplicate_card');
 return i>=0?registry.map((c,k)=>k===i?{...c,...next}:c):[...registry,next];
}
// A removal outlives the seed, an imported snapshot and a discovery record that has not been cleared yet.
export const WALLET_REMOVED_KEY='cardybara-wallet-removed-v1';
const removedRow=(card,removed)=>removed.some(r=>r.id===card.id||(card.identitySource==='bank-page'&&r.bank===card.bank&&r.tail===card.tail));
// Snapshot rows that name a card go with it. They are hidden, not deleted: the stored snapshot keeps them, so adding the
// card back by import brings them back. Rows without a card id are the legacy 'gold' card's, as the pages show them.
// Reward accounts are pools, not cards, and stay; user-entered ledgers live outside the snapshot and are never touched.
const CARD_ROWS={transactions:'gold',benefits:'gold',offers:null,spendingGoals:null,rewardObservations:null,benefitProgress:null};
export function withoutRemoved(base,removed=[]){
 const cards=base.cards.filter(c=>!removedRow(c,removed));
 const gone=new Set(base.cards.filter(c=>removedRow(c,removed)).map(c=>c.id));
 if(!gone.size)return {...base,cards};
 const rows=Object.fromEntries(Object.entries(CARD_ROWS).filter(([k])=>Array.isArray(base[k])).map(([k,legacy])=>[k,base[k].filter(r=>!gone.has(r?.card??legacy))]));
 return {...base,...rows,cards};
}
export const withoutRemovedCards=(cards,removed=[])=>cards.filter(c=>!removedRow(c,removed));
export function removeWalletCard(registry,removed,card){
 // A registry row with this tail is this card, or was hidden by it when the wallet merged duplicates.
 return {registry:registry.filter(c=>c.id!==card.id&&!(c.bank===card.bank&&c.tail===card.tail)),removed:[...removed.filter(r=>r.id!==card.id),{id:card.id,bank:card.bank,tail:card.tail}]};
}
// Importing a card is the user asking for it back. A manual add needs no lift: its new id is not hidden, and lifting would bring back the removed row in its place.
export const liftRemoval=(removed,cards)=>removed.filter(r=>!cards.some(c=>c.id===r.id||(c.bank===r.bank&&c.tail===r.tail)));
// Removals the collector has not applied, for example because the extension was away when the card was removed.
export const pendingRemovals=(state,removed)=>state?.run?.status==='running'?[]:removed.filter(r=>state?.records?.[r.bank]?.[r.id]||(state?.discoveredCards||[]).some(c=>c.bank===r.bank&&c.tail===r.tail));
export function withoutLiveCard(live,card){
 const entry=live[card.bank];if(!entry?.patches?.some(p=>p.id===card.id))return live;
 return {...live,[card.bank]:{...entry,patches:entry.patches.filter(p=>p.id!==card.id)}};
}
