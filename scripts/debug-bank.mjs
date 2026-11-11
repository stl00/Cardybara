// Offline only: no browser, cloud request, credentials, or live wallet mutation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {refreshTests} from './run-tests.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const context={self:{}};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'extension-next/reader.js'),'utf8'),context);
const reader=context.self.CardyReader,runId=new Date().toISOString().replace(/[:.]/g,'-');
const cases=[];
// --report <file>: turn a tester's problem report (#196) into a failing fixture, then replay as usual.
const reportArg=process.argv.indexOf('--report');
if(reportArg>0){
 const {replayText}=await import('../extension-next/problem-report.js');
 const file=process.argv[reportArg+1],report=JSON.parse(fs.readFileSync(file,'utf8'));
 if(report.kind!=='cardybara-problem-report'||!report.bank)throw Error('not a Cardybara problem report: '+file);
 const missing=[...new Set((report.cards||[]).flatMap(c=>Object.entries(c.fields||{}).filter(([,v])=>v==='missing').map(([k])=>k)))];
 const locale=report.structure?.lang||({US:'en-US',HK:'en-HK'})[report.region]||'en-US',slug=(report.bank+'-'+(report.createdAt||runId)).toLowerCase().replace(/[^a-z0-9]+/g,'-');
 const fixture={id:'report-'+slug,provenance:'Replayed from a sanitized beta problem report: structure and label words only, every value synthetic. Set expected to what the page shows, then fix the reader.',bank:report.bank,locale,heading:'',
  card:{id:'report-card-1',bank:report.bank,tail:'0000',currency:report.region==='HK'?'HKD':'USD'},text:replayText(report),expected:Object.fromEntries((missing.length?missing:['balance']).map(k=>[k,'__fill__']))};
 const out=path.join(root,'tests/fixtures/banks',fixture.id+'.json');fs.writeFileSync(out,JSON.stringify(fixture,null,1)+'\n');
 console.log(`Wrote failing fixture ${path.relative(root,out)} (expected: ${Object.keys(fixture.expected).join(', ')} = __fill__)`);
}
for(const file of fs.readdirSync(path.join(root,'tests/fixtures/banks')).filter(f=>f.endsWith('.json'))){
 const f=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/banks',file),'utf8'));
 const capturedAt=new Date().toISOString();
 const compare=(expected,actual)=>[...new Set([...Object.keys(expected),...Object.keys(actual)])].map(key=>({key,expected:expected[key]??null,actual:actual[key]??null,pass:Object.hasOwn(expected,key)&&(expected[key]===null?!Object.hasOwn(actual,key):actual[key]===expected[key])}));
 try{
  if(f.bank==='Chase'&&Array.isArray(f.cards)&&Array.isArray(f.details)&&Array.isArray(f.expected)){
   for(const [i,card] of f.cards.entries()){
    const result=reader.chaseDetail(f.details[i],card),actual=Object.fromEntries(result.items.map(item=>[item.kind==='reward'?'reward':item.key,item.key==='due'?item.date:item.key==='autopay'?item.status:item.value]));
    const fields=compare(f.expected[i],actual);cases.push({id:f.id+'-'+card.id,bank:'Chase',provenance:f.provenance,stage:fields.every(x=>x.pass)?'passed':'field_extraction',fields,pass:fields.every(x=>x.pass)});
   }
  }else if(f.billingRules===true&&f.card&&f.expected&&typeof f.text==='string'){
   const items=reader.issuerBilling(f.text,f.bank,f.card),actual=Object.fromEntries(items.map(i=>[i.key,i.key==='due'?i.date:['paymentStatus','duePartial'].includes(i.key)?i.title:i.value]));
   const fields=compare(f.expected,actual);cases.push({id:f.id,bank:f.bank,provenance:f.provenance,stage:fields.every(x=>x.pass)?'passed':'field_extraction',fields,pass:fields.every(x=>x.pass)});
  }else if(typeof f.bank==='string'&&f.card&&f.expected&&typeof f.text==='string'){
   const patch=f.bank.startsWith('Amex ')?reader.parseAmexOverview(f.text,f.heading,[f.card],f.locale,capturedAt):reader.parseAccount(f.text,f.bank,f.card,f.locale,capturedAt);
   const fields=compare(f.expected,patch?.fields||{});cases.push({id:f.id,bank:f.bank,provenance:f.provenance,stage:!patch?'card_scope':fields.every(x=>x.pass)?'passed':'field_extraction',fields,pass:!!patch&&fields.every(x=>x.pass)});
  }else throw Error('unsupported_fixture_schema');
 }catch(error){cases.push({id:f.id||file,bank:f.bank||'unknown',stage:'fixture_error',fields:[],pass:false,error:error.message});}
}
const parseOnly=process.argv.includes('--parse-only');
const flow=parseOnly?{status:0,stdout:'',stderr:''}:spawnSync(process.execPath,['--test',...refreshTests(root)],{cwd:root,encoding:'utf8',timeout:60000});
const report={schema:1,runId,mode:'offline',parsing:{pass:cases.length>0&&cases.every(c=>c.pass),cases},workflow:{pass:parseOnly?null:flow.status===0,status:parseOnly?'not_run':flow.status===0?'passed':'failed',scope:'mock Chrome, model and bank pages; actual background worker',exitCode:flow.status,output:flow.stdout+flow.stderr,error:flow.error?.message},liveAcceptance:{status:'not_run',reason:'Requires bank login and user-exported wallet evidence. Offline passing is not live acceptance.'}};
const dir=path.join(root,'.debug',runId);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(root,'.debug','latest.json'),JSON.stringify(report,null,2)+'\n');
console.log(`Run ${runId} (offline, no API calls)`);
for(const c of cases){console.log(`${c.pass?'PASS':'FAIL'} ${c.id} [${c.stage}]`);for(const f of c.fields)console.log(`  ${f.key}: expected ${f.expected}, actual ${f.actual} ${f.pass?'OK':'MISMATCH'}`);}
console.log(`${parseOnly?'NOT RUN':report.workflow.pass?'PASS':'FAIL'} extension workflow regression`);
console.log('NOT RUN real bank acceptance');console.log(`Report: ${path.join(dir,'report.json')}`);
if(!report.parsing.pass||(!parseOnly&&!report.workflow.pass)){console.error(report.workflow.output);process.exitCode=1;}
