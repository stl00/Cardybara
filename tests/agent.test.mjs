import test from 'node:test';
import assert from 'node:assert/strict';
import {readLink,redact,validateModel,modelRequest,mergeRecords} from '../extension-next/agent-core.js';
import {applyAgentRecords} from '../src/agentData.js';
import {createAgent} from '../extension-next/agent-runtime.js';
const snapshot=(bank='Amex HK')=>({bank,region:'HK',page:'https://global.americanexpress.com/overview',capturedAt:'2026-10-23T17:00:00Z',aliases:[{id:'C1',cardId:'card-one',currency:'HKD'}],blocks:[{text:'[C1] Membership Rewards 12,345 points\nMerchant 2026-10-22 HKD 50.00 posted\nOffer Shop: spend HKD 100.00 get HKD 10.00. Available.'}],links:[{id:'L1',label:'Rewards',href:'https://global.americanexpress.com/rewards'}]});
const item=(overrides={})=>({kind:'reward',cardId:'C1',key:'Membership Rewards',title:'Membership Rewards',value:12345,currency:'points',date:'',status:'unknown',evidence:'[C1] Membership Rewards 12,345 points',...overrides});
test('model output is evidence-grounded; hallucinations, wrong alias, substrings and injected keys fail',()=>{
 const s=snapshot();const r=validateModel({items:[item(),item({value:12}),item({cardId:'C9'}),item({evidence:'fake 12345'}),item({code:'fetch(secret)'})],nextLinkId:'evil'},s);
 assert.equal(r.items.length,1);assert.equal(r.rejected.length,4);assert.equal(r.nextLinkId,null);assert.equal(r.items[0].cardId,'card-one');assert.equal(r.items[0].bank,'Amex HK');
 assert.doesNotThrow(()=>validateModel({items:[null],nextLinkId:null},s));
});
test('dates, amounts and merchant names must be supported by the same evidence',()=>{
 const s=snapshot();const tx=item({kind:'transaction',key:'',title:'Merchant',value:50,currency:'HKD',date:'2026-10-22',status:'posted',evidence:'Merchant 2026-10-22 HKD 50.00 posted'});
 assert.equal(validateModel({items:[tx],nextLinkId:'L1'},s).items.length,1);
 for(const override of [{date:'2026-10-21'},{title:'Other'},{value:5},{date:'2026-02-30'}])assert.equal(validateModel({items:[{...tx,...override}],nextLinkId:null},s).items.length,0);
});
test('multiple visible cards require alias-bound evidence, currency and unknown card fields fail',()=>{
 const s=snapshot();s.aliases.push({id:'C2',cardId:'card-two',currency:'HKD'});
 assert.equal(validateModel({items:[item({evidence:'Membership Rewards 12,345 points'})],nextLinkId:null},s).items.length,0);
 assert.equal(validateModel({items:[item({key:'Rewards',evidence:'Membership Rewards 12,345 points'})],nextLinkId:null},s).items.length,0);
 assert.equal(validateModel({items:[item({kind:'card',key:'password'})],nextLinkId:null},s).items.length,0);
});
test('read navigation admits only same-origin viewing links without tokens or side effects',()=>{
 const url='https://global.americanexpress.com/overview';
 assert.equal(readLink('Rewards','/rewards',url),'https://global.americanexpress.com/rewards');
 for(const [label,href] of [['Redeem rewards','/rewards'],['Rewards','https://evil.test'],['Rewards','/rewards?token=secret'],['Offers','/offers/activate'],['Transfer','/activity'],['Rewards','javascript:alert(1)']])assert.equal(readLink(label,href,url),null);
});
test('redaction removes long card/account numbers, emails, URLs and greetings',()=>{
 const text=redact('Welcome Jane Doe\n1234 5678 9012 3456\nme@example.com https://bank.test/?token=secret');
 assert.ok(!text.includes('Jane Doe'));assert.ok(!text.includes('9012'));assert.ok(!text.includes('example.com'));assert.ok(!text.includes('secret'));
});
test('model keys remain in headers; JSON-only adapters contain no executable tools',()=>{
 for(const provider of ['deepseek','gemini']){const r=modelRequest({provider,key:'SECRET'},snapshot());assert.ok(!r.url.includes('SECRET'));assert.ok(!JSON.stringify(r.body).includes('SECRET'));assert.ok(!JSON.stringify(r.body).includes('card-one'));assert.ok(!JSON.stringify(r.body).includes('functionDeclarations'));}
});
test('shared reward pool deduplicates within country and keeps separate country pools',()=>{
 const a=validateModel({items:[item()],nextLinkId:null},snapshot()).items[0];
 const rows=mergeRecords([],[a,{...a,cardId:'card-two'},{...a,bank:'Amex CA',region:'CA'}]);assert.equal(rows.length,3);
});
test('all seven bank scopes accept grounded records without crossing card ownership',()=>{
 for(const bank of ['Amex US','Amex HK','Amex CA','Chase','BOA','HSBC HK','SC HK']){const s=snapshot(bank);assert.equal(validateModel({items:[item()],nextLinkId:null},s).items[0].bank,bank);}
});
test('approved records merge into React data, keep country pools and newer bank values',()=>{
 const d={cards:[{id:'card-one',bank:'Amex HK',currency:'HKD',balance:99,updated:'2026-10-24'}],rewards:[{id:'hk-mr',label:'Membership Rewards',region:'香港 · Amex',amount:10,unit:'MR',date:'2026-10-21'},{id:'us-mr',label:'Membership Rewards',region:'美国 · Amex',amount:20,unit:'MR',date:'2026-10-21'}],offers:[],transactions:[],benefits:[]};
 const a=validateModel({items:[item()],nextLinkId:null},snapshot()).items[0];const result=applyAgentRecords(d,[a,{...a,kind:'card',key:'balance',value:1,currency:'HKD'}]);
 assert.equal(result.rewards.length,2);assert.equal(result.rewards[0].amount,10);assert.equal(result.rewardObservations[0].amount,12345);assert.equal(result.rewards[1].amount,20);assert.equal(result.cards[0].balance,99);assert.equal(d.rewards[0].amount,10);
});
function harness(){
 const local={},session={};let validDocument=true;let response;let release;
 const io=store=>({get:async k=>({[k]:structuredClone(store[k])}),set:async v=>Object.assign(store,structuredClone(v)),remove:async k=>delete store[k],setAccessLevel:async()=>{}});
 globalThis.chrome={runtime:{id:'test'},storage:{local:io(local),session:io(session)},permissions:{contains:async()=>true},tabs:{get:async()=>({id:2,url:'https://global.americanexpress.com/overview',status:'complete'}),query:async()=>[],update:async()=>{}},scripting:{executeScript:async args=>{if(args.target.documentIds){if(!validDocument)throw Error('document_changed');return [{documentId:'doc',result:true}]}return [{documentId:'doc',result:{...snapshot(),links:[]}}]}}};
 globalThis.fetch=async()=>{if(release)await new Promise(r=>response=r);return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({items:[item()],nextLinkId:null})}}]})}};
 const applied=[];const runtime=createAgent({apply:async items=>applied.push(...items),changed:async()=>{}});
 return {runtime,local,session,applied,stale:()=>validDocument=false,delay:()=>release=true,resume:()=>response?.()};
}
async function prepare(h){await h.runtime.recover();await h.runtime.handle({type:'agent-config',provider:'deepseek',model:'deepseek-flash',key:'SECRET-KEY'});return h.runtime.handle({type:'agent-preview',bank:'Amex HK',cards:[{id:'card-one',bank:'Amex HK',tail:'12345',currency:'HKD'}],tabId:2})}
test('runtime previews, parses, requires explicit review, saves and never persists API key',async()=>{
 const h=harness(),s=await prepare(h);assert.equal(s.configured,true);assert.equal(s.status,'preview');
 const parsed=await h.runtime.handle({type:'agent-run',id:s.id});assert.equal(parsed.status,'review');assert.equal(h.applied.length,0);
 await h.runtime.handle({type:'agent-apply',id:s.id,indices:[0]});assert.equal(h.applied.length,1);assert.ok(!JSON.stringify(h.local).includes('SECRET-KEY'));assert.ok(!JSON.stringify(await h.runtime.handle({type:'agent-state'})).includes('SECRET-KEY'));
});
test('cancellation prevents a late model result from reviving or saving a task',async()=>{
 const h=harness(),s=await prepare(h);h.delay();const pending=h.runtime.handle({type:'agent-run',id:s.id});await new Promise(r=>setTimeout(r,5));await h.runtime.handle({type:'agent-cancel'});h.resume();const done=await pending;assert.equal(done.status,'cancelled');assert.equal(h.applied.length,0);assert.deepEqual(done.items,[]);
});
test('stale bank document cannot be saved; worker recovery marks unfinished parsing interrupted',async()=>{
 const h=harness(),s=await prepare(h);await h.runtime.handle({type:'agent-run',id:s.id});h.stale();await assert.rejects(()=>h.runtime.handle({type:'agent-apply',id:s.id,indices:[0]}));assert.equal(h.applied.length,0);
 h.local['cardybara-agent-v1'].status='running';await h.runtime.recover();assert.equal(h.local['cardybara-agent-v1'].status,'interrupted');
});

