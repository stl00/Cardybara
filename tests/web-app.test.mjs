// The built web app (dist/web, from `npm run build:web`) in real headless Chrome at 375 px: it starts as an empty
// wallet without /data.json, a service worker caches the shell, and a reload with the server gone still shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {WEB_DIR, run} from '../scripts/web-chrome.mjs';

test('the web app loads at phone width, reloads offline and still shows the empty wallet', {timeout: 120000}, async () => {
  assert.ok(existsSync(WEB_DIR), 'run npm run build:web first');
  const r = await run();
  for (const [name, page] of Object.entries({online: r.online, controlled: r.controlled, offline: r.offline})) {
    assert.match(page.text, /欢迎，这是你的新钱包/, `${name}: the empty wallet welcome shows`);
    assert.equal(page.cards, 0, `${name}: the built-in seed has no cards`);
    assert.equal(page.rewards, 0, `${name}: the built-in seed has no rewards`);
    assert.equal(page.viewport, 375, `${name}: phone width`);
    assert.ok(page.width <= 375, `${name}: no horizontal scroll (${page.width}px)`);
    assert.deepEqual(page.csp, [], `${name}: the shipped Content-Security-Policy blocks nothing the app needs`);
    assert.ok(page.persist && 'persisted' in JSON.parse(page.persist), `${name}: the storage-persistence answer is recorded`);
  }
  assert.equal(r.registrations, 1);
  assert.ok(r.ready.entries >= 4, 'the worker cached the app shell');
  assert.equal(r.offline.controlled, true, 'the offline reload was answered by the worker');
});
