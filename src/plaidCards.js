// Plaid-linked credit cards in the wallet (PLAID_PLAN.md). A Plaid card fills a wallet card's billing-cycle fields when it
// is the same card: either the user said so in the Plaid panel (a manual link, kept in PLAID_LINKS_KEY), or, failing
// that, the same issuer (from the institution's name) and the same last four digits. Each field is taken only when
// Plaid's read is newer than what the card already holds, and is marked with the source {method:'plaid'} so the card
// details say where it came from. A Plaid card that matches no wallet card stays in the Plaid panel (PlaidCards.jsx),
// where the user can link it to a wallet card or add it to the wallet as a new manual card (plaidWalletCard); it is never
// turned into a wallet card on its own, since a guessed issuer or product would be a false match.
//
// Field mapping: balance <- current balance, creditLimit <- limit, available <- available, statement <- last statement
// balance, minimum <- minimum payment, due <- next payment due date (YYYY-MM-DD as Plaid gives it, no year guessing).
// A null Plaid field never overwrites anything (Liabilities fields are nullable per institution).

import {PLAID_CHANGE_EVENT} from './plaidClient.js';

// Issuer from the institution name. Only the US banks the wallet knows; anything else matches nothing.
const ISSUERS=[[/american express|\bamex\b/i,'Amex US'],[/\bchase\b/i,'Chase'],[/bank of america/i,'BOA'],[/\bciti(bank)?\b/i,'Citi US']];
export function issuerOf(institution){
 if(typeof institution!=='string')return null;
 return ISSUERS.find(([re])=>re.test(institution))?.[1]||null;
}
const tail=v=>typeof v==='string'?v.replace(/\D/g,'').slice(-4):'';
// A wallet card's last four: its own tail, or the bank's reading when the user's edit has not set one.
const walletTail=c=>tail(c.tail)||tail(c.detected?.tail);
/**
 * Whether a wallet card can take this Plaid card's amounts: the same currency (a wallet card without one counts as USD
 * when it is a US card). Plaid's figures are written as they are, so a USD card must never fill an HKD or CAD card.
 */
export function canTakePlaid(card,p){
 const own=card?.currency||(card?.region==='US'?'USD':null);
 return !!own&&own===(p?.currency||'USD');
}

export const PLAID_LINKS_KEY='cardybara-plaid-links-v1';
/**
 * A key for a Plaid card that survives a re-link: account_id can change (TXN-012), so persistent_account_id where Plaid
 * gives one, else institution + mask + subtype. Null when there is not enough to tell the card apart.
 */
export function plaidCardKey(p){
 if(typeof p?.persistentAccountId==='string'&&p.persistentAccountId)return 'p:'+p.persistentAccountId;
 const inst=p?.institutionId||p?.institution;
 return typeof inst==='string'&&inst&&typeof p?.mask==='string'&&p.mask?['m',inst,p.mask,p.subtype||''].join('|'):null;
}
const cleanLinks=v=>(Array.isArray(v)?v:[]).filter(l=>l&&typeof l.key==='string'&&l.key.length<=300&&typeof l.cardId==='string'&&/^[a-zA-Z0-9-]{1,64}$/.test(l.cardId)).slice(-100);
export function readPlaidLinks(storage){try{return cleanLinks(JSON.parse(storage.getItem(PLAID_LINKS_KEY)));}catch{return [];}}
export function savePlaidLinks(storage,links,win=globalThis.window){
 try{storage.setItem(PLAID_LINKS_KEY,JSON.stringify(cleanLinks(links)));}catch{}
 try{win?.dispatchEvent?.(new Event(PLAID_CHANGE_EVENT));}catch{}
}
/** The links with this Plaid card linked to `cardId` (null removes its link). A wallet card takes one Plaid card at most. */
export function withPlaidLink(links,plaidCard,cardId){
 const key=plaidCardKey(plaidCard);if(!key)throw Error('invalid_plaid_card');
 const rest=cleanLinks(links).filter(l=>l.key!==key&&l.cardId!==cardId);
 return cardId?[...rest,{key,cardId}]:rest;
}
/** Whether this Plaid card's pairing came from the user's manual link. */
export const isManualLink=(links,plaidCard,cardId)=>{const key=plaidCardKey(plaidCard);return !!key&&cleanLinks(links).some(l=>l.key===key&&l.cardId===cardId);};

