// End-to-end test of the packaged extension: the exact release ZIP, installed in a clean Chrome
// profile, against a local synthetic bank. No bank is contacted and no secret is used.
//
//   node scripts/e2e-extension.mjs <release-dir-or-zip> [--out <dir>]
//
// Bank hosts reach the synthetic bank through Chrome launch options only (--host-rules and a
// certificate pin for a throwaway self-signed key); every other host fails to resolve. The tested
// package is never changed. On failure, screenshots of the wallet and the synthetic bank page and
// a log are written to --out (default .debug/e2e) for CI to upload.
import {spawn,execFileSync} from 'node:child_process';
import {createHash,createPublicKey} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile,stat} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {basename,dirname,join,normalize,isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from './dev-collector/chrome-launcher.mjs';
import {readZipEntry,zipEntryNames} from './read-zip.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
let STEP_MS=Number(process.env.CARDYBARA_E2E_STEP_MS||30000);
const BANK_HOST='secure.chase.com';
const STATE_KEY='cardybara-state-v2';
// A real bank page takes a while to arrive. With an instant local page the first load can finish
// before the extension's own reload, which hits a known collector race (stl00/Cardybara#123); set
// this to 0 to reproduce it.
const BANK_DELAY_MS=Number(process.env.CARDYBARA_E2E_BANK_DELAY_MS??400);
let log=[],lastState=null;
const note=(...a)=>{const line=`[${new Date().toISOString()}] `+a.join(' ');log.push(line);console.log(line);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class StepError extends Error{}
async function until(what,fn,ms=STEP_MS){
 const end=Date.now()+ms;let last;
 for(;;){try{const v=await fn();if(v)return v;}catch(e){if(e instanceof StepError)throw e;last=e;}if(Date.now()>end)throw new StepError(`timed out waiting for ${what}`+(last?` (last error: ${last.message})`:''));await sleep(150);}
}

// --- package -------------------------------------------------------------------------------
export async function locateZip(input){
 const s=await stat(input);
 if(!s.isDirectory())return {zip:input,sums:join(dirname(input),'SHA256SUMS')};
 const zips=(await readdir(input)).filter(n=>n.endsWith('.zip'));
 if(zips.length!==1)throw Error(`expected exactly one ZIP in ${input}, found ${zips.length}`);
 return {zip:join(input,zips[0]),sums:join(input,'SHA256SUMS')};
}
export async function extractPackage(zipPath,sumsPath,dest){
 const bytes=await readFile(zipPath);
 const sums=await readFile(sumsPath,'utf8').catch(()=>{throw Error('no SHA256SUMS next to '+basename(zipPath));});
 const want=sums.split('\n').map(l=>l.trim().split(/\s+/)).find(([,name])=>name===basename(zipPath))?.[0];
 if(want!==createHash('sha256').update(bytes).digest('hex'))throw Error(`SHA256SUMS does not match ${basename(zipPath)}`);
 note('package checksum matches SHA256SUMS');
 for(const name of zipEntryNames(bytes)){
  if(name.endsWith('/'))continue;
  const rel=normalize(name);
  if(isAbsolute(rel)||rel.split(sep).includes('..'))throw Error('unsafe path in package: '+name);
  const out=join(dest,rel);await mkdir(dirname(out),{recursive:true});await writeFile(out,readZipEntry(bytes,name));
 }
 return dest;
}
// The entries the main path depends on. A package missing one fails here, before Chrome starts.
export async function checkManifest(dir){
 const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),missing=[];
 const has=async p=>stat(join(dir,p)).then(()=>true,()=>false);
 if(m.manifest_version!==3)missing.push('manifest_version 3');
 if(!m.background?.service_worker||!await has(m.background.service_worker))missing.push('background.service_worker');
 for(const p of ['scripting','storage'])if(!m.permissions?.includes(p))missing.push('permission '+p);
 if(!m.host_permissions?.includes(`https://${BANK_HOST}/*`))missing.push(`host permission https://${BANK_HOST}/*`);
 for(const f of ['index.html','guide.js','reader.js'])if(!await has(f))missing.push(f);
 if(missing.length)throw Error('package manifest/files missing: '+missing.join(', '));
 note('manifest',m.version_name||m.version,'has the required entries');
 return m;
}

// --- synthetic bank ------------------------------------------------------------------------
async function syntheticBank(work){
 const key=join(work,'bank-key.pem'),cert=join(work,'bank-cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN='+BANK_HOST,'-addext','subjectAltName=DNS:'+BANK_HOST],{stdio:'ignore'});
 const page=await readFile(join(root,'tests/fixtures/synthetic-bank.html'));
 const requests=[];
 const server=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
  requests.push(req.headers.host+req.url);note('synthetic bank served',req.method,req.url);
  if(req.url==='/favicon.ico'){res.writeHead(404).end();return;}
  setTimeout(()=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page),BANK_DELAY_MS);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const spki=createHash('sha256').update(createPublicKey(await readFile(cert)).export({type:'spki',format:'der'})).digest('base64');
 return {port:server.address().port,spki,requests,close:()=>new Promise(r=>{server.close(r);server.closeAllConnections();})};
}

