import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {redactStructureText} from '../extension-next/structure-report.js';
import {buildReport,collectReport,needsReport,cardFields,replayText,reportFileName,STRUCTURE_KEY} from '../extension-next/problem-report.js';
import {problemStructureSource} from '../scripts/build-problem-structure.mjs';

const dir=new URL('./fixtures/',import.meta.url);
// Every bank fixture under tests/fixtures, at any depth: JSON samples that name a bank, and the HTML pages.
const walk=u=>fs.readdirSync(u,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(new URL(e.name+'/',u)):[new URL(e.name,u)]);
const fixtureFiles=walk(dir).map(u=>u.pathname.slice(dir.pathname.length));
const jsonFixtures=fixtureFiles.filter(f=>f.endsWith('.json')).map(f=>[f,JSON.parse(fs.readFileSync(new URL(f,dir),'utf8'))]).filter(([,j])=>typeof j.bank==='string');
const htmlFixtures=fixtureFiles.filter(f=>f.endsWith('.html')).map(f=>[f,fs.readFileSync(new URL(f,dir),'utf8')]);
// Every string a fixture holds, keys included, except our own metadata about the fixture and what it expects.
const META=new Set(['id','provenance','description','bank','locale','billingRules','expected','currency']);
const strings=(v,top=true)=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(x=>strings(x,false)):v&&typeof v==='object'?Object.entries(v).filter(([k])=>!(top&&META.has(k))).flatMap(([k,x])=>[k,...strings(x,false)]):[];
const htmlBody=html=>html.replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ');
const htmlText=html=>htmlBody(html).replace(/<[^>]+>/g,'\n').replace(/&[a-z#0-9]+;/gi,' ');
const htmlAttrs=(html,name)=>[...htmlBody(html).matchAll(new RegExp(`\\s${name}="([^"]*)"`,'gi'))].map(m=>m[1]);
const lines=t=>t.split(/\n+/).map(x=>x.trim()).filter(Boolean);
const fixtureLines=()=>[...jsonFixtures.map(([f,j])=>[f,strings(j).flatMap(lines)]),...htmlFixtures.map(([f,h])=>[f,[...lines(htmlText(h)),...htmlAttrs(h,'aria-label'),...htmlAttrs(h,'title')]])];
// Distinctive values a fixture holds: tails, amounts and dates as digit runs, and card names.
const secretsOf=j=>{
 const out=new Set(),add=v=>{if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)>=10){out.add(String(Math.trunc(Math.abs(v))));}else if(typeof v==='string')for(const m of v.match(/\d{3,}/g)||[])out.add(m);};
 const visit=v=>Array.isArray(v)?v.forEach(visit):v&&typeof v==='object'?Object.values(v).forEach(visit):add(v);
 visit(j.expected);for(const c of [j.card,...(j.cards||[])].filter(Boolean)){add(c.tail);if(c.name)out.add(c.name);}
 return [...out];
};

test('the committed injectable structure file matches its source',()=>{
 assert.equal(fs.readFileSync(new URL('../extension-next/problem-structure.js',import.meta.url),'utf8'),problemStructureSource(),'run node scripts/build-problem-structure.mjs');
});

test('the scrubber is checked against every bank fixture, Chase and Amex US included',()=>{
 const banks=new Set(jsonFixtures.map(([,j])=>j.bank));
 for(const bank of ['Chase','Amex US','Amex HK','BOA','Citi US','HSBC HK','SC HK'])assert.ok(banks.has(bank),'no fixture for '+bank);
 assert.ok(jsonFixtures.length>=17&&htmlFixtures.length>=10,`found ${jsonFixtures.length} JSON and ${htmlFixtures.length} HTML fixtures`);
});

test('no digit from any bank fixture survives the scrubber',()=>{
 let checked=0;
 for(const [file,texts]of fixtureLines())for(const line of texts){
  const out=redactStructureText(line);checked++;
  assert.ok(!/\p{N}/u.test(out),`${file}: "${out}"`);
 }
 // Ids, paths and hashes go through the identifier mode.
 for(const [file,html]of htmlFixtures)for(const id of htmlAttrs(html,'id')){const out=redactStructureText(id,true);checked++;assert.ok(!/\p{N}/u.test(out),`${file} id: "${out}"`);}
 for(const [file,j]of jsonFixtures)for(const d of j.details||[])for(const key of Object.keys(d.fields||{})){const out=redactStructureText(key,true);checked++;assert.ok(!/\p{N}/u.test(out),`${file} key: "${out}"`);}
 assert.ok(checked>500,'scrubbed every fixture line: '+checked);
});

