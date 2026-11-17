// #362: six zh find_benefits dialogues failed the answer check with unverified_enrollment. The live report keeps no
// model text, so these replay the real find_benefits evidence with plausible Chinese answers. Each wording below only
// describes a requirement (or repeats what the terms say), and an answer that claims enrolment is still rejected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {actionClaimIssues} from '../src/actionClaims.js';
import {answerGrounding} from '../src/answerGrounding.js';
import {runWalletTool} from '../src/walletAgent.js';
import {evalContext,replay} from '../evals/multiturn/harness.mjs';
import {dialogues} from '../evals/multiturn/dialogues.mjs';

const tool=(name,args)=>runWalletTool({id:'t',type:'function',function:{name,arguments:JSON.stringify(args)}},evalContext);
const byId=id=>dialogues.find(d=>d.id===id);
const evidenceFor=id=>{const d=byId(id);return [tool(d.expect.tool,d.expect.args)];};
const codes=(answer,evidence)=>answerGrounding(answer,evidence).issues.map(i=>i.code);
const scripted=(d,answer)=>{let step=0;return async()=>step++===0?{message:{role:'assistant',content:'',tool_calls:[{id:'s',type:'function',function:{name:d.expect.tool,arguments:JSON.stringify(d.expect.args)}}]}}:{message:{role:'assistant',content:answer}};};

// One test per phrase: [dialogue, answer that describes a requirement].
const describing=[
 ['same-marriott-hk-hant','a requirement word (需) after 已: "已包含…但需登記"','香港白金卡已包含 Marriott Gold 會籍但需登記'],
 ['same-marriott-hk-hant','"官網已列明需登記…"','官網已列明需登記及關聯計劃帳戶'],
 ['same-marriott-hk-hant','a parenthesised requirement: "已附送…（需登記…）"','白金卡已附送 Marriott Gold 會籍（需登記及關聯帳戶）'],
 ['long-hkplat-hans','"已写明需登记…" (zh-Hans)','官网已写明需登记并关联 ALL Accor 账户'],
 ['long-hkplat-hans','登记 as a noun: "登记入口"','官网已列 ALL Accor Elite Status 登记入口'],
 ['pron-hkplat-lounge-hant','登記 as a noun: "登記資格"','呢張卡已經包含 Global Lounge Collection 嘅登記資格'],
 ['ret-hkplat-after-red-hant','登記 as a noun: "登記步驟"','以上已係全部嘅登記步驟'],
 ['ret-hkplat-after-red-hant','Cantonese attribute 嘅: "已登記嘅白金卡"','經 Amex Travel 用已登記嘅白金卡預訂'],
 ['ord-ms-5-hans','an instrument phrase: "通过已关联…的"','通过已关联 Amex 账户的 Airbnb Luxe 预订'],
 ['ord-ms-5-hans','an instrument phrase with 嘅: "用已關聯…嘅"','用已關聯 Amex 嘅 Airbnb 帳戶預訂'],
 ['same-marriott-hk-hant','a condition: "完成即享"','登記同關聯完成即享 Gold Elite'],
 ['long-sr-ord-zh-Hant','automatic activation the terms state: "已自動啟用"','主卡同附屬卡嘅 Priority Pass Select 已自動啟用，入場要實體卡或 Priority Pass 電子卡'],
];
for(const [id,what,answer] of describing)test(`${id}: ${what} is not an enrolment claim (#362)`,()=>{
 assert.ok(!codes(answer,evidenceFor(id)).includes('unverified_enrollment'),answer);
});

test('the six dialogues pass the full loop with a plausible Chinese answer (#362)',async()=>{
 const page='https://www.americanexpress.com/hk/en/credit-cards/platinum-card/';
 for(const [id,answer] of [
  ['ret-hkplat-after-red-hant',`Fine Hotels + Resorts 要經 Amex Travel Online 預訂，用已登記嘅白金卡付款；早餐、退房等待遇按酒店及訂單條款（來源：${page}）`],
  ['pron-hkplat-lounge-hant',`有，呢張卡已經包含 Global Lounge Collection；參與休息室、登記、攜客同航班條件各異（來源：${page}）`],
  ['long-sr-ord-zh-Hant','第二個係 Priority Pass：主卡同附屬卡嘅 Priority Pass Select 已自動啟用，入場要實體卡或 Priority Pass 電子卡，攜客有限制。'],
  ['long-hkplat-hans',`香港白金卡已附送 ALL Accor 精英会籍（需登记），具体等级和登记方法以专属页面为准（来源：${page}）`],
  ['same-marriott-hk-hant',`香港白金卡已包含 Marriott Gold 會籍但需登記，再關聯 Marriott Bonvoy 帳戶（來源：${page}）`],
  ['ord-ms-5-hans','第5项是住宿预订抵扣：经 Amex Travel 预付 FHR、THC 或 Airbnb Luxe，Airbnb Luxe 要通过已关联 Amex 账户的 Airbnb 账户预订，THC 和 Airbnb Luxe 须连续两晚。'],
 ]){
  const d=byId(id),{finalResult}=await replay(d,{finalRequest:scripted(d,answer)});
  assert.ok(!finalResult.trace.some(t=>t.type==='repair'),id+': grounded on the first answer');
 }
});

test('an answer that claims enrolment the evidence does not support is still rejected (#362)',async()=>{
 const claims=[
  ['same-marriott-hk-hant','你嘅 Marriott Gold 會籍已經登記好'],
  ['same-marriott-hk-hant','Marriott 帳戶已關聯，Gold 會籍已生效'],
  ['same-marriott-hk-hant','已經幫你登記好 Marriott 會籍'],
  ['same-marriott-hk-hant','登記完成，你現在可以享受金卡禮遇'],
  ['long-hkplat-hans','ALL Accor 会籍已登记，需要时直接出示会员号'],
  ['long-hkplat-hans','你的 ALL Accor 会籍已经开通'],
  ['ord-ms-5-hans','你的 Airbnb 账户已关联 Amex'],
  ['ret-hkplat-after-red-hant','我用已登記嘅白金卡幫你預訂咗'],
  // Automatic activation is grounded only by a record that says so: the Marriott record needs enrolment.
  ['same-marriott-hk-hant','Marriott Gold 會籍已自動開通'],
  // An activation the evidence calls automatic does not cover another enrolment in the same clause.
  ['long-sr-ord-zh-Hant','Priority Pass 已登記並自動啟用'],
 ];
 for(const [id,answer] of claims){
  const found=codes(answer,evidenceFor(id));
  assert.ok(found.includes('unverified_enrollment')||found.includes('unauthorized_action_claim'),`${id}: ${answer} → ${found}`);
 }
 // Without evidence of automatic activation, "已自動啟用" stays a claim.
 assert.deepEqual(actionClaimIssues('Priority Pass Select 已自動啟用').map(i=>i.code),['unverified_enrollment']);
 assert.deepEqual(actionClaimIssues('Priority Pass Select 已自動啟用',{autoActivation:true}),[]);
 // With an agent in the clause the wording stays strict, even with a requirement word.
 assert.ok(actionClaimIssues('我已經幫你登記，唔需要再做').length>0);
 const d=byId('same-marriott-hk-hant');
 await assert.rejects(()=>replay(d,{finalRequest:scripted(d,'你嘅 Marriott Gold 會籍已經登記好。')}),/answer_not_grounded/);
});
