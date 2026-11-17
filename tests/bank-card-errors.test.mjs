import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

// #319: the wallet names the cards a bank read could not open, next to the job-level read error. Synthetic data only.
const root=new URL('..',import.meta.url).pathname;
const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import BankConnections from './src/BankConnections.jsx';import {activateLanguage} from './src/i18n-core.js';export const render=(props,lang='zh-CN')=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(BankConnections,props));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
const card=(id,name)=>({id,bank:'Chase',name,balance:10,updated:'2026-01-01'});
const props=jobs=>({data:{connections:[{bank:'Chase'}],cards:[card('c1','Synthetic Card One'),card('c2','Synthetic Card Two')]},connected:true,collectorConnected:true,collectorState:{runtimeBuild:'b',disabled:[],records:{},run:{status:'complete',jobs}},
 sendCollector(){},bankState:()=>'',isBusy:()=>false,refreshBank(){},urls:{},onSetup(){},onRestore(){},refreshing:false,onFocus(){}});

test('a failed card is named with its reason and keeps its previous record (#319)',()=>{
 const job={bank:'Chase',status:'partial',readError:'card_not_identified',cardErrors:[{cardIds:['c1'],error:'card_not_identified'},{cardIds:['c2'],error:'chase_detail_timeout'}]};
 const zh=module.exports.render(props([job]));
 assert.ok(zh.includes('以下卡片本轮没有读取成功'));assert.ok(zh.includes('Synthetic Card One · 页面未显示卡片'));assert.ok(zh.includes('Synthetic Card Two · 这张卡的详情页加载超时'));assert.ok(zh.includes('保留上次读取的记录和日期'));
 assert.ok(zh.includes('Synthetic Card One'),'the card itself is still listed with its saved balance');
 const en=module.exports.render(props([job]),'en-US');assert.ok(en.includes('These cards could not be read in this run'));assert.ok(en.includes('Card not visible'));assert.ok(en.includes('previously read records'));
 const tw=module.exports.render(props([job]),'zh-TW');assert.ok(tw.includes('以下卡片本輪沒有讀取成功'));assert.ok(tw.includes('頁面未顯示卡片'));
});

test('no per-card error block without cardErrors, and an unknown card id is not invented (#319)',()=>{
 assert.ok(!module.exports.render(props([{bank:'Chase',status:'updated'}])).includes('以下卡片本轮没有读取成功'));
 assert.ok(!module.exports.render(props([{bank:'Chase',status:'partial',cardErrors:[]}])).includes('以下卡片本轮没有读取成功'));
 assert.ok(module.exports.render(props([{bank:'Chase',status:'partial',cardErrors:[{cardIds:['gone'],error:'card_not_identified'}]}])).includes('卡片待确认'));
});