test('a report built from each bank fixture leaks none of its values',()=>{
 for(const [file,j]of jsonFixtures){
  const cards=[j.card,...(j.cards||[])].filter(Boolean);
  // The fixture's page lines as the structure rows; an older build's raw rows, so the report itself must scrub them.
  const rows=strings(j).flatMap(lines).map((text,i)=>i%2?{tag:'h2',text}:{tag:'span',aria:text,id:'row-'+text.slice(0,20)});
  const records=Object.fromEntries(cards.map(c=>[c.id+'-'+c.tail,Object.fromEntries(Object.entries(Array.isArray(j.expected)?j.expected[0]||{}:j.expected||{}).map(([k,v])=>[k,{value:v,capturedAt:'x'}]))]));
  const report=buildReport({build:'b',version:'v',bank:j.bank,job:{status:'partial',readError:'card '+(cards[0]?.tail||'')+' timeout'},records,structure:{capturedAt:'T',report:{lang:j.locale||'',path:'/x',title:j.heading||'',rows}},createdAt:'T'});
  const body=JSON.stringify(report);
  assert.ok(!/\p{N}/u.test(JSON.stringify({...report.structure,rows:report.structure.rows.map(({tag,...r})=>r)})),`${file}: digit in structure`);
  assert.ok(!/\p{N}/u.test(JSON.stringify(report.run)),`${file}: digit in run`);
  for(const s of secretsOf(j))assert.ok(!body.includes(s),`${file}: report leaks "${s}"`);
  assert.ok(report.region,`${file}: region for ${j.bank}`);
 }
});

const records={'card-ending-4321':{balance:{value:1234.56,capturedAt:'2030-12-01T00:00:00Z'},statement:{value:987.65,capturedAt:'2030-12-01T00:00:00Z'},creditLimit:{value:24680,capturedAt:'x'}},
 'card-ending-8765':{balance:{value:13.57,capturedAt:'x'},paymentStatus:{title:'No payment due',capturedAt:'x'}}};
const secrets=['4321','8765','1234','987','24680','13.57','Jordan','Main Street','2030'];

test('a report holds structure and field states, never values',()=>{
 // A structure stored by an older build still carries raw digits and a name; the report masks them again.
 const structure={capturedAt:'T',report:{schema:1,host:'example.test',lang:'en-US',path:'/accounts/#',hashShape:'',title:'Accounts',rows:[{tag:'h2',text:'Jordan Card ending in 4321'},{tag:'span',id:'balance-4321',text:'$1,234.56'},{tag:'p',aria:'Due Dec 15, 2030 at 12 Main Street'}]}};
 const job={bank:'Chase',status:'partial',phase:'complete',received:1,rejected:2,rejectReasons:{programme_unconfirmed:2},sections:{billing:{status:'partial',reason:'minimum_not_seen'}},readError:'card 4321 timeout'};
 const report=buildReport({build:'b',version:'1.1.0',bank:'Chase',job,records,structure,diagnostic:{adapterBuild:'reader',language:'en-US',locale:'en-US',cards:2,fieldCount:3},createdAt:'T'});
 const body=JSON.stringify({run:report.run,cards:report.cards,structure:report.structure});
 for(const s of secrets)assert.ok(!body.includes(s),'leaked '+s+': '+body);
 assert.ok(!/\d/.test(JSON.stringify(report.structure.rows.map(r=>[r.text,r.aria,r.id]))),'no digit in page rows');
 assert.deepEqual(report.cards.map(c=>c.card),['card-1','card-2']);
 assert.deepEqual(report.cards[0].fields,{balance:'read',statement:'read',minimum:'missing',due:'missing'});
 assert.deepEqual(report.cards[1].fields,{balance:'read',statement:'missing',minimum:'not_due',due:'not_due'});
 assert.equal(report.run.status,'partial');assert.equal(report.run.sections.billing.reason,'minimum_not_seen');assert.equal(report.region,'US');
});

test('a report is offered after a failed or partial read, or a missing field',()=>{
 assert.equal(needsReport({status:'partial'},{}),true);
 assert.equal(needsReport({status:'load_error'},{}),true);
 assert.equal(needsReport({status:'capturing'},{}),false,'not while reading');
 assert.equal(needsReport({status:'cancelled'},records),false);
 const full={a:{balance:1,statement:1,minimum:1,due:1},b:{balance:1,statement:1,paymentStatus:1}};
 assert.equal(needsReport({status:'updated'},full),false);
 assert.equal(needsReport({status:'updated'},records),true,'a card missing a field');
 assert.equal(cardFields(full)[1].fields.due,'not_due');
});

