// Read the Plaid card list without the Plaid panel (stl00/Cardybara#580). The panel (PlaidCards.jsx) is the only other
// reader and lives on Settings / Connections, while the cache it fills is per device and not part of the synced wallet.
// So on a new device (an iPhone Home Screen app has its own storage) a Plaid-added card arrived by sync with no numbers
// until the user happened to open that panel. This reads the list when the wallet opens, when it comes back to the
// front or online, and right after sign-in; createPlaidClient().cards() writes the cache and fires PLAID_CHANGE_EVENT,
// which main.jsx already listens to. Signed out, it makes no request. At most one read per `minMs`, one at a time.
import {ACCOUNT_CHANGE_EVENT} from './accountClient.js';

export const PLAID_FETCH_MIN_MS=60_000;

/** Starts the reads; answers a stop function. `signedIn()` is checked before every read. Never throws. */
export function startPlaidAutoFetch({client,signedIn,win=globalThis.window,doc=globalThis.document,now=()=>Date.now(),minMs=PLAID_FETCH_MIN_MS}){
 if(!client||!win?.addEventListener)return ()=>{};
 let last=-Infinity,busy=false,stopped=false,pending=false;
 const run=force=>{
  if(stopped||doc?.visibilityState==='hidden')return;
  // A sign-in while a read is out (another account, say) is not dropped: it runs as soon as that read ends.
  if(busy){if(force)pending=true;return;}
  let ok=false;try{ok=!!signedIn();}catch{}
  if(!ok||(!force&&now()-last<minMs))return;
  busy=true;last=now();
  Promise.resolve().then(()=>client.cards())
   // A read that never got through does not count against the minute, so the `online` event retries at once.
   .then(r=>{if(r?.ok===false&&r.code==='offline')last=-Infinity;},()=>{last=-Infinity;})
   .finally(()=>{busy=false;if(pending){pending=false;run(true);}});
 };
 const front=()=>run(false),account=()=>run(true);
 win.addEventListener('focus',front);win.addEventListener('online',front);win.addEventListener(ACCOUNT_CHANGE_EVENT,account);
 doc?.addEventListener?.('visibilitychange',front);
 run(true);
 return ()=>{
  stopped=true;
  win.removeEventListener('focus',front);win.removeEventListener('online',front);win.removeEventListener(ACCOUNT_CHANGE_EVENT,account);
  doc?.removeEventListener?.('visibilitychange',front);
 };
}
