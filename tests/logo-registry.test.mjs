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
 for(const id of Object.keys(registry.ruleOverrides))assert.ok(rules.some(r=>r.id===id),id);
});
test('a logo ships only with approval, a local file, a source and terms',()=>{
 const files=existsSync(logosDir)?readdirSync(logosDir):[];
 for(const b of registry.brands){
  assert.ok(['approved','forbidden','unverified'].includes(b.status),b.id);
  assert.ok(b.finding&&b.checkedAt,b.id);
  if(b.status==='approved'){assert.match(b.logo,/^brand\/logos\/[a-z0-9-]+\.svg$/,b.id);assert.ok(existsSync(new URL('../public/'+b.logo,import.meta.url)),b.id);assert.ok(b.termsUrl,b.id);}
  else assert.equal(b.logo,null,b.id);
 }
 const approved=registry.brands.filter(b=>b.status==='approved').map(b=>b.logo.split('/').at(-1));
 assert.deepEqual(files.filter(f=>!approved.includes(f)),[],'unapproved logo file bundled');
});
test('unapproved brands resolve to their category, never a file',()=>{
 const dash=logoForRuleId('rule.chase-us-sapphire-reserve.doordash-general');
 assert.equal(dash.brandId,'doordash');assert.equal(dash.logo,null);assert.equal(dash.category,'delivery');
 assert.equal(logoForRuleId('rule.chase-us-united-quest.rideshare').category,'ride-share');
 assert.equal(logoForRuleId('rule.amex-us-us-american-express-gold-card.uber').category,'ride-share');
 assert.equal(logoForRuleId('rule.chase-us-sapphire-reserve.lyft').brandId,'lyft');
 assert.equal(logoForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.digital').category,'entertainment');
 assert.equal(logoForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.airline-fee').category,'airline');
});
test('an approved brand resolves to its local file',()=>{
 const brand=registry.brands.find(b=>b.id==='doordash'),saved={...brand};
 Object.assign(brand,{status:'approved',logo:'brand/logos/doordash.svg'});
 try{assert.equal(logoForRuleId('rule.chase-us-sapphire-reserve.dashpass').logo,'brand/logos/doordash.svg');}finally{Object.assign(brand,saved);}
});
test('merchant matching does not create false matches',()=>{
 for(const text of ['Tuber Farm','Ouralike Labs','Resynth Audio','uber lowercase','Walmartian','Peloton2','United States Postal','Delta Faucet','Apple Pie Bakery','Clear Skies Spa','Southwest Grill','Virgin Olive Oil','Hilton Head Golf','The Edit LDN','ANA Yoga','EVA Foam'])assert.equal(logoForText(text).brandId,null,text);
 assert.equal(logoForText('$10 back at DoorDash').brandId,'doordash');
 assert.equal(logoForText('Uber Eats').brandId,'uber');
 assert.equal(logoForText('DoorDash or Lyft').brandId,null,'two brands choose neither');
 assert.equal(identifyBrand({title:'StubHub／viagogo 抵扣'}),null);
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
 assert.match(doc,/belong to their owners/);assert.match(doc,/no endorsement/i);
 for(const b of registry.brands){const line=doc.split('\n').find(l=>l.startsWith(`| ${b.name} |`));assert.ok(line,b.name);assert.ok(line.includes(`| ${b.status} |`),b.name);assert.ok(line.includes(b.finding),b.name);}
});
