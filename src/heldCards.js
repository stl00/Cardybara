import {withoutCardRows} from './walletRegistry.js';
import {REWARD_ROW_BANKS} from './rewardAccounts.js';
// A hidden card stays in the wallet and the bank still reads it, but everything that asks "which cards does the
// user hold" acts as if it were not there: totals, alerts, rewards, credits, reminders, card choice and the assistant.
// The flag is the user's, stored with their other per-card edits (cardEdits.js), so it outlives refreshes and backups.
export const isHiddenCard=card=>card?.hidden===true;
/** The one selector for held cards. Every consumer that counts a card goes through this or heldWallet. */
export const heldCards=cards=>Array.isArray(cards)?cards.filter(c=>!isHiddenCard(c)):[];
export const hiddenCards=cards=>Array.isArray(cards)?cards.filter(isHiddenCard):[];
/**
 * The wallet as if hidden cards were not held: their cards and the snapshot rows that name them are left out.
 * A legacy reward pool row whose bank (named, or known from its programme id) goes too when every card of that bank is hidden, because no held card
 * reaches it any more; a pool still reached by a held card stays, counted once as before.
 */
export function heldWallet(data){
 if(!data||!Array.isArray(data.cards))return data;
 const hidden=new Set(hiddenCards(data.cards).map(c=>c.id));
 if(!hidden.size)return data;
 const held=withoutCardRows(data,hidden),heldBanks=new Set(held.cards.map(c=>c.bank)),hiddenBanks=new Set(hiddenCards(data.cards).map(c=>c.bank));
 const bankOf=r=>r?.bank||REWARD_ROW_BANKS[r?.id];
 const rewards=Array.isArray(data.rewards)?data.rewards.filter(r=>!(hidden.has(r?.card)||(bankOf(r)&&hiddenBanks.has(bankOf(r))&&!heldBanks.has(bankOf(r))))):data.rewards;
 return {...held,...(rewards?{rewards}:{})};
}
