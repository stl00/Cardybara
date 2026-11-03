import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {applyLive,mergeBankResult} from '../src/live.js';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../extension/reader.js',import.meta.url),'utf8'),ctx);
const parse=(t,b='BOA')=>JSON.parse(JSON.stringify(ctx.cardybaraParseText(t,b,[{id:'atmos',tail:'2554'}],'2026-10-22T23:30:00Z')));
assert.deepEqual(parse('Card ending 2554\nCurrent balance\n$3,217.26\nAvailable credit\n$99,123.26\nMinimum payment due\n$35.00')[0].fields,{balance:3217.26,available:99123.26,minimum:35});
assert.equal(parse('Current balance\n$999.00').length,0);
assert.equal(parse('ending 2554\nCurrent balance\n$9.00\nCurrent balance\n$12.00').length,0);
assert.equal(parse('ending 2554\nCurrent balance\nNot available').length,0);
assert.equal(parse('ending 2554\nCurrent balance\n0.00')[0].fields.balance,0);
assert.equal(parse('ending 2554\nCurrent balance\n23.74 CR')[0].fields.balance,-23.74);
assert.equal(parse('ending 2554\nCurrent balance\nHK$6,208.65','HSBC HK')[0].fields.balance,-6208.65);
const base={asOf:'2026-10-21',cards:[{id:'atmos',bank:'BOA',balance:10,statement:20,updated:'2026-10-21'}],connections:[{bank:'BOA',lastAttemptAt:'2026-10-21T00:00:00Z'}]};
const live={BOA:{attemptedAt:'2026-10-22T23:30:00Z',status:'updated',patches:parse('ending 2554\nCurrent balance\n$99.00')}};
const merged=applyLive(base,live);assert.equal(merged.cards[0].balance,99);assert.equal(merged.cards[0].statement,20);assert.equal(merged.cards[0].fieldDates.statement,'2026-10-21T00:00:00Z');assert.equal(merged.cards[0].updated,'2026-10-22');assert.equal(merged.asOf,'2026-10-22');
assert.equal(applyLive(base,{BOA:{attemptedAt:'2026-10-22T23:30:00Z',status:'needs_login',patches:[]}}).cards[0].balance,10);
const newer={...base,cards:[{...base.cards[0],updated:'2026-10-23'}]};assert.equal(applyLive(newer,live).cards[0].balance,10);
console.log('Passed: account identity, ambiguity, missing/zero, credit balances, HSBC signs, field freshness, failures.');

assert.equal(parse('ending 2554\nCurrent balance\n-$23.74')[0].fields.balance,-23.74);
assert.equal(parse('ending 2554\nAvailable credit $7,776.47')[0].fields.available,7776.47);

const prior={status:'updated',attemptedAt:'2026-10-22T23:30:00Z',patches:[{id:'atmos',fields:{balance:99,statement:50},capturedAt:'2026-10-22T23:30:00Z'},{id:'other',fields:{balance:7},capturedAt:'2026-10-22T23:30:00Z'}]};
const single=mergeBankResult(prior,{status:'updated',attemptedAt:'2026-10-23T16:00:00Z',patches:[{id:'atmos',fields:{balance:100},capturedAt:'2026-10-23T16:00:00Z'}]});
assert.equal(single.patches.length,2);assert.equal(single.receivedCount,1);
const afterSingle=applyLive(base,{BOA:single});assert.equal(afterSingle.cards[0].balance,100);assert.equal(afterSingle.cards[0].statement,50);assert.equal(afterSingle.cards[0].fieldDates.statement,'2026-10-22T23:30:00Z');
const failed=mergeBankResult(single,{status:'needs_login',attemptedAt:'2026-10-24T16:00:00Z',patches:[]});
assert.equal(applyLive(base,{BOA:failed}).cards[0].balance,100);assert.equal(failed.receivedCount,0);assert.equal(applyLive(base,{BOA:failed}).connections[0].outcome,'live_failed');
const stale=mergeBankResult(single,{status:'updated',patches:[{id:'atmos',fields:{balance:1},capturedAt:'2026-10-21T16:00:00Z'}]});
assert.equal(stale.patches.find(p=>p.id==='atmos').fields.balance,100);

import {migrateLegacyWalletStorage} from '../src/legacyStorage.js';
test('brand namespace migration preserves old data and never overwrites an existing new wallet',()=>{const map=new Map([['atlas-import','old-wallet'],['atlas-favorites','old-favorites'],['cardybara-favorites','new-favorites']]);const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};migrateLegacyWalletStorage(storage);assert.equal(map.get('cardybara-import'),'old-wallet');assert.equal(map.get('cardybara-favorites'),'new-favorites');assert.equal(map.get('atlas-import'),'old-wallet');migrateLegacyWalletStorage(storage);assert.equal(map.get('cardybara-import'),'old-wallet');});
