// #578: iPhone Safari tab vs the Home Screen app. In the `install` state the reminder card shows the guidance alone (no dead,
// disabled switch) plus a line that the Home Screen app is separate; support is recomputed when the page is shown again;
// the Home Screen app's sign-in banner shows only standalone + signed out + not yet dismissed. Synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {watchSupport,isStandalone} from '../src/webPush.js';
const root=new URL('..',import.meta.url).pathname;

async function bundle(entry){
 const {outputFiles:[out]}=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',logLevel:'silent',loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl','.webp':'dataurl'}});
 const module={exports:{}};new Function('module','exports','require',out.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return module.exports;
}
const storage=(init={})=>{const m=new Map(Object.entries(init));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
async function renderReminders(support,lang='zh-CN'){
 const before=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{value:storage({'cardybara-language':lang}),configurable:true,writable:true});
 try{
  const m=await bundle(`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {App} from 'antd';import {I18nProvider} from './src/i18n.jsx';import {activateLanguage} from './src/i18n-core.js';import ReminderSettings from './src/ReminderSettings.jsx';
  export const html=(support,lang)=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(App,null,React.createElement(ReminderSettings,{pushApi:{support:()=>support,active:()=>false}}))));};`);
  return m.html(support,lang);
 }finally{before?Object.defineProperty(globalThis,'localStorage',before):delete globalThis.localStorage;}
}

test('install state: the reminder card has the guidance and no Switch at all, not even a disabled one',async()=>{
 const html=await renderReminders('install');
 assert.ok(!html.includes('ant-switch'),'no Switch element');
 assert.ok(!/role="switch"/.test(html)&&!/disabled/.test(html.replace(/<style[\s\S]*?<\/style>/g,'')),'no disabled control');
 assert.match(html,/添加到主屏幕/);
 assert.match(html,/主屏幕上的 App 和 Safari 是两个独立的浏览器/,'says the Home Screen app is separate and needs its own sign-in');
});
test('install state, English: same, with the separate-app line',async()=>{
 const html=await renderReminders('install','en-US');
 assert.ok(!html.includes('ant-switch'));
 assert.match(html,/separate browsers/);
});
test('other states still show the switch (the card is unchanged outside install)',async()=>{
 assert.ok((await renderReminders('unsupported')).includes('ant-switch'));
 assert.ok((await renderReminders('ready')).includes('ant-switch'));
});

test('support is recomputed on visibilitychange and pageshow, and the subscription is removed on cleanup',()=>{
 const listeners={doc:{},win:{}};
 const target=name=>({visibilityState:'visible',addEventListener:(e,f)=>{listeners[name][e]=f},removeEventListener:(e,f)=>{if(listeners[name][e]===f)delete listeners[name][e]}});
 const doc=target('doc'),win=target('win');let calls=0;
 const off=watchSupport(()=>{calls++;},{doc,win});
 listeners.doc.visibilitychange();assert.equal(calls,1,'visibilitychange rechecks');
 doc.visibilityState='hidden';listeners.doc.visibilitychange();assert.equal(calls,1,'going to the background does not');
 listeners.win.pageshow();assert.equal(calls,2,'pageshow rechecks');
 off();assert.deepEqual([listeners.doc,listeners.win],[{},{}],'listeners removed');
});
test('ReminderSettings and the runner re-read support through watchSupport (not once at mount)',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../src/ReminderSettings.jsx',import.meta.url),'utf8');
 assert.ok((src.match(/watchSupport\(/g)||[]).length>=2);
});
test('isStandalone: display-mode and navigator.standalone',()=>{
 assert.equal(isStandalone({nav:{},win:{matchMedia:q=>({matches:q==='(display-mode: standalone)'})}}),true);
 assert.equal(isStandalone({nav:{standalone:true},win:{}}),true);
 assert.equal(isStandalone({nav:{},win:{matchMedia:()=>({matches:false})}}),false);
});
test('Home Screen banner shows only when standalone, signed out and not dismissed',async()=>{
 const {showHomeBanner}=await bundle(`export {showHomeBanner} from './src/HomeScreenBanner.jsx';`);
 assert.equal(showHomeBanner({standalone:true,account:null,seen:false}),true);
 assert.equal(showHomeBanner({standalone:false,account:null,seen:false}),false,'a normal tab');
 assert.equal(showHomeBanner({standalone:true,account:{email:'x'},seen:false}),false,'signed in');
 assert.equal(showHomeBanner({standalone:true,account:null,seen:true}),false,'dismissed once');
});
