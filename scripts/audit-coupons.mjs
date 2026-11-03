// Public inventory and editorial coverage, not personal remaining benefits.
import {writeFile} from 'node:fs/promises';
import {queryKnowledge,validateKnowledge,knowledgeManifest} from '../src/knowledge.js';
const asOf=process.argv.find(x=>x.startsWith('--as-of='))?.slice(8)||knowledgeManifest.asOf;
const rows=queryKnowledge({kind:'benefit',asOf}).rules.filter(r=>['credit','promo'].includes(r.category));
const rules=rows.map(r=>({ruleId:r.id,revision:r.revisionId,title:r.content.title,productIds:r.productIds,period:r.terms.period,amount:r.terms.amount??null,currency:r.terms.currency??null,structuredCoupon:!!r.terms.coupon,reviewedAt:r.terms.coupon?.review.checkedAt||null,sourceAccess:r.terms.coupon?.review.access||null,unresolved:r.terms.coupon?.review.unresolved||['Only summary reviewed; detailed redemption restrictions require audit.']}));
const report={schema:1,asOf,snapshotId:knowledgeManifest.snapshotId,scope:'Active public credit/promo rules, including non-monetary and non-periodic promotions. Not an exhaustive product benefit inventory.',valid:validateKnowledge().valid,summary:{activeCreditPromoRules:rules.length,structuredCouponRules:rules.filter(r=>r.structuredCoupon).length,summaryOnlyRules:rules.filter(r=>!r.structuredCoupon).length},rules};
const out=process.argv.find(x=>x.startsWith('--out='))?.slice(6);
if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({valid:report.valid,asOf,...report.summary,...(out?{report:out}:{})}));
if(!report.valid)process.exitCode=1;
