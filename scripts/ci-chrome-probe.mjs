// TEMPORARY diagnostic (removed before merge): how long headless Chrome takes to answer its first CDP call on this
// machine, with which flags, and what it prints to stderr while it does.
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findChrome, SANDBOX_SAFE_ARGS} from './dev-collector/chrome-launcher.mjs';

const BASE = ['--remote-debugging-pipe', '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', ...SANDBOX_SAFE_ARGS];
const KEYRING = ['--password-store=basic', '--use-mock-keychain'];

async function once(extra, env = process.env) {
  const work = await mkdtemp(join(tmpdir(), 'probe-'));
  const t0 = Date.now();
  const child = spawn(await findChrome(), ['--user-data-dir=' + join(work, 'p'), ...BASE, ...extra, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env});
  let err = '';
  child.stderr.on('data', d => { err += `[+${Date.now() - t0}ms] ` + d; });
  const answer = new Promise(resolve => {
    let buf = '';
    child.stdio[4].on('data', d => { buf += d; if (buf.includes('\0')) resolve(Date.now() - t0); });
    setTimeout(() => resolve('>60000'), 60000);
  });
  child.stdio[3].write(JSON.stringify({id: 1, method: 'Target.createTarget', params: {url: 'about:blank'}}) + '\0');
  const ms = await answer;
  child.kill('SIGKILL');
  await rm(work, {recursive: true, force: true, maxRetries: 5}).catch(() => {});
  return {ms, err};
}

const variants = {
  base: [[], process.env],
  keyring: [KEYRING, process.env],
  noDbus: [[], {...process.env, DBUS_SESSION_BUS_ADDRESS: 'disabled:'}],
};
console.log('DBUS_SESSION_BUS_ADDRESS=' + process.env.DBUS_SESSION_BUS_ADDRESS);
for (const parallel of [1, 3]) {
  for (const [name, [extra, env]] of Object.entries(variants)) {
    const times = [];
    let slowest = {ms: -1};
    for (let rep = 0; rep < 4; rep++) {
      const runs = await Promise.all(Array.from({length: parallel}, () => once(extra, env)));
      for (const r of runs) { times.push(r.ms); if (r.ms === '>60000' || r.ms > slowest.ms) slowest = r; }
    }
    console.log(`${name} x${parallel}: ${times.join(' ')}`);
    console.log('  slowest stderr:\n' + slowest.err.split('\n').slice(0, 25).map(l => '    ' + l).join('\n'));
  }
}
