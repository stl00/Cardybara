// Build-time check for the split translation catalog in src/i18n/.
// Fails when a key appears in more than one file, or a file is not imported by src/i18n/index.js.
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');

export function catalogProblems(dir = defaultDir) {
  const problems = [];
  const names = readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  const index = readFileSync(join(dir, 'index.js'), 'utf8');
  const imported = new Set([...index.matchAll(/from '\.\/([\w-]+\.json)'/g)].map(m => m[1]));
  for (const name of names) if (!imported.has(name)) problems.push(`src/i18n/${name} is not imported by src/i18n/index.js`);
  for (const name of imported) if (!names.includes(name)) problems.push(`src/i18n/index.js imports missing ${name}`);
  const owner = {};
  for (const name of names) {
    const file = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    for (const [language, entries] of Object.entries(file)) for (const key of Object.keys(entries)) {
      const seen = (owner[language] ??= {})[key];
      if (seen) problems.push(`${language} key ${JSON.stringify(key)} is in both ${seen} and ${name}`);
      else owner[language][key] = name;
    }
  }
  return problems;
}

export function i18nCatalogPlugin() {
  return {
    name: 'cardybara-i18n-catalog',
    buildStart() {
      const problems = catalogProblems();
      if (problems.length) this.error(`Translation catalog problems:\n${problems.join('\n')}`);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = catalogProblems();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('src/i18n catalog: no duplicate keys, every file imported');
}