// --- Chrome over a debugging pipe ----------------------------------------------------------
function pipeCdp(child){
 // Split on NUL bytes before decoding, so a character split across chunks is never mangled.
 let next=0,buffer=Buffer.alloc(0),gone=null;const pending=new Map(),handlers=new Set();
 const fail=reason=>{gone=gone||reason;for(const [id,p] of pending){pending.delete(id);p.reject(Error(`${p.method}: ${gone}`));}};
 child.stdio[3].on('error',e=>fail('pipe closed ('+e.message+')'));
 child.stdio[4].on('error',e=>fail('pipe closed ('+e.message+')'));
 child.on('exit',(code,signal)=>fail(`Chrome exited (${signal||code})`));
 child.stdio[4].on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);let i;
  while((i=buffer.indexOf(0))>=0){
   let msg;try{msg=JSON.parse(buffer.subarray(0,i).toString('utf8'));}catch{msg={};}buffer=buffer.subarray(i+1);
   if(msg.id!=null&&pending.has(msg.id)){const {resolve,reject,method}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(`${method}: ${msg.error.message}`)):resolve(msg.result);}
   else for(const h of handlers)h(msg);
  }
 });
 return {
  send(method,params={},sessionId){if(gone)return Promise.reject(Error(`${method}: ${gone}`));const id=++next;child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,method});setTimeout(()=>{if(pending.delete(id))reject(Error(method+': no answer'));},STEP_MS);});},
  on(h){handlers.add(h);},
 };
}
async function launch(profile,bank){
 const args=[
  '--user-data-dir='+profile,'--remote-debugging-pipe','--enable-unsafe-extension-debugging',
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-sync','--disable-component-update','--window-size=1280,900',
  // The bank host goes to the synthetic bank; nothing else resolves.
  `--host-rules=MAP ${BANK_HOST} 127.0.0.1:${bank.port}, MAP * ~NOTFOUND`,
  '--ignore-certificate-errors-spki-list='+bank.spki,
  ...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'];
 const child=spawn(await findChrome(),args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
 child.stdio[2].on('data',d=>{for(const l of d.toString().split('\n'))if(l.trim())log.push('[chrome] '+l);});
 child.on('error',e=>note('chrome spawn error',e.message));
 return {child,cdp:pipeCdp(child)};
}

// --- the main path -------------------------------------------------------------------------
export async function run(input,{out=join(root,'.debug/e2e'),mutate,stepMs}={}){
 if(stepMs)STEP_MS=stepMs;log=[];lastState=null;
 const work=await mkdtemp(join(tmpdir(),'cardybara-e2e-'));
 const sessions={};let browser,bank;
 try{
  const {zip,sums}=await locateZip(resolve(input));
  note('testing',basename(zip));
  const ext=await extractPackage(zip,sums,join(work,'extension'));
  if(mutate){await mutate(ext);note('negative control: package deliberately broken after extraction');}
  await checkManifest(ext);
  bank=await syntheticBank(work);
  browser=await launch(join(work,'profile'),bank);
  const {cdp}=browser;
  cdp.on(msg=>{
   const who=Object.entries(sessions).find(([,id])=>id===msg.sessionId)?.[0]||msg.sessionId||'browser';
   if(msg.method==='Runtime.consoleAPICalled')log.push(`[${who} console.${msg.params.type}] `+msg.params.args.map(a=>a.value??a.description??a.type).join(' '));
   if(msg.method==='Runtime.exceptionThrown')log.push(`[${who} exception] `+(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text));
  });
  note('chrome',(await cdp.send('Browser.getVersion')).product);

  // Install the unpacked package into the clean profile.
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext}).catch(e=>{throw new StepError('extension did not load: '+e.message);});
  note('extension loaded',id);
  const worker=await until('the extension service worker',async()=>(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(`chrome-extension://${id}/`)));
  sessions.worker=(await cdp.send('Target.attachToTarget',{targetId:worker.targetId,flatten:true})).sessionId;
  await cdp.send('Runtime.enable',{},sessions.worker);

  const attach=async(name,targetId)=>{sessions[name]=(await cdp.send('Target.attachToTarget',{targetId,flatten:true})).sessionId;await cdp.send('Runtime.enable',{},sessions[name]);await cdp.send('Page.enable',{},sessions[name]);};
  const evaluate=async(name,expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessions[name]);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};

  // Open the wallet page the toolbar button opens.
  const walletUrl=`chrome-extension://${id}/index.html`;
  const {targetId:walletTarget}=await cdp.send('Target.createTarget',{url:walletUrl});
  await attach('wallet',walletTarget);
  // A worker that throws can still show up briefly as a target; it must answer the wallet.
  await until('the service worker to answer the wallet',()=>evaluate('wallet',`chrome.tabs.getCurrent().then(t=>chrome.runtime.sendMessage({type:'hello',requestId:'e2e-hello',ownerTabId:t.id})).then(r=>!!r?.ok,()=>false)`));
  const translations=JSON.parse(await readFile(join(root,'src/translations.json'),'utf8'));
  const words=zh=>JSON.stringify([zh,translations['en-US']?.[zh],translations['zh-TW']?.[zh]].filter(Boolean));
  const clickText=(name,selector,zh)=>evaluate(name,`(()=>{const want=${words(zh)};const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>want.includes(e.textContent.trim()));if(!el)return false;el.click();return true;})()`);
  const pageText=name=>evaluate(name,'document.body?.innerText||""');
  // Read through the service worker: a background wallet tab may be throttled.
  const state=async()=>(lastState=(await evaluate('worker',`chrome.storage.local.get(${JSON.stringify(STATE_KEY)})`))?.[STATE_KEY]);

  // 1. Empty wallet.
  const shows=async(name,zh)=>{const t=await pageText(name);return JSON.parse(words(zh)).some(w=>t.includes(w));};
  await until('the empty-wallet welcome',()=>shows('wallet','欢迎，这是你的新钱包'));
  const initial=await state();
  if(initial?.discoveredCards?.length||Object.keys(initial?.records||{}).length)throw new StepError('a clean install must start with an empty wallet');
  note('empty wallet shown');

  // 2. Connect the synthetic bank.
  await until('the first-bank button',()=>clickText('wallet','button','连接第一家银行'));
  await until('the connections page',async()=>(await evaluate('wallet','location.hash'))==='#connections');
  await until('the Chase connect button',()=>evaluate('wallet',`(()=>{const want=${words('连接银行')};const card=[...document.querySelectorAll('.account-connection')].find(c=>c.querySelector('.ant-card-head')?.textContent.includes('Chase'));const b=card&&[...card.querySelectorAll('button')].find(b=>want.includes(b.textContent.trim()));if(!b)return false;b.click();return true;})()`));
  note('asked the extension to connect Chase');

  // 3. The extension opens the bank, which asks for a sign-in; the wallet shows needs-login.
  const bankTarget=await until('the bank tab',async()=>(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&new URL(t.url||'about:blank').hostname===BANK_HOST));
  await attach('bank',bankTarget.targetId);
  await until('the synthetic sign-in page',()=>evaluate('bank','!!document.getElementById("sign-in")'));
  await until('needs-login in the extension state',async()=>{const j=(await state())?.run?.jobs?.find(j=>j.bank==='Chase');if(j&&!['queued','opening','navigating','capturing','needs_login'].includes(j.status))throw new StepError(`the run ended as ${j.status} before sign-in: ${JSON.stringify(j.diagnostic||null)}`);return j?.status==='needs_login';});
  await until('needs-login on the wallet page',()=>shows('wallet','需要登录银行'));
  await until('the reading guide on the bank page',()=>evaluate('bank','!!document.getElementById("cardybara-bank-guide")'));
  note('needs-login shown on the wallet and the guide on the bank page');

  // 4. Sign in on the fake page; the guide reads without another click.
  await evaluate('bank','document.getElementById("sign-in").click()');
  note('signed in on the synthetic page');
  const done=await until('the reading to finish',async()=>{const s=await state();return s?.run?.status&&s.run.status!=='running'&&s.run.jobs?.find(j=>j.bank==='Chase')?.status!=='needs_login'?s:null;},STEP_MS*2);
  const job=done.run.jobs.find(j=>j.bank==='Chase');
  note('run',done.run.status,'job',job.status);

  // 5. Fields come back; missing values stay unknown.
  const byTail=Object.fromEntries((done.discoveredCards||[]).map(c=>[c.tail,c]));
  const record=tail=>done.records?.Chase?.[byTail[tail]?.id]||{};
  const value=(tail,key)=>record(tail)[key]?.value;
  const problems=[];
  const expect=(label,got,want)=>{if(JSON.stringify(got)!==JSON.stringify(want))problems.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);};
  expect('job status',job.status,'updated');
  expect('discovered cards',Object.keys(byTail).sort(),['1234','5678']);
  expect('1234 balance',value('1234','balance'),1234.56);
  expect('1234 statement',value('1234','statement'),321);
  expect('1234 minimum',value('1234','minimum'),35);
  expect('5678 balance',value('5678','balance'),67.89);
  expect('5678 statement',value('5678','statement'),0);
  // The synthetic page shows no minimum for this card: it stays unknown, never zero. (Due dates are
  // billing items, not record fields, and the overview read does not cover them.)
  if(record('5678').minimum!==undefined)problems.push(`5678 minimum must stay unknown, got ${JSON.stringify(record('5678').minimum)}`);
  if(problems.length)throw new StepError('read-back mismatch:\n  '+problems.join('\n  ')+'\nrecords: '+JSON.stringify(done.records?.Chase));

  // The wallet page shows what was read.
  await evaluate('wallet','location.hash="wallet"');
  await until('the read balance on the wallet page',async()=>(await pageText('wallet')).includes('1,234.56'));
  note('fields written back; missing values left unknown');
  if(!bank.requests.length)throw new StepError('the synthetic bank was never contacted');
  note('PASS: packaged extension installs, connects a synthetic bank, signs in and reads back');
  return {ok:true};
 }catch(error){
  note('FAIL:',error.message);
  if(lastState)log.push('[state] '+JSON.stringify(lastState));
  if(browser&&sessions.worker)try{const r=await browser.cdp.send('Runtime.evaluate',{expression:`chrome.storage.local.get('cardybara:last-capture-error')`,awaitPromise:true,returnByValue:true},sessions.worker);log.push('[capture-error] '+JSON.stringify(r.result.value));}catch{}
  await mkdir(out,{recursive:true});
  if(browser)for(const [name,session] of Object.entries(sessions)){
   if(name==='worker')continue;
   try{const {data}=await browser.cdp.send('Page.captureScreenshot',{format:'png'},session);await writeFile(join(out,name+'.png'),Buffer.from(data,'base64'));note('screenshot',name+'.png');}catch(e){note('no screenshot for',name,e.message);}
  }
  throw error;
 }finally{
  await mkdir(out,{recursive:true}).catch(()=>{});
  await writeFile(join(out,'e2e.log'),log.join('\n')+'\n').catch(()=>{});
  if(browser){await browser.cdp.send('Browser.close').catch(()=>{});await sleep(300);browser.child.kill('SIGKILL');}
  await bank?.close();
  await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
 }
}

