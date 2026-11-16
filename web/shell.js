// Web build only (npm run build:web): runs before the wallet starts. It gives the wallet its empty built-in seed in
// place of the /data.json the local server and the extension supply, asks the browser to keep the wallet's storage,
// and registers the service worker that caches the app shell. Nothing here talks to another origin.
import seed from '../public/data.example.json' with {type: 'json'};

export const PERSIST_KEY = 'cardybara-web-storage-persist';

// A copy per call: the wallet may change what it gets back.
export function seedResponse() {
  return new Response(JSON.stringify(seed), {status: 200, headers: {'content-type': 'application/json'}});
}

export function isSeedRequest(input, base = globalThis.location?.href) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
    const url = new URL(raw, base);
    return url.origin === new URL(base).origin && url.pathname === '/data.json';
  } catch { return false; }
}

export function installSeed(target = globalThis) {
  const real = target.fetch?.bind(target);
  target.fetch = (input, init) => isSeedRequest(input, target.location?.href) ? Promise.resolve(seedResponse()) : real(input, init);
}

// Called on every load until the browser says yes, so a later visit can still be granted; the answer is kept for the
// settings page (a wallet that is not persistent can be evicted by the browser under storage pressure).
export async function recordPersistence(nav = globalThis.navigator, store = globalThis.localStorage) {
  let persisted = null;
  try {
    if (!nav?.storage?.persist) persisted = 'unsupported';
    else if (await nav.storage.persisted?.()) persisted = true;
    else persisted = await nav.storage.persist();
  } catch { persisted = 'error'; }
  try {
    const before = JSON.parse(store?.getItem(PERSIST_KEY) || 'null');
    if (before?.persisted !== true || persisted === true) store?.setItem(PERSIST_KEY, JSON.stringify({persisted, checkedAt: new Date().toISOString()}));
  } catch { /* storage unavailable: the wallet still runs */ }
  return persisted;
}

export function registerServiceWorker(nav = globalThis.navigator) {
  if (!nav?.serviceWorker) return null;
  return nav.serviceWorker.register('/sw.js', {scope: '/'}).catch(() => null);
}

if (typeof window !== 'undefined' && !globalThis.__CARDYBARA_WEB_TEST__) {
  installSeed();
  recordPersistence();
  window.addEventListener('load', () => registerServiceWorker());
}
