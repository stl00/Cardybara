// #581: the pure parts of the Overview Plaid offer (src/PlaidOfferCard.jsx), kept apart so tests need no browser.
export const PLAID_OFFER_KEY='cardybara-plaid-offer-dismissed-v1';
// A sign-in the user abandoned must not start Plaid when they sign in much later from the header.
export const PENDING_MS=5*60*1000;
const store=()=>{try{return typeof localStorage==='undefined'?null:localStorage}catch{return null}};
export const offerDismissed=(storage=store())=>{try{return storage?.getItem(PLAID_OFFER_KEY)==='1'}catch{return false}};
export const dismissOffer=(storage=store())=>{try{storage?.setItem(PLAID_OFFER_KEY,'1')}catch{/* it may show again next time */}};
/** The card's whole condition, kept apart so a test can drive it. */
export const showPlaidOffer=({collects,hasPlaid,gatewayConfigured,linked,dismissed,unavailable})=>!collects&&!!hasPlaid&&!!gatewayConfigured&&!linked&&!dismissed&&!unavailable;

