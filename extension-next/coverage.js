// Counts come from the visible, selected bank list. They are never inferred from
// the number of extracted records, and zero counters alone are not empty proof.
export function collectCoverage(previous,observed,cards){
 const map=new Map(previous.map(c=>[c.cardId+'|'+c.view,c]));
 for(const c of observed||[]){
  if(c?.kind!=='offer'||!cards.some(card=>card.id===c.cardId)||!['available','added','all'].includes(c.view)||!Number.isInteger(c.expected)||c.expected<0||c.expected>5000)continue;
  map.set(c.cardId+'|'+c.view,{kind:'offer',cardId:c.cardId,view:c.view,expected:c.expected,confirmedEmpty:c.confirmedEmpty===true});
 }
 return [...map.values()];
}
export function offerCoverage(items,coverage,cards){
 const count=items.filter(i=>i.kind==='offer').length;
 let expected=0,complete=cards.length>0,allCountsKnown=cards.length>0;
 for(const card of cards){
  const all=coverage.find(c=>c.cardId===card.id&&c.view==='all');if(all){expected+=all.expected;const received=new Set(items.filter(i=>i.kind==='offer'&&i.cardId===card.id).map(i=>i.key||i.title)).size;if(all.expected===0&&!all.confirmedEmpty)allCountsKnown=false;if(received!==all.expected||(all.expected===0&&!all.confirmedEmpty))complete=false;continue;}
  for(const view of ['available','added']){
  const entry=coverage.find(c=>c.cardId===card.id&&c.view===view);
  if(!entry){complete=false;allCountsKnown=false;continue;}expected+=entry.expected;
  const received=new Set(items.filter(i=>i.kind==='offer'&&i.cardId===card.id&&i.status===view).map(i=>i.title)).size;
  if(entry.expected===0&&!entry.confirmedEmpty)allCountsKnown=false;
  if(received!==entry.expected||(entry.expected===0&&!entry.confirmedEmpty))complete=false;
 }
 }
 return {count,expected:allCountsKnown?expected:null,complete};
}
