import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {logoRegistry as registry,identifyBrand,logoForRule,logoForRuleId,logoForProgramme,logoForEarning,logoForText} from '../src/logoRegistry.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const json=p=>JSON.parse(read(p));
const rules=json('src/data/knowledge/rules.json'),programmes=json('src/data/knowledge/entities.json').programmes;
const taxonomy=json('src/data/knowledge/taxonomy.json');
const logosDir=new URL('../public/brand/logos/',import.meta.url);
test('every knowledge programme maps to exactly one registry brand',()=>{
 const seen=registry.brands.flatMap(b=>b.programmeIds);
 assert.equal(new Set(seen).size,seen.length,'programme mapped twice');
 assert.deepEqual([...seen].filter(id=>!programmes.some(p=>p.id===id)),[],'dangling programme');
 assert.deepEqual(programmes.map(p=>p.id).filter(id=>!seen.includes(id)),[],'unmapped programme');
});
test('registry references only known categories',()=>{
 const known=Object.keys(registry.categories);
 for(const b of registry.brands)assert.ok(known.includes(b.category),b.id);
 for(const id of [...Object.values(registry.scenarioCategories),...Object.values(registry.earningLabels),...Object.values(registry.ruleOverrides)])assert.ok(known.includes(id),id);
 assert.deepEqual(taxonomy.scenarios.map(s=>s.id).filter(id=>!registry.scenarioCategories[id]),[]);
 for(const id of [...Object.keys(registry.ruleOverrides),...registry.ruleNoBrand])assert.ok(rules.some(r=>r.id===id),id);
});
test('a logo ships only with approval, a local file and a source',()=>{
 const files=existsSync(logosDir)?readdirSync(logosDir,{recursive:true}):[];
 for(const b of registry.brands){
  assert.ok(['approved','unapproved'].includes(b.status),b.id);
  assert.ok(['requires-permission','unverified'].includes(b.terms),b.id);
  assert.ok(b.finding&&b.checkedAt,b.id);
  if(b.status==='approved'){assert.match(b.logo,/^brand\/(?:logos|banks)\/[a-z0-9-]+\.(?:svg|png|ico)$/,b.id);assert.ok(existsSync(new URL('../public/'+b.logo,import.meta.url)),b.id);assert.ok(b.source&&b.approval,b.id);}
  else assert.equal(b.logo,null,b.id);
 }
 const used=registry.brands.filter(b=>b.logo?.startsWith('brand/logos/')).map(b=>b.logo.split('/').at(-1));
 assert.deepEqual(files.filter(f=>!used.includes(f)),[],'unregistered logo file bundled');
 for(const file of files){
  const bytes=readFileSync(new URL(file,logosDir));
  assert.ok(bytes.length<=16*1024,`${file} is too large`);
  if(file.endsWith('.svg'))assert.doesNotMatch(bytes.toString(),/<script|<foreignObject|\son\w+=|href=["']?https?:/i,file);
 }
});
test('brands resolve to their local logo, and to the category when not approved',()=>{
 const dash=logoForRuleId('rule.chase-us-sapphire-reserve.doordash-general');
 assert.equal(dash.brandId,'doordash');assert.equal(dash.logo,'brand/logos/doordash.svg');assert.equal(dash.category,'delivery');
 assert.equal(logoForRuleId('rule.chase-us-sapphire-reserve.edit').name,'Chase','a borrowed mark is labelled as its owner');
 assert.equal(logoForRuleId('rule.chase-us-united-quest.rideshare').category,'ride-share');
 assert.equal(logoForRuleId('rule.chase-us-united-quest.rideshare').logo,null,'no single brand, so no logo');
 assert.equal(logoForRuleId('rule.amex-us-us-american-express-gold-card.uber').category,'ride-share');
 assert.equal(logoForRuleId('rule.chase-us-sapphire-reserve.lyft').brandId,'lyft');
 assert.equal(logoForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.digital').category,'entertainment');
 assert.equal(logoForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.airline-fee').category,'airline');
 const brand=registry.brands.find(b=>b.id==='doordash'),saved={...brand};
 Object.assign(brand,{status:'unapproved'});
 try{const view=logoForRuleId('rule.chase-us-sapphire-reserve.dashpass');assert.equal(view.logo,null);assert.equal(view.category,'delivery');}finally{Object.assign(brand,saved);}
});
test('merchant matching does not create false matches',()=>{
 for(const text of ['Tuber Farm','Ouralike Labs','Resynth Audio','uber lowercase','Walmartian','Peloton2','United States Postal','Delta Faucet','Apple Pie Bakery','Clear Skies Spa','Southwest Grill','Virgin Olive Oil','Hilton Head Golf','The Edit LDN','ANA Yoga','EVA Foam','Home Chef Catering','HK Express Courier','Plaza Premium Outlet','Priority Pass Lane','Non-Uber rides','Excludes Walmart','不含 DoorDash','Excl. Uber','Other than Uber','Without Walmart','除Uber外','排除 Uber','非 Uber 商户','Wyndham Estate Wines','Peloton Cycles','Uber-like','Marriott Street Cafe','Hyatt Road'])assert.equal(logoForText(text).brandId,null,text);
 assert.equal(logoForText('DoorDash: $10 back').brandId,'doordash');assert.equal(logoForText('$10 back at DoorDash').brandId,null,'position unknown');assert.equal(logoForText('Uber  Eats').category,'delivery');
 assert.equal(logoForText('Uber Eats').brandId,'uber-eats');assert.equal(logoForText('Uber Eats').category,'delivery');assert.equal(logoForText('Uber ride').category,'ride-share');
 assert.equal(logoForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.lounge').brandId,null);assert.equal(logoForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.lounge').category,'lounge');
 assert.equal(logoForText('DoorDash or Lyft').brandId,null,'two brands choose neither');
 assert.equal(identifyBrand({title:'StubHub／Peloton 抵扣'}),null);
 assert.equal(identifyBrand({title:'StubHub／viagogo 抵扣'}).id,'stubhub','viagogo is part of StubHub, so the rule shows one mark');
 assert.equal(identifyBrand({title:'United刷卡部分'}),null,'United is matched by programme ID only');
 assert.equal(identifyBrand({programmeIds:['programme.uber','programme.resy']}),null);
 assert.equal(identifyBrand({programmeIds:['programme.uber','programme.uber-one']}).id,'uber');
});
test('programmes, transfers and earning labels resolve exactly',()=>{
 assert.equal(logoForProgramme('United MileagePlus').category,'airline');
 assert.equal(logoForProgramme('programme.marriott-bonvoy').category,'hotel');
 assert.equal(logoForProgramme('Not A Programme').category,null);
 for(const r of rules.filter(r=>r.kind==='transfer-relationship')){const v=logoForRule(r);assert.ok(v.category&&v.brandId,r.id);}
 for(const r of rules.filter(r=>r.kind==='earning-rate'))assert.ok(logoForEarning(r.terms.spendCategory).category,r.terms.spendCategory);
 assert.equal(logoForEarning('餐饮 ').category,null,'exact labels only');
});
test('ASSET-SOURCES records every brand, its status and the trademark notice',()=>{
 const doc=read('public/ASSET-SOURCES.md').toString();
 assert.match(doc,/belong to their owners/);assert.equal(doc.match(/^# Merchant and programme marks$/gm).length,1,'one marks section');assert.match(doc,/no endorsement/i);
 for(const b of registry.brands){const line=doc.split('\n').find(l=>l.startsWith(`| ${b.name} |`));assert.ok(line,b.name);assert.ok(line.includes(`| ${b.terms} |`),b.name);assert.ok(line.includes(b.finding),b.name);assert.ok(line.includes(`| ${b.termsUrl||'not located'} |`),b.name);assert.ok(line.includes(`| ${b.source} |`),b.name);}
});