test('Amex HK split point grouping and Chinese programme merge into the existing pool',()=>{
 const s=snapshot();s.blocks=[{text:'美國運通積分計劃\n246 ,810'}];const raw=item({key:'美國運通積分計劃',title:'美國運通積分計劃',value:246810,evidence:s.blocks[0].text});const v=validateModel({items:[raw],nextLinkId:null},s);assert.equal(v.items.length,1);
 const d={cards:[{id:'card-one',bank:'Amex HK',currency:'HKD'}],rewards:[{id:'hk-mr',label:'Membership Rewards',region:'香港 · Amex',amount:10,unit:'MR',date:'2026-10-21'}],offers:[],transactions:[],benefits:[]};const merged=applyAgentRecords(d,v.items);assert.equal(merged.rewards.length,1);assert.equal(merged.rewards[0].id,'hk-mr');assert.equal(merged.rewards[0].amount,10);assert.equal(merged.rewardObservations[0].amount,246810);assert.equal(merged.rewards[0].label,'Membership Rewards');
});
test('Amex offers can retain their transient account selector without permitting general query tokens',()=>{
 const base='https://global.americanexpress.com/dashboard';
 assert.ok(readLink('優惠 · 查看更多','/offers?account_key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',base));
 assert.equal(readLink('優惠 · 查看更多','/offers?account_key=AAAA&token=secret',base),null);
 assert.equal(readLink('優惠 · 查看更多','/offers?token=secret',base),null);
});

