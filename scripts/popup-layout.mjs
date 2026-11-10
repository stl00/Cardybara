// Measures both extension popups in headless Chrome with synthetic state: no extension install, no bank.
// Chrome caps a popup at 800×600 and scrolls the whole window past that, so every scenario here must fit.
// Run: node scripts/popup-layout.mjs [--shots <dir>]  (prints one JSON line per scenario)
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,mkdir,rm,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {findChrome} from './dev-collector/chrome-launcher.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const POPUP_MAX={width:800,height:600};
const NOW=Date.UTC(2026,10,10,15,0);
const H=3600000;

// Eight banks, every status the dev popup can show at once, with a last result on most rows.
const DEV_SKIPS={'Amex US':'not_due','Amex HK':'amex_turn',Chase:'ready',BOA:'stopped','HSBC HK':'signed_out','SC HK':'no_tab','Citi US':'check_failed','Amex CA':'other_region'};
const DEV_BANKS={'Amex US':{state:'ok',lastAttemptAt:NOW-2*H,finishedAt:NOW-2*H},'Amex HK':{state:'login_expired',lastAttemptAt:NOW-5*H,finishedAt:NOW-5*H},Chase:{state:'ok',lastAttemptAt:NOW-30*H,finishedAt:NOW-30*H},BOA:{state:'stopped',reason:'no_data',lastAttemptAt:NOW-3*H,finishedAt:NOW-3*H},'HSBC HK':{state:'login_expired',lastAttemptAt:NOW-26*H,finishedAt:NOW-26*H},'SC HK':{state:'ok',lastAttemptAt:NOW-50*H,finishedAt:NOW-50*H},'Citi US':{state:'stopped',lastAttemptAt:NOW-H,finishedAt:NOW-H},'Amex CA':{}};
const devState={ok:true,running:false,settings:{enabled:true,intervalMinutes:360,lastCheckAt:NOW-10*60000,readNow:['Amex US','Chase','BOA','Citi US'],skips:DEV_SKIPS,banks:DEV_BANKS}};
// The release popup with a run over every active bank, each in a different phase.
const JOBS=[['Amex US','updated'],['Amex HK','needs_login'],['Chase','capturing'],['BOA','partial'],['HSBC HK','needs_confirmation'],['SC HK','load_error'],['Citi US','queued']];
const releaseState={ok:true,state:{runtimeBuild:'stale-build',disabled:['Citi US'],run:{status:'running',jobs:JOBS.map(([bank,status])=>({bank,status}))}}};
const DIAGNOSTICS={'cardybara:last-capture-error':{bank:'Chase',stage:'capture',code:'load_error',name:'TimeoutError'},'cardybara:last-read-diagnostic':{bank:'BOA',fields:['balance','minimum','dueDate'],missing:['statement'],page:'account-overview',note:'synthetic'}};

export const SCENARIOS=[];
for(const lang of ['zh-CN','zh-TW','en-US']){
 SCENARIOS.push({name:`dev ${lang}`,page:'dev-popup.html',lang,reply:devState});
 SCENARIOS.push({name:`release ${lang}`,page:'popup.html',lang,reply:releaseState,storage:DIAGNOSTICS});
 // Everything unfolded: the bank list and both diagnostics. Only the inner list may scroll here.
 SCENARIOS.push({name:`release ${lang} unfolded`,page:'popup.html',lang,reply:releaseState,storage:DIAGNOSTICS,open:true});
}

const stub=({lang,reply,storage={}})=>`localStorage.setItem('cardybara-language',${JSON.stringify(lang)});
Date.now=()=>${NOW};
globalThis.chrome={runtime:{sendMessage:async()=>structuredClone(${JSON.stringify(reply)}),reload(){}},storage:{local:{get:async k=>({[k]:${JSON.stringify(storage)}[k]})}}};`;

