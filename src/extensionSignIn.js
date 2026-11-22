// Passkey sign-in for the extension (stl00/Cardybara#472, #455). A passkey made on the PWA origin only works there (its rpId
// is the PWA hostname), so the extension opens the PWA in the browser identity web-auth flow (launchWebAuthFlow); the PWA signs in and redirects to
// https://<extension-id>.chromiumapp.org/ with the session in the URL fragment. Pure helpers, no browser API: the platform
// adapter (src/platform/extension.js) calls the browser API, the PWA route (src/ExtensionSignInRoute.jsx) calls location.
// The redirect target is rebuilt from a validated extension id, never taken from the URL, so there is no open redirect.
// The token only ever travels in the fragment: never a query string, never a log line.

/** The PWA's origin (Pages project `cardybara-app`, custom domain cardybara.dev). Must equal the gateway's PASSKEY_ORIGIN. */
export const APP_ORIGIN='https://cardybara.dev';
export const ROUTE_PREFIX='#extension-signin/';
// A Chrome extension id: 32 letters a-p.
const EXTENSION_ID=/^[a-p]{32}$/;

export const validExtensionId=id=>typeof id==='string'&&EXTENSION_ID.test(id);
/** `https://<id>.chromiumapp.org/` for a valid extension id, else null. */
export const redirectTarget=id=>validExtensionId(id)?`https://${id}.chromiumapp.org/`:null;
/** The page the extension opens: the PWA route naming the extension. */
export const signInUrl=(id,origin=APP_ORIGIN)=>validExtensionId(id)?origin+'/'+ROUTE_PREFIX+id:null;
/** The extension id a location hash asks for, or null when it is not the sign-in route or the id is not valid. */
export const routeExtensionId=hash=>{
 if(typeof hash!=='string'||!hash.startsWith(ROUTE_PREFIX))return null;
 const id=hash.slice(ROUTE_PREFIX.length);
 return validExtensionId(id)?id:null;
};
/** Where the PWA sends the browser back to with a session: the exact redirect target plus the session in the fragment. Null for a bad id or session. */
export function redirectWithSession(id,session){
 const base=redirectTarget(id);
 if(!base||typeof session?.token!=='string'||!session.token)return null;
 const p=new URLSearchParams({token:session.token});
 if(Number.isFinite(session.expiresAt))p.set('expiresAt',String(session.expiresAt));
 if(typeof session.email==='string')p.set('email',session.email);
 return base+'#'+p.toString();
}
/** The extension's side: the session in the URL launchWebAuthFlow returned, or null unless the URL is exactly this extension's redirect target. */
export function sessionFromRedirect(resultUrl,id){
 const base=redirectTarget(id);
 if(!base||typeof resultUrl!=='string')return null;
 let u;try{u=new URL(resultUrl);}catch{return null;}
 if(u.origin+u.pathname!==base||u.search||!u.hash)return null;
 const p=new URLSearchParams(u.hash.slice(1));
 const token=p.get('token');
 if(!token)return null;
 const exp=p.has('expiresAt')?Number(p.get('expiresAt')):null;
 return {token,expiresAt:Number.isFinite(exp)?exp:null,email:p.get('email')||''};
}
