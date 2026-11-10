// Frozen held-out assistant cases. Written 2026-11-09 from public card terms, before any run against this code.
// Never tune against these. A case that fails and is then fixed moves to evals/fixtures.mjs and is replaced here;
// any edit to this file must update evals/holdout/manifest.json, which a test checks.
// Synthetic public products only: no account snapshot, balance, tail digits or personal ledger.
import {creditMark} from '../fixtures.mjs';
const GOLD='amex-us-us-american-express-gold-card',GOLD_DINING='rule.amex-us-us-american-express-gold-card.dining';
const inGroup=(r,group,card)=>(r.groups?.[group]||[]).filter(i=>i.card===card);
const row=(r,card)=>r.rows?.find(x=>x.card===card);
export const retrievalCases=[
 {id:'ho-trip-cancel-insurance',query:'机票退了，行程取消有保险赔吗',expected:['rule.chase-us-sapphire-reserve.trip-cancel']},
 {id:'ho-rental-collision-en',query:'rental car collision damage coverage',expected:['rule.chase-us-sapphire-reserve.rental']},
 {id:'ho-checked-bag',query:'托运行李能免费吗',expected:['rule.chase-us-united-quest.bags']},
 {id:'ho-global-entry-cantonese',query:'辦Global Entry有冇得報銷',expected:['rule.chase-us-sapphire-reserve.global-entry']},
 {id:'ho-clear-security',query:'机场 CLEAR 安检会员能报销吗',expected:['rule.amex-us-us-morgan-stanley-platinum-card.clear']},
 {id:'ho-walmart-plus-en',query:'Walmart+ membership credit',expected:['rule.amex-us-us-morgan-stanley-platinum-card.walmart']},
 {id:'ho-concert-tickets',query:'买演唱会门票有没有抵扣',expected:['rule.chase-us-sapphire-reserve.stubhub']},
 {id:'ho-extended-warranty',query:'买电器能延长保修吗',expected:['rule.chase-us-sapphire-reserve.warranty']},
 {id:'ho-delayed-bag-en',query:'my checked bag arrived late, is there coverage',expected:['rule.chase-us-sapphire-reserve.baggage-delay']},
 {id:'ho-ihg-anniversary-night',query:'洲际每年送的免费房晚',expected:['rule.chase-us-ihg-premier.anniversary-new']},
 {id:'ho-cathay-miles-cantonese',query:'國泰亞洲萬里通里數點樣賺',expected:['rule.sc-hk-hk-cathay-mastercard.miles']},
 {id:'ho-nonsense-empty',query:'量子传送舱年度福利',expected:[],empty:true},
];
const usd=(category,amount)=>({category,amount,currency:'USD',country:'US'});
export const decisionCases=[
 // Blue Cash Everyday earns 3% at US supermarkets; the flat and grocery-tier cash cards earn less.
 {id:'ho-choice-supermarket-cash-back',args:usd('supermarket',200),check:r=>r.choice?.card==='Blue Cash Everyday'&&r.choice.value===6},
 // US gas: 3% on Blue Cash Everyday, or on Customized Cash only if gas is the chosen category.
 {id:'ho-choice-gas',args:usd('gas',50),check:r=>['Blue Cash Everyday','Customized Cash Rewards Visa Signature'].includes(r.choice?.card)&&r.choice.value>=1.5},
 // Online retail cap: 3% on the first 6,000 USD a year at Blue Cash Everyday, then 1%.
 {id:'ho-choice-online-retail-cap',args:usd('online-retail',7000),check:r=>row(r,'Blue Cash Everyday')?.earn?.capExceeded===true&&row(r,'Blue Cash Everyday')?.earn?.reward===190},
 // Flights booked direct: 5x MR on the Platinum card. Without a stated value points are shown, not ranked.
 {id:'ho-choice-flight-points-unpriced',args:usd('flight',100),check:r=>r.choice?.valuedPoints===false&&r.pointsAlternatives?.some(p=>p.card==='Morgan Stanley Platinum Card')},
 {id:'ho-choice-flight-points-priced',args:{...usd('flight',100),pointValues:{MR:1}},check:r=>r.choice?.card==='Morgan Stanley Platinum Card'&&r.choice.value===5&&r.choice.valuedPoints===true},
 // A marked-unused dining credit at a dining merchant it covers is used before earn.
 {id:'ho-choice-marked-credit-wins',args:{category:'dining',merchant:'Grubhub',amount:20,currency:'USD',country:'US'},events:[creditMark(GOLD,GOLD_DINING,'2026-10-01','2026-10-31','unused')],check:r=>r.choice?.card==='American Express Gold Card'},
];
const window=(r,start,end)=>r.window?.start===start&&r.window?.end===end;
export const planCases=[
 {id:'ho-plan-dining-november',use:'dining',when:'11月',check:r=>window(r,'2026-11-01','2026-11-30')&&r.groups.markedUnused.length===0&&inGroup(r,'unknownStatus','American Express Gold Card').length>0},
 {id:'ho-plan-english-range',when:'Nov 20 to Nov 27',check:r=>window(r,'2026-11-20','2026-11-27')},
 {id:'ho-plan-marked-used',use:'dining',when:'10月',events:[creditMark(GOLD,GOLD_DINING,'2026-10-01','2026-10-31','used')],check:r=>inGroup(r,'markedUsed','American Express Gold Card').length===1&&inGroup(r,'markedUnused','American Express Gold Card').length===0},
];
export const publicRuleCases=[
 {id:'ho-hk-platinum-published-fee',args:{kind:'fee',region:'HK',cardName:'The Platinum Card'},role:'primary',terms:{currency:'HKD',actualCharge:null}},
];
// [id, answer, evidence, expected issue code]
export const groundingCases=[
 ['ho-claims-transfer','我已经帮你把积分转到 Hilton 了。',[],'unauthorized_action_claim'],
 ['ho-claims-enrollment-en','You are now enrolled in the hotel offer.',[],'unverified_enrollment'],
 ['ho-invented-ratio','积分按 1:2 转入 Hilton。',[{rules:[{kind:'transfer-relationship',revision:1,terms:{ratio:null}}]}],'unsupported_transfer_ratio'],
 ['ho-invented-link','See [details](https://made-up-terms.example/card).',[],'unsupported_citation'],
 ['ho-invented-points','This purchase earns 450 points.',[],'unsupported_number'],
];
