import {matchCardProduct} from './productCatalog.js';
// A bank-read card and a manual card of the same product are one card (stl00/Cardybara#417). The bank's readings
// (balance, statement, minimum, due date) stay with the bank-read card; what the user set by hand is moved onto it:
// fee date, bill typed in, display name, hidden flag, product choice, and every cost and benefit record that names
// the manual card's id. Pure functions: callers store the result and keep the undo record for one sync cycle.
const sameTail=(a,b)=>typeof a==='string'&&a&&a===b;
/** The product a card is, by the user's choice or by recognition; null when neither names exactly one. */
export function productOf(card,choices=[]){
 const picked=choices.find(c=>c.cardId===card.id)?.productId;
 if(picked)return picked;
 const m=matchCardProduct({...card,productId:undefined});
 return m.status==='matched'?m.product.id:null;
}
const manualTail=c=>c.tail||'';
const bankTail=c=>c.tail||c.detected?.tail||'';
/**
 * Pairs each bank-read card with a manual card. Rules: same bank, same recognised product, and the same last digits.
 * A manual card always has digits (`newWalletCard` requires 4-5, stl00/Cardybara#460), so a card without them never
 * matches. A pair the user undid (`declined`) is never offered again. A bank card with one candidate merges; with
 * several (stored data that holds two manual cards of one bank and digits, such as an older backup) it is
 * `ambiguous` and the caller asks once. A manual card claimed by two bank cards is ambiguous for both. Nothing is guessed.
 */
export function planCardMerges({manual,bank,choices=[],declined=[]}){
 const isDeclined=(m,b)=>declined.some(d=>d.manualId===m.id&&d.bankId===b.id);
 const candidates=new Map();
 for(const b of bank){
  const product=productOf(b);
  if(!product)continue;
  const list=manual.filter(m=>m.identitySource!=='bank-page'&&m.id!==b.id&&m.bank===b.bank&&productOf(m,choices)===product
   &&sameTail(manualTail(m),bankTail(b))&&!isDeclined(m,b));
  if(list.length)candidates.set(b.id,list);
 }
 const claims=new Map();
 for(const list of candidates.values())for(const m of list)claims.set(m.id,(claims.get(m.id)||0)+1);
 const merges=[],ambiguous=[];
 for(const [bankId,list] of candidates){
  if(list.length===1&&claims.get(list[0].id)===1)merges.push({manualId:list[0].id,bankId});
  else ambiguous.push({bankId,manualIds:list.map(m=>m.id)});
 }
 return {merges,ambiguous};
}
/** Moves the first element of a JSON-array key ([cardId, ...]) from one card id to another; other keys are unchanged. */
export function remapKey(key,from,to){
 try{const a=JSON.parse(key);if(Array.isArray(a)&&a[0]===from)return JSON.stringify([to,...a.slice(1)]);}catch{}
 return key;
}
// A cost event's key is ['fee', cardId, start] or ['account', cardId].
export function remapCostKey(key,from,to){
 try{const a=JSON.parse(key);if(Array.isArray(a)&&a[1]===from)return JSON.stringify([a[0],to,...a.slice(2)]);}catch{}
 return key;
}
/** Cost events (cardId) and benefit events (event.key) naming `from` now name `to`; returns the ids that moved so an undo can move them back. */
export function remapLedgers({costEvents=[],benefitEvents=[]},from,to){
 const moved=[];
 const cost=costEvents.map(e=>{if(e.cardId!==from)return e;moved.push(e.id);return {...e,cardId:to,key:remapCostKey(e.key,from,to)};});
 const benefit=benefitEvents.map(e=>{const key=remapKey(e.key,from,to);if(key===e.key)return e;moved.push(e.id);return {...e,key};});
 return {costEvents:cost,benefitEvents:benefit,moved};
}
const without=(rows,cardId)=>rows.filter(r=>r.cardId!==cardId);
/**
 * Merges manual card `manualId` into bank-read card `bank`. `state` is {registry, edits, choices, costEvents,
 * benefitEvents}; `cycle` is the sync-cycle counter now. Returns the new state and an `undo` record.
 */
export function applyCardMerge(state,manualId,bank,cycle){
 const manual=state.registry.find(c=>c.id===manualId&&c.identitySource!=='bank-page');
 if(!manual)throw Error('merge_no_manual_card');
 if(bank.identitySource!=='bank-page'||bank.id===manualId)throw Error('merge_not_bank_card');
 const own=state.edits.find(e=>e.cardId===manualId),theirs=state.edits.find(e=>e.cardId===bank.id);
 // The bank decides tail and bank; the user's own fields win over anything older on the bank-read card.
 const carried={};
 for(const f of ['feeDate','feeDateConflict','hidden','bill'])if(own?.[f]!=null)carried[f]=own[f];
 if(manual.name&&manual.name!==bank.name)carried.name=own?.name||manual.name;else if(own?.name)carried.name=own.name;
 const mergedRow={...theirs,...carried,cardId:bank.id};
 const edits=[...without(state.edits,manualId).filter(e=>e.cardId!==bank.id),...(Object.keys(mergedRow).length>1?[mergedRow]:[])];
 const choice=state.choices.find(c=>c.cardId===manualId);
 const choices=[...state.choices.filter(c=>c.cardId!==manualId&&!(choice&&c.cardId===bank.id)),...(choice?[{cardId:bank.id,productId:choice.productId}]:[])];
 const ledgers=remapLedgers(state,manualId,bank.id);
 const next={registry:state.registry.filter(c=>c.id!==manualId),edits,choices,costEvents:ledgers.costEvents,benefitEvents:ledgers.benefitEvents};
 return {state:next,undo:{manualId,bankId:bank.id,manual,manualEdit:own||null,bankEdit:theirs||null,choice:choice||null,bankChoice:choice?state.choices.find(c=>c.cardId===bank.id)||null:null,moved:ledgers.moved,cycle}};
}
/** A merge can be undone until the sync cycle after the one it happened in has finished. */
export const undoAvailable=(undo,cycle)=>!!undo&&cycle<=undo.cycle;
/** Puts the manual card back with everything that was moved, and returns the pair to remember as declined. */
export function undoCardMerge(state,undo,cycle){
 if(!undoAvailable(undo,cycle))throw Error('merge_undo_expired');
 const moved=new Set(undo.moved);
 const back=e=>!moved.has(e.id)?e:e.cardId!==undefined?{...e,cardId:undo.manualId,key:remapCostKey(e.key,undo.bankId,undo.manualId)}:{...e,key:remapKey(e.key,undo.bankId,undo.manualId)};
 const edits=state.edits.filter(e=>e.cardId!==undo.bankId&&e.cardId!==undo.manualId);
 if(undo.bankEdit)edits.push(undo.bankEdit);if(undo.manualEdit)edits.push(undo.manualEdit);
 const choices=state.choices.filter(c=>c.cardId!==undo.manualId&&!(undo.choice&&c.cardId===undo.bankId));
 if(undo.bankChoice)choices.push(undo.bankChoice);if(undo.choice)choices.push(undo.choice);
 return {state:{registry:[...state.registry.filter(c=>c.id!==undo.manualId),undo.manual],edits,choices,costEvents:state.costEvents.map(back),benefitEvents:state.benefitEvents.map(back)},declined:{manualId:undo.manualId,bankId:undo.bankId}};
}
