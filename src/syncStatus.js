// What the account sheet says about sync (stl00/Cardybara#580). Pure: the sheet turns the kind into words in the
// user's language. A sync that is running or failing keeps showing when the last good one finished, so "Syncing…" is
// never the only thing said for a long time.
/** `on`: sync is on for this device; `status`: the latest engine status or null; `syncedAt`: ms of the last finished sync or null. */
export function syncLine({on,status,syncedAt}){
 const at=Number.isFinite(syncedAt)?{at:syncedAt}:{};
 if(!on)return {kind:'off'};
 if(status==='synced')return {kind:'synced',...at};
 if(status==='offline'||status==='error'||status==='signed_out'||status==='newer')return {kind:status,...at};
 return {kind:Object.keys(at).length?'syncing_since':'syncing',...at};
}
