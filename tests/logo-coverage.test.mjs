import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {logoForRule,logoForRuleId} from '../src/logoRegistry.js';
import {benefitProfileView} from '../src/knowledge.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const rules=JSON.parse(read('src/data/knowledge/rules.json'));
// Add to this list only with a reason in the PR. It is empty today and new entries are visible in review.
const KNOWN_UNCOVERED=[];
const latest=rows=>[...new Map(rows.filter(r=>r.status==='published').sort((a,b)=>a.revision-b.revision).map(r=>[r.id,r])).values()];
const uncovered=rows=>rows.filter(r=>{const v=logoForRule(r);return !v.logo&&!v.category;}).map(r=>r.id);
const benefits=latest(rules).filter(r=>r.kind==='benefit');
test('every credit and benefit has a merchant logo or a category icon',t=>{
 const views=benefits.map(logoForRule),logos=views.filter(v=>v.logo).length,named=views.filter(v=>v.brandId&&!v.logo).length;
 t.diagnostic(`${benefits.length} benefits: ${logos} logo, ${named} brand shown by category icon, ${benefits.length-logos-named} category icon only`);
 assert.deepEqual(uncovered(benefits),KNOWN_UNCOVERED);
});
test('a newly added benefit with no icon fails the check',()=>{
 const rule={id:'rule.synthetic.new',kind:'benefit',category:'credit',scenarioIds:[],programmeIds:[],content:{title:'Synthetic Merchant Credit'}};
 assert.deepEqual(uncovered([rule]),['rule.synthetic.new']);
 assert.deepEqual(uncovered([{...rule,scenarioIds:['dining']}]),[]);
});
test('every benefit in a card profile carries a rule ID that resolves to an icon',()=>{
 for(const profile of benefitProfileView())for(const b of profile.benefits)assert.ok(logoForRuleId(b.knowledgeRuleId).category,`${profile.productId}: ${b.id}`);
});
// A source scan of the known sites: it catches removal or a wrong ID there, not a brand-new page.
test('known UI sites draw titles and names with ItemLogo',()=>{
 const sites={'src/BenefitGuide.jsx':['<ItemLogo ruleId={b.knowledgeRuleId}/>','<ItemLogo programme={v}/>','<ItemLogo earning={r.label}'],'src/PersonalWallet.jsx':['<ItemLogo ruleId={task.ruleId}/><Text strong>{ruleField(task.title,task,\'title\')}','<ItemLogo ruleId={task.ruleId}/>{ruleField(task.title,task,\'title\')}','<ItemLogo ruleId={b.knowledgeRuleId}/><Text strong>{ruleField(b.title,b,\'title\')}','<ItemLogo ruleId={b.knowledgeRuleId} size={12}/>{ruleField(b.title,b,\'title\')}'],'src/CostTrackingUI.jsx':['<ItemLogo ruleId={task.ruleId}/>'],'src/main.jsx':['<ItemLogo text={o.name}/><Text strong>','<ItemLogo text={o.name}/><Text ellipsis','<ItemLogo text={offerDetail.name}/>','<ItemLogo text={b.name}/>']};
 for(const [file,needles] of Object.entries(sites)){const source=read(file);for(const needle of needles)assert.ok(source.includes(needle),`${file}: ${needle}`);}
 for(const file of ['src/BenefitGuide.jsx','src/PersonalWallet.jsx'])assert.doesNotMatch(read(file),/ruleId=\{(?:b|task)\.id\}/,file);
});
