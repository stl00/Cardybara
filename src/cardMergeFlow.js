import {planCardMerges,applyCardMerge,undoCardMerge,undoAvailable} from './cardMerge.js';
import {WALLET_CARDS_KEY} from './walletRegistry.js';
import {CARD_EDITS_KEY,readCardEdits} from './cardEdits.js';
import {CARD_PRODUCT_KEY,readCardProductChoices} from './cardProductChoice.js';
// The wallet-side flow of the card merge engine (stl00/Cardybara#457): reads the stores, plans, applies the merges
// that are unambiguous, saves everything the engine changed, and keeps the undo record and the pairs the user declined.
// `io` is {readCostEvents, readBenefitEvents, rewriteCostEvents, rewriteBenefitEvents}, so tests can pass fakes.
/** Pairs the user said are not the same card (document section cardMerges: they follow the wallet to other devices). */
export const MERGE_DECLINED_KEY='cardybara-card-merges-v1';
/** Undo records and the sync-cycle counter. This device only: an undo lasts one sync cycle and its ledger ids are local. */
export const MERGE_STATE_KEY='cardybara-card-merge-state-v1';
const MAX_DECLINED=200,MAX_UNDOS=20;
const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key))}catch{return null}};
const pair=p=>p&&typeof p.manualId==='string'&&p.manualId.length<=100&&typeof p.bankId==='string'&&p.bankId.length<=100;
const cleanDeclined=rows=>Array.isArray(rows)?rows.filter(pair).slice(-MAX_DECLINED).map(({manualId,bankId})=>({manualId,bankId})):[];
export const readDeclined=storage=>{const d=read(storage,MERGE_DECLINED_KEY);return d?.schema===1?cleanDeclined(d.declined):[]};
const writeDeclined=(storage,declined)=>storage.setItem(MERGE_DECLINED_KEY,JSON.stringify({schema:1,declined:cleanDeclined(declined)}));
/** Backup and sync: the union of declined pairs. A backup with a malformed section is refused whole. */
export function mergeDeclinedPairs(declined,backup){
 if(backup?.schema!==1||!Array.isArray(backup.declined)||backup.declined.length>MAX_DECLINED||cleanDeclined(backup.declined).length!==backup.declined.length)throw Error('invalid_card_merges_backup');
 const all=new Map(declined.map(p=>[p.manualId+'\n'+p.bankId,p]));for(const p of cleanDeclined(backup.declined))all.set(p.manualId+'\n'+p.bankId,p);
 return [...all.values()].slice(-MAX_DECLINED);
}
export function readMergeState(storage){
 const s=read(storage,MERGE_STATE_KEY);
 const cycle=Number.isInteger(s?.cycle)&&s.cycle>=0?s.cycle:0;
 const undos=Array.isArray(s?.undos)?s.undos.filter(u=>u&&pair(u)&&Number.isInteger(u.cycle)&&u.manual&&Array.isArray(u.moved)).slice(-MAX_UNDOS):[];
 return {cycle,endedRun:typeof s?.endedRun==='string'?s.endedRun:null,undos};
}
const writeMergeState=(storage,s)=>storage.setItem(MERGE_STATE_KEY,JSON.stringify(s));
/** The collector run `runId` has ended: that is one sync cycle. An undo is dropped once the cycle after its own has ended. */
export function endSyncCycle(storage,runId){
 const s=readMergeState(storage);
 if(!runId||s.endedRun===runId)return s;
 const cycle=s.cycle+1,next={cycle,endedRun:runId,undos:s.undos.filter(u=>undoAvailable(u,cycle))};
 writeMergeState(storage,next);return next;
}
async function load(storage,io){
 const registry=read(storage,WALLET_CARDS_KEY);
 return {registry:Array.isArray(registry)?registry:[],edits:readCardEdits(storage),choices:readCardProductChoices(storage),costEvents:await io.readCostEvents(),benefitEvents:await io.readBenefitEvents()};
}
// The ledgers go first: they can refuse (an overlapping fee year), and then nothing else has changed.
async function save(storage,io,state,moved){
 const ids=new Set(moved);
 await io.rewriteCostEvents(state.costEvents.filter(e=>ids.has(e.id)));
 await io.rewriteBenefitEvents(state.benefitEvents.filter(e=>ids.has(e.id)));
 storage.setItem(WALLET_CARDS_KEY,JSON.stringify(state.registry));
 storage.setItem(CARD_EDITS_KEY,JSON.stringify(state.edits));
 storage.setItem(CARD_PRODUCT_KEY,JSON.stringify(state.choices));
}
/** The question for one bank card the engine could not decide alone, with the cards a user can pick from. */
const question=(state,{bankId,manualIds})=>{
 const bank=state.registry.find(c=>c.id===bankId),manual=manualIds.map(id=>state.registry.find(c=>c.id===id)).filter(Boolean);
 return bank&&manual.length?{bank,manual}:null;
};
const questions=(state,ambiguous)=>ambiguous.map(a=>question(state,a)).filter(Boolean);
/**
 * Plans and applies. Returns the merged pairs (with their undo records), the cards that went away, and the
 * questions still open. A merge the ledgers refuse is skipped and left as two cards.
 */
