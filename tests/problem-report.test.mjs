import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {redactStructureText} from '../extension-next/structure-report.js';
import {buildReport,needsReport,cardFields,replayText} from '../extension-next/problem-report.js';
import {problemStructureSource} from '../scripts/build-problem-structure.mjs';

const dir=new URL('./fixtures/',import.meta.url),banks=new URL('./fixtures/banks/',import.meta.url);
// Every line of text a fixture holds: bank JSON text and details, and the visible text of the HTML samples.
const strings=v=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(strings):v&&typeof v==='object'?Object.values(v).flatMap(strings):[];
const fixtureTexts=()=>[
 ...fs.readdirSync(banks).filter(f=>f.endsWith('.json')).map(f=>{const j=JSON.parse(fs.readFileSync(new URL(f,banks),'utf8'));return [f,strings({text:j.text,details:j.details,heading:j.heading,cards:j.cards,card:j.card})];}),
 ...fs.readdirSync(dir).filter(f=>f.endsWith('.html')).map(f=>[f,[fs.readFileSync(new URL(f,dir),'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,'\n').replace(/&[a-z#0-9]+;/gi,' ')]]),
];
const lines=t=>t.split(/\n+/).map(x=>x.trim()).filter(Boolean);

test('the committed injectable structure file matches its source',()=>{
 assert.equal(fs.readFileSync(new URL('../extension-next/problem-structure.js',import.meta.url),'utf8'),problemStructureSource(),'run node scripts/build-problem-structure.mjs');
});

test('no digit from any bank fixture survives the scrubber',()=>{
 let checked=0;
 for(const [file,texts]of fixtureTexts())for(const text of texts)for(const line of lines(text)){
  const out=redactStructureText(line);checked++;
  assert.ok(!/\p{N}/u.test(out),`${file}: "${out}"`);
 }
 assert.ok(checked>200,'scrubbed every fixture line');
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
 const f=JSON.parse(fs.readFileSync(new URL('sc-hk-en-card-details.json',banks),'utf8'));
 const report=buildReport({bank:'SC HK',job:{status:'partial'},records:{},structure:{capturedAt:'T',report:{lang:'en-HK',rows:lines(f.text).map(text=>({tag:'div',text:redactStructureText(text)}))}}});
 const text=replayText(report);assert.ok(!/\[word\]|#/.test(text));
 const items=ctx.self.CardyReader.issuerBilling(text,'SC HK',{id:'report-card-1',bank:'SC HK',tail:'0000',currency:'HKD'});
 const keys=items.map(i=>i.key);
 for(const k of ['balance','statement','minimum','due'])assert.ok(keys.includes(k),`replay reads ${k}: ${keys} from\n${text}`);
});