test('evidence matching tolerates rendered span whitespace without accepting changed digits',()=>{
 const s=snapshot();s.blocks=[{text:'美國運通積分計劃\n246 ,810'}];
 assert.equal(validateModel({items:[item({key:'美國運通積分計劃',value:246810,evidence:'美國運通積分計劃 246,810'})],nextLinkId:null},s).items.length,1);
 assert.equal(validateModel({items:[item({key:'美國運通積分計劃',value:246811,evidence:'美國運通積分計劃 246,811'})],nextLinkId:null},s).items.length,0);
});

import {evidenceDate} from '../extension-next/agent-core.js';
test('full Chinese and English calendar dates normalize while ambiguous or incomplete dates do not',()=>{
 assert.equal(evidenceDate('2026-10-23','2026年10月23日 Merchant HK$12.00'),true);
 assert.equal(evidenceDate('2026-10-23','23 Oct 2026 Merchant $12.00'),true);
 assert.equal(evidenceDate('2026-10-23','October 23, 2026 Merchant $12.00'),true);
 for(const s of ['23 Oct','10/23','2025年10月23日','23 Oct 2025'])assert.equal(evidenceDate('2026-10-23',s),false);
 assert.equal(evidenceDate('2026-02-30','2026年2月30日'),false);
});
test('Amex activity links allow only the observed read-only account selector query',()=>{
 const base='https://global.americanexpress.com/dashboard',key='A'.repeat(32);
 assert.ok(readLink('View All Recent Transactions',`/activity/recent?account_key=${key}`,base));
 assert.equal(readLink('Transactions',`/activity/recent?account_key=${key}&token=bad`,base),null);
 assert.equal(readLink('Payments',`/payments/pay?account_key=${key}`,base),null);
});
test('observed Amex offer numeric dates use the adapter format without interpreting ambiguous dates elsewhere',()=>{
 assert.equal(evidenceDate('2026-12-31','到期 12/31/2026','mdy'),true);
 assert.equal(evidenceDate('2026-11-05','11/05/2026','mdy'),true);
 assert.equal(evidenceDate('2026-11-05','11/05/2026'),false);
 assert.equal(evidenceDate('2026-12-31','12/30/2026','mdy'),false);
});
test('redaction preserves valid printed ISO transaction dates while masking long identifiers',()=>{
 assert.equal(redact('2026-10-23 merchant 1234567890123456'),'2026-10-23 merchant [number]');
 assert.equal(redact('2026-02-30'), '[number]');
});
test('Canadian Amex transaction cycle navigation admits only observed read-only parameters',()=>{
 const base='https://global.americanexpress.com/dashboard';
 assert.ok(readLink('View Transactions','/activity?cycleIndex=0',base));
 assert.ok(readLink('View Transactions','/activity?cycleIndex=0&account_key='+'A'.repeat(32),base));
 for(const query of ['cycleIndex=0&token=bad','cycleIndex=999','cycleIndex=0&cycleIndex=1','cycleIndex=-1','session=secret'])assert.equal(readLink('View Transactions','/activity?'+query,base),null);
});
import {statementDate} from '../extension-next/agent-core.js';
test('transaction years use the printed statement boundary months and reject unrelated months or years',()=>{
 const evidence='Statement Period:\n04 Sep - 03 Oct 2026\nTransaction:\n03 Sep SAMPLE MERCHANT 1 -$15.13';
 assert.equal(evidenceDate('2026-09-03',evidence),true);assert.equal(evidenceDate('2026-10-03',evidence),false);assert.equal(evidenceDate('2025-09-03',evidence),false);
 const cross='Statement Period:\n04 Dec - 03 Jan 2026\nTransaction:\n15 Dec Merchant $10.00';
 assert.equal(statementDate('2025-12-15',cross),true);assert.equal(statementDate('2026-12-15',cross),false);
 assert.equal(statementDate('2025-12-16',cross),false);
});
test('full transaction dates are validated on the row even when statement context is present',()=>{
 const prefix='Statement Period:\n04 Sep - 03 Oct 2026\nTransaction:\n';
 assert.equal(evidenceDate('2026-09-03',prefix+'2026-09-03 Merchant $10.00'),true);
 assert.equal(evidenceDate('2026-09-03',prefix+'09/03/2026 Merchant $10.00','mdy'),true);
 assert.equal(statementDate('2026-09-03','Statement Period:\n04 Sep 2025 - 03 Sep 2026\nTransaction:\n03 Sep Merchant $10.00'),false);
});
test('historical statement totals cannot overwrite current Amex card amounts',()=>{
 const s=snapshot();s.page='https://global.americanexpress.com/activity';s.blocks=[{text:'[C1] Statement Balance HKD 321.00'}];
 const card=item({kind:'card',key:'statement',title:'Statement Balance',value:321,currency:'HKD',evidence:s.blocks[0].text});
 assert.deepEqual(validateModel({items:[card],nextLinkId:null},s).rejected,['card_page']);
 s.page='https://global.americanexpress.com/dashboard';assert.equal(validateModel({items:[card],nextLinkId:null},s).items.length,1);
});
test('saved-offer list URLs do not authorize registering or activating offers',()=>{
 const base='https://global.americanexpress.com/dashboard',key='A'.repeat(32);
 assert.ok(readLink('Saved offers','/offers/enrolled?account_key='+key,base));
 for(const path of ['/offers/enroll','/offers/enrolled/activate','/offers/enrolled#activate'])assert.equal(readLink('Offers',path,base),null);
});

