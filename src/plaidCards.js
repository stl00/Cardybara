// Plaid-linked credit cards in the wallet (PLAID_PLAN.md). A Plaid card fills a wallet card's billing-cycle fields when it
// is the same card: the same issuer (from the institution's name) and the same last four digits. Each field is taken
// only when Plaid's read is newer than what the card already holds, and is marked with the source {method:'plaid'} so the card
// details say where it came from. Plaid cards that match no wallet card stay in the Plaid panel (PlaidCards.jsx); they
// are never turned into wallet cards on their own, since a guessed issuer or product would be a false match.
//
// Field mapping: balance <- current balance, creditLimit <- limit, available <- available, statement <- last statement
// balance, minimum <- minimum payment, due <- next payment due date (YYYY-MM-DD as Plaid gives it, no year guessing).
// A null Plaid field never overwrites anything (Liabilities fields are nullable per institution).

// Issuer from the institution name. Only the US banks the wallet knows; anything else matches nothing.
const ISSUERS=[[/american express|\bamex\b/i,'Amex US'],[/\bchase\b/i,'Chase'],[/bank of america/i,'BOA'],[/\bciti(bank)?\b/i,'Citi US']];
export function issuerOf(institution){
 if(typeof institution!=='string')return null;
 return ISSUERS.find(([re])=>re.test(institution))?.[1]||null;
}
const tail=v=>typeof v==='string'?v.replace(/\D/g,'').slice(-4):'';

/** The wallet card each Plaid card fills, as [walletCardId, plaidCard] pairs; one Plaid card per wallet card at most. */
export function matchPlaidCards(walletCards,plaidCards){
 const pairs=[],used=new Set();
 for(const p of plaidCards||[]){
  const bank=issuerOf(p.institution),last=tail(p.mask);
  if(!bank||last.length!==4)continue;
  const hits=(walletCards||[]).filter(c=>c.bank===bank&&tail(c.tail)===last&&!used.has(c.id));
  // Two wallet cards with the same issuer and last four: ambiguous, fill neither.
  if(hits.length!==1)continue;
  used.add(hits[0].id);pairs.push([hits[0].id,p]);
 }
 return pairs;
}

const FIELDS=[['balance','balance'],['creditLimit','limit'],['available','available'],['statement','statementBalance'],['minimum','minimumPayment'],['due','dueDate']];
const fieldDate=(card,k)=>card.fieldDates?.[k]||(card.updated?card.updated+'T00:00:00Z':'');

/** The wallet with each matched card's fields filled from Plaid where Plaid's read is newer. */
export function applyPlaid(wallet,plaidCards){
 if(!wallet?.cards?.length||!plaidCards?.length)return wallet;
 const byId=new Map(matchPlaidCards(wallet.cards,plaidCards));
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
