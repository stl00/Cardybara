// MVP is the default. Full collection remains available for deliberate legacy use.
export const MVP_KINDS=new Set(['card','billing','reward']);
export function mvpLink(link){if(/^(?:禮品換領|礼品换领)$/.test(link.label))return true;if(/^(?:賬項|账项)$/.test(link.label)){try{return /^\/activity(?:\/|$)/.test(new URL(link.href).pathname)}catch{return false}}return /rewards|points|statement|積分|积分|獎賞|奖赏|月結|月结/i.test(link.label)&&!/offer|benefit|優惠|优惠|福利|禮遇|礼遇|transaction|交易/i.test(link.label);}
export function mvpSummary(items,cards,initialPatches=[]){
 const coverage=cards.map(c=>{const keys=new Set(Object.keys(initialPatches.find(p=>p.id===c.id)?.fields||{}));for(const i of items.filter(i=>i.cardId===c.id&&['card','billing'].includes(i.kind)))keys.add(i.key);const missing=['balance',...(!keys.has('statement')&&!keys.has('statementClosing')?['statement']:[]),'minimum','due'].filter(k=>!keys.has(k));return {cardId:c.id,missing,complete:missing.length===0};});
 const readCards=new Set(items.filter(i=>i.kind==='reward').map(i=>i.cardId));
 return {card:{status:cards.length&&coverage.every(c=>c.complete)?'updated':coverage.some(c=>c.missing.length<4)?'partial':'not_found',count:items.filter(i=>['card','billing'].includes(i.kind)).length,coverage},reward:{status:cards.length&&cards.every(c=>readCards.has(c.id))?'updated':readCards.size?'partial':'not_found',count:items.filter(i=>i.kind==='reward').length,readCards:readCards.size,expectedCards:cards.length,coverage:cards.map(c=>({cardId:c.id,complete:readCards.has(c.id),missing:readCards.has(c.id)?[]:['reward']}))}};
}
