import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agentTools} from '../src/walletAgent.js';
const src=readFileSync(new URL('../src/ChatAdvisor.jsx',import.meta.url),'utf8');
const langs=['zh-CN','zh-TW','en-US'];
// Layout-independent: a language block runs from its `'lang': {` marker to the next marker (or end of file).
const marks=langs.map(l=>{const m=new RegExp(`['"]${l}['"]\\s*:\\s*\\{`).exec(src);assert.ok(m,l);return {l,i:m.index};}).sort((x,y)=>x.i-y.i);
const block=lang=>{const k=marks.findIndex(m=>m.l===lang);return src.slice(marks[k].i,k+1<marks.length?marks[k+1].i:src.length);};
test('every assistant tool has a progress label in all three languages',()=>{
 const names=agentTools.map(t=>t.function.name);
 assert.ok(names.includes('plan_flight'));
 for(const lang of langs)for(const n of names)
  assert.match(block(lang),new RegExp(`[,{\\s]['"]?${n}['"]?\\s*:\\s*['"\`][^'"\`]+['"\`]`),`${lang} is missing a progress label for ${n}`);
});
