// `node scripts/ci-part.mjs <npm script> <k>/<n>`: runs the k-th of the n commands an npm script chains with `&&`,
// so CI can run one long script as n parallel jobs without a second list of what the script contains.
// It refuses to run when the script does not have exactly n commands: a command added to the script fails CI
// until the workflow runs it too. tests/ci-coverage.test.mjs checks the same thing without running anything.
import {readFileSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const steps = command => command.split('&&').map(s => s.trim()).filter(Boolean);
export const npmRun = step => step.match(/^npm run ([\w:.-]+)$/)?.[1] ?? null;

// The commands a script runs, in order, with every plain `npm run x` replaced by what x runs.
export function leaves(name, scripts, seen = []) {
  if (!(name in scripts)) throw new Error(`no npm script named ${name}`);
  if (seen.includes(name)) throw new Error(`npm script ${name} runs itself`);
  return steps(scripts[name]).flatMap(step => npmRun(step) ? leaves(npmRun(step), scripts, [...seen, name]) : [step]);
}

export function part(name, spec, scripts) {
  const m = /^(\d+)\/(\d+)$/.exec(spec ?? '');
  if (!m) throw new Error('usage: node scripts/ci-part.mjs <npm script> <k>/<n>');
  const [k, n] = [Number(m[1]), Number(m[2])];
  const all = leaves(name, scripts);
  if (all.length !== n) throw new Error(`${name} runs ${all.length} commands but CI splits it in ${n}; update .github/workflows/ci.yml so each one runs:\n${all.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`);
  if (k < 1 || k > n) throw new Error(`part ${k} is outside 1..${n}`);
  return all[k - 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let command;
  try {
    command = part(process.argv[2], process.argv[3], JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts);
  } catch (error) { console.error(error.message); process.exit(1); }
  console.log(`> ${command}`);
  // Same lookup as `npm run`: local binaries first.
  const env = {...process.env, PATH: join(root, 'node_modules', '.bin') + delimiter + process.env.PATH};
  const result = spawnSync(command, {cwd: root, stdio: 'inherit', shell: true, env});
  process.exit(result.status ?? 1);
}
