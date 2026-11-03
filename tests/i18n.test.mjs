import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activateLanguage, normalizeLanguage, t, formatNumber, formatDateTime} from '../src/i18n-core.js';
const catalog=JSON.parse(readFileSync(new URL('../src/translations.json',import.meta.url),'utf8'));
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
