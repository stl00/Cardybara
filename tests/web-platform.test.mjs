// #375: the wallet runs on a plain web origin with no `chrome` global. Bank collection, the parser and the extension-only
// controls are absent there (manual entry only), the extension behaves as before, and every browser-extension call
// lives in src/platform/extension.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const root=new URL('..',import.meta.url).pathname;
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);

test('only src/platform/extension.js calls the browser extension API',()=>{
 const hits=walk(join(root,'src')).filter(f=>/\.(jsx?|mjs|json|css|html)$/.test(f)&&/chrome\./.test(readFileSync(f,'utf8'))).map(f=>relative(root,f));
 assert.deepEqual(hits,['src/platform/extension.js']);
});

const bundle=async(source)=>{
 const {outputFiles:[out]}=await build({stdin:{contents:source,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',logLevel:'silent',
  loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl','.jpg':'dataurl','.webp':'dataurl'}});
 const module={exports:{}};new Function('module','exports','require',out.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 return module.exports;
};
// Run `fn` with the given globals, restoring them after, so one test's fake browser never leaks into another.
async function withGlobals(globals,fn){
 const before=Object.fromEntries(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 try{return await fn();}finally{for(const [k,d] of Object.entries(before))d?Object.defineProperty(globalThis,k,d):delete globalThis[k];}
}

test('with no chrome global the platform is the web one: no collection, assistant or notification worker',async()=>{
 assert.equal(globalThis.chrome,undefined);
 const {platform}=await bundle("export {platform} from './src/platform/index.js';");
 assert.equal(platform.kind,'web');
 assert.equal(platform.collection,undefined);
 assert.equal(platform.assistant,undefined);
 assert.equal(platform.notifications.worker,false);
});

test('on an extension page the platform is the extension one and keeps its calls',async()=>{
 const calls=[];
 const chrome={runtime:{id:'x',getURL:p=>'chrome-extension://x/'+p,sendMessage:async m=>{calls.push(m.type);return {ok:true,result:1}}},permissions:{request:async()=>true,contains:async()=>true,remove:async()=>{}},storage:{local:{}}};
 await withGlobals({chrome,location:{protocol:'chrome-extension:'}},async()=>{
  const {platform}=await bundle("export {platform} from './src/platform/index.js';");
  assert.equal(platform.kind,'extension');
  assert.ok(platform.collection&&platform.assistant&&platform.notifications.worker);
  assert.deepEqual(await platform.assistant.send('agent-state'),{ok:true,result:1});
  assert.deepEqual(calls,['agent-state']);
  assert.equal(platform.notifications.area(),chrome.storage.local);
  assert.equal(await platform.notifications.request(),true);
 });
});

const NO_BANK=/连接银行|连接第一家银行|刷新全部银行|刷新银行|刷新所属银行|管理银行|银行连接|开始使用 Cardybara|安装扩展|下载 Cardybara/;
const rendering={};
async function render(initial,key='web'){
 rendering[key]??=await bundle(`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {I18nProvider} from './src/i18n.jsx';import {CostProvider} from './src/CostTrackingUI';import {PersonalProvider} from './src/PersonalWallet.jsx';import {Dashboard} from './src/main.jsx';
  const h=React.createElement;
  export const render=initial=>renderToStaticMarkup(h(I18nProvider,null,h(CostProvider,null,h(PersonalProvider,null,h(Dashboard,{initial})))));`);
 return rendering[key].render(initial);
}
const empty={cards:[],rewards:[],transactions:[],offers:[],benefits:[],connections:[]};

test('the web wallet renders with no chrome global and its first screen leads to adding a card by hand',async()=>{
 assert.equal(globalThis.chrome,undefined);
 const html=await withGlobals({location:{hash:'',protocol:'https:',origin:'https://wallet.example'}},()=>render(empty));
 const text=html.replace(/<[^>]+>/g,' ');
 assert.match(text,/欢迎，这是你的新钱包/);
 assert.match(html,/empty-wallet-manual/);
 assert.match(text,/添加卡片/);
 assert.doesNotMatch(text,NO_BANK);
});

test('a web link to the bank connection page opens the overview instead',async()=>{
 const html=await withGlobals({location:{hash:'#connections',protocol:'https:',origin:'https://wallet.example'}},()=>render(empty));
 assert.match(html,/page-overview/);
 assert.doesNotMatch(html,/page-connections/);
});

test('the web settings page has the reminder card but no bank refresh, parser or model settings',async()=>{
 const html=await withGlobals({location:{hash:'#settings',protocol:'https:',origin:'https://wallet.example'}},()=>render(empty));
 const text=html.replace(/<[^>]+>/g,' ');
 assert.match(text,/账单和福利提醒/);
 assert.match(text,/开启时浏览器会请求通知权限/);
 assert.doesNotMatch(text,/银行刷新|AI 服务|可选 AI 解析|自动补全银行数据|Chrome/);
});

test('control: the same wallet on an extension page still shows bank connection',async()=>{
 const chrome={runtime:{id:'x'},permissions:{},storage:{local:{}}};
 const html=await withGlobals({chrome,location:{hash:'',protocol:'chrome-extension:',origin:'chrome-extension://x'}},()=>render(empty,'extension'));
 const text=html.replace(/<[^>]+>/g,' ');
 assert.match(text,NO_BANK);
 assert.match(text,/连接第一家银行/);
 assert.doesNotMatch(html,/empty-wallet-manual/);
});
