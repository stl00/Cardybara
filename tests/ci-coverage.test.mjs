// CI runs `npm run check:release` as parallel jobs (stl00/Cardybara#237). Local and CI must run the same set:
// these tests fail when a step of check:release is run by no CI job, or when the one required status
// (`Verify and package`) does not wait for a job that runs one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {leaves, npmRun, part, steps} from '../scripts/ci-part.mjs';

const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
// What the old single job ran in a row.
const GATE = [...steps(scripts['check:release']).map(npmRun), 'test:collector-chrome'];

// The workflow is plain enough to read by indentation: jobs at two spaces, one-line `run:` commands.
function jobs(text) {
  const out = {};
  let job = null;
  for (const line of text.slice(text.indexOf('\njobs:\n')).split('\n')) {
    const head = /^ {2}([\w-]+):\s*$/.exec(line);
    if (head) { job = out[head[1]] = {runs: [], needs: [], parts: [], name: null, always: false}; continue; }
    if (!job) continue;
    const run = /^\s+(?:- )?run: (?!\|)(.+)$/.exec(line);
    if (run) job.runs.push(run[1].trim());
    const needs = /^ {4}needs: (.+)$/.exec(line);
    if (needs) job.needs = needs[1].replace(/[[\]]/g, '').split(',').map(s => s.trim());
    const name = /^ {4}name: (.+)$/.exec(line);
    if (name) job.name = name[1].trim();
    const parts = /^\s+part: \[(.+)\]$/.exec(line);
    if (parts) job.parts = parts[1].split(',').map(s => Number(s.trim()));
    if (/^ {4}if: always\(\)$/.test(line)) job.always = true;
  }
  return out;
}

// Which job runs each gate step in full; a problem line for each step that none does.
function coverage(text) {
  const all = jobs(text), ranBy = {}, problems = [];
  for (const step of GATE) {
    for (const [id, job] of Object.entries(all)) {
      const split = job.runs.map(r => /^node scripts\/ci-part\.mjs (\S+) \$\{\{ matrix\.part \}\}\/(\d+)$/.exec(r)).find(m => m?.[1] === step);
      const whole = job.runs.includes(`npm run ${step}`);
      const n = leaves(step, scripts).length;
      const everyPart = split && Number(split[2]) === n && job.parts.length === n && job.parts.every((p, i) => p === i + 1);
      if (whole || everyPart) ranBy[step] = id;
      else if (split) problems.push(`${id} splits ${step} in ${split[2]} with parts [${job.parts}] but it has ${n} commands`);
    }
    if (!ranBy[step]) problems.push(`no CI job runs ${step}`);
  }
  return {all, ranBy, problems};
}

test('every step of check:release, and the Chrome collector test, is run by a CI job', () => {
  assert.ok(GATE.every(Boolean), 'check:release is a chain of plain `npm run` steps');
  assert.deepEqual(coverage(workflow).problems, []);
});

test('a dropped step, a missing part or an extra command is reported', () => {
  const without = (text, line) => { assert.ok(text.includes(line), line); return text.replace(line, ''); };
  assert.deepEqual(coverage(without(workflow, '      - run: npm run check:fixtures\n')).problems, ['no CI job runs check:fixtures']);
  assert.deepEqual(coverage(without(workflow, '      - run: npm run test:collector-chrome\n')).problems, ['no CI job runs test:collector-chrome']);
  assert.match(coverage(workflow.replace('part: [1, 2, 3, 4]', 'part: [1, 2, 3]')).problems.join(), /no CI job runs check:agent/);
  const longer = {...scripts, 'check:agent': scripts['check:agent'] + ' && node extra.mjs'};
  assert.throws(() => part('check:agent', '1/4', longer), /runs 5 commands but CI splits it in 4/);
});

test('a split script runs each of its commands once, nested scripts included', () => {
  const all = leaves('check:agent', scripts);
  assert.deepEqual(all.map((_, i) => part('check:agent', `${i + 1}/${all.length}`, scripts)), all);
  assert.ok(all.includes(scripts['check:agent:cloud']), 'the nested cloud check is one of the commands');
  assert.ok(all.every(c => !npmRun(c)));
  assert.throws(() => part('check:agent', `0/${all.length}`, scripts), /outside/);
  assert.throws(() => leaves('missing', scripts), /no npm script/);
  assert.throws(() => leaves('a', {a: 'npm run b', b: 'npm run a'}), /runs itself/);
});

test('the package audit and the dev parity check run after the build, in the job that uploads the package', () => {
  const {all, ranBy} = coverage(workflow);
  const runs = all[ranBy['build:release']].runs;
  for (const step of ['check:release-package', 'check:dev-parity']) {
    assert.equal(ranBy[step], ranBy['build:release']);
    assert.ok(runs.indexOf(`npm run ${step}`) > runs.indexOf('npm run build:release'), step);
  }
  assert.deepEqual(all.e2e.needs, [ranBy['build:release']], 'E2E waits only for the package it tests');
});

test('the one required status waits for every part and fails when a part did not pass', () => {
  const {all, ranBy} = coverage(workflow);
  const gate = Object.values(all).filter(job => job.name === 'Verify and package');
  assert.equal(gate.length, 1);
  assert.deepEqual([...gate[0].needs].sort(), [...new Set(Object.values(ranBy))].sort());
  assert.ok(gate[0].always, 'a skipped required check would count as passing');
  assert.match(workflow, /RESULTS: \$\{\{ join\(needs\.\*\.result, ' '\) \}\}/);
  assert.match(workflow, /if \[ "\$result" != success \]; then .*exit 1; fi/);
  assert.ok(all['draft-release'].needs.includes('verify') && all['draft-release'].needs.includes('e2e'));
});

test('CI runs no npm script that does not exist', () => {
  for (const job of Object.values(jobs(workflow))) for (const run of job.runs) {
    const name = npmRun(run);
    if (name) assert.ok(name in scripts, name);
  }
});
