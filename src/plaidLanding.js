// Coming back from the Plaid Link page (#677). The gateway sends a linked web wallet to `#plaid-added`; the wallet then
// waits for the card read and the auto-add, and lands on what is new. A wallet built before this hash treats it as an
// unknown page and shows the Overview; `#settings`, which older gateways send, stays an ordinary page.
import {matchCardProduct} from './productCatalog.js';

export const PLAID_ADDED_HASH='#plaid-added';
export const LANDING_TIMEOUT_MS=15_000;
export const LANDING_POLL_MS=3_000;
// After this the wallet stops asking on its own; the ordinary reads on focus and reconnect still fill cards in.
export const LANDING_GIVE_UP_MS=120_000;

export const isPlaidAddedHash=hash=>hash===PLAID_ADDED_HASH;

/** A new landing: `baseline` is the Plaid accounts this device already knew, so anything else came from this link. */
export const startLanding=cachedCards=>({phase:'waiting',baseline:(cachedCards||[]).map(c=>c.accountId),cardIds:[],answered:[],stepping:false});

/**
 * Where the new Plaid accounts ended up. `pairs` are matchPlaidCards' answer, `pending` what plaidCardsToAdd would still
 * add. `waiting`: nothing new read yet, or a new card is not in the wallet yet (e.g. sync has not finished its first
 * run). `unplaced`: read, but no wallet card can take them (the Plaid panel lists them). `ready`: the wallet cards.
 */
export function landingResult({baseline=[],plaidCards=[],pairs=[],pending=[]}){
 const known=new Set(baseline),fresh=p=>!!p&&!known.has(p.accountId);
 if(!plaidCards.some(fresh)||pending.some(a=>fresh(a.plaid)))return {status:'waiting'};
 const cardIds=pairs.filter(([,p])=>fresh(p)).map(([id])=>id);
 return cardIds.length?{status:'ready',cardIds}:{status:'unplaced'};
}

/** The card type is still open: the user has not picked one and the catalogue does not recognise the card by itself. */
export const needsCardType=card=>!!card&&!card.productChosen&&matchCardProduct({...card,name:card.pageName??card.name,productId:undefined}).status!=='matched';

/** The new cards that still want an answer about their type, in landing order. */
export const cardsToType=(landing,cards)=>(landing?.phase==='done'?landing.cardIds:[]).filter(id=>!landing.answered.includes(id)&&needsCardType(cards.find(c=>c.id===id)));
