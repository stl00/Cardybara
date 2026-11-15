// The Worker's main module. Workers allows only handlers and Durable Object classes as its exports, so the
// gateway's logic and its helpers live in gateway.js.
import {handle} from './gateway.js';
import {runAlerts} from './alerts.js';
export {UsageLedger} from './gateway.js';
// `scheduled` is the hourly alert check (alerts.js); the Cron Trigger is in wrangler.jsonc.
export default {fetch:(request,env,ctx)=>handle(request,env,{waitUntil:p=>ctx.waitUntil(p)}),scheduled:(event,env,ctx)=>{ctx.waitUntil(runAlerts(env));}};
