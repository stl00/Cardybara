// The web channel deploys itself (stl00/Cardybara#393, CLAUDE.md "One source, two channels"). These tests read
// .github/workflows/web-deploy.yml by indentation, like tests/ci-coverage.test.mjs, and fail when a red line breaks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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

function stepScript(job, name) {
  const step = job.text.split(/^ {6}- /m).find(s => s.startsWith(`name: ${name}\n`));
  assert.ok(step, name);
  return step.split('        run: |\n')[1].replace(/^ {10}/gm, '');
}

function shell(script, {cwd, env} = {}) {
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
    cwd, env: {...process.env, ...env}, encoding: 'utf8',
  });
  assert.ifError(result.error);
  return result;
}

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

test('missing credentials fail production and skip previews', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'cardybara-deploy-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const output = join(cwd, 'github-output');
  const production = stepScript(all.production, 'Check Cloudflare secrets');
  const preview = stepScript(all.preview, 'Check Cloudflare secrets');
  for (const [token, account] of [['', ''], ['test-token', ''], ['', 'test-account'], ['test-token', 'test-account']]) {
    writeFileSync(output, '');
    const env = {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, GITHUB_OUTPUT: output};
    const configured = Boolean(token && account);
    assert.equal(shell(production, {env}).status, configured ? 0 : 1);
    const result = shell(preview, {env});
    assert.equal(result.status, 0);
    assert.equal(readFileSync(output, 'utf8'), `configured=${configured}\n`);
  }
});

test('production verifies the entry bundle from the public homepage and checks its content', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'cardybara-deploy-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  mkdirSync(join(cwd, 'dist/web/assets'), {recursive: true});
  const page = '<script type="module" crossorigin src="/assets/index-current.js"></script>';
  const bundle = 'console.log("current build");';
  writeFileSync(join(cwd, 'dist/web/index.html'), page);
  writeFileSync(join(cwd, 'dist/web/assets/index-current.js'), bundle);
  assert.match(all.production.text, /name: Verify the production bundle\n {8}shell: bash/);
  assert.ok(all.production.text.indexOf('name: Deploy to Cloudflare Pages') < all.production.text.indexOf('name: Verify the production bundle'));
  const mockPages = `
    curl() {
      case "\${@: -1}" in
        https://cardybara.dev/\\?*-1) printf '%s' "\${PAGES_FIRST_INDEX:-$PAGES_INDEX}" ;;
        https://cardybara.dev/\\?*) printf '%s' "$PAGES_INDEX" ;;
        https://cardybara.dev/assets/index-current.js\\?*) printf '%s' "$PAGES_BUNDLE"; return "$PAGES_STATUS" ;;
        *) return 1 ;;
      esac
    }
    sleep() { :; }
  `;
  const smoke = mockPages + stepScript(all.production, 'Verify the production bundle');
  const check = (index, body, status = '0', firstIndex = '') => shell(smoke, {cwd, env: {PAGES_INDEX: index, PAGES_BUNDLE: body, PAGES_STATUS: status, PAGES_FIRST_INDEX: firstIndex}});
  const stale = page.replace('index-current', 'index-old');
  const verified = check(page, bundle);
  assert.equal(verified.status, 0, verified.stderr + verified.stdout);
  assert.match(verified.stdout, /Verified .* on cardybara\.dev/);
  assert.equal(check(page, bundle, '0', stale).status, 0);
  assert.equal(check(stale, bundle).status, 1);
  assert.equal(check(page, 'different bundle').status, 1);
  assert.equal(check(page, bundle, '22').status, 1);
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
