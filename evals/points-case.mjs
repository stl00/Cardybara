// Offline runs of the three points live cases (#481): a scripted model drives the real agent loop (runAgentTurn, so the shipped
// answer checker and tool execution run) and the same code checks as the nightly live run (runLiveCase) score it. The scripted
// model calls the tool the case expects and writes its answer only from the tool result; a `fault` makes it break one rule on
// purpose, so each case can be shown to fail. Synthetic wallet, no network.
import {liveCases} from './fixtures.mjs';
import {runLiveCase} from './live-case.mjs';
import {runAgentTurn} from '../tests/helpers/agent-target.mjs';

export const POINTS_CASE_IDS=['points-add-up','convert-stated-points','convert-through-pooled-card'];
export const POINTS_FAULTS=['no-tool','wrong-tool','rounded-up','no-combine'];
export const pointsCases=POINTS_CASE_IDS.map(id=>liveCases.find(c=>c.id===id));

// The call the scripted model makes for each case, and the answer it writes from the result.
const script={
 'points-add-up':{name:'points_accounts',args:{programme:'Ultimate Rewards'},answer(result,fault){
  const p=result.programmes.find(x=>x.programme==='Ultimate Rewards');
  if(fault==='no-combine')return '两张卡的积分各自独立，不能加在一起用。';
  return `${p.summary} 要用来转点，需要先合并到 Sapphire Reserve 这类能转点的卡里。`;
 }},
 'convert-stated-points':{name:'convert_points',args:{partner:'Aer Lingus AerClub',points:12345},answer(result,fault){
  const row=result.programmes.flatMap(g=>g.partners).find(x=>x.partner==='Aer Lingus AerClub'),c=row.conversion;
  if(fault==='rounded-up')return `12345 点可以转成 13000 Aer Lingus AerClub 点。`;
  return `按公布的转点档位，${c.spend} 点可转成 ${c.receive} Aer Lingus AerClub 点，剩下的 ${c.unusedPoints} 点用不完，不会凑整进位。`;
 }},
 'convert-through-pooled-card':{name:'convert_points',args:{partner:'Hyatt',cardName:'Freedom Unlimited'},answer(result,fault){
  const row=result.programmes.flatMap(g=>g.partners).find(x=>x.partner==='World of Hyatt'),via=row.cards[0].through?.[0];
  if(fault==='no-combine')return 'Freedom Unlimited 本身没有转点记录，所以不能转到 Hyatt。';
  return `可以，但要先把 Freedom Unlimited 的积分合并到 ${via}，再从它转到 World of Hyatt。合并免费、即时，但不可撤销。`;
 }},
};

/** Runs one case with the scripted model; returns runLiveCase's {checks, detail}. */
export async function runPointsCase(c,{fault=null,turn=runAgentTurn}={}){
 const s=script[c.id];
 const chat=async payload=>{
  const tools=(payload.messages||[]).filter(m=>m.role==='tool');
  if(!tools.length&&fault!=='no-tool'){
   const name=fault==='wrong-tool'?'find_benefits':s.name,args=fault==='wrong-tool'?{query:'points'}:s.args;
   return {role:'assistant',content:'',tool_calls:[{id:'pts1',type:'function',function:{name,arguments:JSON.stringify(args)}}]};
  }
  const result=tools.map(m=>JSON.parse(m.content)).find(r=>r.kind===(s.name==='points_accounts'?'points-accounts':'transfer-options'));
  return {role:'assistant',content:result?s.answer(result,fault):'可以，直接转就行。'};
 };
 return runLiveCase(c,{chat,turn});
}
