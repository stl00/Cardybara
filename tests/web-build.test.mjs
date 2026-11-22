// Unit checks for the web build (stl00/Cardybara#374): headers, manifest, service worker, shell helpers and the
// dist/web audit. They use synthetic folders; tests/web-app.test.mjs loads the real build in Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gatewayOrigin, serviceWorkerSource, shellVersion, webHeaders, webManifest} from '../scripts/web-build.mjs';
import {checkWeb} from '../scripts/check-web.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
import {headersFor} from '../scripts/web-chrome.mjs';

globalThis.__CARDYBARA_WEB_TEST__ = true;
const shell = await import('../web/shell.js');

test('the gateway origin is optional and must be a bare https origin', () => {
  assert.equal(gatewayOrigin({}), null);
  assert.equal(gatewayOrigin({CARDYBARA_GATEWAY_ORIGIN: 'https://gateway.example/'}), 'https://gateway.example');
  for (const bad of ['gateway.example', 'http://gateway.example', 'https://gateway.example/path', 'https://u:p@gateway.example', '*'])
    assert.throws(() => gatewayOrigin({CARDYBARA_GATEWAY_ORIGIN: bad}), /CARDYBARA_GATEWAY_ORIGIN/, bad);
});

test('headers are strict, allow the gateway only in connect-src, and parse as Pages would', () => {
  const plain = headersFor(webHeaders());
  assert.match(plain['Content-Security-Policy'], /^default-src 'none'; script-src 'self'; /);
  assert.match(plain['Content-Security-Policy'], /connect-src 'self'; /);
  const gw = headersFor(webHeaders('https://gateway.example'))['Content-Security-Policy'];
  assert.match(gw, /connect-src 'self' https:\/\/gateway\.example; /);
  assert.equal(gw.match(/https:\/\/gateway\.example/g).length, 1);
  assert.doesNotMatch(gw, /unsafe-eval|script-src[^;]*unsafe-inline|\*/);
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
});

test('the manifest is installable and standalone with the brand icon', () => {
  const m = webManifest();
  assert.equal(m.display, 'standalone');
  const png = m.icons.filter(i => i.type === 'image/png');
  assert.deepEqual(png.map(i => i.sizes).sort(), ['192x192', '512x512', '512x512'], 'Android needs 192 and 512 px PNGs');
  assert.ok(png.some(i => i.purpose === 'maskable'), 'a maskable PNG with a safe zone');
  assert.ok(m.icons.some(i => i.src === '/cardybara.svg'));
  for (const i of png) assert.ok(existsSync(join(root, 'public', i.src)), `${i.src} is committed`);
  assert.ok(existsSync(join(root, 'public/brand/app-icons/apple-touch-icon.png')), 'the iOS Home Screen icon is committed');
  assert.ok(m.name && m.short_name && m.theme_color && m.background_color);
});

test('the service worker precaches the shell, skips other origins and the seed, and falls back offline', () => {
  const src = serviceWorkerSource(['/', '/assets/a.js'], 'abc');
  assert.match(src, /cardybara-web-abc/);
  assert.match(src, /url\.origin !== self\.location\.origin/);
  assert.match(src, /'\/data\.json'/);
  assert.match(src, /request\.method !== 'GET'/);
  assert.doesNotThrow(() => new Function(src.replace(/self\.addEventListener/g, 'void 0&&self.addEventListener')));
  assert.notEqual(serviceWorkerSource(['/'], 'abc'), serviceWorkerSource(['/'], 'abd'));
});

test('the cache version changes when only index.html changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-version-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets/a.js'), 'a');writeFileSync(join(dir, 'push-worker.js'), 'p');writeFileSync(join(dir, 'index.html'), 'one');
  const before = shellVersion(dir, ['/', '/assets/a.js']);
  writeFileSync(join(dir, 'index.html'), 'two');
  assert.notEqual(shellVersion(dir, ['/', '/assets/a.js']), before);
  rmSync(dir, {recursive: true, force: true});
});

