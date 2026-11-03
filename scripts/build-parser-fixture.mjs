// Generates a synthetic, local-only DOM integration fixture; contains no bank data.
import fs from 'node:fs';
const dir=new URL('../dist/debug-parser/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
for(const f of ['reader.js','agent-snapshot.js','agent-core.js','bank-adapters.js','coverage.js'])fs.copyFileSync(new URL('../extension-next/'+f,import.meta.url),new URL(f,dir));
fs.copyFileSync(new URL('../tests/browser/hsbc-fixture.html',import.meta.url),new URL('index.html',dir));
fs.copyFileSync(new URL('../tests/browser/amex-hk-fixture.html',import.meta.url),new URL('amex-hk.html',dir));
fs.copyFileSync(new URL('../tests/browser/amex-hk-data-fixture.html',import.meta.url),new URL('amex-hk-data.html',dir));
fs.copyFileSync(new URL('../tests/browser/amex-lazy-offers-fixture.html',import.meta.url),new URL('amex-lazy-offers.html',dir));
console.log('http://127.0.0.1:8766/debug-parser/index.html');

fs.copyFileSync(new URL('../tests/browser/chase-fixture.html',import.meta.url),new URL('chase.html',dir));
