// Whether a credit applies to a purchase, decided only from a rule's sourced decisionFields.
// A field that is not recorded is unknown, never assumed satisfied, so most credits stay conditional.
export const DECISION_FIELDS={
 enrollment:v=>['required','not-required','link-card'].includes(v),
 channels:v=>Array.isArray(v)&&v.length>0&&v.every(c=>['direct','portal'].includes(c)),
 minimumNights:v=>Number.isInteger(v)&&v>0,
 prepaidOnly:v=>v===true,
 excludedPurchases:v=>Array.isArray(v)&&v.length>0&&v.every(c=>typeof c==='string'&&/^[a-z]+(-[a-z]+)*$/.test(c))
};
// Fields every credit needs before code can call it applicable without asking anything.
const REQUIRED_FOR_APPLICABLE=['enrollment','channels'];

/** Errors for a rule's decisionFields: each field needs a known value and a quote copied from the rule's own original source text. */
export function validateDecisionFields(rule){
 const fields=rule.decisionFields;if(fields===undefined)return [];
 if(!fields||typeof fields!=='object'||Array.isArray(fields))return ['decisionFields must be an object'];
 const errors=[],quotes=rule.original?.quotes||[];
 for(const [key,field] of Object.entries(fields)){
  if(!DECISION_FIELDS[key]){errors.push(`decisionFields: unknown field ${key}`);continue;}
  if(!field||!DECISION_FIELDS[key](field.value))errors.push(`decisionFields.${key}: invalid value`);
  if(!field?.sourceId||!rule.evidence.sourceIds.includes(field.sourceId))errors.push(`decisionFields.${key}: needs a source the rule cites`);
  if(typeof field?.quote!=='string'||!field.quote.trim()||!quotes.some(q=>q.sourceId===field.sourceId&&q.text.includes(field.quote)))errors.push(`decisionFields.${key}: quote must be copied from the rule's original quotes for that source`);
 }
 const coupon=rule.terms.coupon;
 if(fields.enrollment&&coupon&&coupon.enrollment!=='unknown'&&coupon.enrollment!==fields.enrollment.value)errors.push('decisionFields.enrollment disagrees with coupon.enrollment');
 if(fields.minimumNights&&coupon?.minimumNights!=null&&coupon.minimumNights!==fields.minimumNights.value)errors.push('decisionFields.minimumNights disagrees with coupon.minimumNights');
 return errors;
}

const norm=s=>String(s||'').normalize('NFKC').toLowerCase();
const portalWords=s=>norm(s).split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!['travel','the','and','com','portal'].includes(w));
const samePortal=(named,via)=>{const b=new Set(portalWords(via));return portalWords(named).some(w=>b.has(w));};

/**
 * applicable: every recorded field is satisfied and enrollment and channel are known to need nothing more.
 * not-applicable: a recorded field rules this purchase out.
 * conditional: something must still be true, or a field is not recorded.
 * purchase: {channel, portal, nights}; any of them may be missing.
 */
export function creditApplicability(rule,purchase={}){
 const f=rule.decisionFields||{},unmet=[],needs=[];
 const unrecorded=REQUIRED_FOR_APPLICABLE.filter(k=>!f[k]);
 if(f.enrollment&&f.enrollment.value!=='not-required')needs.push(f.enrollment.value==='link-card'?'card-linked':'enrolled');
 if(f.channels){
  const allowed=f.channels.value,channel=purchase.channel;
  if(channel==='direct'||channel==='portal'){
   if(!allowed.includes(channel))unmet.push(allowed.includes('portal')?'booked-through-portal':'paid-directly');
   else if(channel==='portal'&&f.channels.via&&purchase.portal&&!samePortal(purchase.portal,f.channels.via))unmet.push('booked-through-portal');
   else if(channel==='portal'&&f.channels.via&&!purchase.portal)needs.push('booked-through-portal');
  }else needs.push(allowed.includes('portal')?'booked-through-portal':'paid-directly');
 }
 if(f.minimumNights){
  if(Number.isInteger(purchase.nights)){if(purchase.nights<f.minimumNights.value)unmet.push('minimum-nights');}
  else needs.push('minimum-nights');
 }
 if(f.prepaidOnly)needs.push('prepaid');
 if(f.excludedPurchases)needs.push('not-an-excluded-purchase');
 const status=unmet.length?'not-applicable':needs.length||unrecorded.length?'conditional':'applicable';
 return {status,...(unmet.length?{unmet}:{}),...(needs.length?{needs}:{}),...(unrecorded.length?{unrecorded}:{}),
  ...(f.channels?.via?{via:f.channels.via}:{}),...(f.minimumNights?{minimumNights:f.minimumNights.value}:{}),...(f.excludedPurchases?{excludedPurchases:f.excludedPurchases.value}:{})};
}
