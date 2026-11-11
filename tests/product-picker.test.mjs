import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {translations as i18nCatalog} from '../src/i18n/index.js';
import {cardProducts} from '../src/productCatalog.js';
import {productDisplayName} from '../src/cardName.js';
import {PICKER_BANKS,brandTerms,groupEntries,highlightRanges,isBusinessProduct,matchedVia,normalizeSearch,pickerEntries} from '../src/productPicker.js';

const products=cardProducts.filter(p=>PICKER_BANKS.includes(p.bank));
const entries=pickerEntries(products,p=>productDisplayName(p.id,'zh-CN')||p.name);
const ids=(query,opts={})=>groupEntries(entries,{query,...opts}).flatMap(g=>g.items.map(e=>e.id));
const first=query=>ids(query)[0];

test('the picker lists Chase, then Amex US, then the other MVP banks, never an archived one',()=>{
 assert.deepEqual(PICKER_BANKS.slice(0,2),['Chase','Amex US']);
 assert.ok(!PICKER_BANKS.includes('Amex CA'));
 const groups=groupEntries(entries).map(g=>g.bank);
 assert.deepEqual(groups,PICKER_BANKS.filter(b=>products.some(p=>p.bank===b)));
 assert.equal(groups.length,new Set(groups).size);
});

test('without a query each bank lists personal cards before business ones, by name',()=>{
 for(const group of groupEntries(entries)){
  const flags=group.items.map(e=>e.business);
  assert.deepEqual(flags,[...flags].sort((a,b)=>a-b),group.bank);
  for(const part of [false,true]){const names=group.items.filter(e=>e.business===part).map(e=>e.label);assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)),group.bank);}
 }
 assert.ok(isBusinessProduct({name:'Ink Business Cash Credit Card'}));
 assert.ok(isBusinessProduct({name:'American Express Gold Corporate Card'}));
 assert.ok(!isBusinessProduct({name:'Sapphire Reserve'}));
});

test('search matches aliases, ignoring case and spacing',()=>{
 assert.equal(first('csr'),'chase-us-sapphire-reserve');
 assert.equal(first('CSR'),'chase-us-sapphire-reserve');
 for(const q of ['sapphire reserve','  SAPPHIRE    reserve ','sapphirereserve','Sapphire-Reserve'])assert.equal(first(q),'chase-us-sapphire-reserve',q);
 assert.ok(ids('sapphire reserve').includes('chase-us-sapphire-reserve-for-business-credit-card'));
 // Words in any order, each found somewhere.
 assert.equal(first('cash ink'),'chase-us-ink-business-cash-credit-card');
 assert.deepEqual(ids('no such card zzz'),[]);
 // A short query never matches across words, and an exact bank or region name leads.
 assert.ok(first('sc').startsWith('sc-hk-'),first('sc'));
 assert.ok(!ids('aa').includes('chase-us-air-canada-aeroplan-card'));
 assert.ok(['Chase','Amex US','BOA','Citi US'].includes(groupEntries(entries,{query:'美国'})[0].bank));
});

test('co-brands are found by brand, in English and Chinese, across banks',()=>{
 const marriott=ids('Marriott');
 assert.ok(marriott.length>=5);
 assert.ok(marriott.every(id=>/marriott/.test(id)),marriott.join());
 assert.ok(marriott.some(id=>id.startsWith('chase-'))&&marriott.some(id=>id.startsWith('amex-us-')));
 for(const q of ['万豪','萬豪','bonvoy'])assert.deepEqual(ids(q),marriott,q);
 const delta=ids('delta');
 assert.ok(delta.length>=5&&delta.every(id=>/delta/.test(id)));
 assert.deepEqual(ids('达美'),delta);assert.deepEqual(ids('達美'),delta);
 assert.ok(ids('凯悦').every(id=>/hyatt/.test(id))&&ids('凯悦').length>=2);
 assert.ok(brandTerms(products.find(p=>p.id==='chase-us-marriott-bonvoy-boundless-credit-card')).includes('万豪'));
 // A brand is a whole word: "Unlimited" is not United, and Sapphire has no co-brand.
 assert.ok(!ids('united').includes('chase-us-freedom-unlimited'));
 assert.ok(!ids('美联航').includes('chase-us-freedom-unlimited'));
 assert.ok(ids('united').every(id=>/united/.test(id)),'not every US card');
 // A region is a whole word: "香港" or "hk" lists Hong Kong cards only.
 assert.ok(ids('香港').length>0&&ids('香港').every(id=>/-hk-/.test(id)));
 assert.deepEqual(brandTerms(products.find(p=>p.id==='chase-us-sapphire-reserve')),[]);
});