// Negative controls: each deliberately broken copy of the same package must fail the run, and for
// the expected reason, so a broken environment cannot pass them.
export const BROKEN={
 'no service worker in the manifest':[/missing: background\.service_worker/,async dir=>{const p=join(dir,'manifest.json'),m=JSON.parse(await readFile(p,'utf8'));delete m.background;await writeFile(p,JSON.stringify(m));}],
 'no bank host permission':[/missing: host permission/,async dir=>{const p=join(dir,'manifest.json'),m=JSON.parse(await readFile(p,'utf8'));m.host_permissions=m.host_permissions.filter(h=>!h.includes(BANK_HOST));await writeFile(p,JSON.stringify(m));}],
 'a service worker that does not start':[/service worker|Runtime\.enable: (no answer|Chrome exited)/,async dir=>{const p=join(dir,'manifest.json'),m=JSON.parse(await readFile(p,'utf8'));await writeFile(join(dir,m.background.service_worker),'throw Error("deliberately broken");\n');}],
 'no reading guide on the bank page':[/reading guide/,async dir=>{await writeFile(join(dir,'guide.js'),'');}],
 'a page reader that does nothing':[/run ended as|needs-login|reading to finish|read-back mismatch/,async dir=>{await writeFile(join(dir,'reader.js'),'');}],
};
export async function negativeControls(input,{out}){
 const escaped=[];
 for(const name of Object.keys(BROKEN)){
  console.log(`--- negative control: ${name}`);
  const [reason,mutate]=BROKEN[name];
  const error=await run(input,{out:join(out,name.replace(/\W+/g,'-')),mutate,stepMs:12000}).then(()=>null,e=>e);
  const ok=error&&reason.test(error.message);
  if(!ok)escaped.push(name+(error?` (failed for another reason: ${error.message})`:' (passed)'));
  console.log(ok?`ok: the broken package (${name}) failed as expected`:`ESCAPED: ${name}`);
 }
 if(escaped.length)throw Error('E2E did not catch: '+escaped.join(', '));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),take=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;if(flag==='--out'&&!args[i+1]){console.error('--out needs a directory');process.exit(2);}return args.splice(i,flag==='--out'?2:1).at(-1);};
 const outArg=take('--out'),controls=take('--negative-controls');
 if(!args[0]){console.error('usage: node scripts/e2e-extension.mjs <release-dir-or-zip> [--out <dir>] [--negative-controls]');process.exit(2);}
 const out=resolve(outArg||join(root,'.debug/e2e'));
 (controls?negativeControls(args[0],{out}):run(args[0],{out})).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1);});
}