export async function runCardMerges({storage,io}){
 let state=await load(storage,io);
 const plan=planCardMerges({manual:state.registry.filter(c=>c.identitySource!=='bank-page'),bank:state.registry.filter(c=>c.identitySource==='bank-page'),choices:state.choices,declined:readDeclined(storage)});
 const ms=readMergeState(storage),applied=[];
 for(const {manualId,bankId} of plan.merges){
  const bank=state.registry.find(c=>c.id===bankId);if(!bank)continue;
  try{const r=applyCardMerge(state,manualId,bank,ms.cycle+1);await save(storage,io,r.state,r.undo.moved);state=r.state;applied.push(r.undo);}catch{}
 }
 if(applied.length)writeMergeState(storage,{...ms,undos:[...ms.undos,...applied].slice(-MAX_UNDOS)});
 return {applied,open:questions(state,plan.ambiguous)};
}
/** The user's answer to one question: merge `manualId` into the bank card, or (null) say none of the candidates is it. */
export async function answerMerge({storage,io,bankId,manualId,candidates}){
 if(!manualId){writeDeclined(storage,[...readDeclined(storage),...candidates.map(id=>({manualId:id,bankId}))]);return null;}
 const state=await load(storage,io),bank=state.registry.find(c=>c.id===bankId);
 if(!bank)return null;
 const ms=readMergeState(storage),r=applyCardMerge(state,manualId,bank,ms.cycle+1);
 await save(storage,io,r.state,r.undo.moved);
 // The others were not it: they stay as they are and are not offered for this card again.
 writeDeclined(storage,[...readDeclined(storage),...candidates.filter(id=>id!==manualId).map(id=>({manualId:id,bankId}))]);
 writeMergeState(storage,{...ms,undos:[...ms.undos,r.undo].slice(-MAX_UNDOS)});
 return r.undo;
}
/** Undo one merge while it can still be undone: the manual card comes back with everything moved, and the pair is not offered again. */
export async function undoMerge({storage,io,bankId,manualId}){
 const ms=readMergeState(storage),undo=ms.undos.find(u=>u.bankId===bankId&&u.manualId===manualId);
 if(!undo)throw Error('merge_undo_expired');
 const r=undoCardMerge(await load(storage,io),undo,ms.cycle);
 await save(storage,io,r.state,undo.moved);
 writeDeclined(storage,[...readDeclined(storage),r.declined]);
 writeMergeState(storage,{...ms,undos:ms.undos.filter(u=>u!==undo&&!(u.bankId===bankId&&u.manualId===manualId))});
 return undo.manual;
}
