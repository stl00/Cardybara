// The account sync boundary (stl00/Cardybara#410, #418): the notice, the red line and the web check agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkAccountBody} from '../scripts/check-web.mjs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('PRIVACY.md describes the optional account, what the server holds, who can read it, export and deletion', () => {
  const p = read('PRIVACY.md');
  const section = p.slice(p.indexOf('## Optional account and wallet sync'), p.indexOf('## Retention, exports and deletion'));
  assert.ok(section.length > 500, 'account section missing');
  for (const re of [/optional/i, /passkey public key if you add one/, /salted password hash/, /readable copy of the wallet document/, /push subscription/, /never stores/i, /bank passwords, cookies, bank one-time codes/, /not end-to-end encrypted/i, /operator[\s\S]*can technically read/, /export everything/i, /delete the account/i]) assert.match(section, re);
  assert.doesNotMatch(p, /Cloud browser sync is not used by the application\.(?! )/);
});

test('CLAUDE.md red line allows wallet upload only with account sync on and never bank credentials', () => {
  const c = read('CLAUDE.md');
  assert.doesNotMatch(c, /wallet data never leaves the browser/);
  assert.match(c, /wallet data is uploaded only for a signed-in account with sync on \(on by default after sign-in, owner 2026-11-23, #579\), and bank credentials never are/);
});

test('an account body with only wallet fields passes; credentials, codes, cookies and page evidence fail', () => {
  assert.deepEqual(checkAccountBody({document: {formatVersion: 1, cards: [{id: 'a', product: 'Example Card', feeDate: '2027-01-15'}], settings: {}}}), []);
  for (const key of ['password', 'cookie', 'otp', 'oneTimeCode', 'sessionToken', 'pageEvidence', 'rawHtml', 'apiKey']) {
    const found = checkAccountBody({document: {cards: [{id: 'a', [key]: 'x'}]}});
    assert.equal(found.length, 1, key);
    assert.match(found[0], /not wallet data/);
  }
});

test('with the wallet document field list, any other top-level field fails', () => {
  const allowed = ['formatVersion', 'cards', 'settings'];
  assert.deepEqual(checkAccountBody({document: {formatVersion: 1, cards: []}}, {allowed}), []);
  assert.match(checkAccountBody('{"document":{"formatVersion":1,"bankSnapshot":{}}}', {allowed}).join(), /bankSnapshot/);
  assert.match(checkAccountBody('not json').join(), /not valid JSON/);
});

test('check:web fails a bundle that talks to /v2/account when the CSP names no gateway', async () => {
  const {mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {checkWeb} = await import('../scripts/check-web.mjs');
  const {webHeaders} = await import('../scripts/web-build.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'cby-web-'));
  try {
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets/a.js'), 'const u="/v2/account/wallet"');
    writeFileSync(join(dir, '_headers'), webHeaders());
    assert.match(checkWeb(dir).join(), /a\.js: talks to \/v2\/account/);
    writeFileSync(join(dir, '_headers'), webHeaders('https://gateway.example'));
    assert.doesNotMatch(checkWeb(dir).join(), /talks to \/v2\/account/);
  } finally { rmSync(dir, {recursive: true}); }
});
