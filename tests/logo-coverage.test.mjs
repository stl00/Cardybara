import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {logoForRule} from '../src/logoRegistry.js';
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
test('benefit and credit titles in the UI are drawn with ItemLogo',()=>{
 for(const file of ['src/BenefitGuide.jsx','src/PersonalWallet.jsx']){
  const source=read(file);
  assert.match(source,/import ItemLogo from '\.\/ItemLogo'/,file);
  const bare=[...source.matchAll(/(.{0,40})<Text strong>\{t\((?:b\.title|task\.title|v)\)\}<\/Text>/g)].filter(m=>!m[1].includes('<ItemLogo'));
  assert.deepEqual(bare.map(m=>m[0]),[],file);
 }
 assert.match(read('src/BenefitGuide.jsx'),/<ItemLogo programme=\{v\}\/>/,'transfer partners');
 assert.match(read('src/BenefitGuide.jsx'),/<ItemLogo earning=\{r\.label\}/,'earning rates');
 assert.match(read('src/CostTrackingUI.jsx'),/<ItemLogo ruleId=\{task\.ruleId\}\/>/,'credit amount dialog');
 assert.equal(read('src/main.jsx').match(/<ItemLogo text=/g)?.length,3,'offers and benefit rows');
});
