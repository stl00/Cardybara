// One platform for the whole page, chosen once at startup. Shared code asks it what the channel can do:
//   notifications  reminder permission and test notification; `worker` says whether a background worker fires them
//   collection     read bank pages (extension and dev only); absent on the web
//   assistant      the extension's assistant and parser transport; absent on the web
//   plaid          open the gateway's Plaid Link page: a tab in the extension, this same window on the web (PWA)
import {runtimeKind} from '../runtime.js';
import extension from './extension.js';
import web,{dev} from './web.js';
export const platform={extension,dev,web}[runtimeKind()];
export default platform;