test('observed US statement links allow only bounded read-only query fields',()=>{
 const base='https://global.americanexpress.com/dashboard',key='A'.repeat(32);
 assert.ok(readLink('View Transactions','/activity/statement?end=2026-10-12&account_key='+key,base));
 assert.ok(readLink('View Recent Transactions','/activity/recent?opaqueAccountId=ABCDEFGHIJKLMNO',base));
 assert.ok(readLink('Offers','/offers/enrolled?opaqueAccountId=ABCDEFGHIJKLMNO',base));
 assert.equal(readLink('Offers','/offers/enroll?opaqueAccountId=ABCDEFGHIJKLMNO',base),null);
 for(const q of ['end=2026-02-30','end=2026-10-12&end=2026-10-13','end=2026-10-12&redirect=evil','end=2026-10-12&payment=true'])assert.equal(readLink('View Transactions','/activity/statement?'+q,base),null);
 assert.equal(readLink('View Transactions','/payments/pay?end=2026-10-12',base),null);
});

test('billing dates and autopay require explicit evidence and preserve field-level dates',()=>{
 const s=snapshot('HSBC HK');s.page='https://www.hsbc.com.hk/online/dashboard/';s.blocks=[{text:'[C1] Payment due date\n02 Nov 2026'},{text:'[C1] AutoPay Off'},{text:'[C1] Automatic payments menu'}];
 const due=item({kind:'billing',key:'due',title:'Payment due date',value:null,currency:'HKD',date:'2026-11-02',evidence:s.blocks[0].text});
 const auto=item({kind:'billing',key:'autopay',title:'AutoPay',value:null,currency:'HKD',status:'off',evidence:s.blocks[1].text});
 const good=validateModel({items:[due,auto],nextLinkId:null},s);assert.equal(good.items.length,2);
 for(const bad of [{...due,date:'2027-11-02'},{...auto,status:'on'},{...auto,evidence:s.blocks[2].text,status:'on'},{...auto,value:0}])assert.equal(validateModel({items:[bad],nextLinkId:null},s).items.length,0);
 const data={cards:[{id:'card-one',bank:'HSBC HK',currency:'HKD',balance:15,updated:'2026-10-20'}],rewards:[],offers:[],benefits:[],transactions:[]};
 const d=applyAgentRecords(data,good.items);assert.equal(d.cards[0].due,'2026-11-02');assert.equal(d.cards[0].autopay,'off');assert.equal(d.cards[0].balance,15);assert.equal(d.cards[0].fieldDates.due,s.capturedAt);
 const newer=structuredClone(d);newer.cards[0].fieldDates.due='2026-10-25T00:00:00Z';newer.cards[0].due='2026-12-01';assert.equal(applyAgentRecords(newer,good.items).cards[0].due,'2026-12-01');
});
test('same-page AI cannot replace an evidence-grounded rule field; newer readings can',()=>{
 const base={kind:'card',bank:'HSBC HK',cardId:'card-one',key:'balance',currency:'HKD',value:1,capturedAt:'2026-10-26T12:00:00Z',method:'rules'};
 assert.equal(mergeRecords([base],[{...base,value:2,method:'ai'}])[0].value,1);
 assert.equal(mergeRecords([base],[{...base,value:2,method:'ai',capturedAt:'2026-10-27T12:00:00Z'}])[0].value,2);
});

