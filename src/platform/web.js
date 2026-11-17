// The plain web app, and `npm run dev`. A capability the web lacks is absent, not faked: there is no `collection`, no
// `assistant` and no extension notification worker here. Reminders reach a closed wallet through Web Push (#381):
// `notifications.push` (src/webPush.js) is made on first use, so nothing touches the browser at import time.
import {createWebPush} from '../webPush.js';
import {mirrorArea} from '../pushMirror.js';
import {GATEWAY_ORIGIN,gatewayConfigured} from '../../extension-next/model-client.js';
let push=null;
export const web={
 kind:'web',
 notifications:{
  worker:false,
  get push(){return push??=Object.assign(createWebPush({gateway:gatewayConfigured?GATEWAY_ORIGIN:null}),{area:()=>mirrorArea()});}
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
