import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CREDIT_CATEGORIES,creditCategoriesForRule,creditCategoriesForRuleId,creditCategoryLabel} from '../src/creditCategories.js';
import {creditTasks} from '../src/personalBenefits.js';
import {logoForCategory} from '../src/logoRegistry.js';
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const rules=json('../src/data/knowledge/rules.json'),taxonomy=json('../src/data/knowledge/taxonomy.json'),data=json('../src/data/credit-categories.json'),catalog=json('../src/translations.json');
const fixtureCards=json('./fixtures/wallet-products.json').cards;
const ids=new Set(CREDIT_CATEGORIES.map(c=>c.id));

test('every credit and promo has at least one valid category',()=>{
 const rows=rules.filter(r=>['credit','promo'].includes(r.category));assert.ok(rows.length>50);
 for(const rule of rows){const found=creditCategoriesForRule(rule);assert.ok(found.length,`${rule.id} has no category`);for(const id of found)assert.ok(ids.has(id),`${rule.id}: ${id}`);}
});
test('every scenario has a default so a new rule is categorized on arrival',()=>{
 for(const {id} of taxonomy.scenarios)assert.ok(data.scenarioDefaults[id]?.length,id);
 assert.deepEqual(creditCategoriesForRule({id:'rule.synthetic.new',scenarioIds:['hotel-stay']}),['hotel']);
});
test('overrides name real rules and real categories',()=>{
 const known=new Set(rules.map(r=>r.id));
 for(const [id,list] of Object.entries(data.ruleOverrides)){assert.ok(known.has(id),id);assert.ok(list.length&&list.every(c=>ids.has(c)),id);}
 for(const list of Object.values(data.scenarioDefaults))assert.ok(list.every(c=>ids.has(c)));
});
test('airline has its own category, and scenario tags that were too broad are corrected',()=>{
 assert.deepEqual(creditCategoriesForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.airline-fee'),['airline']);
 assert.deepEqual(creditCategoriesForRuleId('rule.amex-us-us-morgan-stanley-platinum-card.digital'),['entertainment']);
 assert.deepEqual(creditCategoriesForRuleId('rule.chase-us-united-quest.bags'),['airline']);
});
test('every override resolves to exactly what it is meant to',()=>{
 const p='rule.amex-us-us-morgan-stanley-platinum-card.',expected={
  'rule.chase-us-sapphire-reserve.edit':['hotel'],[p+'airline-fee']:['airline'],[p+'digital']:['entertainment'],[p+'uber']:['dining','ride-share'],[p+'uber-one']:['dining','ride-share'],
  'rule.amex-us-us-hilton-honors-aspire-card.flight':['airline'],'rule.chase-us-united-quest.travelbank':['airline'],'rule.chase-us-united-quest.award-discount':['airline'],'rule.chase-us-united-quest.bags':['airline'],
  'rule.chase-us-ihg-premier.airline-new':['airline'],'rule.chase-us-ihg-premier.travelbank':['airline'],'rule.boa-us-atmos-rewards-summit-visa-infinite.companion':['airline'],'rule.boa-us-atmos-rewards-summit-visa-infinite.partner-fees':['airline'],
  'rule.hsbc-hk-hk-red-credit-card.hkexpress':['airline'],'rule.boa-us-customized-cash-rewards-visa-signature.first-year':['reward'],
 };
 assert.deepEqual(Object.keys(data.ruleOverrides).sort(),Object.keys(expected).sort());
 for(const [id,list] of Object.entries(expected))assert.deepEqual(creditCategoriesForRuleId(id),list,id);
});
test('a credit can have several categories',()=>{
 assert.deepEqual(creditCategoriesForRuleId('rule.chase-us-sapphire-reserve.doordash-general'),['dining','shopping']);
 assert.deepEqual(creditCategoriesForRuleId('rule.amex-us-us-american-express-gold-card.uber'),['dining','ride-share']);
});
test('an unknown rule stays uncategorized instead of being guessed',()=>{
 assert.deepEqual(creditCategoriesForRuleId('rule.does-not-exist'),[]);
 assert.deepEqual(creditCategoriesForRule({id:'rule.synthetic.none',scenarioIds:[]}),[]);
 assert.equal(creditCategoryLabel('nope'),null);
});
test('credit tasks carry their categories',()=>{
 const tasks=creditTasks(fixtureCards,'2026-10-28');assert.ok(tasks.length>10);
 for(const task of tasks)assert.ok(task.categories.length,task.key);
});
test('labels exist in three languages and each category has an icon',()=>{
 for(const {id,label} of CREDIT_CATEGORIES){
  for(const language of ['en-US','zh-TW'])assert.ok(catalog[language][label],`${language}: ${label}`);
  assert.equal(logoForCategory(id).category,id,id);
 }
});
