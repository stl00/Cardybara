import {ACTIVE_BANKS,PROVIDERS} from '../extension-next/providers.js';
// An archived bank shows only for a wallet already holding its cards, and never joins a refresh-all.
export const visibleConnections=data=>data.connections.filter(c=>!PROVIDERS[c.bank]?.archived||data.cards.some(card=>card.bank===c.bank));
export const defaultRefreshBanks=cards=>[...new Set(cards.map(c=>c.bank))].filter(b=>ACTIVE_BANKS.includes(b));
export const WALLET_CARDS_KEY='cardybara-wallet-cards-v1';
export function newWalletCard({bank,name,tail},id=crypto.randomUUID()){
 const p=PROVIDERS[bank];const label=String(name||'').trim();
 if(!p||!label||label.length>100||/[<>\u0000-\u001f]/.test(label)||/(?:\d[ -]?){9,}/.test(label)||typeof tail!=='string'||!/^\d{4,5}$/.test(tail)||typeof id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(id))throw Error('invalid_card');
 return {id,bank,name:label,tail,region:p.region,currency:p.currency,identitySource:'manual'};
}
export function mergeWalletCards(base,extra=[]){
 if(!Array.isArray(extra)||extra.length>40)throw Error('invalid_registry');
 const cards=[...base.cards];
 for(const c of extra){
  const clean=newWalletCard(c,c.id);
  if(cards.some(old=>old.id===clean.id||old.bank===clean.bank&&old.tail===clean.tail))continue;
  if(cards.length>=40)throw Error('card_limit');
  cards.push({...clean,identitySource:c.identitySource==='bank-page'?'bank-page':'manual'});
 }
 return {...base,cards};
}
