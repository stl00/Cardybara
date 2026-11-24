// #573: the browser install prompt, tested with a fake window (no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createInstallPrompt} from '../src/installPrompt.js';
import {translations} from '../src/i18n/index.js';
const root=new URL('..',import.meta.url).pathname;
const fakeWindow=()=>{const h={};return {h,addEventListener:(n,f)=>{(h[n]||=new Set()).add(f);},removeEventListener:(n,f)=>h[n]?.delete(f),fire:(n,e={})=>{(h[n]||[]).forEach(f=>f(e));return e;}};};
const fakeEvent=(outcome='accepted')=>{const e={prevented:false,prompts:0,preventDefault(){e.prevented=true;},async prompt(){e.prompts++;},userChoice:Promise.resolve({outcome})};return e;};
const never=()=>false;

test('the event is captured and its default prevented; the button shows',()=>{
 const w=fakeWindow(),p=createInstallPrompt(w,{standalone:never});
 assert.equal(p.canInstall(),false,'no event: text steps stay');
 const e=w.fire('beforeinstallprompt',fakeEvent());
 assert.equal(e.prevented,true);assert.equal(p.canInstall(),true);
});
test('not shown when already standalone',()=>{
 const w=fakeWindow(),p=createInstallPrompt(w,{standalone:()=>true});
 w.fire('beforeinstallprompt',fakeEvent());assert.equal(p.canInstall(),false);
});
test('prompt() is called only after the tap, once, and the button hides after the choice',async()=>{
 const w=fakeWindow(),p=createInstallPrompt(w,{standalone:never}),e=fakeEvent('dismissed');let ticks=0;p.subscribe(()=>ticks++);
 w.fire('beforeinstallprompt',e);assert.equal(e.prompts,0,'never prompts on its own');
 assert.equal(await p.install(),'dismissed');assert.equal(e.prompts,1);
 assert.equal(p.canInstall(),false);assert.equal(await p.install(),null);assert.equal(e.prompts,1);assert.ok(ticks>=2);
});
test('appinstalled hides the button, and a later event does not bring it back',()=>{
 const w=fakeWindow(),p=createInstallPrompt(w,{standalone:never});
 w.fire('beforeinstallprompt',fakeEvent());w.fire('appinstalled');assert.equal(p.canInstall(),false);
 w.fire('beforeinstallprompt',fakeEvent());assert.equal(p.canInstall(),false);
});
test('dispose removes the listeners; install() without an event is a no-op',async()=>{
 const w=fakeWindow(),p=createInstallPrompt(w,{standalone:never});assert.equal(await p.install(),null);
 p.dispose();assert.equal(w.h.beforeinstallprompt.size,0);assert.equal(w.h.appinstalled.size,0);
});
test('wiring: web only, a tap handler calls install, string in three languages, no network',()=>{
 const main=readFileSync(root+'src/main.jsx','utf8'),mod=readFileSync(root+'src/installPrompt.js','utf8'),btn=readFileSync(root+'src/InstallAppButton.jsx','utf8');
 assert.match(main,/runtimeKind\(\)==='web'\)\{coverSafeArea\(\);startInstallPrompt\(\)/);
 assert.match(btn,/onClick=\{\(\)=>c\.install\(\)\}/);
 assert.doesNotMatch(mod+btn,/fetch\(|XMLHttpRequest|sendBeacon/);
 for(const l of ['zh-TW','en-US'])assert.ok(translations[l]['安装应用'],l);
});