test('a navigation is never answered with a redirected response (Safari refuses it)', async () => {
  const src = serviceWorkerSource(['/', '/assets/a.js'], 'abc');
  const handlers = {}, store = new Map();
  // A cached copy that followed Pages' 308 (/index.html -> /), as Safari's Cache keeps it.
  const redirected = () => { const r = new Response('<!doctype html>', {status: 200, headers: {'Content-Type': 'text/html'}}); Object.defineProperty(r, 'redirected', {value: true}); return r; };
  store.set('/', redirected());
  const self = {location: {origin: 'https://wallet.example'}, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: {claim() {}}};
  const caches = {open: async () => ({match: async k => (store.has(typeof k === 'string' ? k : new URL(k.url).pathname) ? redirected() : undefined), put: async () => {}})};
  new Function('self', 'caches', 'importScripts', 'fetch', src)(self, caches, () => {}, async () => redirected());
  const run = async (url, mode) => { let p; handlers.fetch({request: {method: 'GET', url, mode}, respondWith: x => { p = x; }}); return p; };
  for (const url of ['https://wallet.example/', 'https://wallet.example/#settings']) {
    const r = await run(url, 'navigate');
    assert.equal(r.redirected, false, url);assert.equal(await r.text(), '<!doctype html>');
  }
  assert.doesNotMatch(src, /'\/index\.html'/, 'the worker never asks for /index.html (Pages redirects it)');
  store.clear();
  const net = await run('https://wallet.example/index.html', 'navigate');
  assert.equal(net.redirected, false, 'a redirected network answer to a navigation is copied too');
});

test('the page shell answers /data.json from the built-in empty seed and leaves other requests alone', async () => {
  const calls = [];
  const target = {location: {href: 'https://wallet.example/'}, fetch: async u => { calls.push(String(u)); return new Response('real'); }};
  shell.installSeed(target);
  for (const url of ['/data.json', '/data.json?refresh=1', 'https://wallet.example/data.json']) {
    const d = await (await target.fetch(url, {cache: 'no-store'})).json();
    assert.equal(d.cards.length, 0, url);
    assert.equal(d.rewards.length, 0, url);
  }
  assert.equal(await (await target.fetch('/assets/x.js')).text(), 'real');
  assert.equal(await (await target.fetch('https://other.example/data.json')).text(), 'real');
  assert.deepEqual(calls, ['/assets/x.js', 'https://other.example/data.json']);
});

test('the storage-persistence answer is recorded, and a granted answer is not overwritten by a later refusal', async () => {
  const store = new Map();
  const local = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  assert.equal(await shell.recordPersistence({storage: {persisted: async () => false, persist: async () => true}}, local), true);
  assert.equal(JSON.parse(store.get(shell.PERSIST_KEY)).persisted, true);
  assert.equal(await shell.recordPersistence({storage: {persisted: async () => false, persist: async () => false}}, local), false);
  assert.equal(JSON.parse(store.get(shell.PERSIST_KEY)).persisted, true);
  assert.equal(await shell.recordPersistence({}, {getItem: () => null, setItem: () => { throw Error('blocked'); }}), 'unsupported');
  assert.equal(await shell.recordPersistence({storage: {persist: async () => { throw Error('x'); }}}, local), 'error');
});

// A minimal good folder, then one defect at a time.
function folder(edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cardybara-web-check-'));
  const files = {
    'index.html': '<!doctype html><meta name="theme-color" content="#1677ff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#141414" media="(prefers-color-scheme: dark)"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><script type="module" src="/assets/a.js"></script><div id="root"></div>',
    'manifest.webmanifest': JSON.stringify(webManifest()),
    'cardybara.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'apple-touch-icon.png': 'png',
    'brand/app-icons/icon-192.png': 'png',
    'brand/app-icons/icon-512.png': 'png',
    'brand/app-icons/icon-maskable-512.png': 'png',
    'assets/a.js': 'console.log("see https://www.example-bank.com/cards")',
    'sw.js': serviceWorkerSource(['/', '/assets/a.js'], 'x'),
    'push-worker.js': 'self.addEventListener("push",function(){});',
    '_headers': webHeaders('https://gateway.example'),
  };
  edit(files);
  for (const [name, body] of Object.entries(files)) {
    if (body === null) continue;
    mkdirSync(join(dir, name, '..'), {recursive: true});
    writeFileSync(join(dir, name), body);
  }
  return dir;
}
const problems = (edit, opts) => { const dir = folder(edit); try { return checkWeb(dir, opts); } finally { rmSync(dir, {recursive: true}); } };

test('a complete folder passes, reference links in the bundle included', () => {
  assert.deepEqual(problems(() => {}, {gateway: 'https://gateway.example'}), []);
});

