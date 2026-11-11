// The Worker's main module. Workers allows only handlers and Durable Object classes as its exports, so the
// gateway's logic and its helpers live in gateway.js.
import {handle} from './gateway.js';
export {UsageLedger} from './gateway.js';
export default {fetch:(request,env,ctx)=>handle(request,env,{waitUntil:p=>ctx.waitUntil(p)})};
