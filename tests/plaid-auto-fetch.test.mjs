// #580: the wallet reads the Plaid card list itself (src/plaidAutoFetch.js), not only when the Plaid panel is open.
// Fake window/document and client; synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startPlaidAutoFetch} from '../src/plaidAutoFetch.js';
import {ACCOUNT_CHANGE_EVENT} from '../src/accountClient.js';

function target() {
  const l = new Map();
  return {
    addEventListener: (t, f) => l.set(t, [...(l.get(t) || []), f]),
    removeEventListener: (t, f) => l.set(t, (l.get(t) || []).filter(x => x !== f)),
    fire: t => (l.get(t) || []).forEach(f => f()),
    count: () => [...l.values()].reduce((n, a) => n + a.length, 0),
  };
}
const tick = () => new Promise(r => setTimeout(r, 0));
function setup({signedIn = true, hidden = false} = {}) {
  const win = target(), doc = {...target(), visibilityState: hidden ? 'hidden' : 'visible'};
  let t = 1_000_000, calls = 0, signed = signedIn;
  const client = {cards: async () => { calls++; return {ok: true}; }};
  const stop = startPlaidAutoFetch({client, signedIn: () => signed, win, doc, now: () => t, minMs: 60_000});
  return {win, doc, stop, calls: () => calls, advance: ms => { t += ms; }, sign: v => { signed = v; }};
}

test('reads once when the wallet opens signed in', async () => {
  const s = setup(); await tick();
  assert.equal(s.calls(), 1);
});

test('signed out: no request at open, on focus or online', async () => {
  const s = setup({signedIn: false});
  s.advance(120_000); s.win.fire('focus'); s.win.fire('online'); s.doc.fire('visibilitychange'); await tick();
  assert.equal(s.calls(), 0);
});

test('coming back to the front reads again, at most once a minute', async () => {
  const s = setup(); await tick();
  s.win.fire('focus'); await tick();
  assert.equal(s.calls(), 1, 'within a minute: no second read');
  s.advance(61_000); s.doc.fire('visibilitychange'); await tick();
  assert.equal(s.calls(), 2);
  s.advance(61_000); s.win.fire('online'); await tick();
  assert.equal(s.calls(), 3);
});

test('a hidden page does not read', async () => {
  const s = setup({hidden: true}); s.advance(61_000); s.win.fire('focus'); await tick();
  assert.equal(s.calls(), 0);
});

test('signing in reads at once, even inside the minute', async () => {
  const s = setup({signedIn: false}); await tick();
  s.sign(true); s.win.fire(ACCOUNT_CHANGE_EVENT); await tick();
  assert.equal(s.calls(), 1);
  s.win.fire(ACCOUNT_CHANGE_EVENT); await tick();
  assert.equal(s.calls(), 2);
});

test('stop removes every listener and later events read nothing', async () => {
  const s = setup(); await tick();
  s.stop();
  assert.equal(s.win.count() + s.doc.count(), 0);
  s.advance(120_000); s.win.fire('focus'); s.win.fire(ACCOUNT_CHANGE_EVENT); await tick();
  assert.equal(s.calls(), 1);
});

test('a failing client never throws into the page', async () => {
  const win = target(), doc = {...target(), visibilityState: 'visible'};
  startPlaidAutoFetch({client: {cards: () => { throw new Error('boom'); }}, signedIn: () => true, win, doc});
  await tick();
  startPlaidAutoFetch({client: {cards: async () => ({ok: true})}, signedIn: () => { throw new Error('x'); }, win, doc});
  await tick();
});
