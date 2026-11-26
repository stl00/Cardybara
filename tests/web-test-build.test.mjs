// `npm run test:refresh` runs its files in parallel and CI starts it without dist/web. A file that builds straight into that
// shared directory empties it while another file is serving it (the phone then shows Chrome's error page), so every such file
// takes its build from tests/helpers/web-test-build.mjs, which builds a cold copy into its own temporary directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {refreshTests} from '../scripts/run-tests.mjs';

test('no parallel test:refresh file builds into the shared dist/web', () => {
  const offenders = refreshTests().filter(file =>
    /spawnSync\('npm',\s*\['run',\s*'build:web'\]/.test(readFileSync(fileURLToPath(new URL('../' + file, import.meta.url)), 'utf8')));
  assert.deepEqual(offenders, []);
});
