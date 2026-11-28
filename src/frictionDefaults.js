// Defaults that replace a question or a required field (stl00/Cardybara#680). Pure, so tests can pin them.
/**
 * The answer preselected for each merge question: its first candidate, unless another question also names that card.
 * Then picking one would be a guess about which bank card it is, so the question stays unanswered.
 */
export function preselectedMerges(questions){
 const claims=new Map();
 for(const q of questions)for(const c of q.manual)claims.set(c.id,(claims.get(c.id)||0)+1);
 const picked={};
 for(const q of questions){const first=q.manual.find(c=>claims.get(c.id)===1);if(first)picked[q.bank.id]=first.id;}
 return picked;
}
/**
 * The name a card from the "not in the list" form is saved under when the user typed none. A catalogue card keeps
 * the empty name: the wallet fills in the product's own.
 */
export function manualCardName({name,productId,bankLabel},translate){
 const typed=String(name||'').trim();
 return typed||(productId?'':translate('{0} 信用卡',[bankLabel]));
}
