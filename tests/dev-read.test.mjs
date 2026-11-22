// The dev build's Read now, diagnostics and self-reload, run in a mock Chrome. No bank contact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import http from 'node:http';
import {afterRun,buildReport,classifyJob,decideBanks,defaultState,planBanks,POPUP_WORDS,SKIP_REASONS,validReport} from '../extension-dev/read-core.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const found=banks=>Object.fromEntries((banks||[]).map(b=>[b,'found']));
const plan=(state,{signedIn,...extra}={})=>planBanks({state,activeBanks:['Chase','BOA','Amex US','Amex HK'],withCards:[],tabs:found(signedIn),...extra});
const why=(state,bank,extra={})=>decideBanks({state,activeBanks:['Chase','BOA','Amex US','Amex HK'],withCards:[],...extra})[bank];
const bank=(banks={})=>({...defaultState(),banks});

test('a bank is opened only after a good read; otherwise the owner\'s signed-in tab must exist',()=>{
 assert.deepEqual(plan(bank(),{withCards:['BOA']}),[],'cards alone never open a login page');
 assert.deepEqual(plan(bank(),{signedIn:['BOA']}),['BOA']);
 assert.deepEqual(plan(bank({BOA:{state:'ok'}}),{withCards:['BOA']}),['BOA']);
 assert.deepEqual(plan(bank({BOA:{state:'login_expired'}}),{withCards:['BOA']}),[],'an expired login is not hit again');
 assert.deepEqual(plan(bank({BOA:{state:'login_expired'}}),{signedIn:['BOA']}),['BOA']);
 assert.deepEqual(plan(bank({BOA:{state:'failed'}}),{signedIn:['BOA'],withCards:['BOA']}),['BOA'],'a failed bank can be read again');
 assert.deepEqual(plan(bank({BOA:{state:'failed'}}),{withCards:['BOA']}),[],'but a failure alone does not open its page');
});
test('every check says why each bank will or will not be read',()=>{
 assert.equal(why(bank(),'BOA'),'no_tab');
 assert.equal(why(bank(),'BOA',{tabs:{BOA:'needs_login'}}),'signed_out');
 assert.equal(why(bank(),'BOA',{tabs:{BOA:'ambiguous'}}),'other_region');
 assert.equal(why(bank(),'BOA',{tabs:{BOA:'no_data'}}),'no_cards_found');
 assert.equal(why(bank(),'BOA',{tabs:{BOA:'failed'}}),'check_failed');
 assert.equal(why(bank(),'BOA',{tabs:found(['BOA']),disabled:['BOA']}),'disconnected');
 assert.equal(why(bank(),'BOA',{tabs:found(['BOA'])}),'ready');
 for(const reason of Object.values(decideBanks({state:bank(),activeBanks:['Chase','BOA','Amex US','Amex HK'],withCards:[],tabs:found(['Amex US','Amex HK'])})))assert.ok(SKIP_REASONS.includes(reason),reason);
 for(const lang of Object.keys(POPUP_WORDS))for(const reason of SKIP_REASONS)assert.ok(POPUP_WORDS[lang][reason],lang+' '+reason);
});
test('Amex regions never run together, and nothing in the rules mentions a schedule',()=>{
 assert.deepEqual(plan(bank(),{signedIn:['Amex US','Amex HK','Chase']}),['Chase','Amex US']);
 assert.equal(why(bank(),'Amex HK',{tabs:found(['Amex US','Amex HK'])}),'amex_turn');
});
test('a failure is shown but never blocks the next read; a login expiry waits for the owner\'s own tab',()=>{
 assert.equal(classifyJob({status:'updated'}).state,'ok');assert.equal(classifyJob({status:'partial'}).state,'ok');
 assert.equal(classifyJob({status:'needs_login'}).state,'login_expired');
 assert.equal(classifyJob({status:'updated',readError:'needs_login'}).state,'login_expired','a login that appears mid-run still counts');
 assert.deepEqual(classifyJob({status:'load_error'}),{state:'failed',reason:'load_error'});
 assert.equal(classifyJob({status:'updated',readError:'needs_confirmation'}).state,'failed');
 assert.equal(classifyJob({status:'Bad Value!'}).reason,'unknown');
 const after=afterRun(bank({Chase:{state:'ok'}}),{jobs:[{bank:'BOA',status:'load_error'}]},5);
 assert.equal(after.banks.BOA.state,'failed');assert.equal(after.banks.BOA.finishedAt,5);assert.equal(after.banks.Chase.state,'ok','other banks keep their last result');
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
test('a report says why fields are missing, counting each card once and naming none',()=>{
 const cards=[{id:'discovered-amex-us-31415'},{id:'discovered-amex-us-27182'}];
 const job={bank:'Amex US',status:'partial',cards,startedAt:0,sections:{
  card:{status:'partial',coverage:[{cardId:cards[0].id,missing:['due'],notApplicable:[],complete:false},{cardId:cards[1].id,missing:['statement'],notApplicable:['minimum','due'],reason:'Payment not required at this time',complete:false}]},
  reward:{status:'partial',coverage:[{cardId:cards[0].id,complete:true,missing:[]},{cardId:cards[1].id,complete:false,missing:['reward'],reason:'programme_unconfirmed',unconfirmed:['Quokka Miles']}]}}};
 const at=new Date(5).toISOString(),state={records:{'Amex US':{[cards[0].id]:{balance:{value:1,capturedAt:at}}}},agentRecords:[{bank:'Amex US',cardId:cards[0].id,kind:'card',key:'balance',capturedAt:at},{bank:'Amex US',cardId:cards[1].id,kind:'card',key:'balance',capturedAt:at}]};
 const report=buildReport({run:{status:'complete',jobs:[job]},state,build:'dev',now:5}),bank=report.banks[0],text=JSON.stringify({...report,at:0});
 assert.equal(bank.fields.balance,2,'a card read twice counts once');
 assert.deepEqual(bank.coverage.card,{missing:{due:1,statement:1},notApplicable:{minimum:1,due:1},reasons:{payment_notice:1},notCollected:0,unconfirmedProgrammes:0});
 assert.deepEqual(bank.coverage.reward,{missing:{reward:1},notApplicable:{},reasons:{programme_unconfirmed:1},notCollected:0,unconfirmedProgrammes:1});
 for(const secret of ['31415','27182','Quokka','Payment not required','discovered'])assert.ok(!text.includes(secret),secret);
 assert.equal(validReport(report),true);
});
test('the dev build has no way in from localhost, and never touches a credential',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-dev-build-'));
 try{
  const r=spawnSync(process.execPath,['scripts/build-dev-extension.mjs','--no-wallet'],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_DEV_EXTENSION_DIR:join(dir,'ext')}});assert.equal(r.status,0,r.stderr);
  const m=JSON.parse(readFileSync(join(dir,'ext/manifest.json'),'utf8'));
  assert.equal(m.content_scripts,undefined);assert.equal(m.externally_connectable,undefined);assert.equal(m.background.service_worker,'background-dev.js');
  assert.ok(!m.permissions.includes('idle'),'no idle permission');assert.deepEqual(m.host_permissions.filter(h=>h.startsWith('http:')),['http://127.0.0.1:8776/*']);assert.deepEqual((m.optional_host_permissions||[]).filter(h=>h.startsWith('http:')),[]);
  assert.ok(!readdirSync(join(dir,'ext')).includes('dashboard.js'));
  writeFileSync(join(dir,'keep.txt'),'x');const refused=spawnSync(process.execPath,['scripts/build-dev-extension.mjs','--no-wallet'],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_DEV_EXTENSION_DIR:dir}});assert.notEqual(refused.status,0,'a folder it did not build is not replaced');assert.ok(readdirSync(dir).includes('keep.txt'));
  for(const name of ['background-dev.js','read-core.js','dev-popup.js']){
   const code=readFileSync(join(root,'extension-dev',name),'utf8');
   for(const banned of [/onMessageExternal/,/onConnectExternal/,/WebSocket/,/EventSource/,/\.click\(/,/\.submit\(/,/type=.?password/,/\.value\s*=[^=].*(?:password|code)/i,/cookies/])assert.ok(!banned.test(code),name+' '+banned);
  }
  const worker=readFileSync(join(root,'extension-dev/background-dev.js'),'utf8'),fetches=[...worker.matchAll(/fetch\(([^,)]+)/g)].map(x=>x[1]);assert.deepEqual(fetches.sort(),["REPORT_URL","chrome.runtime.getURL('build-stamp.json'"].sort(),'it sends one report and reads its own file: nothing it fetches can start a refresh');
  assert.ok(!/\.json\(\)\)?[^;]*engine\.start/.test(worker));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the release audit refuses any dev-only feature in a package',()=>{
 const source=readFileSync(join(root,'scripts/audit-release.py'),'utf8');
 for(const marker of ['cardybara-dev-schedule','/api/dev/diagnostics','build-stamp.json','dev-popup.html','dev-read-now','background-dev'])assert.ok(source.includes(marker),marker);
 for(const file of readdirSync(join(root,'extension-next')).filter(f=>f.endsWith('.js')))assert.ok(!/extension-dev|background-dev|read-core|schedule-core/.test(readFileSync(join(root,'extension-next',file),'utf8')),file);
 const build=readFileSync(join(root,'scripts/build-release.py'),'utf8');assert.ok(!build.includes('extension-dev'));
});
test('the package audit fails on a real zip holding a dev-only feature',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-audit-dev-'));
 try{
  for(const [name,content,why] of [['assets/x.js','fetch("/api/dev/diagnostics")','content'],['dev-popup.js','x','name'],['assets/y.js','fetch("build-stamp.json")','reload']]){
   const zip=join(dir,why+'.zip');spawnSync('python3',['-c',"import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1],'w');z.writestr(sys.argv[2],sys.argv[3]);z.close()",zip,name,content]);
   const r=spawnSync('python3',['scripts/audit-release.py','--package','--package-file='+zip],{cwd:root,encoding:'utf8'});assert.notEqual(r.status,0,why);assert.match(r.stdout+r.stderr,/Dev-only read-now build in package/,why);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('the parity check fails when the dev build runs different code from the release package',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-parity-test-'));
 try{
  const built=spawnSync(process.execPath,['scripts/build-dev-extension.mjs','--no-wallet'],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_DEV_EXTENSION_DIR:join(dir,'ext')}});assert.equal(built.status,0,built.stderr);
  const manifest=JSON.parse(readFileSync(join(dir,'ext/manifest.json'),'utf8')),release={...manifest,permissions:manifest.permissions,host_permissions:manifest.host_permissions.filter(h=>!h.startsWith('http:'))};
  writeFileSync(join(dir,'m.json'),JSON.stringify(release));
  // A package holding every shared file, as the real one does.
  const make=(name,source)=>spawnSync('python3',['-c',"import sys,zipfile,pathlib\nz=zipfile.ZipFile(sys.argv[1],'w')\nroot=pathlib.Path(sys.argv[4])\nfor f in root.rglob('*'):\n if f.is_file() and f.name not in ['manifest.json','reader.js','background-dev.js','read-core.js','dev-popup.html','dev-popup.js','dev-build-info.js','build-stamp.json','dev-structure-report.js']:z.write(f,f.relative_to(root).as_posix())\nz.writestr('manifest.json',open(sys.argv[2]).read());z.writestr('reader.js',open(sys.argv[3]).read());z.close()",join(dir,name),join(dir,'m.json'),source,join(dir,'ext')]);
  const check=(zip,dev=join(dir,'ext'))=>spawnSync('python3',['scripts/check-dev-parity.py','--dev-dir='+dev,'--package-file='+join(dir,zip)],{cwd:root,encoding:'utf8'});
  make('same.zip',join(root,'extension-next/reader.js'));const same=check('same.zip');assert.equal(same.status,0,same.stdout+same.stderr);
  writeFileSync(join(dir,'other.js'),readFileSync(join(root,'extension-next/reader.js'),'utf8')+'\n// changed\n');make('other.zip',join(dir,'other.js'));
  const other=check('other.zip');assert.notEqual(other.status,0);assert.match(other.stdout+other.stderr,/differs from the release package: reader\.js/);
  writeFileSync(join(dir,'ext/icons/extra-reader.js'),'x');const extra=check('same.zip');assert.notEqual(extra.status,0);assert.match(extra.stdout+extra.stderr,/unexpected dev file: icons\/extra-reader\.js/,'nested files count too');rmSync(join(dir,'ext/icons/extra-reader.js'));
  writeFileSync(join(dir,'ext/manifest.json'),JSON.stringify({...manifest,content_security_policy:{extension_pages:"script-src 'self' 'unsafe-eval'"}}));const policy=check('same.zip');assert.notEqual(policy.status,0);assert.match(policy.stdout+policy.stderr,/manifest differs: content_security_policy/);
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
  assert.equal(JSON.parse(readFileSync(join(dir,'latest-run.json'),'utf8')).run,'complete');
  assert.equal((await fetch('http://127.0.0.1:18791/api/dev/refresh',{method:'POST'})).ok,false,'there is no route that starts a refresh');
 }finally{server.close();rmSync(dir,{recursive:true,force:true});delete process.env.CARDYBARA_DEV_DIAGNOSTICS_DIR;}
});
test('in a mock Chrome: Read now reads a signed-in tab, reports, retries a pending report, and reloads itself on a new build',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-dev-worker-'));
 try{
  // BOA is outside the beta scope in release.json; this test drives the worker, so it keeps every bank.
  const built=spawnSync(process.execPath,['scripts/build-dev-extension.mjs','--no-wallet'],{cwd:root,encoding:'utf8',env:{...process.env,CARDYBARA_DEV_EXTENSION_DIR:join(dir,'ext'),CARDYBARA_ALL_BANKS:'1'}});assert.equal(built.status,0,built.stderr);
  const store={'cardybara-parser-settings':{scope:'mvp',enabled:true,cloudConsent:true},'cardybara-dev-schedule':{enabled:true,intervalMinutes:60,banks:{}}},L={},calls={files:[],created:[],removed:[],reloads:0,posts:[],alarms:[],cleared:[]};let tabs=[],nextTab=10,read='updated',captureError=null,serverUp=true,stamp=JSON.parse(readFileSync(join(dir,'ext/build-stamp.json'),'utf8')).stamp;
  const listen=name=>{L[name]=[];return {addListener:f=>L[name].push(f)};};
  const href='https://secure.bankofamerica.com/accounts-home/';
  globalThis.chrome={runtime:{id:'dev',getURL:p=>'chrome-extension://dev/'+p,onMessage:listen('message'),sendMessage:async()=>{},reload:()=>{calls.reloads++;}},permissions:{contains:async()=>true},
   storage:{session:{},onChanged:listen('storage'),local:{get:async k=>k?(typeof k==='string'?{[k]:store[k]}:Object.fromEntries(k.map(x=>[x,store[x]]))):store,set:async s=>{const changes={};for(const [k,v]of Object.entries(s)){store[k]=structuredClone(v);changes[k]={newValue:structuredClone(v)};}for(const f of L.storage)f(changes,'local');},remove:async k=>{for(const x of [].concat(k))delete store[x];},setAccessLevel:async()=>{}}},
   alarms:{onAlarm:listen('alarm'),create:async n=>{calls.alarms.push(n);},get:async()=>null,clear:async n=>{calls.cleared.push(n);}},action:{setBadgeText:async()=>{}},windows:{getLastFocused:async()=>({id:1,focused:true})},
   tabs:{onUpdated:listen('updated'),onRemoved:listen('removed'),query:async q=>q?.active?[{id:1}]:tabs,get:async id=>tabs.find(t=>t.id===id)||(()=>{throw Error('no tab');})(),sendMessage:async()=>{},
    create:async o=>{const t={id:nextTab++,url:o.url.includes('bankofamerica')?href:o.url,status:'complete',windowId:1};tabs.push(t);calls.created.push(o);setTimeout(()=>{for(const f of L.updated){f(t.id,{status:'loading'},t);f(t.id,{status:'complete'},t);}},5);return t;},
    update:async(id,o)=>({id,...o}),reload:async id=>{const t=tabs.find(x=>x.id===id);setTimeout(()=>{for(const f of L.updated){f(id,{status:'loading'},t);f(id,{status:'complete'},t);}},5);},remove:async id=>{calls.removed.push(id);tabs=tabs.filter(t=>t.id!==id);}},
   scripting:{executeScript:async o=>{
    const doc='doc',name=o.func?.name;
    if(o.files){calls.files.push(o.files[0]);return [{documentId:doc,result:o.files[0]==='dev-structure-report.js'?{path:'/accounts-home/',rows:[{text:'Balance $#,###.##'}]}:undefined}];}
    if(name==='discoverVisibleCards')calls.probes=(calls.probes||0)+1;
    if(name==='discoverVisibleCards')return [{documentId:doc,result:read==='needs_login'?{status:'needs_login',cards:[]}:{status:'found',cards:[{tail:'3141',name:'Quokka'}]}}];
    if(name==='boaCards')return [{documentId:doc,result:o.args[0]==='list'?[]:[]}];
    if(name==='capturePage'){if(captureError)return [{documentId:doc,result:{error:captureError}}];const evidence='[C1] Current Balance $1.00';return [{documentId:doc,result:{pageHref:href,aliases:[{id:'C1',cardId:'discovered-boa-3141',currency:'USD'}],blocks:[{id:'B1',text:evidence}],observations:[],links:[],capturedAt:new Date().toISOString()}}];}
    if(o.args?.length===3)return [{documentId:doc,result:{status:read,patches:read==='updated'?[{id:'discovered-boa-3141',fields:{balance:1},locale:'en-US',capturedAt:new Date().toISOString()}]:[]}}];
    return [{documentId:doc,result:o.args?.[0]?.length!==undefined?read!=='needs_login':true}];
   }}};
  chrome.storage.session=chrome.storage.local;
  globalThis.fetch=async(url,o)=>{if(String(url).endsWith('build-stamp.json'))return {json:async()=>({stamp})};if(String(url).endsWith('/api/dev/diagnostics')){if(!serverUp)throw Error('down');calls.posts.push(JSON.parse(o.body));return {ok:true};}if(String(url).endsWith('/api/parser/parse'))calls.parser=true;if(String(url).endsWith('/api/parser/status'))return {ok:true,json:async()=>({configured:true})};return {ok:false,json:async()=>({})};};
  store['cardybara-dev-pending-report']=[{schema:1,at:1,build:'dev',run:'skipped',banks:[]},{schema:1,at:2,build:'dev',run:'complete',banks:[]}];
  await import(pathToFileURL(join(dir,'ext/background-dev.js')).href);
  const state=()=>store['cardybara-state-v2'];const wait=async f=>{const end=Date.now()+5000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,15));}assert.fail('timed out: '+JSON.stringify({run:state()?.run&&{status:state().run.status,jobs:state().run.jobs.map(j=>[j.bank,j.status,j.diagnostic,j.readError,j.phase])},mine:store['cardybara-dev-run'],err:store['cardybara:last-capture-error']}));};
  const alarm=async name=>{for(const f of L.alarm)f({name});await new Promise(r=>setTimeout(r,60));};
  const popup={id:'dev',url:'chrome-extension://dev/dev-popup.html'},say=(m,sender=popup)=>new Promise(r=>{for(const f of L.message){const kept=f(m,sender,r);if(kept===true)return;}r(null);});
  const lastRead=()=>store['cardybara-dev-last-read'];
  const finished=()=>wait(()=>state()?.run?.status&&state().run.status!=='running'&&store['cardybara-dev-run']?.done);

  await wait(()=>store['cardybara-dev-pending-report']===undefined);
  assert.deepEqual(calls.posts.map(p=>p.run),['complete'],'a report waiting from an earlier build is sent; an old skipped one is dropped');calls.posts.length=0;
  assert.equal(store['cardybara-dev-schedule'],undefined,'the obsolete schedule key is cleared at startup');assert.deepEqual(calls.alarms,['cardybara-dev-reload'],'only the reload alarm is created');assert.ok(calls.cleared.includes('cardybara-dev-schedule'));
  assert.equal(state()?.run,undefined,'startup never reads');
  for(const f of L.alarm)f({name:'cardybara-dev-schedule'});await new Promise(r=>setTimeout(r,60));assert.equal(state()?.run,undefined,'an old schedule alarm does nothing');
  // Opening the popup only looks.
  const opened=await say({type:'dev-read-status'});assert.equal(opened.ok,true);assert.equal(opened.read.skips.BOA,'no_tab');assert.deepEqual(opened.read.readNow,[]);
  assert.equal(await say({type:'dev-schedule-get'}),null,'the old schedule messages are gone');
  tabs=[{id:5,url:href,status:'complete',windowId:1,active:true}];
  const signedIn=await say({type:'dev-read-status'});assert.equal(signedIn.read.skips.BOA,'ready');assert.deepEqual(signedIn.read.readNow,['BOA'],'the popup says which signed-in banks Read now would take');await new Promise(r=>setTimeout(r,60));assert.equal(state()?.run,undefined,'opening the popup never starts a read');
  // Read now: only the popup may start it, and nothing else does.
  for(const sender of [{id:'dev',url:'chrome-extension://dev/index.html'},{id:'dev',url:'http://127.0.0.1:8776/'},{id:'other',url:'chrome-extension://dev/dev-popup.html'}])for(const type of ['dev-read-now','dev-read-status','dev-read-poll'])assert.equal((await say({type},sender))?.ok,false,type+' '+sender.url);
  assert.equal(state()?.run,undefined);
  const started=await say({type:'dev-read-now'});assert.equal(started.outcome,'started');
  await finished();
  assert.equal(state().run.manual,true);assert.equal(lastRead().banks.BOA.state,'ok');assert.deepEqual(calls.removed,[],'the owner\'s own tab stays open');assert.ok(calls.files.includes('guide.js'),'the owner is there, so the guide shows');assert.ok(!calls.parser,'a read sends nothing to the model route');
  assert.equal(calls.posts.length,1);assert.ok(!JSON.stringify(calls.posts.map(({at,...rest})=>rest)).match(/3141|Quokka/),'at is a timestamp, the one number that can hold these digits by chance');assert.equal(calls.posts.every(validReport),true);assert.equal(calls.posts[0].banks[0].bank,'BOA');
  assert.equal((await say({type:'dev-read-poll'})).running,false);assert.equal((await say({type:'dev-read-poll'})).read.banks.BOA.state,'ok','the popup shows each bank\'s result');
  // No interval: the next click reads again at once.
  const first=state().run.id;assert.equal((await say({type:'dev-read-now'})).outcome,'started');await wait(()=>state().run.id!==first);await finished();assert.equal(calls.posts.length,2);

  // A bank that read fine may open its normal page; once its login expires, only the owner's own signed-in tab is read.
  read='needs_login';tabs=[];const before=state().run.id;assert.equal((await say({type:'dev-read-now'})).outcome,'started');await wait(()=>state().run.id!==before);await finished();
  assert.equal(calls.created.length,1);assert.equal(lastRead().banks.BOA.state,'login_expired');assert.equal(calls.removed.length,0,'a read the owner starts leaves its tab open');
  const expired=state().run.id;tabs=[];assert.equal((await say({type:'dev-read-now'})).outcome,'nothing','an expired login is not hit again');assert.equal(calls.created.length,1);assert.equal(state().run.id,expired);
  tabs=[{id:6,url:href,status:'complete',windowId:1,active:false}];assert.equal((await say({type:'dev-read-now'})).outcome,'nothing','the tab shows a login page');assert.equal(state().run.id,expired);
  read='updated';
  // Failure after a partial read: reported, shown, and the next click still reads.
  captureError='needs_confirmation';assert.equal((await say({type:'dev-read-now'})).outcome,'started');await wait(()=>state().run.id!==expired);await finished();
  assert.equal(lastRead().banks.BOA.state,'failed','a challenge after a partial read is a failure');assert.equal(calls.posts.at(-1).banks[0].page.rows[0].text,'Balance $#,###.##','the failed page\'s shape is reported');
  const failed=state().run.id;captureError=null;assert.equal((await say({type:'dev-read-now'})).outcome,'started','a failure never blocks the next Read now');await wait(()=>state().run.id!==failed);await finished();assert.equal(lastRead().banks.BOA.state,'ok');
  // Server down: the report waits, and the next try sends it.
  serverUp=false;const down=state().run.id;calls.posts.length=0;assert.equal((await say({type:'dev-read-now'})).outcome,'started');await wait(()=>state().run.id!==down);await finished();
  assert.equal(calls.posts.length,0);assert.equal(store['cardybara-dev-pending-report'].length,1,'the report waits for the server');
  serverUp=true;await alarm('cardybara-dev-reload');assert.equal(calls.posts.length,1);assert.equal(store['cardybara-dev-pending-report'],undefined,'it is sent once the server is back');
  // Reload on a new build never reads.
  const last=state().run.id;await alarm('cardybara-dev-reload');assert.equal(calls.reloads,0,'the same build does nothing');
  stamp='rebuilt';await alarm('cardybara-dev-reload');assert.equal(calls.reloads,1);await alarm('cardybara-dev-reload');assert.equal(calls.reloads,1,'one try per build');assert.equal(state().run.id,last,'a new build never starts a read');
  // A worker that died mid-run: the check must settle that run, not replace it.
  store['cardybara-state-v2']={...state(),run:{...state().run,id:'interrupted-run',status:'interrupted',jobs:state().run.jobs.map(j=>({...j,status:'interrupted'}))}};store['cardybara-dev-run']={id:'interrupted-run'};
  const created=calls.created.length;await say({type:'dev-read-status'});assert.equal(state().run.id,'interrupted-run','not replaced');assert.equal(lastRead().banks.BOA.state,'failed','its result is kept');assert.equal(store['cardybara-dev-run'].done,true);assert.equal(calls.created.length,created);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
