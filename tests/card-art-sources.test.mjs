import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cardProducts} from '../src/productCatalog.js';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url));
const overrides=JSON.parse(read('src/data/card-product-overrides.json'));
const sources=JSON.parse(read('public/card-art-sources.json')),notes=read('public/ASSET-SOURCES.md').toString();
// Hosts each issuer publishes its product pages and card images on. Art from any other host is not issuer art.
const issuerHosts={
 'Amex US':{page:['www.americanexpress.com'],image:['icm.aexp-static.com']},
 'Amex HK':{page:['www.americanexpress.com'],image:['icm.aexp-static.com']},
 'Amex CA':{page:['www.americanexpress.com'],image:['icm.aexp-static.com']},
 'Citi US':{page:['www.citi.com'],image:['aemapi.citi.com']},
 'Capital One':{page:['www.capitalone.com'],image:['ecm.capitalone.com']},
 // Discover is part of Capital One; its own page serves card art from Capital One's content host.
 'Discover':{page:['www.discover.com'],image:['ecm.capitalone.com']},
 'U.S. Bank':{page:['www.usbank.com'],image:['www.usbank.com']},
 'Wells Fargo':{page:['creditcards.wellsfargo.com'],image:['creditcards.wellsfargo.com']},
 'BOA':{page:['www.bankofamerica.com'],image:['www.bankofamerica.com']},
 'HSBC HK':{page:['www.hsbc.com.hk'],image:['www.hsbc.com.hk']},
 'SC HK':{page:['www.sc.com'],image:['www.sc.com']},
 'Bilt':{page:['www.bilt.com'],image:['img.bilt.com']},
};
const magic={png:[0x89,0x50,0x4e,0x47],jpg:[0xff,0xd8,0xff]};
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
  // A catalogue rebuild applies only the overrides, so sourced art must be there too.
  assert.deepEqual(overrides.find(o=>o.id===p.id)?.art,a,`${p.id}: card-product-overrides.json`);
  assert.equal(sources[a.file],a.sourceUrl,`${p.id}: card-art-sources.json`);
  assert.ok(notes.split('\n').some(l=>l.includes(`assets/${a.file} `)&&l.includes(a.pageUrl)&&l.includes(a.sourceUrl)),`${p.id}: ASSET-SOURCES.md row`);
  const [stem,ext]=a.file.split('.');assert.equal(stem,`catalog-${createHash('sha256').update(a.sourceUrl).digest('hex').slice(0,16)}`,`${p.id}: file name`);assert.ok(magic[ext],`${p.id}: ${ext}`);
  const file=new URL(`../public/assets/${a.file}`,import.meta.url);assert.ok(existsSync(file),p.id);
  assert.deepEqual([...readFileSync(file).subarray(0,magic[ext].length)],magic[ext],`${p.id}: ${ext} bytes`);
 }
});
test('no product borrows another product\'s sourced art',()=>{
 const files=sourced.map(p=>p.art.file),images=sourced.map(p=>p.art.sourceUrl);
 assert.equal(new Set(files).size,files.length);assert.equal(new Set(images).size,images.length);
});
