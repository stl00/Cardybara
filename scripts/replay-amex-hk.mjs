// Offline replay of redacted, dated observations. Does not access Chrome, APIs or wallet storage.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {validateModel,mergeRecords} from '../extension-next/agent-core.js';
const out=process.argv[2];if(!out)throw Error('Usage: node scripts/replay-amex-hk.mjs <task-outputs-directory>');
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const pages=read('amex-hk-pages-2026-10-26.json').pages.filter(p=>p.usableForFinancialRefresh!==false&&p.text.length>120),views=read('amex-hk-offers-2026-10-26.json').views;
const cards=JSON.parse(fs.readFileSync(new URL('../public/data.json',import.meta.url))).cards.filter(c=>c.bank==='Amex HK');
const sandbox={self:{}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),sandbox);const reader=sandbox.self.CardyReader;
let records=[];const checks=[],rejected=[];
function accept(items,p,card){
 const snapshot={bank:'Amex HK',region:'HK',page:p.page,capturedAt:p.observedAt,aliases:[{id:'C1',cardId:card.id,currency:card.currency}],blocks:items.map(i=>({text:i.evidence})),links:[]};
 const result=validateModel({items,nextLinkId:null},snapshot);records=mergeRecords(records,result.items.map(i=>({...i,method:'rules'})));rejected.push(...result.rejected.map(reason=>({page:p.page,cardId:card.id,reason})));
}
for(const card of cards){
 const p=pages.find(p=>p.label===card.tail+'-dashboard-details');if(p){const parsed=reader.parseAccount(p.text,'Amex HK',card,'zh-HK',p.observedAt);accept(Object.entries(parsed?.fields||{}).map(([key,value])=>({kind:'card',cardId:'C1',key,title:key,value,currency:'HKD',date:'',status:'unknown',evidence:'[C1]\n'+p.text})),p,card);}
 const rewards=pages.find(p=>p.label===card.tail+'-rewards');if(rewards){const lines=rewards.text.split('\n').map(s=>s.trim()).filter(Boolean),at=lines.findIndex(s=>/^Membership Rewards[®™]?$/.test(s)),value=lines[at+1];if(at>=0&&/^\d[\d,]*$/.test(value))accept([{kind:'reward',cardId:'C1',key:lines[at],title:lines[at],value:Number(value.replaceAll(',','')),currency:'points',date:'',status:'unknown',evidence:'[C1]\n'+lines.slice(at,at+2).join('\n')}],rewards,card);}
 const statement=read('amex-hk-statement-'+card.tail+'-2026-10-26.json');const rows=statement.rows.map(c=>({date:c[0]?.match(/(?:(?:20\d{2})年)?\d{1,2}月\d{1,2}日/)?.[0],status:c[1],description:c[2],amount:c.at(-1)?.split('\n')[0]}));
 const tx=reader.amexHkTransactionRows(rows,card,statement.period.length===1?statement.period[0]:'');rejected.push(...JSON.parse(JSON.stringify(tx.rejected)));accept(JSON.parse(JSON.stringify(tx.items)),statement,card);
 const benefit=pages.find(p=>p.label===card.tail+'-benefits');if(benefit){const m=benefit.text.match(/(?:HK\$([\d,]+)\s*已簽賬|已簽賬\s*HK\$([\d,]+))/);if(m){const lines=benefit.text.split('\n').map(s=>s.trim()),at=lines.findIndex(s=>s==='禮遇活動'),title=lines.slice(at+1).find(s=>s&&!/^\d|^目前/.test(s));accept([{kind:'benefit',cardId:'C1',key:'spend_progress',title,value:Number((m[1]||m[2]).replaceAll(',','')),currency:'HKD',date:'',status:'unknown',evidence:'[C1]\n'+benefit.text}],benefit,card);}}
}
for(const view of views){const card=cards.find(c=>view.selected==='-'+c.tail);if(!card)throw Error('Unidentified offer account');const label=view.view?.[0]||'',status=/^可用/.test(label)?'available':/^已儲存至卡中/.test(label)?'added':null;if(!status)throw Error('Unknown offer view');
 const readyRows=view.rows.filter(r=>r.paragraphs[0]?.trim()&&r.paragraphs[1]?.trim()&&r.text.includes(r.paragraphs[1]));const items=readyRows.map(row=>{const title=row.paragraphs[1],date=row.text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);return {kind:'offer',cardId:'C1',key:'',title,value:null,currency:'HKD',date:date?date[3]+'-'+date[1].padStart(2,'0')+'-'+date[2].padStart(2,'0'):'',status,evidence:'[C1]\n'+label+'\n'+row.text};});
 accept(items,view,card);const expected=Number(label.match(/\((\d+)\)/)?.[1]);checks.push({cardId:card.id,view:status,expected,containers:view.rows.length,observed:items.length,unique:new Set(items.map(i=>i.title)).size,complete:expected===items.length&&new Set(items.map(i=>i.title)).size===items.length});
}
const catalogue=read('amex-hk-benefit-catalogue-2026-10-26.json'),catalogueCard=cards.find(c=>catalogue.selected==='-'+c.tail);accept(catalogue.titles.map(title=>({kind:'benefit',cardId:'C1',key:'entitlement',title,value:null,currency:'HKD',date:'',status:'unknown',evidence:'[C1]\n'+title})),catalogue,catalogueCard);
// This title was printed in the captured Explorer "all benefits (1)" page.
const explorer=cards.find(c=>/Explorer/.test(c.name)),benefit=pages.find(p=>p.label===explorer.tail+'-benefits'),explorerTitle='環亞機場貴賓室禮遇';if(benefit?.text.includes(explorerTitle))accept([{kind:'benefit',cardId:'C1',key:'entitlement',title:explorerTitle,value:null,currency:'HKD',date:'',status:'unknown',evidence:'[C1]\n'+explorerTitle}],benefit,explorer);
const report={mode:'offline-replay-of-observed-bank-pages',walletWritten:false,fullHistoricalCoverage:false,checks,rejected,records};fs.writeFileSync(path.join(out,'amex-hk-normalized-2026-10-26.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({records:records.length,byKind:Object.fromEntries([...new Set(records.map(r=>r.kind))].map(k=>[k,records.filter(r=>r.kind===k).length])),checks,rejected}));
if(rejected.length||checks.some(c=>!c.complete))process.exitCode=1;
