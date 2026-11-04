import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {subscribeSystemDark,systemPrefersDark} from '../src/colorScheme.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const COLOUR=/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/g;
// Only these may stay literal. Everything else must use a token or a --cb-* variable, or it stays light in dark mode.
const SHADOWS=new Set(['#00000006','#00000005','#0000000d','#00000020','#493b3109']);
const TOKEN_FALLBACKS=new Set(['rgba(5,5,5,.06)','rgba(0,0,0,.45)']);
// Logos are drawn for light backgrounds, so their plates are white in both themes.
const LOGO_PLATES=/\.bank-mark\{[^}]*\}|\.item-logo\.is-logo\{[^}]*\}/g;
const THEME_VARIABLES=/:root\{--cb-[^}]*\}|@media\(prefers-color-scheme:dark\)\{:root\{[^}]*\}html,body\{[^}]*\}\}/g;

const strayColours=css=>(css.replace(THEME_VARIABLES,'').replace(LOGO_PLATES,'').match(COLOUR)||[]).filter(colour=>!SHADOWS.has(colour)&&!TOKEN_FALLBACKS.has(colour));

function fakeMedia(matches){
 const listeners=new Set(),query={matches,addEventListener:(_,f)=>listeners.add(f),removeEventListener:(_,f)=>listeners.delete(f)};
 return {query,listeners,matchMedia:q=>{assert.equal(q,'(prefers-color-scheme: dark)');return query}};
}

test('wallet stylesheets use theme colours rather than literal ones',async()=>{
 for(const path of ['src/style.css','src/capybara-pet.css'])assert.deepEqual(strayColours(await read(path)),[],path);
});

test('every --cb- colour has a dark value and every use is defined',async()=>{
 const css=await read('src/style.css'),pet=await read('src/capybara-pet.css');
 const names=block=>new Set([...block.matchAll(/(--cb-[a-z-]+):/g)].map(m=>m[1]));
 const light=names(css.match(/:root\{--cb-[^}]*\}/)[0]),dark=names(css.match(/@media\(prefers-color-scheme:dark\)\{:root\{[^}]*\}/)[0]);
 assert.deepEqual([...dark].sort(),[...light].sort());
 const chat=await read('src/ChatAdvisor.jsx');
 for(const source of [css,pet,chat])for(const m of source.matchAll(/var\((--cb-[a-z-]+)\)/g))assert.ok(light.has(m[1]),m[1]);
});

test('inline surfaces in the wallet do not hard-code light colours',async()=>{
 const light=/(background|borderTop|border|color):\s*'[^']*(#[fF]{3}\b|#[fF]{6}\b|#f0f0f0|#fafafa|#f3f4f6)/;
 for(const path of ['src/ChatAdvisor.jsx','src/CostTrackingUI.jsx','src/main.jsx','src/PersonalWallet.jsx','src/PaymentAssistant.jsx','src/RewardsView.jsx','src/BankConnections.jsx','src/WalletOnboarding.jsx'])assert.doesNotMatch(await read(path),light,path);
});

test('the theme comes from the system and reaches confirmation dialogs',async()=>{
 const i18n=await read('src/i18n.jsx'),main=await read('src/main.jsx'),html=await read('index.html');
 assert.match(i18n,/theme\.darkAlgorithm/);
 assert.match(i18n,/useSyncExternalStore\(subscribeSystemDark, systemPrefersDark\)/);
 assert.match(html,/<meta name="color-scheme" content="light dark">/);
 // Modal.confirm renders outside ConfigProvider and would stay light.
 assert.doesNotMatch(main,/\bModal\.(confirm|info|success|warning|error)\(/);
});

test('system preference is read live and listeners are removed',()=>{
 const saved=globalThis.window;
 try{
  delete globalThis.window;
  assert.equal(systemPrefersDark(),false,'no window means light');
  assert.doesNotThrow(()=>subscribeSystemDark(()=>{})());
  const media=fakeMedia(false);globalThis.window={matchMedia:media.matchMedia};
  assert.equal(systemPrefersDark(),false);
  media.query.matches=true;
  assert.equal(systemPrefersDark(),true);
  const listener=()=>{},stop=subscribeSystemDark(listener);
  assert.equal(media.listeners.size,1);
  stop();
  assert.equal(media.listeners.size,0);
 }finally{if(saved===undefined)delete globalThis.window;else globalThis.window=saved}
});
