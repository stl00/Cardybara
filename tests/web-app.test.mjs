// The built web app (dist/web, from `npm run build:web`) in real headless Chrome at 375 px: it starts as an empty
// wallet without /data.json, a service worker caches the shell, and a reload with the server gone still shows it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {WEB_DIR, run} from '../scripts/web-chrome.mjs';

// test:refresh also lists this file but runs before build:web, so it skips there when dist/web is absent; under
// `npm run test:web` (after build:web, in check:release and CI) a missing dist/web fails instead of skipping.
const required = process.env.npm_lifecycle_event === 'test:web';
test('the web app loads at phone width, reloads offline and still shows the empty wallet', {timeout: 120000, skip: !required && !existsSync(WEB_DIR) && 'dist/web is not built (npm run build:web); npm run test:web runs this'}, async () => {
  assert.ok(!required || existsSync(WEB_DIR), 'dist/web must be built (npm run build:web) before npm run test:web');
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
