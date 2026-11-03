// MVP is the default. Full collection remains available for deliberate legacy use.
export const MVP_KINDS=new Set(['card','billing','reward']);
export function mvpLink(link){if(/^(?:禮品換領|礼品换领)$/.test(link.label))return true;if(/^(?:賬項|账项)$/.test(link.label)){try{return /^\/activity(?:\/|$)/.test(new URL(link.href).pathname)}catch{return false}}return /rewards|points|statement|積分|积分|獎賞|奖赏|月結|月结/i.test(link.label)&&!/offer|benefit|優惠|优惠|福利|禮遇|礼遇|transaction|交易/i.test(link.label);}
// Rewards required by this version, per issuer. structural: this is the product scope, not a page rule.
// Other programmes' code stays in place and runs only in full scope; here they are reported as not collected.
const REQUIRED_REWARDS={Chase:/^Ultimate Rewards\b/i,Amex:/^(?:Membership Rewards\b|美國運通積分|美国运通积分)/i};
const requiredPattern=bank=>bank==='Chase'?REQUIRED_REWARDS.Chase:String(bank).startsWith('Amex ')?REQUIRED_REWARDS.Amex:null;
export const requiredReward=(bank,programme)=>!!requiredPattern(bank)?.test(String(programme).replace(/[®™]/g,'').trim());
export function mvpSummary(items,cards,initialPatches=[],notCollected={}){
 const coverage=cards.map(c=>{const keys=new Set(Object.keys(initialPatches.find(p=>p.id===c.id)?.fields||{}));for(const i of items.filter(i=>i.cardId===c.id&&['card','billing'].includes(i.kind)))keys.add(i.key);const absent=['balance',...(!keys.has('statement')&&!keys.has('statementClosing')?['statement']:[]),'minimum','due'].filter(k=>!keys.has(k));
  // An explicit bank statement that no payment is due satisfies minimum and due with its recorded reason (docs/RELEASE.md). The values stay unknown, and a printed minimum or due date overrides it.
  const own=items.filter(i=>i.cardId===c.id),conflict=own.some(i=>(i.key==='minimum'&&i.value>0)||['due','duePartial'].includes(i.key))||initialPatches.find(p=>p.id===c.id)?.fields?.minimum>0,reason=conflict?null:own.findLast(i=>i.kind==='billing'&&i.key==='paymentStatus')?.title,notApplicable=reason?absent.filter(k=>['minimum','due'].includes(k)):[],missing=absent.filter(k=>!notApplicable.includes(k));
  return {cardId:c.id,missing,complete:missing.length===0,...(notApplicable.length?{notApplicable,reason}:{})};});
 const readCards=new Set(items.filter(i=>i.kind==='reward').map(i=>i.cardId));
 const rewardCoverage=cards.map(c=>{
  if(readCards.has(c.id))return {cardId:c.id,complete:true,missing:[]};
  const other=[...(notCollected[c.id]||[])];
  // No required programme at this bank, or the page shows this card has another programme.
  if((c.bank&&!requiredPattern(c.bank))||other.length)return {cardId:c.id,complete:true,missing:[],notCollected:other};
  return {cardId:c.id,complete:false,missing:['reward'],reason:'reward_not_seen'};
 });
 const allDone=cards.length&&rewardCoverage.every(c=>c.complete);
 return {card:{status:cards.length&&coverage.every(c=>c.complete)?'updated':coverage.some(c=>c.missing.length<4)?'partial':'not_found',count:items.filter(i=>['card','billing'].includes(i.kind)).length,coverage},reward:{status:allDone?(readCards.size?'updated':'not_collected'):readCards.size||rewardCoverage.some(c=>c.complete)?'partial':'not_found',count:items.filter(i=>i.kind==='reward').length,readCards:readCards.size,expectedCards:cards.length,coverage:rewardCoverage}};
}
