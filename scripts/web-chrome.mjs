// Drives dist/web in real headless Chrome at phone width, with synthetic state only: no bank, no network beyond
// loopback. Used by tests/web-app.test.mjs and runnable alone: node scripts/web-chrome.mjs [--shot file.png]
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {findChrome, SANDBOX_SAFE_ARGS} from './dev-collector/chrome-launcher.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const WEB_DIR = join(root, 'dist/web');
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json'};
const wait = ms => new Promise(r => setTimeout(r, ms));

// The headers Cloudflare Pages would send for `/*`, so the Content-Security-Policy is tested as shipped.
export function headersFor(file) {
  const out = {};
  let applies = false;
  for (const line of file.split('\n')) {
    if (/^\S/.test(line)) applies = line.trim() === '/*';
    else if (applies && line.includes(':')) { const i = line.indexOf(':'); out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
  return out;
}

export async function serve(dir) {
  const headers = headersFor(await readFile(join(dir, '_headers'), 'utf8'));
  const server = createServer(async (req, res) => {
    let name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (name === '/') name = '/index.html';
    const path = join(dir, name);
    if (!path.startsWith(dir)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, {...headers, 'content-type': TYPES[extname(path)] || 'application/octet-stream'}).end(body);
    } catch { res.writeHead(404, headers).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return server;
}

function cdpPipe(child) {
  let next = 0, buffer = Buffer.alloc(0), gone = null;
  const pending = new Map(), listeners = [];
  const fail = reason => { gone = gone || reason; for (const [id, p] of pending) { pending.delete(id); p.reject(Error(`${p.method}: ${gone}`)); } };
  child.on('error', e => fail('Chrome failed to start (' + e.message + ')'));
  child.on('exit', (code, signal) => fail(`Chrome exited (${signal || code})`));
  for (const s of [child.stdio[3], child.stdio[4]]) s.on('error', e => fail('pipe closed (' + e.message + ')'));
  child.stdio[4].on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    let i;
    while ((i = buffer.indexOf(0)) >= 0) {
      const msg = JSON.parse(buffer.subarray(0, i).toString('utf8'));
      buffer = buffer.subarray(i + 1);
      if (msg.id === undefined) { listeners.forEach(l => l(msg)); continue; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); }
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (gone) return reject(Error(`${method}: ${gone}`));
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ': no answer in 30 s')); }, 30000);
    pending.set(id, {resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); }, method});
    child.stdio[3].write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0');
  });
  send.on = fn => listeners.push(fn);
  return send;
}

const snapshot = `(async()=>{
  for(let n=0;n<200&&!document.querySelector('#root > *');n++)await new Promise(r=>setTimeout(r,50));
  await new Promise(r=>setTimeout(r,500));
  const seed=await fetch('/data.json').then(r=>r.json());
  return {text:document.body.innerText,width:document.documentElement.scrollWidth,viewport:innerWidth,
    controlled:!!navigator.serviceWorker?.controller,cards:seed.cards.length,rewards:seed.rewards.length,
    persist:localStorage.getItem('cardybara-web-storage-persist'),csp:window.__cspViolations||[]};
})()`;

export async function run({shot, dir = WEB_DIR} = {}) {
  const work = await mkdtemp(join(tmpdir(), 'cardybara-web-'));
  let server, child;
  try {
    server = await serve(dir);
    const origin = `http://127.0.0.1:${server.address().port}`;
    child = spawn(await findChrome(), ['--user-data-dir=' + join(work, 'profile'), '--remote-debugging-pipe', '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', ...SANDBOX_SAFE_ARGS, 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']});
    const send = cdpPipe(child);
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const page = (m, p) => send(m, p, sessionId);
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Emulation.setDeviceMetricsOverride', {width: 375, height: 812, deviceScaleFactor: 2, mobile: true});
    await page('Page.addScriptToEvaluateOnNewDocument', {source: `window.__cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.__cspViolations.push(e.violatedDirective+' '+e.blockedURI));`});
    const evaluate = async expression => (await page('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true})).result.value;

    await page('Page.navigate', {url: origin + '/'});
    const online = await evaluate(snapshot);
    // The worker installs after first paint: wait until it holds the shell, then reload so a worker controls the page.
    const ready = await evaluate(`navigator.serviceWorker.ready.then(async()=>{const keys=await caches.keys();const n=keys.length?(await (await caches.open(keys[0])).keys()).length:0;return {caches:keys.length,entries:n}})`);
    const registrations = await evaluate(`navigator.serviceWorker.getRegistrations().then(r=>r.length)`);
    await page('Page.reload');
    const controlled = await evaluate(snapshot);

    // Offline for real: the server is gone, so only the worker's cache can answer.
    await new Promise(r => server.close(r));
    server.closeAllConnections?.();
    await page('Page.reload');
    const offline = await evaluate(snapshot);
    if (shot) await writeFile(shot, Buffer.from((await page('Page.captureScreenshot', {format: 'png'})).data, 'base64'));
    return {online, ready, registrations, controlled, offline};
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit').catch(() => {}); child.kill(); await Promise.race([exited, wait(5000)]); }
    server?.closeAllConnections?.();
    server?.close();
    await rm(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--shot');
  const result = await run({shot: at > 0 ? resolve(process.argv[at + 1]) : null});
  console.log(JSON.stringify(result, null, 1));
}
