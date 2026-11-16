import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agentTools} from '../src/walletAgent.js';
const src=readFileSync(new URL('../src/ChatAdvisor.jsx',import.meta.url),'utf8');
const block=lang=>{const i=src.indexOf(` '${lang}':{`);assert.ok(i>=0,lang);return src.slice(i,src.indexOf('\n',i));};
test('every assistant tool has a progress label in all three languages',()=>{
 const names=agentTools.map(t=>t.function.name);
 assert.ok(names.includes('plan_flight'));
 for(const lang of ['zh-CN','zh-TW','en-US'])for(const n of names)
  assert.match(block(lang),new RegExp(`[,{]${n}:'[^']+'`),`${lang} is missing a progress label for ${n}`);
});
