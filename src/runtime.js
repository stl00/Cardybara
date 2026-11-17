// Where the wallet is running. `src/platform/index.js` reads this once at startup; nothing else should branch on it.
// 'extension' is a page of the installed Chrome extension. 'dev' is `npm run dev`, whose page bridge talks to the local
// collector. Everything else is the plain web app: manual entry only.
export const inExtension=()=>typeof location!=='undefined'&&location.protocol==='chrome-extension:'&&!!globalThis.chrome?.runtime?.id;
export const inDevServer=()=>!!import.meta.env?.DEV;
export const runtimeKind=()=>inExtension()?'extension':inDevServer()?'dev':'web';
