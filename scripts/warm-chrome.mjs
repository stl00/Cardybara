// Starts headless Chrome once and waits for its first DevTools answer, before the browser tests start several Chromes in
// parallel. On a fresh CI runner the first start reads the browser from a cold disk: 8 s alone, and 15-35 s when three
// test files start Chrome at the same moment, which crossed the tests' 30 s per-call limit (#518). Later starts take
// well under a second. Run: node scripts/warm-chrome.mjs
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findChrome, SANDBOX_SAFE_ARGS} from './dev-collector/chrome-launcher.mjs';

const LIMIT_MS = 120000;

export async function warmChrome({limitMs = LIMIT_MS} = {}) {
  const chrome = await findChrome().catch(() => null);
  if (!chrome) return {skipped: 'no Chrome on this machine'};
  const work = await mkdtemp(join(tmpdir(), 'cardybara-warm-'));
  const t0 = Date.now();
  const child = spawn(chrome, ['--user-data-dir=' + join(work, 'profile'), '--remote-debugging-pipe', '--headless=new', '--no-first-run', '--no-default-browser-check', ...SANDBOX_SAFE_ARGS, 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']});
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`Chrome gave no DevTools answer in ${limitMs / 1000} s`)), limitMs);
      const done = f => v => { clearTimeout(timer); f(v); };
      child.on('error', done(reject));
      child.on('exit', code => done(reject)(Error(`Chrome exited (${code}) before answering`)));
      for (const pipe of [child.stdio[3], child.stdio[4]]) pipe.on('error', e => done(reject)(Error('pipe closed (' + e.message + ')')));
      child.stdio[4].on('data', d => { if (d.includes(0)) done(resolve)({ms: Date.now() - t0}); });
      child.stdio[3].write(JSON.stringify({id: 1, method: 'Browser.getVersion'}) + '\0');
    });
  } finally {
    child.removeAllListeners('exit');
    child.kill('SIGKILL');
    await rm(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}).catch(() => {});
  }
}

// Same rule as the phone tests: a Chrome that cannot start here skips them locally, but must fail the build on GitHub Actions.
const r = await warmChrome().catch(err => {
  if (process.env.GITHUB_ACTIONS) throw err;
  return {skipped: 'Chrome found but cannot start here (' + err.message + '); the browser tests will skip'};
});
console.log(r.skipped ? `warm-chrome: skipped, ${r.skipped}` : `warm-chrome: first DevTools answer after ${r.ms} ms`);
