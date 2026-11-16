// Issuer fixed-value redemptions for US Membership Rewards and Ultimate Rewards (#307).
// A value is a number only when an official page states it; "varies" and null (unknown) never become numbers.
import data from './data/knowledge/fixed-redemptions.json' with {type:'json'};

export const FIXED_REDEMPTION_PROGRAMMES=['programme.amex-membership-rewards-us','programme.chase-ultimate-rewards'];
export const fixedRedemptionSources=structuredClone(data.sources);
export const fixedRedemptions=structuredClone(data.redemptions);
export const fixedRedemptionsCheckedAt=data.checkedAt;
export const fixedRedemptionsFor=programmeId=>fixedRedemptions.filter(r=>r.programmeId===programmeId);

/** Errors in the redemption data: no source or date, a value that is neither a number, "varies" nor unknown, or a programme outside US MR/UR. */
export function validateFixedRedemptions(d=data){
 const errors=[],sources=new Map((d.sources||[]).map(s=>[s.id,s])),seen=new Set(),date=/^20\d{2}-\d{2}-\d{2}$/;
 for(const s of d.sources||[]){
  if(!/^https:\/\//.test(s.url||''))errors.push(`source ${s.id}: url`);
  if(!date.test(s.checkedAt||''))errors.push(`source ${s.id}: checkedAt`);
  if(s.authority!=='official')errors.push(`source ${s.id}: only official issuer pages are accepted`);
 }
 for(const r of d.redemptions||[]){
  const fail=m=>errors.push(`${r.id}: ${m}`);
  if(seen.has(r.id))fail('duplicate id');seen.add(r.id);
  if(!FIXED_REDEMPTION_PROGRAMMES.includes(r.programmeId))fail('programme outside US Membership Rewards / Ultimate Rewards');
  if(r.region!=='US')fail('region must be US');
  if(!r.kind)fail('kind');
  const v=r.centsPerPoint;
  if(!(v===null||v==='varies'||(typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=10)))fail('centsPerPoint must be a number, "varies" or null');
  if(v===null&&!r.unknownReason)fail('unknown value needs a reason');
  if(typeof r.dependsOn!=='string'||!r.dependsOn)fail('dependsOn');
  if(!date.test(r.checkedAt||''))fail('checkedAt');
  if(!r.textEn||!r.textZh)fail('English source text and Simplified Chinese');
  if(!r.sourceIds?.length||r.sourceIds.some(id=>!sources.has(id)))fail('missing source');
 }
 return errors;
}
