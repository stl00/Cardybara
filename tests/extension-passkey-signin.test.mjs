// #472: extension passkey sign-in through the PWA. Redirect validation, the platform adapter and the client's extension path
// (synthetic ids and tokens only). The web-origin side with a virtual authenticator is in tests/extension-passkey-web.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {APP_ORIGIN,redirectTarget,redirectWithSession,routeExtensionId,sessionFromRedirect,signInUrl,validExtensionId} from '../src/extensionSignIn.js';
import {createAccountClient} from '../src/accountClient.js';

const ID='abcdefghijklmnopabcdefghijklmnop';
const SESSION={token:'synthetic-token-0001',expiresAt:1893456000,email:'synthetic.user@example.test'};
const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};

test('only a 32-letter a-p extension id gives a redirect target, and it is exactly https://<id>.chromiumapp.org/',()=>{
 assert.equal(redirectTarget(ID),`https://${ID}.chromiumapp.org/`);
 for(const bad of [undefined,null,'',ID.slice(1),ID+'a',ID.toUpperCase(),ID.replace('a','q'),'evil.example/'+ID,ID+'.evil.example',`${ID}@evil.example`,'https://evil.example/','//evil.example',ID+'/..','a'.repeat(32)+'\n'])
  assert.equal(redirectTarget(bad),null,String(bad));
 assert.equal(redirectWithSession('evil.example',SESSION),null);
});

test('the redirect carries the session only in the fragment, never the query',()=>{
 const url=redirectWithSession(ID,SESSION);
 const u=new URL(url);
 assert.equal(u.origin+u.pathname,`https://${ID}.chromiumapp.org/`);
 assert.equal(u.search,'');
 assert.ok(u.hash.startsWith('#token='));
 assert.equal(url.split('#')[0].includes(SESSION.token),false);
 assert.deepEqual(sessionFromRedirect(url,ID),SESSION);
 assert.equal(redirectWithSession(ID,{token:''}),null);
 assert.equal(redirectWithSession(ID,null),null);
});

test('the extension accepts only its own redirect target, with a fragment and no query',()=>{
 const good=redirectWithSession(ID,SESSION);
 assert.ok(sessionFromRedirect(good,ID));
 const other='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
 assert.equal(sessionFromRedirect(good,other),null,'another extension id');
 assert.equal(sessionFromRedirect(good.replace('https://','http://'),ID),null);
 assert.equal(sessionFromRedirect(`https://${ID}.chromiumapp.org/?token=${SESSION.token}`,ID),null,'a token in the query');
 assert.equal(sessionFromRedirect(`https://${ID}.chromiumapp.org/?x=1#token=a`,ID),null);
 assert.equal(sessionFromRedirect(`https://${ID}.chromiumapp.org/path#token=a`,ID),null);
 assert.equal(sessionFromRedirect(`https://evil.example/#token=a`,ID),null);
 assert.equal(sessionFromRedirect(`https://${ID}.chromiumapp.org.evil.example/#token=a`,ID),null);
 assert.equal(sessionFromRedirect(`https://${ID}.chromiumapp.org/`,ID),null,'no fragment');
 assert.equal(sessionFromRedirect(`https://${ID}.chromiumapp.org/#email=a`,ID),null,'no token');
 assert.equal(sessionFromRedirect(undefined,ID),null);
 assert.equal(sessionFromRedirect('not a url',ID),null);
});

test('the route and the sign-in url name only a valid extension id',()=>{
 assert.equal(signInUrl(ID),`${APP_ORIGIN}/#extension-signin/${ID}`);
 assert.equal(signInUrl('bad'),null);
 assert.equal(routeExtensionId('#extension-signin/'+ID),ID);
 for(const bad of ['','#settings','#extension-signin/','#extension-signin/bad','#extension-signin/'+ID+'/x','#extension-signin/'+ID+'?next=https://evil.example','extension-signin/'+ID,undefined])
  assert.equal(routeExtensionId(bad),null,String(bad));
});

