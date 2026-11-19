import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WEB_DIR} from '../../scripts/web-chrome.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const newest = dir => readdirSync(dir, {withFileTypes: true}).reduce((time, entry) => {
  const path = join(dir, entry.name);
  return Math.max(time, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
}, 0);

export function prepareWebTestBuild() {
  const index = statSync(join(WEB_DIR, 'index.html'), {throwIfNoEntry: false});
  const worker = statSync(join(WEB_DIR, 'sw.js'), {throwIfNoEntry: false});
  const sourceTime = Math.max(newest(join(root, 'src')), statSync(join(root, 'index.html')).mtimeMs);
  if (index?.mtimeMs >= sourceTime && worker?.mtimeMs >= index.mtimeMs) {
    return WEB_DIR;
  }

  // Account test files run in parallel. A cold build must never empty a directory another test is serving.
  const dir = mkdtempSync(join(tmpdir(), 'cardybara-test-web-'));
  process.once('exit', () => rmSync(dir, {recursive: true, force: true}));
  const built = spawnSync('npm', ['run', 'build:web', '--', '--outDir', dir], {cwd: root, encoding: 'utf8'});
  assert.ifError(built.error);
  assert.equal(built.status, 0, 'npm run build:web failed:\n' + built.stdout.slice(-2000) + built.stderr.slice(-2000));
  return dir;
}
