// The plain web app, and `npm run dev`. A capability the web lacks is absent, not faked: there is no `collection`, no
// `assistant` and no extension notification worker here. Reminders reach a closed wallet through Web Push (#381):
// `notifications.push` (src/webPush.js) is made on first use, so nothing touches the browser at import time.
import {createWebPush} from '../webPush.js';
import {mirrorArea} from '../pushMirror.js';
import {speechCapability} from './speech.js';
import {GATEWAY_ORIGIN,gatewayConfigured} from '../../extension-next/model-client.js';
let push=null;
export const web={
 kind:'web',
 // The short commit SHA of a `npm run build:web` build (scripts/web-build.mjs); undefined in any other build.
 get commit(){return typeof __WEB_COMMIT__==='string'&&__WEB_COMMIT__||undefined;},
 // The browser's speech recognition (#655); undefined where the browser has none.
 get speech(){return speechCapability();},
 notifications:{
  worker:false,
  get push(){return push??=Object.assign(createWebPush({gateway:gatewayConfigured?GATEWAY_ORIGIN:null}),{area:()=>mirrorArea()});}
 },
 // Plaid-linked credit cards (PLAID_PLAN.md; owner 2026-11-17: the PWA too, for every signed-in user). The gateway hosts
 // Plaid Link; the wallet goes there in this same window, because a home-screen PWA has no tabs and a pop-up would
 // leave it. The Link page sends the user back to this origin's settings page when it is done (only to an origin the
 // gateway lists), and the panel reads the cards again on load.
 plaid:{
  open:url=>{location.assign(url);}
 }
};
// `npm run dev` serves the same page with a bridge script the dev server injects, so collection exists but needs no start-up here.
// It registers no service worker, so it has no Web Push.
export const dev={
 ...web,
 kind:'dev',
 notifications:{worker:false},
 collection:{start(){}}
};
export default web;
