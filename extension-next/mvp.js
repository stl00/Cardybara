// MVP is the default. Full collection remains available for deliberate legacy use.
export const MVP_KINDS=new Set(['card','billing','reward']);
export function mvpLink(link){if(/^(?:禮品換領|礼品换领)$/.test(link.label))return true;if(/^(?:賬項|账项)$/.test(link.label)){try{return /^\/activity(?:\/|$)/.test(new URL(link.href).pathname)}catch{return false}}return /rewards|points|statement|積分|积分|獎賞|奖赏|月結|月结/i.test(link.label)&&!/offer|benefit|優惠|优惠|福利|禮遇|礼遇|transaction|交易/i.test(link.label);}
// Rewards required by this version, per issuer. structural: this is the product scope, not a page rule.
// Other programmes' code stays in place and runs only in full scope; here they are reported as not collected.
// Matched anywhere in the label: a page or model may print "Available Membership Rewards Points".
export const AMEX_REQUIRED_SOURCE='\\bMembership Rewards\\b|\\bMR\\b|美國運通積分|美国运通积分|會員積分|会员积分';
const REQUIRED_REWARDS={Chase:/\bUltimate Rewards\b|\bUR\b/i,Amex:new RegExp(AMEX_REQUIRED_SOURCE,'i')};
const requiredPattern=bank=>bank==='Chase'?REQUIRED_REWARDS.Chase:String(bank).startsWith('Amex ')?REQUIRED_REWARDS.Amex:null;
// Spacing, punctuation and a singular form do not make a required programme into another one.
const REQUIRED_COMPACT={Chase:/ultimatereward/,Amex:/membershipreward|美國運通積分|美国运通积分|會員積分|会员积分/};
export const requiredReward=(bank,programme)=>{const pattern=requiredPattern(bank);if(!pattern)return false;const label=String(programme).normalize('NFKC').replace(/[®™]/g,'').trim(),compact=label.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');return pattern.test(label)||(bank==='Chase'?REQUIRED_COMPACT.Chase:REQUIRED_COMPACT.Amex).test(compact);};
// Telling an Amex card holds another programme needs its brand: page wording alone cannot separate it from a
// generic label for the required balance. structural: scope data, used only to avoid hiding a missing reward.
// An unlisted name stays partial with the name shown. A listed name on a card missing its required value still reads as not collected.
const AMEX_OTHER_PROGRAMMES=/\b(?:Hilton|Marriott|Bonvoy|Delta|SkyMiles|Reward Dollars|Cash Back|Cash Rewards|Aeroplan)\b/i;
export const confirmedOtherProgramme=(bank,programme)=>!String(bank).startsWith('Amex ')||AMEX_OTHER_PROGRAMMES.test(String(programme));
export function mvpSummary(items,cards,initialPatches=[],notCollected={}){
 const coverage=cards.map(c=>{const keys=new Set(Object.keys(initialPatches.find(p=>p.id===c.id)?.fields||{}));for(const i of items.filter(i=>i.cardId===c.id&&['card','billing'].includes(i.kind)))keys.add(i.key);const absent=['balance',...(!keys.has('statement')&&!keys.has('statementClosing')?['statement']:[]),'minimum','due'].filter(k=>!keys.has(k));
  // An explicit bank statement that no payment is due satisfies minimum and due with its recorded reason (docs/RELEASE.md). The values stay unknown, and a printed minimum or due date overrides it.
  const own=items.filter(i=>i.cardId===c.id),conflict=own.some(i=>(i.key==='minimum'&&i.value>0)||['due','duePartial'].includes(i.key))||initialPatches.find(p=>p.id===c.id)?.fields?.minimum>0,reason=conflict?null:own.findLast(i=>i.kind==='billing'&&i.key==='paymentStatus')?.title,notApplicable=reason?absent.filter(k=>['minimum','due'].includes(k)):[],missing=absent.filter(k=>!notApplicable.includes(k));
  return {cardId:c.id,missing,complete:missing.length===0,...(notApplicable.length?{notApplicable,reason}:{})};});
 const readCards=new Set(items.filter(i=>i.kind==='reward').map(i=>i.cardId));
 const rewardCoverage=cards.map(c=>{
  if(readCards.has(c.id))return {cardId:c.id,complete:true,missing:[]};
  const seen=[...(notCollected[c.id]||[])],other=seen.filter(name=>confirmedOtherProgramme(c.bank,name)),unconfirmed=seen.filter(name=>!other.includes(name));
  // No required programme at this bank, or the page confirms this card has another programme.
  if((c.bank&&!requiredPattern(c.bank))||other.length)return {cardId:c.id,complete:true,missing:[],notCollected:other};
  return {cardId:c.id,complete:false,missing:['reward'],...(unconfirmed.length?{reason:'programme_unconfirmed',unconfirmed}:{reason:'reward_not_seen'})};
 });
 const allDone=cards.length&&rewardCoverage.every(c=>c.complete);
 return {card:{status:cards.length&&coverage.every(c=>c.complete)?'updated':coverage.some(c=>c.missing.length<4)?'partial':'not_found',count:items.filter(i=>['card','billing'].includes(i.kind)).length,coverage},reward:{status:allDone?(readCards.size?'updated':'not_collected'):readCards.size||rewardCoverage.some(c=>c.complete)?'partial':'not_found',count:items.filter(i=>i.kind==='reward').length,readCards:readCards.size,expectedCards:cards.length,coverage:rewardCoverage}};
}