test('same physical card retains separate currency observations',()=>{
 const base={kind:'card',bank:'HSBC HK',cardId:'pulse',key:'balance',value:1,currency:'HKD',capturedAt:'2026-10-26T14:00:00Z'};
 assert.equal(mergeRecords([],[base,{...base,currency:'CNY',value:2}]).length,2);
 const tx={...base,kind:'transaction',key:'observed-row|same'};
 assert.equal(mergeRecords([],[tx,{...tx,currency:'CNY'}]).length,2);
});

test('transactions cannot cross the selected account currency',()=>{
 const s=snapshot();s.blocks=[{text:'[C1] Merchant 2026-10-22 HKD 50.00 CNY 50.00'}];
 const tx=item({kind:'transaction',key:'',title:'Merchant',value:50,currency:'CNY',date:'2026-10-22',status:'unknown',evidence:s.blocks[0].text});
 assert.deepEqual(validateModel({items:[tx],nextLinkId:null},s).rejected,['transaction']);
 assert.equal(validateModel({items:[{...tx,currency:'HKD'}],nextLinkId:null},s).items.length,1);
});

test('HK Amex account-activity viewing link is recognized without admitting account mutations',()=>{
 const base='https://global.americanexpress.com/activity/recent';
 assert.equal(readLink('查看賬項','/activity/statement?end=2026-10-05',base),'https://global.americanexpress.com/activity/statement?end=2026-10-05');
 assert.equal(readLink('查看賬項','/payment',base),null);
 assert.equal(readLink('查看賬項','/activity/statement?end=2026-02-30',base),null);
});
test('HK statement date normalization validates both Chinese period and row evidence',async()=>{
 const {evidenceDate}=await import('../extension-next/agent-core.js');
 const e='Statement Period:\n2026年6月29日 至 2026年7月28日\nTransaction:\n6月28日 -HK$600.00';
 assert.equal(evidenceDate('2026-06-28',e),true);assert.equal(evidenceDate('2025-06-28',e),false);assert.equal(evidenceDate('2026-07-28',e),false);
});
test('HK read-only rewards and benefit links retain account scope and strip known analytics only',()=>{
 const base='https://global.americanexpress.com/rewards';
 assert.equal(readLink('禮品換領','/rewards?inav=hk_ch_myca_rewards',base),base);
 assert.equal(readLink('查看所有禮遇','/card-benefits/view-all?inav=hk_ch_view_all',base),'https://global.americanexpress.com/card-benefits/view-all');
 assert.equal(readLink('禮品換領','/rewards/points-for-charges',base),null);
 assert.equal(readLink('查看所有禮遇','/card-benefits/view-all?token=secret',base),null);
 assert.equal(readLink('查看所有禮遇','/card-benefits/view-all?inav=https://evil.test',base),null);
});
test('benefit entitlement and qualifying spend do not become activated memberships or used credits',()=>{
 const s=snapshot();s.blocks=[{text:'[C1]\n環亞機場貴賓室\n已簽賬 HK$5,124\n尚餘 HK$24,876'}];
 const progress=item({kind:'benefit',key:'spend_progress',title:'環亞機場貴賓室',currency:'HKD',value:5124,evidence:s.blocks[0].text});
 const entitlement={...progress,key:'entitlement',value:null};
 const r=validateModel({items:[progress,entitlement,{...progress,value:24876}],nextLinkId:null},s);
 assert.equal(r.items.length,2);assert.deepEqual(r.rejected,['benefit_progress']);
 const data=applyAgentRecords({cards:[{id:'card-one',bank:'Amex HK'}],benefits:[],offers:[],transactions:[]},r.items);
 assert.equal(data.benefits.length,0);assert.equal(data.benefitProgress[0].value,5124);assert.equal(data.benefitEntitlements[0].status,'unconfirmed');
});
test('wallet transaction reducer preserves distinct repeated rows and currency scopes',()=>{
 const base={kind:'transaction',bank:'HSBC HK',cardId:'pulse',currency:'HKD',date:'2026-10-22',title:'TEST MERCHANT',value:10,status:'unknown',capturedAt:'2026-10-26T14:00:00Z'};
 const rows=[{...base,key:'observed-row|1'},{...base,key:'observed-row|2'},{...base,key:'observed-row|1',currency:'CNY'}];
 const d=applyAgentRecords({cards:[{id:'pulse',bank:'HSBC HK'}],transactions:[],offers:[],benefits:[]},rows);
 assert.equal(d.transactions.length,3);assert.equal(applyAgentRecords(d,rows).transactions.length,3);
});
test('multiple entitlements and progress groups on one card remain separate observations',()=>{
 const base={kind:'benefit',key:'entitlement',bank:'Amex HK',cardId:'hk-platinum',currency:'HKD',date:'',capturedAt:'2026-10-26T14:00:00Z',value:null};
 const rows=[{...base,title:'Membership A'},{...base,title:'Membership B'},{...base,title:'Lounge A',key:'spend_progress',value:10},{...base,title:'Lounge B',key:'spend_progress',value:20}];
 assert.equal(mergeRecords([],rows).length,4);assert.equal(mergeRecords(rows,rows).length,4);
});
test('Chase explicit Automatic payments status is accepted while menu-only text is rejected',()=>{
 const s=snapshot('Chase');s.region='US';s.aliases[0].currency='USD';s.blocks=[{text:'[C1]\nAutomatic payments\nOff\n|\nSet up'}];
 const record=item({kind:'billing',key:'autopay',title:'Automatic payments',value:null,currency:'USD',status:'off',evidence:s.blocks[0].text});
 assert.equal(validateModel({items:[record],nextLinkId:null},s).items.length,1);s.blocks=[{text:'[C1]\nAutomatic payments\nSet up'}];assert.equal(validateModel({items:[{...record,evidence:s.blocks[0].text}],nextLinkId:null},s).items.length,0);
});
test('benefit credit gauge and activation states are evidence scoped and stored as separate metrics',()=>{
 const s=snapshot('Chase');s.region='US';s.aliases[0].currency='USD';s.blocks=[{text:'[C1]\n$300 Annual Dining Credit*\n$0/$150\nGood through 12/31/2026'},{text:'[C1]\nMembership*\nActivated'}];
 const base=item({kind:'benefit',key:'credit_progress',title:'$300 Annual Dining Credit*',value:0,currency:'USD',date:'2026-12-31',evidence:s.blocks[0].text});
 const out=validateModel({items:[base,{...base,key:'credit_limit',value:150},{...base,key:'credit_limit',value:300},item({kind:'benefit',key:'entitlement',title:'Membership*',value:null,currency:'USD',status:'activated',evidence:s.blocks[1].text})],nextLinkId:null},s);
 assert.equal(out.items.length,3);assert.deepEqual(out.rejected,['benefit_progress']);const d=applyAgentRecords({cards:[{id:'card-one',bank:'Chase'}],benefits:[],transactions:[],offers:[]},out.items);assert.equal(d.benefitProgress.length,2);assert.equal(d.benefitEntitlements[0].status,'activated');
});