test('Chinese product names and issuer names find cards, in either script',()=>{
 assert.equal(first('美國運通白金卡'),'amex-hk-hk-the-platinum-card');
 assert.equal(first('美国运通白金卡'),'amex-hk-hk-the-platinum-card');
 assert.ok(ids('滙豐').length>0&&ids('滙豐').every(id=>id.startsWith('hsbc-hk-')));
 assert.deepEqual(ids('汇丰'),ids('滙豐'));
 assert.ok(ids('大通').length>0&&ids('大通').every(id=>id.startsWith('chase-')));
});

test('with a query the best match comes first, and its bank group leads',()=>{
 const groups=groupEntries(entries,{query:'brilliant'});
 assert.equal(groups[0].bank,'Amex US');
 assert.equal(groups[0].items[0].id,'amex-us-us-marriott-bonvoy-brilliant-card');
 // An exact name beats a longer name that contains it.
 assert.equal(first('Sapphire Reserve'),'chase-us-sapphire-reserve');
 // Filters narrow without changing the order rules.
 assert.ok(ids('',{bank:'Amex US'}).every(id=>id.startsWith('amex-us-')));
 assert.ok(ids('',{type:'business'}).every(id=>isBusinessProduct(products.find(p=>p.id===id))));
 assert.ok(ids('',{type:'personal'}).every(id=>!isBusinessProduct(products.find(p=>p.id===id))));
 // Pinned tiles (an AI suggestion, near matches) come first in their group.
 const chase=entries.filter(e=>e.bank==='Chase');
 assert.equal(groupEntries(chase,{pinned:['chase-us-world-of-hyatt-credit-card']})[0].items[0].id,'chase-us-world-of-hyatt-credit-card');
});

test('highlights follow the same matching as the search',()=>{
 assert.deepEqual(highlightRanges('Chase Sapphire Reserve','sapphirereserve'),[[6,22]]);
 assert.deepEqual(highlightRanges('Chase Sapphire Reserve','reserve SAPPHIRE'),[[6,14],[15,22]]);
 assert.deepEqual(highlightRanges('美國運通白金卡','运通'),[[2,4]]);
 assert.deepEqual(highlightRanges('Gold Card',''),[]);
 assert.equal(normalizeSearch(' Ｃｓｒ® '),'csr');
 const marriott=entries.find(e=>e.id==='chase-us-marriott-bonvoy-bold-credit-card');
 assert.equal(matchedVia(marriott,'万豪'),'万豪');
 assert.equal(matchedVia(marriott,'marriott'),null,'the shown name already matches');
 const zh=pickerEntries(products.filter(p=>p.id==='amex-hk-hk-the-platinum-card'),p=>productDisplayName(p.id,'zh-CN'))[0];
 assert.equal(matchedVia(zh,'the platinum'),'The Platinum Card','an English name shows why a Chinese tile matched');
});

test('the panel shows only a product\'s own art, and its strings exist in three languages',()=>{
 const panel=readFileSync(new URL('../src/ProductPickerPanel.jsx',import.meta.url),'utf8');
 assert.match(panel,/product\.art\?\.file&&!broken\?<ArtImage art=\{product\.art\}/);
 const catalog=i18nCatalog;
 for(const file of ['ProductPickerPanel.jsx','WalletOnboarding.jsx','CardProductPicker.jsx'])for(const [,key] of readFileSync(new URL('../src/'+file,import.meta.url),'utf8').matchAll(/\bt\('([^']+)'/g))for(const l of ['en-US','zh-TW'])assert.ok(catalog[l][key],`${file} ${l}: ${key}`);
});
