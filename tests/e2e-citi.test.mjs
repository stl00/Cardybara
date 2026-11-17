// The Citi US E2E step (stl00/Cardybara#486) offers Citi US in the extracted package copy when the shipped bank
// list leaves it out, and the synthetic Citi page carries a www sign-in over to online.citi.com.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CITI_HOSTS,offerCiti} from '../scripts/e2e-extension.mjs';

const scope = banks => `export const BUILD_BANKS=${JSON.stringify(banks)};\nexport const BUILD_SCOPE="cardybara-scope:x";\n`;
async function offered(banks) {
  const dir = await mkdtemp(join(tmpdir(), 'cardybara-citi-'));
  try {
    await writeFile(join(dir, 'build-scope.js'), scope(banks));
    await offerCiti(dir);
    return await readFile(join(dir, 'build-scope.js'), 'utf8');
  } finally { await rm(dir, {recursive: true, force: true}); }
}

test('a bank list without Citi US gets it added, and nothing else changes', async () => {
  assert.equal(await offered(['Chase', 'Amex US']), scope(['Chase', 'Amex US', 'Citi US']));
});

test('a list that has Citi US, or offers every bank, is left as it is', async () => {
  assert.equal(await offered(['Chase', 'Citi US']), scope(['Chase', 'Citi US']));
  assert.equal(await offered(null), scope(null));
});

test('both Citi hosts are served the synthetic Citi page, and www hands the sign-in to online', async () => {
  assert.deepEqual(CITI_HOSTS, ['www.citi.com', 'online.citi.com']);
  const page = await readFile(new URL('./fixtures/synthetic-citi.html', import.meta.url), 'utf8');
  assert.match(page, /https:\/\/online\.citi\.com\/US\/ag\/dashboard\/summary\?synthetic-signed-in=1/);
  assert.match(page, /q\.get\('synthetic-signed-in'\)==='1'/);
});