const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function stage(dir){
 await cp(join(root,'extension-next'),dir,{recursive:true});
 for(const f of ['dev-popup.html','dev-popup.js','schedule-core.js'])await cp(join(root,'extension-dev',f),join(dir,f));
 await cp(join(root,'public/brand'),join(dir,'brand'),{recursive:true});
 for(const [i,s] of SCENARIOS.entries()){
  await writeFile(join(dir,`stub-${i}.js`),stub(s));
  const html=await readFile(join(dir,s.page),'utf8');
  await writeFile(join(dir,`scenario-${i}.html`),html.replace('<main>',`<script src="stub-${i}.js"></script><main>`));
 }
}
function serve(dir){
 const server=createServer(async(req,res)=>{
  const path=join(dir,decodeURIComponent(new URL(req.url,'http://x').pathname));
  if(!path.startsWith(dir)){res.writeHead(403).end();return;}
  try{const body=await readFile(path);res.writeHead(200,{'content-type':TYPES[extname(path)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}
 });
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server)));
}
// Every request fails, instead of hanging, when Chrome exits or does not answer in time.
function cdpPipe(child){
 let next=0,buffer=Buffer.alloc(0),gone=null;const pending=new Map();
 const fail=reason=>{gone=gone||reason;for(const [id,p] of pending){pending.delete(id);p.reject(Error(`${p.method}: ${gone}`));}};
 child.on('error',e=>fail('Chrome failed to start ('+e.message+')'));child.on('exit',(code,signal)=>fail(`Chrome exited (${signal||code})`));
 for(const s of [child.stdio[3],child.stdio[4]])s.on('error',e=>fail('pipe closed ('+e.message+')'));
 child.stdio[4].on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);let i;while((i=buffer.indexOf(0))>=0){const msg=JSON.parse(buffer.subarray(0,i).toString('utf8'));buffer=buffer.subarray(i+1);const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(msg.error.message)):p.resolve(msg.result);}}});
 return (method,params={},sessionId)=>new Promise((resolve,reject)=>{
  if(gone)return reject(Error(`${method}: ${gone}`));
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+': no answer in 30 s'));},30000);
  pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);},method,timer});
  child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
 });
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));

export async function measure({shots}={}){
 const work=await mkdtemp(join(tmpdir(),'cardybara-popup-')),site=join(work,'site');
 let server,child;const results=[];
 try{
  await stage(site);server=await serve(site);const port=server.address().port;
  child=spawn(await findChrome(),['--user-data-dir='+join(work,'profile'),'--remote-debugging-pipe','--headless=new','--no-first-run','--no-default-browser-check','--hide-scrollbars','--force-color-profile=srgb',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
  const send=cdpPipe(child);
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Page.enable',{},sessionId);await send('Runtime.enable',{},sessionId);
  if(shots)await mkdir(shots,{recursive:true});
  for(const [i,s] of SCENARIOS.entries()){
   // A 1px-tall viewport makes scrollHeight the content height, as Chrome sizes a popup to its content.
   await send('Emulation.setDeviceMetricsOverride',{width:POPUP_MAX.width,height:1,deviceScaleFactor:shots?2:1,mobile:false},sessionId);
   await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]},sessionId);
   await send('Page.navigate',{url:`http://127.0.0.1:${port}/scenario-${i}.html`},sessionId);
   const expr=`(async()=>{for(let n=0;n<100&&!document.querySelector('#banks li');n++)await new Promise(r=>setTimeout(r,20));await new Promise(r=>setTimeout(r,100));
    if(${!!s.open})for(const d of document.querySelectorAll('details'))d.open=true;
    await document.fonts.ready;const inner=[...document.querySelectorAll('.banks')].filter(l=>l.checkVisibility()).map(l=>({id:l.id,scroll:l.scrollHeight>l.clientHeight+1}));
    // A section that overflows its own box would paint over the next one without growing the page.
    const parts=[...document.querySelector('main').children].filter(e=>e.checkVisibility()),spill=[];
    parts.forEach((e,n)=>{if(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)spill.push(e.id||e.className||e.tagName);if(n&&e.getBoundingClientRect().top<parts[n-1].getBoundingClientRect().bottom-0.5)spill.push((e.id||e.className||e.tagName)+' overlaps');});
    return {width:Math.max(Math.ceil(document.body.getBoundingClientRect().width),document.body.scrollWidth),height:document.documentElement.scrollHeight,inner,spill,rows:Object.fromEntries([...document.querySelectorAll('.banks')].map(l=>[l.id,l.children.length]))};})()`;
   const {result}=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},sessionId);
   const r={name:s.name,...result.value};results.push(r);
   if(shots){
    await send('Emulation.setDeviceMetricsOverride',{width:r.width,height:Math.min(r.height,POPUP_MAX.height),deviceScaleFactor:2,mobile:false},sessionId);await wait(100);
    const {data}=await send('Page.captureScreenshot',{format:'png'},sessionId);
    await writeFile(join(shots,s.name.replaceAll(' ','-')+'.png'),Buffer.from(data,'base64'));
   }
  }
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit').catch(()=>{});child.kill();await Promise.race([exited,wait(5000)]);}
  server?.close();await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
 return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const at=process.argv.indexOf('--shots'),shots=at>0?resolve(process.argv[at+1]):null;
 for(const r of await measure({shots}))console.log(JSON.stringify(r));
}
