// The web channel deploys itself (stl00/Cardybara#393, CLAUDE.md "One source, two channels"). These tests read
// .github/workflows/web-deploy.yml by indentation, like tests/ci-coverage.test.mjs, and fail when a red line breaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);
const workflow = readFileSync(new URL('web-deploy.yml', dir), 'utf8');

function jobs(text) {
  const out = {};
  let job = null;
  for (const line of text.slice(text.indexOf('\njobs:\n')).split('\n')) {
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) { job = out[head[1]] = {needs: [], env: null, if: null, text: ''}; continue; }
    if (!job) continue;
    job.text += line + '\n';
    const needs = /^ {4}needs: \[(.*)\]$/.exec(line);
    if (needs) job.needs = needs[1].split(',').map(s => s.trim());
    const env = /^ {4}environment: (.+)$/.exec(line);
    if (env) job.env = env[1].trim();
    const cond = /^ {4}if: (.+)$/.exec(line);
    if (cond) job.if = cond[1].trim();
  }
  return out;
}
const all = jobs(workflow);

test('no workflow uses pull_request_target', () => {
  for (const file of readdirSync(dir).filter(f => /\.ya?ml$/.test(f))) {
    const text = readFileSync(new URL(file, dir), 'utf8').split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    assert.ok(!text.includes('pull_request_target'), file);
  }
  assert.match(workflow, /^ {2}pull_request:\s*$/m);
});

test('production deploy needs the build and the web checks and runs only for main pushes', () => {
  const p = all.production;
  assert.deepEqual([...p.needs].sort(), ['build', 'web-tests']);
  assert.equal(p.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.ok(all['web-tests'].text.includes('npm run test:web'));
  assert.ok(all.build.text.includes('npm run build:web') && all.build.text.includes('npm run check:web'));
  assert.ok(!/continue-on-error/.test(workflow));
});

test('the preview is for pull requests of this repository only and needs the build', () => {
  const p = all.preview;
  assert.deepEqual(p.needs, ['build']);
  assert.match(p.if, /github\.event_name == 'pull_request'/);
  assert.match(p.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test('secrets are used only by jobs in the web environment', () => {
  for (const [id, job] of Object.entries(all)) {
    const uses = /secrets\./.test(job.text.replace(/secrets\.github_token/gi, ''));
    if (uses) assert.equal(job.env, 'web', id);
  }
  assert.equal(all.preview.env, 'web');
  assert.equal(all.production.env, 'web');
  for (const name of workflow.match(/secrets\.(\w+)/g)) assert.match(name, /secrets\.(CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID)$/);
  assert.ok(!/secrets:\s*inherit/.test(workflow));
  // Both deploy to the web project, never to the product site's.
  assert.equal([...workflow.matchAll(/--project-name (\S+)/g)].length, 2);
  for (const m of workflow.matchAll(/--project-name (\S+)/g)) assert.equal(m[1], 'cardybara-app');
});

test('wrangler is pinned like site.yml and every action is pinned by SHA', () => {
  const site = readFileSync(new URL('site.yml', dir), 'utf8');
  const pin = /wrangler@(\d+\.\d+\.\d+)/.exec(site)[1];
  const mine = [...workflow.matchAll(/(?:npx --yes )?wrangler(?:@(\S+))?/g)].filter(m => /wrangler@|npx/.test(m[0]));
  assert.ok(mine.length >= 2);
  for (const m of workflow.matchAll(/npx --yes wrangler@(\S+)/g)) assert.equal(m[1], pin);
  assert.ok(!/npx (?!--yes wrangler@)\S*wrangler/.test(workflow));
  const uses = [...workflow.matchAll(/^\s+- uses: (\S+)(.*)$/gm)];
  assert.ok(uses.length >= 6);
  for (const [, ref, rest] of uses) {
    assert.match(ref, /@[0-9a-f]{40}$/, ref);
    assert.match(rest, /# v\d/, ref);
  }
});

test('the token is not persisted by checkout and untrusted values reach shell only through env', () => {
  for (const [, block] of workflow.matchAll(/actions\/checkout@[^\n]*\n((?: {8}.*\n)+)/g)) assert.match(block, /persist-credentials: false/);
  for (const line of workflow.split('\n').filter(l => /^\s+run:/.test(l) || /^\s{10,}\S/.test(l))) {
    if (!line.includes('${{')) continue;
    assert.ok(!/github\.(head_ref|event\.pull_request\.(title|body|head\.ref))/.test(line), line);
  }
  assert.ok(!/run: .*\$\{\{ *(github\.event|secrets)/.test(workflow));
});

test('docs/RELEASE.md says how to roll back', () => {
  const doc = readFileSync(new URL('../docs/RELEASE.md', import.meta.url), 'utf8');
  assert.match(doc, /Web rollback/);
  assert.match(doc, /previous green commit/);
  assert.match(doc, /fixed forward/);
});
