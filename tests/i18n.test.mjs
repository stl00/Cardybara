import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {translations as i18nCatalog} from '../src/i18n/index.js';
import {catalogProblems} from '../scripts/i18n-catalog.mjs';
import {activateLanguage, normalizeLanguage, t, formatNumber, formatDateTime} from '../src/i18n-core.js';
const catalog=i18nCatalog;
test('all translations preserve interpolation slots and have matching catalogs',()=>{
 assert.deepEqual(Object.keys(catalog['en-US']).sort(),Object.keys(catalog['zh-TW']).sort());
 for(const language of ['en-US','zh-TW'])for(const [source,translated] of Object.entries(catalog[language])){
  assert.ok(translated.trim(),source);
  assert.deepEqual(translated.match(/\{\d+\}/g)?.sort()||[],source.match(/\{\d+\}/g)?.sort()||[],source);
 }
});
test('switching locale preserves raw bank values and unknown descriptions',()=>{
 activateLanguage('en-US');
 assert.equal(t('下一笔已知还款：{0} · {1}',['Gold 15555','2026-11-06']),'Next known payment: Gold 15555 · 2026-11-06');
 assert.equal(t('MERCHANT 1888 HKD73,132'),'MERCHANT 1888 HKD73,132');
 assert.equal(t(null),'');
 assert.match(t('本机 Chrome 已读取 4 张卡的可见字段；其他金额、积分与账单保留各自原采集日期。'),/4 cards/);
 activateLanguage('zh-TW');assert.equal(t('银行连接'),'銀行連接');
 activateLanguage('zh-CN');assert.equal(t('银行连接'),'银行连接');
});
test('unsupported saved locale safely falls back and dates use Chicago',()=>{
 assert.equal(normalizeLanguage('invalid'),'zh-CN');
 activateLanguage('en-US');
 assert.equal(formatNumber(-1234.56,{minimumFractionDigits:2}),'-1,234.56');
 assert.equal(formatDateTime('2026-10-23T02:00:00Z',{year:'numeric',month:'2-digit',day:'2-digit'}),'10/22/2026');
 activateLanguage('zh-CN');
});

import {formatReadDate} from '../src/i18n-core.js';
test('reading dates use the client Chicago day without shifting date-only statements',()=>{assert.equal(formatReadDate('2026-10-24T02:58:00Z'),'2026-10-23');assert.equal(formatReadDate('2026-10-24'),'2026-10-24');});
test('the split catalog fails the build on a key in two files or a file index.js does not import',()=>{
 const src=new URL('../src/i18n/',import.meta.url),dir=mkdtempSync(join(tmpdir(),'i18n-'));
 try{
  for(const name of ['index.js','app.json','common.json'])copyFileSync(new URL(name,src),join(dir,name));
  writeFileSync(join(dir,'index.js'),"import app from './app.json' with {type:'json'};\nimport common from './common.json' with {type:'json'};\n");
  assert.deepEqual(catalogProblems(dir),[]);
  const app=JSON.parse(readFileSync(join(dir,'app.json'),'utf8')),key=Object.keys(app['en-US'])[0];
  writeFileSync(join(dir,'common.json'),JSON.stringify({'en-US':{[key]:'Again'},'zh-TW':{}}));
  writeFileSync(join(dir,'stray.json'),'{}');
  const problems=catalogProblems(dir);
  assert.ok(problems.some(p=>p.includes(JSON.stringify(key))&&p.includes('app.json')&&p.includes('common.json')),problems.join('\n'));
  assert.ok(problems.some(p=>p.includes('stray.json is not imported')),problems.join('\n'));
 }finally{rmSync(dir,{recursive:true,force:true});}
 assert.deepEqual(catalogProblems(),[]);
});
