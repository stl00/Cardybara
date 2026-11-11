import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {cardProducts} from '../src/productCatalog.js';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url));
const sources=JSON.parse(read('public/card-art-sources.json')),notes=read('public/ASSET-SOURCES.md').toString();
// Hosts each issuer publishes its product pages and card images on. Art from any other host is not issuer art.
const issuerHosts={
 'Amex US':{page:['www.americanexpress.com'],image:['icm.aexp-static.com']},
};
const host=u=>new URL(u).host;
const sourced=cardProducts.filter(p=>p.art?.pageUrl);
test('art with a recorded page comes from that issuer, with a date, terms and a local file',()=>{
 assert.ok(sourced.length>0);
 for(const p of sourced){const a=p.art,hosts=issuerHosts[p.bank];
  assert.ok(hosts,`${p.id}: no issuer hosts recorded for ${p.bank}`);
  assert.equal(a.verification,'issuer-asset',p.id);
  assert.ok(hosts.page.includes(host(a.pageUrl)),`${p.id}: page ${a.pageUrl}`);
  assert.ok(hosts.image.includes(host(a.sourceUrl)),`${p.id}: image ${a.sourceUrl}`);
  assert.match(a.checkedAt,/^\d{4}-\d{2}-\d{2}$/,p.id);
  assert.ok(['requires-permission','unverified'].includes(a.terms),p.id);
  assert.ok(a.foundIn,p.id);
  assert.equal(sources[a.file],a.sourceUrl,`${p.id}: card-art-sources.json`);
  assert.ok(notes.includes(a.file)&&notes.includes(a.pageUrl),`${p.id}: ASSET-SOURCES.md`);
  const file=new URL(`../public/assets/${a.file}`,import.meta.url);assert.ok(existsSync(file),p.id);
  assert.deepEqual([...readFileSync(file).subarray(0,4)],[0x89,0x50,0x4e,0x47],`${p.id}: PNG`);
 }
});
test('no product borrows another product\'s sourced art',()=>{
 const files=sourced.map(p=>p.art.file),images=sourced.map(p=>p.art.sourceUrl);
 assert.equal(new Set(files).size,files.length);assert.equal(new Set(images).size,images.length);
});
