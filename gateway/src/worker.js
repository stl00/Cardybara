// The Worker's main module. Workers allows only handlers and Durable Object classes as its exports, so the
// gateway's logic and its helpers live in gateway.js.
import {handle} from './gateway.js';
import {runAlerts} from './alerts.js';
import {sendDuePushes,CRON as PUSH_CRON} from './push.js';
const ALERT_CRON='7 * * * *';
export {UsageLedger} from './gateway.js';
// `scheduled` runs the hourly alert check (alerts.js) and sends due Web Push reminders (push.js); the Cron Triggers are in wrangler.jsonc.
export default {fetch:(request,env,ctx)=>handle(request,env,{waitUntil:p=>ctx.waitUntil(p)}),scheduled:(event,env,ctx)=>{
 // Two Cron Triggers (wrangler.jsonc): the hourly alert check and the push sender every 15 minutes. Without a cron string (tests), both.
 const cron=event?.cron;
 if(!cron||cron===ALERT_CRON)ctx.waitUntil(runAlerts(env));
 if(!cron||cron===PUSH_CRON)ctx.waitUntil(sendDuePushes(env));
}};