import {rewardAccounts} from '../src/rewardAccounts.js';
test('new HK and Chase readings replace stale headline records without adding shared pools',()=>{
 const cards=[{id:'hk',bank:'Amex HK',region:'HK'},{id:'hk2',bank:'Amex HK',region:'HK'},{id:'chase',bank:'Chase',region:'US'}];const d={cards,rewards:[{id:'hk-mr',label:'Membership Rewards',amount:1,date:'2026-10-21'},{id:'ur',label:'Ultimate Rewards',amount:2,date:'2026-10-21'},{id:'us-mr',label:'Membership Rewards',amount:3,date:'2026-10-21'}],rewardObservations:[{id:'a',card:'hk',bank:'Amex HK',region:'HK',label:'美國運通積分計劃',amount:100,capturedAt:'2026-10-27T12:00:00Z'},{id:'b',card:'hk2',bank:'Amex HK',region:'HK',label:'Membership Rewards',amount:100,capturedAt:'2026-10-27T12:00:00Z'},{id:'c',card:'chase',bank:'Chase',region:'US',label:'Ultimate Rewards® points',amount:200,capturedAt:'2026-10-27T12:00:00Z'}]};const r=rewardAccounts(d);
 assert.equal(r.historical.length,2);assert.equal(r.current.length,4);assert.ok(r.current.some(x=>x.id==='us-mr'));assert.equal(r.current.filter(x=>x.cardReading).length,3);assert.ok(!r.current.some(x=>x.amount===400||x.amount===1||x.amount===2));assert.equal(d.rewards[0].amount,1);
});
test('invalid, unregistered and older duplicate reward observations cannot replace latest card reading',()=>{
 const d={cards:[{id:'c',bank:'Chase',region:'US'}],rewards:[],rewardObservations:[{id:'new',card:'c',bank:'Chase',label:'Ultimate Rewards',amount:200,capturedAt:'2026-10-27T12:00:00Z'},{id:'old',card:'c',bank:'Chase',label:'Ultimate Rewards® points',amount:100,capturedAt:'2026-10-26T12:00:00Z'},{card:'other',bank:'Chase',amount:999,capturedAt:'2026-10-27'},{card:'c',bank:'Chase',amount:-1,capturedAt:'2026-10-27'}]};assert.equal(rewardAccounts(d).current.length,1);assert.equal(rewardAccounts(d).current[0].amount,200);
});

