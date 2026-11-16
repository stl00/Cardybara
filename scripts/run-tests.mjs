// `npm run test:refresh`: runs every tests/**/*.test.mjs except the few below, so a new test needs no list edit.
// Each excluded test names the npm script that runs it instead; the run fails if that script does not,
// so no test file is left collected by no script.
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const SEPARATE = {
  // Drive a real Chrome; CI runs them in their own step.
  'tests/dev-collector-chrome.test.mjs': 'test:collector-chrome',
  'tests/popup-layout.test.mjs': 'test:collector-chrome',
  // Agent model plumbing and multi-turn evals run with the agent evals.
  'tests/model-client.test.mjs': 'check:agent',
  'tests/agent-scripted-model.test.mjs': 'check:agent',
  'tests/multiturn-eval.test.mjs': 'check:agent',
  'tests/conversation-state.test.mjs': 'check:agent',
};

const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

export function allTests(base = root) {
  return walk(join(base, 'tests')).map(file => relative(base, file).split('\\').join('/'))
    .filter(file => file.endsWith('.test.mjs')).sort();
}

export function refreshTests(base = root) {
  return allTests(base).filter(file => !(file in SEPARATE));
}

export function testListProblems(base = root) {
  const scripts = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).scripts;
  const all = new Set(allTests(base));
  const problems = [];
  for (const [file, script] of Object.entries(SEPARATE)) {
    if (!all.has(file)) problems.push(`${file} is listed in scripts/run-tests.mjs but does not exist`);
    if (!scripts[script]?.split(/\s+/).includes(file)) problems.push(`${file} is excluded from test:refresh but npm script ${script} does not run it`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = testListProblems();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  const files = refreshTests();
  if (process.argv.includes('--list')) { console.log(files.join('\n')); process.exit(0); }
  const result = spawnSync(process.execPath, ['--test', ...files], {cwd: root, stdio: 'inherit'});
  process.exit(result.status ?? 1);
}