/**
 * The wallet card each Plaid card fills, as [walletCardId, plaidCard] pairs; one Plaid card per wallet card at most.
 * Manual links come first; the rest match on issuer and last four, and an ambiguous match fills nothing.
 */
export function matchPlaidCards(walletCards,plaidCards,links=[]){
 const pairs=[],used=new Set(),done=new Set(),cards=walletCards||[],plaid=plaidCards||[];
 const linked=new Map(cleanLinks(links).map(l=>[l.key,l.cardId]));
 for(const p of plaid){
  const id=linked.get(plaidCardKey(p));
  if(!id||used.has(id)||!cards.some(c=>c.id===id&&canTakePlaid(c,p)))continue;
  used.add(id);done.add(p);pairs.push([id,p]);
 }
 for(const p of plaid){
  if(done.has(p))continue;
  const bank=issuerOf(p.institution),last=tail(p.mask);
  if(!bank||last.length!==4)continue;
  const hits=cards.filter(c=>c.bank===bank&&walletTail(c)===last&&!used.has(c.id)&&canTakePlaid(c,p));
  // Two wallet cards with the same issuer and last four: ambiguous, fill neither.
  if(hits.length!==1)continue;
  used.add(hits[0].id);pairs.push([hits[0].id,p]);
 }
 return pairs;
}

/** The new manual wallet card for an unmatched Plaid card ({bank,name,tail} for newWalletCard), or null for an unknown issuer. */
export function plaidWalletCard(p){
 const bank=issuerOf(p?.institution),digits=typeof p?.mask==='string'?p.mask.replace(/\D/g,''):'';
 if(!bank||digits.length<4||(p.currency&&p.currency!=='USD'))return null;
 // The mask as Plaid gives it when it is 4 or 5 digits (an Amex US page shows five), so the bank page's own reading of the
 // same card later merges with this row instead of becoming a second card.
 const last=digits.length<=5?digits:digits.slice(-4);
 // Plaid's account name, without long digit runs (newWalletCard refuses anything that could be a card number).
 const name=[p.name,p.officialName].map(n=>typeof n==='string'?n.replace(/(?:\d[ -]?){5,}/g,'').replace(/\s+/g,' ').trim():'').find(n=>n&&n.length<=100&&!/[<>\u0000-\u001f]/.test(n));
 return {bank,tail:last,name:name||bank+' '+last};
}

const FIELDS=[['balance','balance'],['creditLimit','limit'],['available','available'],['statement','statementBalance'],['minimum','minimumPayment'],['due','dueDate']];
const fieldDate=(card,k)=>card.fieldDates?.[k]||(card.updated?card.updated+'T00:00:00Z':'');

/** The wallet with each matched card's fields filled from Plaid where Plaid's read is newer. `pairs` (from matchPlaidCards) skips matching. */
export function applyPlaid(wallet,plaidCards,{links=[],pairs}={}){
 if(!wallet?.cards?.length||!plaidCards?.length)return wallet;
 const byId=new Map(pairs||matchPlaidCards(wallet.cards,plaidCards,links));
 if(!byId.size)return wallet;
 return {...wallet,cards:wallet.cards.map(card=>{
  const p=byId.get(card.id);
  if(!p||!Number.isFinite(p.readAt))return card;
  const readAt=new Date(p.readAt*1000).toISOString();
  const next={...card,fieldDates:{...card.fieldDates},fieldSources:{...card.fieldSources},plaid:{itemId:p.itemId,accountId:p.accountId,aprs:p.aprs||[],statementDate:p.statementDate,isOverdue:p.isOverdue}};
  for(const [k,from] of FIELDS){
   const v=p[from];
   if(v==null)continue;
   const old=fieldDate(card,k);
   if(old&&Date.parse(old)>Date.parse(readAt))continue;
   next[k]=v;next.fieldDates[k]=readAt;next.fieldSources[k]={method:'plaid'};
  }
  return next;
 })};
}

/** The purchase APR of a Plaid card, or null (APRs are a list by type and may be empty). */
export const purchaseApr=card=>(card?.aprs||[]).find(a=>a.type==='purchase_apr')?.percentage??null;
