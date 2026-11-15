// Credits without a calendar cycle: four-year, one-off and ongoing rows (stl00/Cardybara#274). Synthetic cards and marks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {benefitProfiles} from '../src/benefitRules.js';
import {cardProducts} from '../src/productCatalog.js';
import {ACTIVE_BANKS} from '../extension-next/providers.js';
import {newWalletCard} from '../src/walletRegistry.js';
import {creditTasks,feeDateNeededRows,offCycleRows,offCycleStatus,nextFourYears,validatePersonalEvent,activeTasks,dismissKey} from '../src/personalBenefits.js';

const DAY='2026-11-10';
const inForce=b=>['credit','promo'].includes(b.category)&&!b.applicability&&!(b.validFrom&&b.validFrom>DAY)&&!(b.validThrough&&b.validThrough<DAY);
const products=benefitProfiles.filter(p=>p.coverage!=='variant-unconfirmed').map(p=>cardProducts.find(x=>x.id===p.productId)).filter(p=>p&&ACTIVE_BANKS.includes(p.bank));
const card=(product,i,extra={})=>({...newWalletCard({bank:product.bank,name:'Synthetic '+i,tail:String(1000+i)},'manual-'+i),productId:product.id,...extra});

test('every credit/promo rule appears in exactly one of: cycle task, needs-fee-date, four-year, one-off, ongoing',()=>{
 const counts={task:0,'needs-fee-date':0,'four-year':0,'one-off':0,ongoing:0};
 for(const feeDate of [undefined,{month:5,day:20}])for(const [i,product] of products.entries()){
  const c=card(product,i,feeDate?{feeDate}:{}),expected=benefitProfiles.find(p=>p.productId===product.id).benefits.filter(inForce).map(b=>b.knowledgeRuleId).sort();
  const groups=[creditTasks([c],DAY).map(t=>['task',t.ruleId]),feeDateNeededRows([c],DAY).map(r=>['needs-fee-date',r.ruleId]),offCycleRows([c],DAY).map(r=>[r.state,r.ruleId])].flat();
  for(const [g] of groups)counts[g]++;
  assert.deepEqual(groups.map(x=>x[1]).sort(),expected,product.id+(feeDate?' dated':' undated'));
 }
 for(const k of Object.keys(counts))assert.ok(counts[k]>0,'covers '+k);
});

test('four-year: unmarked is available; marking the date shows +4 years; marking again replaces it',()=>{
 const product=cardProducts.find(p=>p.id==='chase-us-sapphire-reserve'),c=card(product,1,{feeDate:{month:5,day:20}});
 const row=offCycleRows([c],DAY).find(r=>r.state==='four-year');assert.ok(row);
 assert.deepEqual(offCycleStatus(row,[]),{status:'available',usedOn:null,nextEligible:null});
 const ev=(id,at,usedOn,status='used')=>validatePersonalEvent({schema:1,id,key:row.key,status,at,revisionId:row.revisionId,...(usedOn?{usedOn}:{})});
 const first=ev('a','2026-11-01T00:00:00.000Z','2024-02-29');
 assert.deepEqual(offCycleStatus(row,[first]),{status:'used',usedOn:'2024-02-29',nextEligible:'2028-02-29'});
 const second=ev('b','2026-11-02T00:00:00.000Z','2026-03-15');
 assert.equal(offCycleStatus(row,[first,second]).nextEligible,'2030-03-15');
 assert.equal(offCycleStatus(row,[first,second,ev('c','2026-11-03T00:00:00.000Z',null,'unknown')]).status,'available');
 assert.equal(nextFourYears('2026-11-10'),'2030-11-10');
 assert.throws(()=>ev('d','2026-11-04T00:00:00.000Z',null),/invalid/,'used needs a date');
 assert.throws(()=>ev('e','2026-11-04T00:00:00.000Z','2999-01-01'),/invalid/,'no future date');
 assert.throws(()=>ev('f','2026-11-04T00:00:00.000Z','2026-02-30'),/invalid/);
});

test('one-off rows take used / not relevant; ongoing rows take no mark but can be dismissed',()=>{
 const c=card(cardProducts.find(p=>p.id==='chase-us-united-quest'),2),hk=card(cardProducts.find(p=>p.id==='amex-hk-hk-the-platinum-card'),3),rows=offCycleRows([c,hk],DAY);
 const oneOff=rows.find(r=>r.state==='one-off');assert.ok(oneOff);
 const mk=status=>validatePersonalEvent({schema:1,id:status,key:oneOff.key,status,at:'2026-11-01T00:00:00.000Z',revisionId:oneOff.revisionId});
 assert.equal(offCycleStatus(oneOff,[mk('skipped')]).status,'skipped');
 assert.equal(offCycleStatus(oneOff,[mk('used')]).status,'used');
 assert.equal(offCycleStatus(oneOff,[]).status,'unknown');
 assert.throws(()=>mk('partial'),/invalid/);
 const ongoing=rows.find(r=>r.state==='ongoing'&&r.cardId===hk.id);assert.ok(ongoing,'missing period is an ongoing perk, not a guessed cycle');
 assert.equal(offCycleStatus(ongoing,[]),null);
 const off=[validatePersonalEvent({schema:1,id:'x',key:dismissKey(hk.id,ongoing.ruleId),status:'dismissed',at:'2026-11-01T00:00:00.000Z'})];
 assert.ok(!activeTasks(rows,off).some(r=>r.ruleId===ongoing.ruleId));
});

const KEYS=["可再次申请", "记录使用日期", "上次使用日期", "下次可申请 {0}（上次 {1}）", "每四年一次，没有固定截止日", "按次使用", "按住宿次数", "需要先激活", "限定日期", "促销期内", "一次性权益：{0}。用过或与你无关就标记一下。", "长期权益（{0}）", "没有固定周期，作为长期权益查看", "已使用", "不相关"];
test('strings exist in all three languages',()=>{
 const b=JSON.parse(readFileSync(new URL('../src/i18n/benefits.json',import.meta.url),'utf8'));
 for(const k of KEYS)for(const l of ['en-US','zh-TW'])assert.ok(b[l][k],l+' '+k);
});