test('a report replays into text the reader can parse',()=>{
 const ctx={self:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../extension-next/reader.js',import.meta.url),'utf8'),ctx);
 const f=JSON.parse(fs.readFileSync(new URL('banks/sc-hk-en-card-details.json',dir),'utf8'));
 const report=buildReport({bank:'SC HK',job:{status:'partial'},records:{},structure:{capturedAt:'T',report:{lang:'en-HK',rows:lines(f.text).map(text=>({tag:'div',text:redactStructureText(text)}))}}});
 const text=replayText(report);assert.ok(!/\[word\]|#/.test(text));
 const items=ctx.self.CardyReader.issuerBilling(text,'SC HK',{id:'report-card-1',bank:'SC HK',tail:'0000',currency:'HKD'});
 const keys=items.map(i=>i.key);
 for(const k of ['balance','statement','minimum','due'])assert.ok(keys.includes(k),`replay reads ${k}: ${keys} from\n${text}`);
});

test('the popup and the wallet gather the same report, with or without extension storage',async()=>{
 const job={bank:'Chase',status:'partial',phase:'complete'},state={runtimeBuild:'b1',records:{Chase:records}};
 const stored={[STRUCTURE_KEY]:{Chase:{capturedAt:'T',report:{lang:'en-US',rows:[{tag:'span',text:'Balance $1,234.56'}]}},BOA:{capturedAt:'T',report:{rows:[{tag:'p',text:'other bank'}]}}},
  'cardybara:last-read-diagnostic':{bank:'BOA',adapterBuild:'x'}};
 const api={storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,stored[k]]))}},runtime:{getManifest:()=>({version:'1.2.3'})}};
 const inExtension=await collectReport(job,state,api);
 assert.equal(inExtension.extension.version,'1.2.3');assert.equal(inExtension.extension.build,'b1');
 assert.equal(inExtension.structure.rows.length,1,'only this bank\'s page structure');
 assert.equal(inExtension.run.diagnostic,null,'another bank\'s diagnostic is left out');
 assert.deepEqual(inExtension.cards[0].fields,{balance:'read',statement:'read',minimum:'missing',due:'missing'});
 for(const s of secrets)assert.ok(!JSON.stringify({run:inExtension.run,cards:inExtension.cards,structure:inExtension.structure}).includes(s),'leaked '+s);
 const website=await collectReport(job,state,undefined);
 assert.equal(website.structure,null,'no page structure outside the extension');assert.equal(website.run.status,'partial');
 assert.equal(reportFileName('Amex US'),'cardybara-problem-report-amex-us.json');
});

test('the wallet offers 生成问题报告 on a bank whose read was partial or missed a field, and only there (#196)',async()=>{
 const {build}=await import('esbuild'),{createRequire}=await import('node:module');
 const root=new URL('..',import.meta.url).pathname;
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import BankConnections from './src/BankConnections.jsx';import {activateLanguage} from './src/i18n-core.js';export const render=(props,lang='zh-CN')=>{activateLanguage(lang);return renderToStaticMarkup(React.createElement(BankConnections,props));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty','.png':'empty','.svg':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 const full={a:{balance:1,statement:1,minimum:1,due:1}};
 const props=(jobs,recs)=>({data:{connections:[{bank:'Chase'},{bank:'Amex US'}],cards:[]},connected:true,collectorConnected:true,collectorState:{runtimeBuild:'b',disabled:[],records:recs,run:{status:'complete',jobs}},
  sendCollector(){},bankState:()=>'',isBusy:()=>false,refreshBank(){},urls:{},onSetup(){},onRestore(){},refreshing:false,onFocus(){}});
 const offers=html=>(html.match(/problem-report-button/g)||[]).length;
 const partial=module.exports.render(props([{bank:'Chase',status:'partial'},{bank:'Amex US',status:'updated'}],{'Amex US':full}));
 assert.equal(offers(partial),1,'only the bank with the partial read');assert.ok(partial.includes('生成问题报告'));
 assert.equal(offers(module.exports.render(props([{bank:'Chase',status:'load_error'}],{}))),1,'a failed read');
 assert.equal(offers(module.exports.render(props([{bank:'Chase',status:'updated'}],{Chase:records}))),1,'a card missing a field');
 assert.equal(offers(module.exports.render(props([{bank:'Chase',status:'updated'},{bank:'Amex US',status:'capturing'}],{Chase:full}))),0,'not after a full read or while reading');
 assert.equal(offers(module.exports.render(props([],{}))),0,'no run, no offer');
 assert.ok(module.exports.render(props([{bank:'Chase',status:'partial'}],{}),'en-US').includes('Create problem report'));
 assert.ok(module.exports.render(props([{bank:'Chase',status:'partial'}],{}),'zh-TW').includes('產生問題報告'));
});