test('the audit fails on a missing manifest, service worker, icon or headers', () => {
  assert.match(problems(f => { f['manifest.webmanifest'] = null; }).join(), /missing manifest\.webmanifest/);
  assert.match(problems(f => { f['sw.js'] = null; }).join(), /missing sw\.js/);
  assert.match(problems(f => { f['cardybara.svg'] = null; }).join(), /missing cardybara\.svg[\s\S]*icon/);
  assert.match(problems(f => { f['_headers'] = null; }).join(), /missing _headers/);
  assert.match(problems(f => { f['apple-touch-icon.png'] = null; }).join(), /missing apple-touch-icon\.png/);
  assert.match(problems(f => { f['index.html'] = f['index.html'].replace(/<link rel="apple-touch-icon"[^>]*>/, ''); }).join(), /apple-touch-icon/);
  assert.match(problems(f => { const m = JSON.parse(f['manifest.webmanifest']); m.icons = m.icons.filter(i => i.sizes !== '192x192'); f['manifest.webmanifest'] = JSON.stringify(m); }).join(), /192x192 PNG/);
  assert.match(problems(f => { const m = JSON.parse(f['manifest.webmanifest']); m.icons = m.icons.filter(i => i.purpose !== 'maskable'); f['manifest.webmanifest'] = JSON.stringify(m); }).join(), /maskable/);
  assert.match(problems(f => { f['sw.js'] = serviceWorkerSource(['/', '/assets/gone.js'], 'x'); }).join(), /gone\.js/);
  assert.match(problems(f => { f['sw.js'] = serviceWorkerSource(['/assets/a.js'], 'x'); }).join(), /does not cache \//);
  assert.match(problems(f => { f['sw.js'] = serviceWorkerSource(['/', '/index.html', '/assets/a.js'], 'x'); }).join(), /caches \/index\.html, which Pages redirects/);
});

test('the audit fails when the service worker imports a script that is not shipped', () => {
  assert.match(problems(f => { f['push-worker.js'] = null; }).join(), /push-worker\.js, which is not in the folder/);
});

test('the audit fails on a wallet snapshot or any file the web app does not ship', () => {
  assert.match(problems(f => { f['data.json'] = '{}'; }).join(), /data\.json: a wallet snapshot/);
  assert.match(problems(f => { f['assets/data.json'] = '{}'; }).join(), /assets\/data\.json/);
  assert.match(problems(f => { f['connector-review.html.bak'] = 'x'; }).join(), /not part of the web app/);
  assert.match(problems(f => { f['.env'] = 'K=1'; }).join(), /hidden/);
  assert.match(problems(f => { f['brand/sources.json'] = '{}'; }).join(), /not part of the web app/);
});

test('the audit fails on third-party URLs and requests', () => {
  assert.match(problems(f => { f['index.html'] = f['index.html'].replace('<div', '<script src="https://cdn.example.net/x.js"></script><div'); }).join(), /third-party URL/);
  assert.match(problems(f => { f['assets/s.css'] = 'a{background:url(https://img.example.net/a.png)}'; }).join(), /s\.css: third-party URL/);
  assert.match(problems(f => { f['assets/a.js'] = 'fetch("https://api.example.net/x")'; }).join(), /requests a third-party URL/);
  assert.match(problems(f => { f['index.html'] += '<script>alert(1)</script>'; }).join(), /inline script/);
  assert.match(problems(f => { f['assets/a.js'] = 'const p="/' + 'Users/someone/work/"'; }).join(), /personal path/);
});

test('the audit fails on a loose Content-Security-Policy', () => {
  const csp = body => f => { f['_headers'] = `/*\n  Content-Security-Policy: ${body}\n`; };
  const base = webHeaders().match(/Content-Security-Policy: (.+)/)[1];
  assert.deepEqual(problems(csp(base)), []);
  assert.match(problems(csp(base.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))).join(), /script-src/);
  assert.match(problems(csp(base.replace("connect-src 'self'", "connect-src 'self' https://a.example https://b.example"))).join(), /only the gateway origin/);
  assert.match(problems(csp(base.replace("connect-src 'self'", "connect-src https://a.example"))).join(), /connect-src must include/);
  assert.match(problems(csp(base.replace("connect-src 'self'", "connect-src 'self' https://evil.example"), ), {gateway: 'https://gateway.example'}).join(), /only the gateway origin/);
});
