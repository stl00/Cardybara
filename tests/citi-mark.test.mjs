// #363: the Citi issuer mark and ThankYou Points show a bundled logo (owner decision 2026-11-16).
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {logoRegistry as registry,logoForProgramme} from '../src/logoRegistry.js';
const root=new URL('..',import.meta.url).pathname,read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('the Citi mark is a local 64 px file with its source and an asset-sources row',()=>{
 const file=new URL('../public/brand/banks/citi.png',import.meta.url);assert.ok(existsSync(file));
 const png=readFileSync(file);assert.equal(png.readUInt32BE(16),64);assert.equal(png.readUInt32BE(20),64);
 assert.match(JSON.parse(read('public/brand/banks/sources.json'))['citi.png'],/^https:\/\/www\.citi\.com\//);
 const row=read('public/ASSET-SOURCES.md').split('\n').find(l=>l.startsWith('| Citi ThankYou Points |'));
 assert.match(row,/requires-permission/);assert.match(row,/brand\/banks\/citi\.png/);assert.match(row,/owner's decision/);
});
test('ThankYou Points resolves to the Citi mark under the owner decision',()=>{
 const b=registry.brands.find(x=>x.id==='citi-thankyou');
 assert.equal(b.status,'approved');assert.equal(b.approval,'owner-decision-2026-11-16');assert.equal(b.terms,'requires-permission');
 assert.equal(b.logo,'brand/banks/citi.png');assert.equal(b.checkedAt,'2026-11-16');
 const view=logoForProgramme('programme.citi-thankyou');
 assert.equal(view.logo,'brand/banks/citi.png');assert.equal(view.name,'Citi');
});
test('BankMark renders the Citi image, not the category icon',async()=>{
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {BankMark} from './src/Identity.jsx';
export const html=bank=>renderToStaticMarkup(React.createElement(BankMark,{bank}));`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 assert.match(module.exports.html('Citi US'),/<img src="\/brand\/banks\/citi\.png"/);
 assert.doesNotMatch(module.exports.html('Citi US'),/anticon/);
});
