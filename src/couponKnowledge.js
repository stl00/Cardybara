// Public redemption mechanics only. Never infers enrollment, usage or eligibility.
export function validateCoupon(c,terms,sourceIds=[]){
 const errors=[],fail=message=>errors.push(message);
 const fields=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&keys.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>keys.includes(k));
 if(!c||typeof c!=='object'||Array.isArray(c))return ['invalid coupon object'];
 const keys=['schema','delivery','capScope','enrollment','eligibleCountries','eligibleMerchants','eligibleChannels','excludedPurchases','conditionalPurchases','redemption','carryover','posting','refundPolicy','additionalCards','minimumNights','review'];
 if(keys.some(k=>!Object.hasOwn(c,k))||Object.keys(c).some(k=>!keys.includes(k)))fail('coupon fields');
 if(c.schema!==1)fail('coupon schema');
 for(const [value,list,label] of [[c.delivery,['statement-credit','wallet-credit','checkout-discount'],'delivery'],[c.capScope,['card-account','primary-cardmember','person','unknown'],'cap scope'],[c.enrollment,['required','link-card','not-required','unknown'],'enrollment']])if(!list.includes(value))fail(label);
 for(const key of ['eligibleCountries','eligibleMerchants','eligibleChannels','excludedPurchases','conditionalPurchases'])if(!Array.isArray(c[key])||c[key].some(v=>typeof v!=='string'||!v.trim())||new Set(c[key]).size!==c[key].length)fail(key);
 if(Array.isArray(c.eligibleCountries)&&c.eligibleCountries.some(country=>!(/^[A-Z]{2}$/).test(country)))fail('country code');
 if(![null,true,false].includes(c.carryover))fail('carryover');
 if(!(c.minimumNights===null||Number.isInteger(c.minimumNights)&&c.minimumNights>0))fail('minimum nights');
 const r=c.redemption;
 if(!fields(r,['mode','couponsPerPeriod','perCouponAmount','separateOrders','unusedPortionForfeited'])||!['cumulative','single-coupon','multiple-coupons'].includes(r.mode))fail('redemption');
 else{
  if(![null,true,false].includes(r.separateOrders)||![null,true,false].includes(r.unusedPortionForfeited))fail('coupon usage semantics');
  if(r.mode!=='cumulative'){
   if(!Number.isInteger(r.couponsPerPeriod)||r.couponsPerPeriod<1||!Number.isFinite(r.perCouponAmount)||r.perCouponAmount<=0)fail('coupon units');
   if(r.mode==='single-coupon'&&r.couponsPerPeriod!==1)fail('single coupon count');
   const total=terms.amount*(terms.quantity||1);
   if(!Number.isFinite(total)||Math.abs(r.couponsPerPeriod*r.perCouponAmount-total)>0.001)fail('coupon units disagree with public limit');
  }else if(r.couponsPerPeriod!==null||r.perCouponAmount!==null)fail('cumulative is not a coupon count');
 }
 if(c.enrollment==='required'&&terms.requiresEnrollment!==true||c.enrollment==='not-required'&&terms.requiresEnrollment===true)fail('enrollment conflict');
 const p=c.posting;
 if(!fields(p,['maximumDays','timingBasis','deadlineTimeZone'])||!['merchant-reported-date','account-posting-date','merchant-wallet','checkout','unknown'].includes(p.timingBasis)||!(p.maximumDays===null||Number.isInteger(p.maximumDays)&&p.maximumDays>=0))fail('posting');
 if(p?.deadlineTimeZone!==null){if(typeof p?.deadlineTimeZone!=='string')fail('deadline timezone');else try{new Intl.DateTimeFormat('en',{timeZone:p.deadlineTimeZone}).format()}catch{fail('deadline timezone')}}
 if(typeof c.refundPolicy!=='string'||!c.refundPolicy.trim())fail('refund policy');
 if(!fields(c.additionalCards,['eligible','sharesCap'])||!['eligible','sharesCap'].every(k=>[null,true,false].includes(c.additionalCards[k])))fail('additional cards');
 const review=c.review;
 if(!fields(review,['checkedAt','sourceIds','section','access','unresolved'])||typeof review.checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(review.checkedAt)||!Number.isFinite(Date.parse(review.checkedAt+'T00:00:00Z'))||new Date(review.checkedAt+'T00:00:00Z').toISOString().slice(0,10)!==review.checkedAt||!Array.isArray(review.sourceIds)||!review.sourceIds.length||review.sourceIds.some(id=>!sourceIds.includes(id))||typeof review.section!=='string'||!review.section.trim()||!['official-page','official-indexed-terms','mixed'].includes(review.access)||!Array.isArray(review.unresolved)||review.unresolved.some(x=>typeof x!=='string'||!x.trim()))fail('coupon evidence');
 return errors;
}
