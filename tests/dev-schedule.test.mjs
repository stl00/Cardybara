// The dev build's schedule, diagnostics and self-reload, run in a mock Chrome. No bank contact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import http from 'node:http';
import {afterRun,buildReport,classifyJob,defaultSettings,markAttempted,planBanks,setEnabled,validReport} from '../extension-dev/schedule-core.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const on=(banks={})=>({...setEnabled(defaultSettings(),true),banks});
const plan=(settings,extra={})=>planBanks({settings,activeBanks:['Chase','BOA','Amex US','Amex HK'],withCards:[],signedIn:[],now:1e12,...extra});

test('a bank is opened only after a good read; otherwise the owner\'s signed-in tab must exist',()=>{
 assert.deepEqual(plan(defaultSettings(),{signedIn:['BOA']}),[],'off means nothing runs');
 assert.deepEqual(plan(on(),{withCards:['BOA']}),[],'cards alone never open a login page');
 assert.deepEqual(plan(on(),{signedIn:['BOA']}),['BOA']);
 assert.deepEqual(plan(on({BOA:{state:'ok'}}),{withCards:['BOA']}),['BOA']);
 assert.deepEqual(plan(on({BOA:{state:'login_expired'}}),{withCards:['BOA']}),[],'an expired login is not hit again');
 assert.deepEqual(plan(on({BOA:{state:'login_expired'}}),{signedIn:['BOA']}),['BOA']);
 assert.deepEqual(plan(on({BOA:{state:'stopped'}}),{signedIn:['BOA'],withCards:['BOA']}),[],'a stopped bank waits for the owner');
 assert.deepEqual(plan(on(),{signedIn:['BOA'],inUse:['BOA']}),[],'a tab the owner is using is left alone');
});
test('the minimum interval holds, and Amex regions never run together',()=>{
 const recent=on({BOA:{state:'ok',lastAttemptAt:1e12-59*60000}});assert.deepEqual(plan({...recent,intervalMinutes:60},{signedIn:['BOA']}),[]);
 assert.deepEqual(plan({...on({BOA:{state:'ok',lastAttemptAt:1e12-60*60000}}),intervalMinutes:60},{signedIn:['BOA']}),['BOA']);
 assert.equal(setEnabled(defaultSettings(),true,1).intervalMinutes,360,'a shorter interval is refused');
 assert.deepEqual(plan(on(),{signedIn:['Amex US','Amex HK']}),['Amex US']);
});
test('a failure stops its bank until the owner turns the schedule off and on',()=>{
 assert.equal(classifyJob({status:'needs_login'}).state,'login_expired');
 for(const status of ['updated','partial'])assert.equal(classifyJob({status}).state,'ok');
 for(const status of ['needs_confirmation','ambiguous','no_data','load_error','timeout','navigation_changed','tab_closed','interrupted','cancelled'])assert.equal(classifyJob({status}).state,'stopped',status);
 const stopped=afterRun(on(),{jobs:[{bank:'BOA',status:'load_error'}]},5);assert.equal(setEnabled(stopped,true).banks.BOA.state,'stopped','saving again is not a retry');
 assert.deepEqual(setEnabled(setEnabled(stopped,false),true).banks,{});
 assert.equal(markAttempted(on(),['BOA'],7).banks.BOA.lastAttemptAt,7);
});
test('a report holds labels, shapes and the failed step, with no values, tails or names',()=>{
 const job={bank:'BOA',status:'load_error',diagnostic:{stage:'read_page',code:'reader_exception'},cards:[{id:'discovered-boa-3141',tail:'3141'}],phase:'complete',rejectReasons:{evidence:2},sections:{card:{status:'partial',missing:['discovered-boa-3141']}},received:1};
 const state={records:{BOA:{'discovered-boa-3141':{balance:{value:1234.56,currency:'USD'}}}},agentRecords:[{bank:'BOA',cardId:'discovered-boa-3141',kind:'reward',key:'Quokka Miles',title:'Quokka Miles',value:999}]};
 const page={path:'/accounts/3141',rows:[{text:'Balance $#,###.##'},{text:'••••3141'},{id:'row-3141'}]};
 const report=buildReport({run:{status:'complete',jobs:[job]},state,pages:{BOA:page},build:'dev',now:5}),text=JSON.stringify(report);
 assert.equal(validReport(report),true);
 for(const secret of ['3141','1234','Quokka','999','discovered'])assert.ok(!text.includes(secret),secret);
 assert.equal(report.banks[0].step,'read_page');assert.deepEqual(report.banks[0].fields,{balance:1});assert.deepEqual(report.banks[0].sections,{card:'partial'});
 assert.equal(validReport({schema:1,banks:[{bank:'BOA',note:'ending 3141'}]}),false,'the server refuses a digit in any string');
});
test('the dev build has no way in from localhost, and never touches a credential',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-dev-build-'));
 try{
  const r=spawnSync(process.execPath,['scripts/build-dev-extension.mjs','--no-wallet'],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_DEV_EXTENSION_DIR:join(dir,'ext')}});assert.equal(r.status,0,r.stderr);
  const m=JSON.parse(readFileSync(join(dir,'ext/manifest.json'),'utf8'));
  assert.equal(m.content_scripts,undefined);assert.equal(m.externally_connectable,undefined);assert.equal(m.background.service_worker,'background-dev.js');
  assert.deepEqual(m.host_permissions.filter(h=>h.startsWith('http:')),['http://127.0.0.1:8766/*']);assert.deepEqual((m.optional_host_permissions||[]).filter(h=>h.startsWith('http:')),[]);
  assert.ok(!readdirSync(join(dir,'ext')).includes('dashboard.js'));
  for(const name of ['background-dev.js','schedule-core.js','dev-popup.js']){
   const code=readFileSync(join(root,'extension-dev',name),'utf8');
   for(const banned of [/onMessageExternal/,/onConnectExternal/,/WebSocket/,/EventSource/,/\.click\(/,/\.submit\(/,/type=.?password/,/\.value\s*=[^=].*(?:password|code)/i,/cookies/])assert.ok(!banned.test(code),name+' '+banned);
  }
  const worker=readFileSync(join(root,'extension-dev/background-dev.js'),'utf8'),fetches=[...worker.matchAll(/fetch\(([^,)]+)/g)].map(x=>x[1]);assert.deepEqual(fetches.sort(),["REPORT_URL","chrome.runtime.getURL('build-stamp.json'"].sort(),'it sends one report and reads its own file: nothing it fetches can start a refresh');
  assert.ok(!/\.json\(\)\)?[^;]*engine\.start/.test(worker));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the release audit refuses any dev scheduling feature in a package',()=>{
 const source=readFileSync(join(root,'scripts/audit-release.py'),'utf8');
 for(const marker of ['cardybara-dev-schedule','/api/dev/diagnostics','build-stamp.json','dev-popup.html','background-dev'])assert.ok(source.includes(marker),marker);
 for(const file of readdirSync(join(root,'extension-next')).filter(f=>f.endsWith('.js')))assert.ok(!/extension-dev|background-dev|schedule-core/.test(readFileSync(join(root,'extension-next',file),'utf8')),file);
 const build=readFileSync(join(root,'scripts/build-release.py'),'utf8');assert.ok(!build.includes('extension-dev'));
});
test('the package audit fails on a real zip holding a dev scheduling feature',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-audit-dev-'));
 try{
  for(const [name,content,why] of [['assets/x.js','fetch("/api/dev/diagnostics")','content'],['dev-popup.js','x','name'],['assets/y.js','fetch("build-stamp.json")','reload']]){
   const zip=join(dir,why+'.zip');spawnSync('python3',['-c',"import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w');z.writestr(sys.argv[2],sys.argv[3]);z.close()",zip,name,content]);
   const r=spawnSync('python3',['scripts/audit-release.py','--package','--package-file='+zip],{cwd:root,encoding:'utf8'});assert.notEqual(r.status,0,why);assert.match(r.stdout+r.stderr,/Dev-only scheduled refresh in package/,why);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the local server stores a redacted report from the dev extension and refuses anything else',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-diag-'));process.env.CARDYBARA_DEV_DIAGNOSTICS_DIR=dir;
 const {createWalletHandler}=await import('../scripts/dev-server.mjs');const server=http.createServer(createWalletHandler({port:18791,staticFiles:false}));await new Promise(r=>server.listen(18791,'127.0.0.1',r));
 const post=(body,headers={})=>fetch('http://127.0.0.1:18791/api/dev/diagnostics',{method:'POST',headers:{'Content-Type':'application/json','X-Cardybara-Client':'extension-dev',Origin:'chrome-extension://abc',...headers},body:JSON.stringify(body)});
 try{
  const report={schema:1,at:5,build:'dev',run:'complete',banks:[{bank:'BOA',status:'updated'}]};
  assert.equal((await post(report,{'X-Cardybara-Client':'other'})).status,400);assert.equal((await post(report,{Origin:'https://example.test'})).status,400);
  assert.equal((await post({...report,banks:[{bank:'BOA',note:'3141'}]})).status,400);assert.deepEqual(readdirSync(dir),[]);
  assert.equal((await post(report)).status,200);assert.equal(JSON.parse(readFileSync(join(dir,'latest.json'),'utf8')).run,'complete');
  assert.equal((await fetch('http://127.0.0.1:18791/api/dev/refresh',{method:'POST'})).ok,false,'there is no route that starts a refresh');
 }finally{server.close();rmSync(dir,{recursive:true,force:true});delete process.env.CARDYBARA_DEV_DIAGNOSTICS_DIR;}
});
test('in a mock Chrome: reads a signed-in tab, stops on failure, asks nothing, reports, and reloads itself on a new build',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-dev-worker-'));
 try{
  const built=spawnSync(process.execPath,['scripts/build-dev-extension.mjs','--no-wallet'],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_DEV_EXTENSION_DIR:join(dir,'ext')}});assert.equal(built.status,0,built.stderr);
  const store={},L={},calls={files:[],created:[],removed:[],reloads:0,posts:[]};let idle='idle',tabs=[],nextTab=10,read='updated',stamp=JSON.parse(readFileSync(join(dir,'ext/build-stamp.json'),'utf8')).stamp;
  const listen=name=>{L[name]=[];return {addListener:f=>L[name].push(f)};};
  const href='https://secure.bankofamerica.com/accounts-home/';
  globalThis.chrome={runtime:{id:'dev',getURL:p=>'chrome-extension://dev/'+p,onMessage:listen('message'),sendMessage:async()=>{},reload:()=>{calls.reloads++;}},permissions:{contains:async()=>true},
   storage:{session:{},onChanged:listen('storage'),local:{get:async k=>k?(typeof k==='string'?{[k]:store[k]}:Object.fromEntries(k.map(x=>[x,store[x]]))):store,set:async s=>{const changes={};for(const [k,v]of Object.entries(s)){store[k]=structuredClone(v);changes[k]={newValue:structuredClone(v)};}for(const f of L.storage)f(changes,'local');},remove:async k=>{delete store[k];},setAccessLevel:async()=>{}}},
   alarms:{onAlarm:listen('alarm'),create:async()=>{},get:async()=>null,clear:async()=>{}},idle:{setDetectionInterval:()=>{},onStateChanged:listen('idle'),queryState:async()=>idle},action:{setBadgeText:async()=>{}},windows:{getLastFocused:async()=>({id:1,focused:false})},
   tabs:{onUpdated:listen('updated'),onRemoved:listen('removed'),query:async q=>q?.active?[{id:1}]:tabs,get:async id=>tabs.find(t=>t.id===id)||(()=>{throw Error('no tab');})(),sendMessage:async()=>{},
    create:async o=>{const t={id:nextTab++,url:o.url.includes('bankofamerica')?href:o.url,status:'complete',windowId:1};tabs.push(t);calls.created.push(o);setTimeout(()=>{for(const f of L.updated){f(t.id,{status:'loading'},t);f(t.id,{status:'complete'},t);}},5);return t;},
    update:async(id,o)=>({id,...o}),reload:async id=>{const t=tabs.find(x=>x.id===id);setTimeout(()=>{for(const f of L.updated){f(id,{status:'loading'},t);f(id,{status:'complete'},t);}},5);},remove:async id=>{calls.removed.push(id);tabs=tabs.filter(t=>t.id!==id);}},
   scripting:{executeScript:async o=>{
    const doc='doc',name=o.func?.name;
    if(o.files){calls.files.push(o.files[0]);return [{documentId:doc,result:o.files[0]==='dev-structure-report.js'?{path:'/accounts-home/',rows:[{text:'Balance $#,###.##'}]}:undefined}];}
    if(name==='discoverVisibleCards')return [{documentId:doc,result:read==='needs_login'?{status:'needs_login',cards:[]}:{status:'found',cards:[{tail:'3141',name:'Quokka'}]}}];
    if(name==='boaCards')return [{documentId:doc,result:o.args[0]==='list'?[]:[]}];
    if(name==='capturePage'){const evidence='[C1] Current Balance $1.00';return [{documentId:doc,result:{pageHref:href,aliases:[{id:'C1',cardId:'discovered-boa-3141',currency:'USD'}],blocks:[{id:'B1',text:evidence}],observations:[],links:[],capturedAt:new Date().toISOString()}}];}
    if(o.args?.length===3)return [{documentId:doc,result:{status:read,patches:read==='updated'?[{id:'discovered-boa-3141',fields:{balance:1},locale:'en-US',capturedAt:new Date().toISOString()}]:[]}}];
    return [{documentId:doc,result:o.args?.[0]?.length!==undefined?read!=='needs_login':true}];
   }}};
  chrome.storage.session=chrome.storage.local;
  globalThis.fetch=async(url,o)=>{if(String(url).endsWith('build-stamp.json'))return {json:async()=>({stamp})};if(String(url).endsWith('/api/dev/diagnostics')){calls.posts.push(JSON.parse(o.body));return {ok:true};}return {ok:false,json:async()=>({})};};
  await import(pathToFileURL(join(dir,'ext/background-dev.js')).href);
  const state=()=>store['cardybara-state-v2'];const wait=async f=>{const end=Date.now()+5000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,15));}assert.fail('timed out: '+JSON.stringify({run:state()?.run&&{status:state().run.status,jobs:state().run.jobs.map(j=>[j.bank,j.status,j.diagnostic,j.readError,j.phase])},mine:store['cardybara-dev-run'],err:store['cardybara:last-capture-error']}));};
  const alarm=async name=>{for(const f of L.alarm)f({name});await new Promise(r=>setTimeout(r,60));};
  const tick=()=>alarm('cardybara-dev-schedule');
  const settings=()=>store['cardybara-dev-schedule'];
  const popup={id:'dev',url:'chrome-extension://dev/dev-popup.html'},say=(m,sender=popup)=>new Promise(r=>{for(const f of L.message){const kept=f(m,sender,r);if(kept===true)return;}r(null);});
  const allow=()=>{for(const b of Object.values(settings().banks))delete b.lastAttemptAt;};
  const finished=()=>wait(()=>state()?.run?.status&&state().run.status!=='running'&&store['cardybara-dev-run']?.done);

  await tick();assert.equal(state()?.run,undefined,'off until the owner turns it on');
  assert.equal((await say({type:'dev-schedule-set',enabled:true,intervalMinutes:60},{id:'dev',url:'http://127.0.0.1:8766/'}))?.ok,false,'only its own popup can turn it on');
  assert.equal((await say({type:'dev-schedule-set',enabled:true,intervalMinutes:60})).ok,true);
  await tick();assert.equal(state()?.run,undefined);assert.deepEqual(calls.created,[],'no card and no signed-in tab: nothing opens');
  idle='active';tabs=[{id:5,url:href,status:'complete',windowId:1,active:false}];await tick();assert.equal(state()?.run,undefined,'it waits until Chrome is idle');
  idle='idle';await tick();await finished();
  assert.equal(state().run.scheduled,true);assert.equal(settings().banks.BOA.state,'ok');assert.deepEqual(calls.removed,[],'the owner\'s own tab stays open');assert.ok(!calls.files.includes('guide.js'),'a scheduled run asks nothing');
  assert.equal(calls.posts.length,1);assert.ok(!JSON.stringify(calls.posts).match(/3141|Quokka/));assert.equal(calls.posts[0].banks[0].bank,'BOA');
  const runId=state().run.id;await tick();assert.equal(state().run.id,runId,'the minimum interval holds');

  tabs=[];read='needs_login';allow();await tick();await wait(()=>state().run.id!==runId);await finished();
  assert.equal(calls.created.length,1,'a bank that read fine may open its normal page');assert.equal(settings().banks.BOA.state,'login_expired');assert.equal(calls.removed.length,1,'its own tab closes');assert.ok(!calls.files.includes('guide.js'));
  const expired=state().run.id;allow();await tick();assert.equal(state().run.id,expired,'an expired login is not retried');assert.equal(calls.created.length,1);

  read='load_error';tabs=[{id:6,url:href,status:'complete',windowId:1,active:false}];allow();read='no_data';await tick();await wait(()=>state().run.id!==expired);await finished();
  assert.equal(settings().banks.BOA.state,'stopped');const stopped=state().run.id;allow();await tick();assert.equal(state().run.id,stopped,'a stopped bank is not retried');
  assert.equal(calls.posts.at(-1).banks[0].page.rows[0].text,'Balance $#,###.##','the failed page\'s shape is reported');

  await alarm('cardybara-dev-reload');assert.equal(calls.reloads,0,'the same build does nothing');
  stamp='rebuilt';await alarm('cardybara-dev-reload');assert.equal(calls.reloads,1);await alarm('cardybara-dev-reload');assert.equal(calls.reloads,1,'one try per build');assert.equal(state().run.id,stopped,'a new build never starts a refresh');
  delete store.devReloadTried;
 }finally{rmSync(dir,{recursive:true,force:true});}
});
