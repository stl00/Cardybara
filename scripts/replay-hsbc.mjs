// Replays redacted observations offline. Never reads browser sessions or writes wallet data.
import fs from 'node:fs';
import vm from 'node:vm';
import {redact,validateModel} from '../extension-next/agent-core.js';
const [input,registry,output]=process.argv.slice(2);
if(!input||!registry||!output)throw Error('Usage: node scripts/replay-hsbc.mjs observations.json registered-cards.json report.json');
const pages=JSON.parse(fs.readFileSync(input)).pages,cards=JSON.parse(fs.readFileSync(registry));
const sandbox={self:{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),sandbox);
const reader=sandbox.self.CardyReader;
const baseTitle=t=>t.replace(/\s*-\s*(?:HKD|RMB|CNY)\s*$/i,'').trim();
const accounts=[];
for(const p of pages){
 let card=cards.find(c=>c.tail===p.tail),association='registered-tail';
 if(!card&&/ - RMB$/.test(p.title)){
  const siblings=pages.filter(x=>x.tail!==p.tail&&baseTitle(x.title)===baseTitle(p.title)&&cards.some(c=>c.tail===x.tail));
  if(siblings.length===1){card={...cards.find(c=>c.tail===siblings[0].tail),tail:p.tail,currency:'CNY'};association='exact-product-title-secondary-currency';}
 }
 if(!card){accounts.push({tail:p.tail,status:'unidentified'});continue;}
 const text=redact(p.details),patch=reader.parseAccount(text,'HSBC HK',card,'en-HK',p.observedAt),lines=text.split('\n').map(s=>s.trim()).filter(Boolean),observations=[];
 const at=lines.findIndex(s=>/^RewardCash balance:?$/i.test(s));
 if(card.currency!=='CNY'&&at>=0&&/^\d[\d,]*$/.test(lines[at+1]||''))observations.push({kind:'reward',cardId:'C1',key:'RewardCash',title:'RewardCash',value:Number(lines[at+1].replaceAll(',','')),currency:'points',date:'',status:'unknown',evidence:'[C1]\n'+lines.slice(at,at+2).join('\n')});
 const dueAt=lines.findIndex(s=>/^Payment due date:?$/i.test(s)),due=lines[dueAt+1]?.match(/^(\d{1,2}) ([A-Za-z]+) (20\d{2})$/),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 if(due){const month=months.indexOf(due[2].slice(0,3).toLowerCase())+1;if(month)observations.push({kind:'billing',cardId:'C1',key:'due',title:'Payment due date',value:null,currency:card.currency,date:`${due[3]}-${String(month).padStart(2,'0')}-${due[1].padStart(2,'0')}`,status:'unknown',evidence:'[C1]\n'+lines.slice(dueAt,dueAt+2).join('\n')});}
 const tx=reader.hsbcTransactionRows(p.table?.rows||[],card);
 observations.push(...JSON.parse(JSON.stringify(tx.items)).map(i=>({...i,key:redact(i.key),title:redact(i.title),evidence:redact(i.evidence)})));
 const snapshot={bank:'HSBC HK',region:'HK',page:p.page,capturedAt:p.observedAt,aliases:[{id:'C1',cardId:card.id,currency:card.currency}],blocks:observations.map(i=>({text:i.evidence})),links:[]};
 const validated=validateModel({items:observations,nextLinkId:null},snapshot);
 accounts.push({cardId:card.id,accountTail:p.tail,currency:card.currency,association,capturedAt:p.observedAt,fields:patch?.fields||{},records:validated.items.map(i=>({...i,method:'rules'})),rejected:[...tx.rejected,...validated.rejected],transactionScope:'visible-current-table-only',explicitlyEmpty:p.table?.explicitEmpty===true});
}
const report={schema:1,mode:'offline-replay-of-bank-observations',walletWritten:false,fullHistoricalCoverage:false,accounts};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({accounts:accounts.length,identified:accounts.filter(a=>a.cardId).length,monetaryFields:accounts.reduce((n,a)=>n+Object.keys(a.fields||{}).length,0),transactions:accounts.reduce((n,a)=>n+(a.records||[]).filter(i=>i.kind==='transaction').length,0),rejected:accounts.flatMap(a=>a.rejected||[])}));