import {cardProducts,matchCardProduct,cardPresentation} from '../src/productCatalog.js';
test('public product catalogue works without a personal card id or tail and isolates countries',()=>{
 const us=matchCardProduct({bank:'Chase',region:'US',name:'Chase Sapphire Reserve® Credit Card'});assert.equal(us.status,'matched');assert.ok(!us.product.art.file.endsWith('.jpg'));assert.equal(matchCardProduct({bank:'Chase',region:'HK',name:'Sapphire Reserve'}).status,'unknown');
 const hk=matchCardProduct({bank:'Amex HK',region:'HK',name:'The Platinum Card'}),ca=matchCardProduct({bank:'Amex CA',region:'CA',name:'Platinum Card'});assert.notEqual(hk.product.id,ca.product.id);
 const unknown={bank:'Chase',region:'US',name:'A future card',balance:5};assert.equal(matchCardProduct(unknown).status,'unknown');assert.equal(unknown.balance,5);
});
test('ambiguous aliases and foreign product ids cannot silently select another product',()=>{
 const p=[{id:'a',bank:'Chase',region:'US',name:'A',aliases:['Card']},{id:'b',bank:'Chase',region:'US',name:'B',aliases:['Card']}];assert.equal(matchCardProduct({bank:'Chase',region:'US',name:'Card'},p).status,'ambiguous');assert.equal(matchCardProduct({bank:'Chase',region:'HK',productId:'a',name:'A'},p).status,'unknown');
});
test('catalogue excludes personal account data and application labels',()=>{
 for(const p of cardProducts){assert.ok(p.id&&p.bank&&p.region&&p.name&&p.sourceUrl);assert.ok(!/apply now|links to product/i.test(p.name));for(const key of ['tail','balance','minimum','due','accountId','capturedAt'])assert.ok(!(key in p));}
 assert.equal(new Set(cardProducts.map(p=>p.id)).size,cardProducts.length);const collected=new Set(['Chase','Amex US','Amex HK','Amex CA','BOA','HSBC HK','SC HK','Citi US']);for(const p of cardProducts)if(!collected.has(p.bank))assert.equal(p.collection,'not-supported',p.id);
 const art=cardPresentation({bank:'Chase',region:'US',name:'Sapphire Reserve',art:'reserve.jpg'}).art;assert.equal(art.file,'chase-sapphire-reserve-official.png');assert.equal(art.verification,'issuer-asset');
});
