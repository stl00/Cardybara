// #403: the web wallet's first-launch guide. The decisions are pure (src/webFirstLaunch.js); the screens render through
// react-dom/server; the wiring in main.jsx is checked from source. The real screens at 375 px are captured in the PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {GUIDE_KEY,GUIDE_STEPS,canReopenGuide,detectPlatform,installKind,isStandalone,markSeen,readSeen,shouldShowGuide} from '../src/webFirstLaunch.js';
import {translations} from '../src/i18n/index.js';
const root=new URL('..',import.meta.url).pathname;
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MAC='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),m};};

test('the guide shows on a first web visit, and never in the extension or the dev server',()=>{
 assert.equal(globalThis.chrome,undefined);
 assert.equal(shouldShowGuide({kind:'web',seen:readSeen(store())}),true);
 assert.equal(shouldShowGuide({kind:'extension',seen:false}),false);
 assert.equal(shouldShowGuide({kind:'dev',seen:false}),false);
 assert.equal(canReopenGuide('web'),true);
 assert.equal(canReopenGuide('extension'),false);
});

test('finishing or skipping records it, so the next visit does not show it; reopening still works',()=>{
 const s=store();
 assert.equal(readSeen(s),false);
 assert.equal(markSeen(s),true);
 assert.equal(s.m.get(GUIDE_KEY),'1');
 assert.equal(shouldShowGuide({kind:'web',seen:readSeen(s)}),false);
 assert.equal(canReopenGuide('web'),true,'the menu entry stays after it was seen');
 const blocked={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
 assert.equal(readSeen(blocked),false);assert.equal(markSeen(blocked),false);
});

test('iOS, Android and desktop are told apart from the user agent',()=>{
 assert.equal(detectPlatform({userAgent:IPHONE}),'ios');
 assert.equal(detectPlatform({userAgent:ANDROID}),'android');
 assert.equal(detectPlatform({userAgent:MAC,platform:'MacIntel',maxTouchPoints:0}),'desktop');
 assert.equal(detectPlatform({userAgent:MAC,platform:'MacIntel',maxTouchPoints:5}),'ios','iPadOS reports itself as a Mac');
 assert.equal(detectPlatform({}),'desktop');
});

test('already-installed (standalone) is detected, and then no install steps are chosen',()=>{
 const mm=matches=>q=>({matches:q==='(display-mode: standalone)'&&matches});
 assert.equal(isStandalone({matchMedia:mm(true),navigator:{}}),true);
 assert.equal(isStandalone({matchMedia:mm(false),navigator:{standalone:true}}),true,'iOS Home Screen flag');
 assert.equal(isStandalone({matchMedia:mm(false),navigator:{}}),false);
 assert.equal(isStandalone({matchMedia:undefined,navigator:undefined}),false);
 for(const p of ['ios','android','desktop']){assert.equal(installKind({platform:p,standalone:true}),null);assert.equal(installKind({platform:p,standalone:false}),p);}
});

async function renderStep(step,platform,standalone){
 const {outputFiles:[out]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {I18nProvider} from './src/i18n.jsx';import {GuideStep} from './src/WebFirstLaunchGuide.jsx';
  export const render=(step,platform,standalone)=>renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(GuideStep,{step,platform,standalone,onExport(){}})));`,resolveDir:root,loader:'jsx'},
  bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',logLevel:'silent',loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl','.webp':'dataurl'}});
 const module={exports:{}};new Function('module','exports','require',out.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return module.exports.render(step,platform,standalone).replace(/<[^>]+>/g,' ');
}
test('the keep-it screen shows the steps for the browser in use and hides them when standalone',async()=>{
 assert.deepEqual(GUIDE_STEPS,['what','where','keep','extras']);
 const ios=await renderStep('keep','ios',false),android=await renderStep('keep','android',false),desktop=await renderStep('keep','desktop',false),app=await renderStep('keep','ios',true);
 assert.match(ios,/添加到主屏幕/);assert.match(ios,/约一周/);assert.doesNotMatch(ios,/安装应用|安装图标/);
 assert.match(android,/安装应用/);assert.doesNotMatch(android,/分享|约一周/);
 assert.match(desktop,/安装图标/);assert.doesNotMatch(desktop,/分享|安装应用/);
 assert.doesNotMatch(app,/添加到主屏幕或安装|分享|安装图标|约一周/);assert.match(app,/不需要再安装/);
 for(const t of [ios,android,desktop,app])assert.match(t,/清除网站数据会删除钱包/),assert.match(t,/现在导出备份/);
});

test('the other screens say what it is, where data lives and what leaves the browser, matching PRIVACY.md',async()=>{
 assert.match(await renderStep('what','desktop',false),/不需要账号、注册或银行登录/);
 assert.match(await renderStep('where','desktop',false),/只保存在你输入它的那个浏览器里，不上传/);
 const extras=await renderStep('extras','desktop',false);
 assert.match(extras,/通知权限/);assert.match(extras,/不含卡号、余额或账单/);
});

test('every guide string exists in zh-TW and en-US, and the guide is wired into the web build only',()=>{
 const src=readFileSync(root+'src/WebFirstLaunchGuide.jsx','utf8');
 const keys=[...src.matchAll(/\bt\('([^']+)'\)/g)].map(m=>m[1]).concat([...src.matchAll(/^ (?:ios|android|desktop):'([^']+)'/gm)].map(m=>m[1]));
 assert.ok(keys.length>15);
 for(const k of keys)for(const lang of ['zh-TW','en-US'])assert.ok(translations[lang][k],`${lang}: ${k}`);
 const main=readFileSync(root+'src/main.jsx','utf8');
 assert.match(main,/shouldShowGuide\(\{kind:runtimeKind\(\)/);
 assert.match(main,/canReopenGuide\(runtimeKind\(\)\)&&<WebFirstLaunchGuide/);
});