const require_=createRequire(new URL('../package.json',import.meta.url));
async function adapter(chrome){
 const {outputFiles:[out]}=await build({stdin:{contents:"export {default as extension} from './src/platform/extension.js';",resolveDir:new URL('..',import.meta.url).pathname,loader:'js'},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
 const module={exports:{}};
 const before=Object.getOwnPropertyDescriptor(globalThis,'chrome');
 Object.defineProperty(globalThis,'chrome',{value:chrome,configurable:true,writable:true});
 try{new Function('module','exports','require',out.text)(module,module.exports,require_);return module.exports.extension;}
 finally{before?Object.defineProperty(globalThis,'chrome',before):delete globalThis.chrome;}
}

test('platform adapter: passkeySignIn opens the PWA route with launchWebAuthFlow and answers the session',async()=>{
 const flows=[];
 const chrome={runtime:{id:ID},identity:{launchWebAuthFlow:async o=>{flows.push(o);return redirectWithSession(ID,SESSION);}}};
 const ext=await adapter(chrome);
 Object.defineProperty(globalThis,'chrome',{value:chrome,configurable:true,writable:true});
 try{
  assert.deepEqual(await ext.account.passkeySignIn(),SESSION);
  assert.deepEqual(flows,[{url:`${APP_ORIGIN}/#extension-signin/${ID}`,interactive:true}]);
  // A redirect that is not this extension's target gives no session.
  chrome.identity.launchWebAuthFlow=async()=>`https://evil.example/#token=${SESSION.token}`;
  assert.equal(await ext.account.passkeySignIn(),null);
  // A closed window rejects; the client turns that into "cancelled".
  chrome.identity.launchWebAuthFlow=async()=>{throw new Error('The user did not approve access.');};
  await assert.rejects(ext.account.passkeySignIn());
 }finally{delete globalThis.chrome;}
});

test('chrome.identity appears in the adapter only, and the manifest asks for the identity permission',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../extension-next/manifest.json',import.meta.url),'utf8'));
 assert.ok(manifest.permissions.includes('identity'));
 assert.ok(!manifest.optional_permissions.includes('identity'));
 assert.match(readFileSync(new URL('../src/platform/extension.js',import.meta.url),'utf8'),/chrome\.identity\.launchWebAuthFlow/);
});

test('client: with webSignIn the session is stored, mirrored and never given back to the screen',async()=>{
 const storage=memory(),mirrored=[],calls=[];
 const mk=webSignIn=>createAccountClient({gateway:'https://gateway.test',storage,win:new EventTarget(),mirror:s=>mirrored.push(s),webSignIn,credentials:undefined,
  fetchFn:async(u)=>{calls.push(u);return new Response(JSON.stringify({enabled:true}),{status:200,headers:{'Content-Type':'application/json'}});}});
 const c=mk(async()=>SESSION);
 assert.equal(await c.passkeysAvailable(),true,'the extension needs the gateway status, not a local authenticator');
 const r=await c.signInWithPasskey();
 assert.deepEqual(r,{ok:true,email:SESSION.email,expiresAt:SESSION.expiresAt});
 assert.equal(JSON.stringify(r).includes(SESSION.token),false);
 assert.equal(JSON.parse(storage.getItem('cardybara-account-session-v1')).token,SESSION.token);
 assert.equal(mirrored[0].token,SESSION.token);
 // Closed window, no session, or a throw: cancelled, nothing stored.
 for(const f of [async()=>null,async()=>{throw new Error('closed');},async()=>({token:''})]){
  storage.removeItem('cardybara-account-session-v1');
  assert.deepEqual(await mk(f).signInWithPasskey(),{ok:false,code:'cancelled'});
  assert.equal(storage.getItem('cardybara-account-session-v1'),null);
 }
});

test('client: passkeyHandoff signs in and answers the redirect for a valid id only',async()=>{
 const storage=memory();
 const c=createAccountClient({gateway:'https://gateway.test',storage,win:new EventTarget(),credentials:undefined,fetchFn:async()=>new Response('{}',{status:404})});
 assert.deepEqual(await c.passkeyHandoff('evil.example'),{ok:false,code:'bad_request'});
 // A failed sign-in (no passkey support here) answers the failure, not a redirect.
 const r=await c.passkeyHandoff(ID);
 assert.equal(r.ok,false);
 assert.equal(r.url,undefined);
});
