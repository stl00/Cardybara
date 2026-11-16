// Synthetic issuer-redemption records for tests and screenshots only (#308). They follow the shape src/issuerRedemptions.js
// expects from #307; values are invented round numbers, never production data and never imported by src/.
const S={MR:'programme.amex-membership-rewards-us',UR:'programme.chase-ultimate-rewards'};
export const GOLD='amex-us-us-american-express-gold-card',CSR='chase-us-sapphire-reserve';
const base={centsPerPoint:1,productIds:null,conditionText:'',sourceIds:[],checkedAt:'2026-11-16'};
export const syntheticRedemptions=[
 {...base,id:'syn.mr.cash',programmeId:S.MR,kind:'statement-credit',centsPerPoint:0.6,conditionText:'Synthetic: any card of the programme',sourceIds:['mr-us-multiple-cards']},
 {...base,id:'syn.mr.portal',programmeId:S.MR,kind:'travel-portal',centsPerPoint:1,productIds:[GOLD],conditionText:'Synthetic: needs the Gold card',sourceIds:['mr-us-multiple-cards']},
 {...base,id:'syn.mr.gift',programmeId:S.MR,kind:'gift-card',centsPerPoint:'varies',conditionText:'Synthetic: depends on the merchant'},
 {...base,id:'syn.ur.cash',programmeId:S.UR,kind:'cash-back',centsPerPoint:1,conditionText:'Synthetic: any card of the programme',sourceIds:['chase-combine-points']},
 {...base,id:'syn.ur.portal',programmeId:S.UR,kind:'travel-portal',centsPerPoint:1.5,productIds:[CSR],conditionText:'Synthetic: needs the Reserve card',sourceIds:['chase-combine-points']},
 {...base,id:'syn.ur.gift',programmeId:S.UR,kind:'gift-card',centsPerPoint:null,conditionText:'Synthetic: value not recorded'}
];
