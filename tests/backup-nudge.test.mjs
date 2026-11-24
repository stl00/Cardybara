// #572: the web backup reminder. The decision function is pure; synthetic values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {showBackupNudge, readNudgeInputs, recordExport, recordDismiss, noteFirstCard, LAST_EXPORT_KEY} from '../src/backupNudge.js';
import {DEVICE_ONLY} from '../src/walletDocument.js';

const DAY = 86400000, now = 1_800_000_000_000, ago = d => now - d * DAY;
const base = {web: true, now, cardCount: 2, syncOn: false, lastExport: null, lastDismiss: null, firstCardAt: ago(5)};

test('never exported and the first card is older than 3 days: shows', () => assert.equal(showBackupNudge(base), true));
test('never exported but the wallet is new: hides', () => assert.equal(showBackupNudge({...base, firstCardAt: ago(2)}), false));
test('never exported and no first-card day known: hides', () => assert.equal(showBackupNudge({...base, firstCardAt: null}), false));
test('recent export hides, a 14-day-old export shows', () => {
  assert.equal(showBackupNudge({...base, lastExport: ago(13)}), false);
  assert.equal(showBackupNudge({...base, lastExport: ago(14)}), true);
});
test('dismissed hides for 7 days then returns', () => {
  assert.equal(showBackupNudge({...base, lastDismiss: ago(6.9)}), false);
  assert.equal(showBackupNudge({...base, lastDismiss: ago(7)}), true);
});
test('sync on hides', () => assert.equal(showBackupNudge({...base, syncOn: true}), false));
test('empty wallet hides', () => assert.equal(showBackupNudge({...base, cardCount: 0}), false));
test('the extension build never shows', () => assert.equal(showBackupNudge({...base, web: false}), false));

test('storage helpers keep to the listed device-only keys', () => {
  const mem = new Map(), s = {getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v)};
  recordExport(1000, s); recordDismiss(2000, s); noteFirstCard(3000, s); noteFirstCard(9000, s);
  assert.deepEqual(readNudgeInputs(s), {lastExport: 1000, lastDismiss: 2000, firstCardAt: 3000});
  for (const k of mem.keys()) assert.ok(k in DEVICE_ONLY, k);
  assert.ok(LAST_EXPORT_KEY in DEVICE_ONLY);
});
