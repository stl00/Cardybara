// `npm run check:web`: audits dist/web, the folder `npm run build:web` makes for static hosting (stl00/Cardybara#374).
// It fails when the app cannot be installed or reloaded offline, or when the folder holds a third-party request,
// a data.json or any file type the web app does not ship. It reads files only: no network, no browser.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {extname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const SHIPPED = new Set(['.html', '.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.webmanifest']);
const NAMESPACES = /^https?:\/\/www\.w3\.org\//;
const URL_RE = /(?:https?:)?\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}[^\s"'`)<>\\]*/g;
// Calls that fetch something at run time. Reference links shown to the person (bank and programme pages inside the
// bundle) are text, not requests, and the Content-Security-Policy stops anything else.
const LOADS = /(?:\bfetch|\bimport|importScripts|\bWebSocket|\bEventSource|sendBeacon|\bXMLHttpRequest[^;]{0,40}\bopen)\(\s*(?:[`"'])(?:https?:)?\/\//;
const SECRETS = [/gh[pousr]_[A-Za-z0-9]{25,}/, /github_pat_[A-Za-z0-9_]{30,}/, /sk-[A-Za-z0-9_-]{24,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\/Users\/[A-Za-z0-9_.-]+\//];

const walk = (dir, base = dir) => readdirSync(dir, {withFileTypes: true}).flatMap(e =>
  e.isDirectory() ? walk(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1).split('\\').join('/')]);

export function checkWeb(dir, {gateway = null} = {}) {
  const problems = [];
  const add = message => problems.push(message);
  if (!existsSync(dir)) return [`${dir} does not exist; run npm run build:web first`];
  const files = walk(dir);
  const has = f => files.includes(f);
  const text = f => readFileSync(join(dir, f), 'utf8');

  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', '_headers', 'cardybara.svg']) if (!has(f)) add(`missing ${f}`);
  if (!files.some(f => /^assets\/[^/]+\.js$/.test(f))) add('missing the wallet script in assets/');

  for (const f of files) {
    const base = f.split('/').pop();
    if (base === 'data.json' || /^data\..*json$/.test(base)) add(`${f}: a wallet snapshot must not ship; the web app starts from its built-in empty seed`);
    else if (f.split('/').some(p => p.startsWith('.') || p === 'archive')) add(`${f}: private or hidden path`);
    else if (base !== '_headers' && base !== 'sw.js' && !SHIPPED.has(extname(base).toLowerCase())) add(`${f}: file type is not part of the web app`);
  }

  const manifestText = has('manifest.webmanifest') ? text('manifest.webmanifest') : null;
  if (manifestText) {
    let m = null;
    try { m = JSON.parse(manifestText); } catch { add('manifest.webmanifest is not valid JSON'); }
    if (m) {
      for (const k of ['name', 'short_name', 'start_url', 'theme_color', 'background_color']) if (!m[k]) add(`manifest.webmanifest has no ${k}`);
      if (m.display !== 'standalone') add('manifest display must be standalone');
      if (!Array.isArray(m.icons) || !m.icons.length) add('manifest has no icons');
      for (const icon of m.icons || []) if (!icon.src || !has(String(icon.src).replace(/^\//, ''))) add(`manifest icon ${icon.src} is not in the folder`);
    }
  }

  if (has('index.html')) {
    const html = text('index.html');
    if (!/<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/.test(html)) add('index.html does not link the manifest');
    if (!/name="theme-color"[^>]+media="\(prefers-color-scheme: dark\)"/.test(html) || !/name="theme-color"[^>]+media="\(prefers-color-scheme: light\)"/.test(html)) add('index.html lacks light and dark theme-color');
    if (/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html)) add('index.html has an inline script, which the Content-Security-Policy forbids');
  }

  if (has('sw.js')) {
    const sw = text('sw.js');
    const shell = /const SHELL = (\[.*?\]);/s.exec(sw);
    let list = null;
    try { list = shell && JSON.parse(shell[1]); } catch { /* reported below */ }
    if (!list?.length) add('sw.js lists no app shell files');
    else for (const f of list) if (f !== '/' && !has(f.replace(/^\//, ''))) add(`sw.js caches ${f}, which is not in the folder`);
    if (list && !list.includes('/index.html')) add('sw.js does not cache index.html, so an offline reload has no page');
    if (!/addEventListener\('fetch'/.test(sw)) add('sw.js does not answer fetches');
  }

  // Third-party URLs: none in anything but the wallet bundle; the bundle may hold reference links but never a request.
  for (const f of files) {
    const ext = extname(f);
    if (!['.html', '.css', '.js', '.svg', '.webmanifest'].includes(ext) && f !== 'sw.js' && f !== '_headers') continue;
    const body = text(f);
    for (const re of SECRETS) if (re.test(body)) add(`${f}: credential-like value or personal path`);
    if (ext === '.js' && f !== 'sw.js') {
      if (LOADS.test(body)) add(`${f}: requests a third-party URL`);
      continue;
    }
    for (const url of body.match(URL_RE) || []) {
      if (NAMESPACES.test(url) || (gateway && f === '_headers' && url.startsWith(gateway))) continue;
      add(`${f}: third-party URL ${url.slice(0, 60)}`);
    }
  }

  if (has('_headers')) {
    const headers = text('_headers');
    const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? '';
    const directive = name => new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp)?.[1].trim().split(/\s+/) ?? null;
    if (!csp) add('_headers has no Content-Security-Policy');
    if (!/default-src 'none'/.test(csp)) add("CSP must start from default-src 'none'");
    const script = directive('script-src');
    if (!script || script.join(' ') !== "'self'") add("CSP script-src must be 'self' only");
    const connect = directive('connect-src');
    const origins = (connect || []).filter(s => s !== "'self'");
    if (!connect || !connect.includes("'self'")) add("CSP connect-src must include 'self'");
    if (origins.length > 1 || origins.some(o => !/^https?:\/\/[^*/\s]+$/.test(o) || (gateway && o !== gateway))) add('CSP connect-src may name only the gateway origin');
    if (/[*]|unsafe-eval|data:\s*;?$/.test(directive('script-src')?.join(' ') ?? '')) add('CSP script-src is too open');
    if (!/frame-ancestors 'none'/.test(csp)) add("CSP must set frame-ancestors 'none'");
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = fileURLToPath(new URL('../dist/web', import.meta.url));
  const problems = checkWeb(dir, {gateway: process.env.CARDYBARA_GATEWAY_ORIGIN?.replace(/\/$/, '') || null});
  if (problems.length) { console.error('dist/web check failed:\n' + problems.map(p => '  ' + p).join('\n')); process.exit(1); }
  console.log(`dist/web ok: ${walk(dir).length} files`);
}
