// End-to-end test of the packaged extension: the exact release ZIP, installed in a clean Chrome
// profile, against a local synthetic bank. No bank is contacted and no secret is used.
//
//   node scripts/e2e-extension.mjs <release-dir-or-zip> [--out <dir>] [--restart] [--expired-login] [--cancel] [--chat] [--cards] [--upgrade-from <previous-release-dir-or-zip>]
//
// --restart (nightly set): after the main path, close Chrome and start it again on the same
// profile; the extension must still be installed and the records it read must still be there.
// --expired-login (nightly set): after the main path, the bank session expires and the user
// refreshes the bank; the run must ask for a sign-in again while keeping the records it read, and
// read again after the sign-in.
// --chat (nightly set): after the main path, the user saves a test-only model key in settings, which
// asks for the provider's host permission, then asks the assistant a question. A scripted model
// answers through a synthetic provider; the answer must show in the chat, and no balance read from
// the bank may ever reach the model. The user then hides a card: the overview and a new chat leave it
// out while the bank records stay, and unhiding brings it back (stl00/Cardybara#198).
// --upgrade-from (nightly set): the main path runs on the previous package instead; then Chrome is
// closed, the tested package replaces the previous one in the same directory, and Chrome starts again
// on the same profile. The same extension must now run the tested package with the records kept.
// --cards: after the main path, the user adds a card by hand by picking its product from the catalogue
// and setting its annual fee date, sees its anniversary credit get a real cycle, edits it, corrects the
// name of a card the bank page showed and resets that correction, then removes the manual card
// (stl00/Cardybara#176). The product is chosen from the catalogue data, and every tail and date is synthetic.
// --cancel (nightly set): after the main path, the user stops a refresh from the wallet while the
// bank page is still loading, then stops a reading that waits at needs-login from the bank page's
// guide, then stops another such reading from the wallet header; each must end cancelled with the
// records it read kept, and nothing is read afterwards.
//
// Bank hosts reach the synthetic bank through Chrome launch options only (--host-rules and a
// certificate pin for a throwaway self-signed key); every other host fails to resolve. The tested
// package is never changed. On failure, screenshots of the wallet and the synthetic bank page and
// a log are written to --out (default .debug/e2e) for CI to upload.
import {spawn,execFileSync} from 'node:child_process';
import {createHash,createPublicKey} from 'node:crypto';
import {cp,mkdtemp,mkdir,readFile,readdir,rm,writeFile,stat} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {basename,dirname,join,normalize,isAbsolute,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome} from './dev-collector/chrome-launcher.mjs';
import {readZipEntry,zipEntryNames} from './read-zip.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
let STEP_MS=Number(process.env.CARDYBARA_E2E_STEP_MS||30000);
const BANK_HOST='secure.chase.com';
// The model provider the packaged client calls. Under --chat it resolves to a scripted synthetic provider.
const MODEL_HOST='api.deepseek.com';
// A made-up key in the provider's key shape. It is never a real key and only ever reaches the synthetic provider.
const TEST_KEY='e2e-test-only-'+'0'.repeat(24);
// Values the synthetic bank shows. They are read into the wallet and must never travel to the model.
const READ_VALUES=['1234.56','1,234.56','67.89'];
const READ_TAILS=['1234','5678'];
const STATE_KEY='cardybara-state-v2';
// The synthetic bank answers at once by default: an instant first load once raced the extension's
// own reload (stl00/Cardybara#123). Set a latency in ms to imitate a slower bank.
const BANK_DELAY_MS=Number(process.env.CARDYBARA_E2E_BANK_DELAY_MS??0);
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
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN='+BANK_HOST,'-addext',`subjectAltName=DNS:${BANK_HOST},DNS:${MODEL_HOST}`],{stdio:'ignore'});
 const page=await readFile(join(root,'tests/fixtures/synthetic-bank.html'));
 const requests=[];let held=null;
 const model={script:null,requests:[]};
 const server=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
  if((req.headers.host||'').split(':')[0]===MODEL_HOST){syntheticProvider(model,req,res);return;}
  requests.push(req.headers.host+req.url);note('synthetic bank served',req.method,req.url);
  if(req.url==='/favicon.ico'){res.writeHead(404).end();return;}
  const answer=()=>setTimeout(()=>res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(page),BANK_DELAY_MS);
  // While held, pages wait for release(): a bank page that is still loading.
  if(held){held.push(answer);note('synthetic bank holding',req.url);}else answer();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const spki=createHash('sha256').update(createPublicKey(await readFile(cert)).export({type:'spki',format:'der'})).digest('base64');
 return {port:server.address().port,spki,requests,model,hold(){held=held||[];},heldCount:()=>held?.length||0,release(){const waiting=held||[];held=null;waiting.forEach(f=>f());return waiting.length;},close:()=>new Promise(r=>{server.close(r);server.closeAllConnections();})};
}

// A scripted stand-in for the provider's API: GET /models answers a key check, and each chat request takes
// the next scripted step. Every request is kept, with its Authorization header and body, for the checks.
function syntheticProvider(model,req,res){
 const chunks=[];
 req.on('data',c=>chunks.push(c));
 req.on('end',async()=>{
  const raw=Buffer.concat(chunks).toString('utf8');let body=null;try{body=raw?JSON.parse(raw):null;}catch{}
  model.requests.push({method:req.method,path:req.url,authorization:req.headers.authorization||null,raw,body});
  note('synthetic provider served',req.method,req.url);
  const json=(status,value)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(value));
  if(req.headers.authorization!=='Bearer '+TEST_KEY)return json(401,{error:{message:'synthetic: unknown key'}});
  if(req.method==='GET'&&req.url==='/models')return json(200,{object:'list',data:[{id:'deepseek-flash',object:'model'}]});
  if(req.method!=='POST'||req.url!=='/chat/completions'||!body)return json(404,{error:{message:'synthetic: not found'}});
  const chats=model.requests.filter(r=>r.method==='POST');
  const step=model.script?.[chats.length-1];
  if(!step)return json(500,{error:{message:'synthetic: the script has no step '+chats.length}});
  const message=await step(body);
  json(200,{id:'synthetic-'+chats.length,object:'chat.completion',choices:[{index:0,message:{role:'assistant',...message},finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
 });
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
  // The bank host goes to the synthetic bank and the model host to the synthetic provider (one local
  // server, routed by Host); nothing else resolves.
  `--host-rules=MAP ${BANK_HOST} 127.0.0.1:${bank.port}, MAP ${MODEL_HOST} 127.0.0.1:${bank.port}, MAP * ~NOTFOUND`,
  '--ignore-certificate-errors-spki-list='+bank.spki,
  ...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'];
 const child=spawn(await findChrome(),args,{stdio:['ignore','ignore','pipe','pipe','pipe']});
 child.stdio[2].on('data',d=>{for(const l of d.toString().split('\n'))if(l.trim())log.push('[chrome] '+l);});
 child.on('error',e=>note('chrome spawn error',e.message));
 return {child,cdp:pipeCdp(child)};
}

// --- the main path -------------------------------------------------------------------------
export async function run(input,{out=join(root,'.debug/e2e'),mutate,stepMs,restart=false,beforeRestart,expiredLogin=false,expire=expireBankSession,requireExpired=true,cancel=false,stop=stopFromWallet,stopGuide=stopFromGuide,stopWaiting=stopFromWallet,chat=false,chatKey=TEST_KEY,chatScript=scriptedChat,cards=false,cardFeeDate={month:2,day:29},upgradeFrom=null,mutatePrevious,swap=true}={}){
 if([restart,expiredLogin,cancel,chat,cards,!!upgradeFrom].filter(Boolean).length>1)throw Error('run --restart, --expired-login, --cancel, --chat, --cards and --upgrade-from separately: each starts from the end of the main path');
 if(stepMs)STEP_MS=stepMs;log=[];lastState=null;
 const work=await mkdtemp(join(tmpdir(),'cardybara-e2e-'));
 const sessions={};let browser,bank;
 try{
  const {zip,sums}=await locateZip(resolve(input));
  note('testing',basename(zip));
  // With --upgrade-from the previous package is installed first, in the directory the tested package
  // later replaces; the tested package waits next to it.
  let ext,next=null;
  if(upgradeFrom){
   const previous=await locateZip(resolve(upgradeFrom));
   note('upgrading from',basename(previous.zip));
   ext=await extractPackage(previous.zip,previous.sums,join(work,'extension'));
   if(mutatePrevious){await mutatePrevious(ext);note('negative control: previous package changed after extraction');}
   await checkManifest(ext);
   next=await extractPackage(zip,sums,join(work,'next'));
   if(mutate){await mutate(next);note('negative control: package deliberately broken after extraction');}
   await checkManifest(next);
   if(await sameFiles(ext,next))note('the previous package is identical to the tested one: the upgrade check only proves the records survive reinstalling it');
  }else{
   ext=await extractPackage(zip,sums,join(work,'extension'));
   if(mutate){await mutate(ext);note('negative control: package deliberately broken after extraction');}
   await checkManifest(ext);
  }
  bank=await syntheticBank(work);
  const profile=join(work,'profile');
  let cdp;
  const start=async()=>{
   browser=await launch(profile,bank);cdp=browser.cdp;
   cdp.on(msg=>{
    const who=Object.entries(sessions).find(([,id])=>id===msg.sessionId)?.[0]||msg.sessionId||'browser';
    if(msg.method==='Runtime.consoleAPICalled')log.push(`[${who} console.${msg.params.type}] `+msg.params.args.map(a=>a.value??a.description??a.type).join(' '));
    if(msg.method==='Runtime.exceptionThrown')log.push(`[${who} exception] `+(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text));
   });
   note('chrome',(await cdp.send('Browser.getVersion')).product);
  };
  await start();

  // Install the unpacked package into the clean profile.
  const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext}).catch(e=>{throw new StepError('extension did not load: '+e.message);});
  note('extension loaded',id);
  const attachWorker=async()=>{
   const worker=await until('the extension service worker',async()=>(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(`chrome-extension://${id}/`)));
   sessions.worker=(await cdp.send('Target.attachToTarget',{targetId:worker.targetId,flatten:true})).sessionId;
   await cdp.send('Runtime.enable',{},sessions.worker);
  };
  await attachWorker();

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
  // Click with real mouse events at the element's centre, for steps that need a user gesture.
  const realClick=async(name,selector,wantJson)=>{
   const at=await evaluate(name,`(()=>{const want=${wantJson};const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>want.includes(e.textContent.trim())&&!e.disabled);if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
   if(!at)return false;
   await cdp.send('Page.bringToFront',{},sessions[name]);await sleep(300);
   const again=await evaluate(name,`(()=>{const want=${wantJson};const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>want.includes(e.textContent.trim())&&!e.disabled);if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`);
   if(!again)return false; // not in view yet; the caller tries again
   Object.assign(at,again);
   await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:at.x,y:at.y},sessions[name]);
   for(const type of ['mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:at.x,y:at.y,button:'left',clickCount:1},sessions[name]);
   return true;
  };
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
  note('PASS: packaged extension installs, connects a synthetic bank, signs in and reads back'+(upgradeFrom?' (previous package)':''));

  if(restart||upgradeFrom){
   const across=upgradeFrom?'an upgrade':'a browser restart';
   // 6. Close Chrome and start it again on the same profile. The extension stays installed and
   // what it read is still there; nothing is re-read to get it back.
   const readBefore=JSON.stringify(done.records?.Chase);
   const served=bank.requests.length;
   const exited=new Promise(r=>browser.child.once('exit',r));
   await cdp.send('Browser.close').catch(()=>{});
   let timer;await Promise.race([exited,new Promise(r=>{timer=setTimeout(r,STEP_MS);})]);clearTimeout(timer);
   if(browser.child.exitCode===null&&browser.child.signalCode===null)throw new StepError('Chrome did not exit on Browser.close');
   note('chrome closed; starting it again on the same profile');
   if(beforeRestart){await beforeRestart(profile);note('negative control: profile deliberately changed while Chrome was closed');}
   // Upgrade: the tested package replaces the previous one in place, as an update of the same extension.
   if(upgradeFrom&&swap){await rm(ext,{recursive:true,force:true});await cp(next,ext,{recursive:true});note('tested package copied over the previous one');}
   for(const k of Object.keys(sessions))delete sessions[k];lastState=null;
   await start();
   // An extension installed over the debugging pipe lasts for that browser session only, so the
   // harness installs the same unpacked directory again. Chrome derives an unpacked extension's id
   // from its path, so this must be the same extension with the profile's storage, not a new one.
   const {id:againId}=await cdp.send('Extensions.loadUnpacked',{path:ext}).catch(e=>{throw new StepError('extension did not load after a restart: '+e.message);});
   if(againId!==id)throw new StepError(`the extension came back as ${againId}, not ${id}`);
   // The service worker may sleep until something wakes it; the wallet page does.
   const {targetId:again}=await cdp.send('Target.createTarget',{url:walletUrl});
   await attach('wallet',again).catch(e=>{throw new StepError('the extension is gone after a restart: '+e.message);});
   await until('the wallet page after a restart',async()=>(await evaluate('wallet','location.protocol'))==='chrome-extension:'&&!!(await pageText('wallet')).trim()).catch(async e=>{
    note('targets after restart:',JSON.stringify((await cdp.send('Target.getTargets')).targetInfos.map(t=>[t.type,t.url])));
    note('wallet page:',await evaluate('wallet','location.href+" | "+document.body?.innerText.slice(0,200)').catch(x=>x.message));
    throw e;});
   await attachWorker();
   if(upgradeFrom){
    // The extension must now serve the tested package's files, not the previous ones.
    const m=JSON.parse(await readFile(join(next,'manifest.json'),'utf8'));
    for(const file of ['manifest.json','index.html',m.background.service_worker]){
     const want=createHash('sha256').update(await readFile(join(next,file))).digest('hex');
     const got=await evaluate('wallet',`fetch(${JSON.stringify(file)}).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(d=>[...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);
     if(got!==want)throw new StepError(`after the upgrade the extension still runs the previous package (${file} differs from the tested one)`);
    }
    note('the extension now serves the tested package',m.version_name||m.version);
   }
   const kept=await state();
   if(JSON.stringify(kept?.records?.Chase)!==readBefore)throw new StepError(`records changed across ${across}: `+JSON.stringify(kept?.records?.Chase));
   const keptTails=(kept?.discoveredCards||[]).map(c=>c.tail).sort();
   if(JSON.stringify(keptTails)!==JSON.stringify(['1234','5678']))throw new StepError(`discovered cards changed across ${across}: `+JSON.stringify(keptTails));
   await evaluate('wallet','location.hash="wallet"');
   await until(`the read balance on the wallet page after ${across}`,async()=>(await pageText('wallet')).includes('1,234.56'));
   if(await shows('wallet','欢迎，这是你的新钱包'))throw new StepError(`the wallet shows the empty-wallet welcome after ${across}`);
   await sleep(1500); // give a delayed start-up refresh time to show itself
   if(bank.requests.length!==served)throw new StepError(`the bank was contacted again just to show records after ${across}`);
   note(upgradeFrom?'PASS: after an upgrade the same extension runs the tested package with its records kept':'PASS: after a browser restart the same extension comes back with its records kept');
  }
  // The bank session expires (open bank pages show the sign-in page again) and the user refreshes
  // Chase from the wallet. Returns the state once the new run waits at needs-login with the earlier
  // records unchanged, the wallet shows needs-login and a bank tab shows the sign-in and the guide.
  const refreshExpired=async(readBefore,{requireExpired:mustExpire=requireExpired}={})=>{
   const expired=await expire({cdp,targets:async()=>(await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='page'&&new URL(t.url||'about:blank').hostname===BANK_HOST)});
   note('bank session expired on',String(expired),'open bank page(s)');
   // A new bank tab starts signed out anyway, so without an open page to expire this would not test
   // an expired session at all.
   if(mustExpire&&!expired)throw new StepError('no open bank page to expire; the expired-login check would not test an expired session');
   const runBefore=(await state())?.run?.id??null;
   await evaluate('wallet','location.hash="connections"');
   await until('the Chase refresh button',()=>evaluate('wallet',`(()=>{const want=${words('刷新银行')};const card=[...document.querySelectorAll('.account-connection')].find(c=>c.querySelector('.ant-card-head')?.textContent.includes('Chase'));const b=card&&[...card.querySelectorAll('button')].find(b=>want.includes(b.textContent.trim()));if(!b)return false;b.click();return true;})()`));
   note('asked the extension to refresh Chase');
   const waiting=await until('needs-login again after the session expired',async()=>{const s=await state();if(!s?.run||(runBefore!==null&&s.run.id===runBefore))return null;const j=s.run.jobs?.find(j=>j.bank==='Chase');if(j&&!['queued','opening','navigating','capturing','needs_login'].includes(j.status))throw new StepError(`the run ended as ${j.status} instead of asking for a sign-in again: ${JSON.stringify(j.diagnostic||null)}`);return j?.status==='needs_login'?s:null;});
   if(JSON.stringify(waiting.records?.Chase)!==readBefore)throw new StepError('records changed while waiting for a sign-in after the session expired: '+JSON.stringify(waiting.records?.Chase));
   await until('needs-login on the wallet page again',()=>shows('wallet','需要登录银行'));
   const signIn=await until('the sign-in page on a bank tab',async()=>{for(const t of (await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='page'&&new URL(t.url||'about:blank').hostname===BANK_HOST)){await attach('bank',t.targetId);if(await evaluate('bank','!!document.getElementById("sign-in")'))return t;}return null;});
   await until('the reading guide on the bank page again',()=>evaluate('bank','!!document.getElementById("cardybara-bank-guide")'));
   return {waiting,signIn};
  };
  if(expiredLogin){
   // 7. The bank session expires and the user refreshes the bank from the wallet. The run must stop
   // at needs-login, keep what it read before (never cleared or zeroed while waiting), and read
   // again once the user signs in.
   const readBefore=JSON.stringify((await state())?.records?.Chase);
   const {waiting,signIn}=await refreshExpired(readBefore);
   // Still kept just before the sign-in, and still shown on the wallet.
   if(JSON.stringify((await state())?.records?.Chase)!==readBefore)throw new StepError('records changed while waiting for a sign-in after the session expired: '+JSON.stringify(lastState?.records?.Chase));
   await evaluate('wallet','location.hash="wallet"');
   await until('the earlier balance on the wallet page while waiting for a sign-in',async()=>(await pageText('wallet')).includes('1,234.56'));
   note('needs-login shown again with the earlier records kept; signing in on',signIn.targetId);
   await evaluate('bank','document.getElementById("sign-in").click()');
   const again=await until('the second reading to finish',async()=>{const s=await state();return s?.run?.status&&s.run.status!=='running'&&s.run.jobs?.find(j=>j.bank==='Chase')?.status!=='needs_login'?s:null;},STEP_MS*2);
   if(again.run.id!==waiting.run.id)throw new StepError('a different run finished after signing in again');
   // The synthetic page gives the same values again, so a fresh capture time is what shows the
   // fields were read again rather than left over.
   const capturedAt=r=>Math.max(...Object.values(r||{}).flatMap(f=>Object.values(f||{}).map(v=>Date.parse(v?.capturedAt)||0)));
   if(!(capturedAt(again.records?.Chase)>capturedAt(JSON.parse(readBefore))))throw new StepError('the fields were not read again after signing in');
   const job2=again.run.jobs.find(j=>j.bank==='Chase');
   if(job2.status!=='updated')throw new StepError(`the read after signing in again ended as ${job2.status}: ${JSON.stringify(job2.diagnostic||null)}`);
   const values=r=>JSON.stringify(Object.fromEntries(Object.entries(r||{}).map(([id,f])=>[id,Object.fromEntries(Object.entries(f||{}).map(([k,v])=>[k,v?.value]))])));
   if(values(again.records?.Chase)!==values(JSON.parse(readBefore)))throw new StepError('values differ after signing in again: '+JSON.stringify(again.records?.Chase));
   await evaluate('wallet','location.hash="wallet"');
   await until('the read balance on the wallet page after signing in again',async()=>(await pageText('wallet')).includes('1,234.56'));
   note('PASS: an expired bank session asks for a sign-in again, keeps the records and reads again');
  }
  if(cancel){
   // 8a. Stop from the wallet while the bank page is still loading. The run and its job must end
   // cancelled with the earlier records kept and shown, and the page finishing its load afterwards
   // must not be read.
   const readBefore=JSON.stringify((await state())?.records?.Chase);
   const runBefore=(await state())?.run?.id??null;
   // Close the signed-in bank tab: an open bank page is read in place, with nothing left to load.
   for(const t of (await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='page'&&new URL(t.url||'about:blank').hostname===BANK_HOST))await cdp.send('Target.closeTarget',{targetId:t.targetId});
   delete sessions.bank;
   bank.hold();
   await evaluate('wallet','location.hash="wallet"');
   await until('the refresh-all button',()=>clickText('wallet','button','刷新全部银行'));
   note('asked the extension to refresh all banks; the synthetic bank holds its pages');
   const loading=await until('the refresh to be under way',async()=>{const s=await state();if(!s?.run||s.run.id===runBefore)return null;const j=s.run.jobs?.find(j=>j.bank==='Chase');if(j&&!['queued','opening','navigating'].includes(j.status))throw new StepError(`the job reached ${j.status} while the bank page was still loading`);return s.run.status==='running'&&j?s:null;});
   // Stop only once the bank page is really loading: stopping before the page is requested would test
   // a different moment, and a page requested only after the stop would go unnoticed.
   await until('a bank page held while loading',()=>bank.heldCount()>0);
   await stop({clickText:()=>clickText('wallet','button','停止本轮刷新'),until});
   note('asked the extension to stop this refresh');
   const cancelled=async(runId,what)=>until(what,async()=>{const s=await state();if(s?.run?.id!==runId)throw new StepError('a different run replaced the one being stopped: '+JSON.stringify(s?.run?.id));const j=s.run.jobs?.find(j=>j.bank==='Chase');if(j&&!['queued','opening','navigating','capturing','needs_login','cancelled'].includes(j.status))throw new StepError(`the job ended as ${j.status} instead of cancelled: ${JSON.stringify(j.diagnostic||null)}`);return j?.status==='cancelled'&&s.run.status!=='running'?s:null;});
   const stopped=await cancelled(loading.run.id,'the run to be cancelled');
   if(stopped.run.status!=='cancelled')throw new StepError(`the stopped run ended as ${stopped.run.status}, not cancelled`);
   if(JSON.stringify(stopped.records?.Chase)!==readBefore)throw new StepError('records changed when the refresh was stopped: '+JSON.stringify(stopped.records?.Chase));
   await until('the stop button to turn back into refresh',()=>shows('wallet','刷新全部银行'));
   await until('the earlier balance on the wallet page after stopping',async()=>(await pageText('wallet')).includes('1,234.56'));
   const released=bank.release();
   note('run and job cancelled with the records kept; released',String(released),'held bank page(s)');
   // The released page is a new tab and shows the synthetic sign-in, so nothing could be read from it;
   // what this checks is that the stopped job does not come back to life once its page loads.
   await sleep(Math.min(5000,STEP_MS/2));
   const settled=await state();
   if(settled?.run?.id!==loading.run.id||settled.run.status!=='cancelled'||settled.run.jobs.find(j=>j.bank==='Chase')?.status!=='cancelled')throw new StepError('the stopped refresh did not stay cancelled after the bank page loaded: '+JSON.stringify({id:settled?.run?.id,status:settled?.run?.status,jobs:settled?.run?.jobs?.map(j=>[j.bank,j.status])}));
   if(JSON.stringify(settled.records?.Chase)!==readBefore)throw new StepError('fields were read after the refresh was stopped: '+JSON.stringify(settled.records?.Chase));
   note('PASS: a refresh stopped from the wallet ends cancelled and keeps the records');

   // 8b. A refresh waits at needs-login (the run itself is done; only the bank page's guide can
   // still read). The open bank tab from 8a never signed in, so this needs-login does not depend on
   // an expired session. and the user presses 停止 on the guide. The job must end cancelled with the records
   // kept, and signing in afterwards must not read anything.
   const {waiting,signIn}=await refreshExpired(readBefore,{requireExpired:false});
   await stopGuide({cdp,session:sessions.bank,until});
   note('pressed stop on the reading guide');
   const guideStopped=await cancelled(waiting.run.id,'the job to be cancelled from the guide');
   if(JSON.stringify(guideStopped.records?.Chase)!==readBefore)throw new StepError('records changed when the guide was stopped: '+JSON.stringify(guideStopped.records?.Chase));
   await until('cancelled on the wallet page',()=>shows('wallet','已取消'));
   const served=bank.requests.length;
   note('job cancelled from the guide; signing in on',signIn.targetId,'after the stop');
   await evaluate('bank','document.getElementById("sign-in").click()');
   await sleep(Math.min(5000,STEP_MS/2));
   const after=await state();
   if(after?.run?.id!==waiting.run.id||after.run.jobs.find(j=>j.bank==='Chase')?.status!=='cancelled')throw new StepError('signing in after the stop started or resumed a reading: '+JSON.stringify({id:after?.run?.id,status:after?.run?.status,jobs:after?.run?.jobs?.map(j=>[j.bank,j.status])}));
   if(JSON.stringify(after.records?.Chase)!==readBefore)throw new StepError('fields were read after the guide was stopped: '+JSON.stringify(after.records?.Chase));
   // Signing in re-renders the synthetic page in place, so a stopped reading makes no request at all.
   if(bank.requests.length!==served)throw new StepError(`the bank was contacted ${bank.requests.length-served} times after the stop`);
   note('PASS: a reading stopped on the guide stays cancelled and does not read after a sign-in');

   // 8c. Another refresh waits at needs-login, and this time the user stops it from the wallet header
   // instead of the guide (stl00/Cardybara#166). The header must offer 停止本轮刷新 while the run waits,
   // and the job must end cancelled as the guide's stop leaves it, with nothing read after a sign-in.
   const {waiting:waiting2,signIn:signIn2}=await refreshExpired(readBefore);
   await stopWaiting({clickText:()=>clickText('wallet','button','停止本轮刷新'),until});
   note('asked the extension to stop the refresh waiting at needs-login from the wallet');
   const walletStopped=await cancelled(waiting2.run.id,'the job to be cancelled from the wallet');
   if(walletStopped.run.status!=='cancelled')throw new StepError(`the run stopped from the wallet ended as ${walletStopped.run.status}, not cancelled`);
   if(JSON.stringify(walletStopped.records?.Chase)!==readBefore)throw new StepError('records changed when the waiting refresh was stopped: '+JSON.stringify(walletStopped.records?.Chase));
   await until('the stop button to turn back into refresh after a waiting stop',()=>shows('wallet','刷新全部银行'));
   const served2=bank.requests.length;
   await evaluate('bank','document.getElementById("sign-in").click()');
   note('signed in on',signIn2.targetId,'after the wallet stop');
   await sleep(Math.min(5000,STEP_MS/2));
   const after2=await state();
   if(after2?.run?.id!==waiting2.run.id||after2.run.status!=='cancelled'||after2.run.jobs.find(j=>j.bank==='Chase')?.status!=='cancelled')throw new StepError('signing in after the wallet stop started or resumed a reading: '+JSON.stringify({id:after2?.run?.id,status:after2?.run?.status,jobs:after2?.run?.jobs?.map(j=>[j.bank,j.status])}));
   if(JSON.stringify(after2.records?.Chase)!==readBefore)throw new StepError('fields were read after the wallet stop: '+JSON.stringify(after2.records?.Chase));
   if(bank.requests.length!==served2)throw new StepError(`the bank was contacted ${bank.requests.length-served2} times after the wallet stop`);
   note('PASS: a refresh waiting at needs-login stops from the wallet header and does not read after a sign-in');
  }
  if(chat){
   // 9. The assistant chat UI on the packaged extension with a scripted model. The user pastes a key
   // in settings and saves it with a real click, which asks for the provider's host permission; then
   // asks a question. The answer comes from the scripted provider through the packaged client.
   bank.model.script=chatScript;
   const access={cdp,id,attach,evaluate,sessions};
   await allowModelHost(access);
   await evaluate('wallet','location.hash="settings"');
   const keyBox=await until('the model key field',()=>evaluate('wallet',`(()=>{const el=document.querySelector('input[type=password]');if(!el)return false;el.focus();return true;})()`));
   if(!keyBox)throw new StepError('no model key field on the settings page');
   await cdp.send('Input.insertText',{text:chatKey},sessions.wallet);
   await cdp.send('Target.activateTarget',{targetId:walletTarget}).catch(()=>{});
   // A real mouse click: Chrome only asks for the host permission from a user gesture.
   // A click that lands is seen as the button going busy or as the key check reaching the provider; a
   // click that missed (the page still settling) is sent again.
   await until('the save-key click to take effect',async()=>{
    const checks=bank.model.requests.length;
    if(!await realClick('wallet','button',words('保存密钥')))return false;
    const end=Date.now()+2000;
    while(Date.now()<end){if(bank.model.requests.length>checks||await evaluate('wallet',`!!document.querySelector('.ant-btn-loading')||!document.querySelector('input[type=password]')`))return true;await sleep(100);}
    note('the save click did not take effect; clicking again');return false;
   });
   note('pasted a test-only key and pressed save');
   await until('the key to be saved and ready',async()=>{
    const t=await pageText('wallet');
    for(const zh of ['没有获得访问服务商的权限，密钥未保存。','服务商拒绝了这个密钥，请检查是否复制完整或已过期。'])if(JSON.parse(words(zh)).some(w=>t.includes(w)))throw new StepError('the key was not saved: '+zh);
    return JSON.parse(words('已就绪')).some(w=>t.includes(w));
   });
   const stored=await evaluate('worker',`chrome.storage.local.get('cardybara-model-key').then(r=>r['cardybara-model-key']||null)`);
   if(stored?.key!==chatKey||stored?.provider!=='deepseek')throw new StepError('the saved key is not the one pasted');
   if(!await evaluate('worker',`chrome.permissions.contains({origins:['https://${MODEL_HOST}/*']})`))throw new StepError('the provider host permission was not granted');
   await restoreSiteAccess(access);
   // The permission the save button obtained is the extension's own and stays; the bank hosts are back.
   for(const host of [MODEL_HOST,BANK_HOST])if(!await evaluate('worker',`chrome.permissions.contains({origins:['https://${host}/*']})`))throw new StepError(`no host permission for ${host} after site access went back to all sites`);
   const checks=bank.model.requests.filter(r=>r.method==='GET'&&r.path==='/models');
   if(!checks.length)throw new StepError('the key was saved without a key check against the provider');
   note('key saved with the provider permission after one key check');
   // The page must not show the key in full once saved.
   if((await pageText('wallet')).includes(chatKey))throw new StepError('the settings page shows the saved key in full');

   await evaluate('wallet','location.hash="advisor"');
   const box=await until('the chat composer to accept text',()=>evaluate('wallet',`(()=>{const el=document.querySelector('.chat-compose textarea');if(!el||el.disabled)return false;el.focus();return true;})()`));
   if(!box)throw new StepError('no chat composer');
   await cdp.send('Input.insertText',{text:QUESTION},sessions.wallet);
   await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'},sessions.wallet);
   await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessions.wallet);
   note('asked the assistant a question');
   await until('the scripted answer in the chat',async()=>{
    const t=await pageText('wallet');
    const failed=['这次没有完成，AI 服务可能暂时不可用。可以重试；你的钱包没有被修改。','聊天助手需要先在设置里添加 AI 模型密钥，钱包其他功能不受影响。'].find(zh=>JSON.parse(words(zh)).some(w=>t.includes(w)));
    if(failed)throw new StepError('the chat failed instead of answering: '+failed);
    return t.includes(ANSWER_MARK);
   },STEP_MS*2);
   const chats=bank.model.requests.filter(r=>r.method==='POST');
   if(chats.length!==chatScript.length)throw new StepError(`the chat asked the model ${chats.length} times, the script has ${chatScript.length} steps`);
   for(const r of bank.model.requests){
    if(r.authorization!=='Bearer '+chatKey)throw new StepError('a provider request did not carry the saved key');
    for(const v of READ_VALUES)if(r.raw.includes(v))throw new StepError(`a value read from the bank (${v}) reached the model`);
   }
   if(!chats[0].body.messages?.some(m=>m.role==='user'&&m.content.includes(QUESTION)))throw new StepError('the question did not reach the model');
   const listed=chats[1].body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(Array.isArray);
   if(!listed?.length)throw new StepError('the list_cards tool result did not reach the model');
   // Card tails are read from the bank too; the projected inventory the model sees must not carry them.
   const inventory=JSON.stringify(listed);
   for(const tail of READ_TAILS)if(inventory.includes(tail))throw new StepError(`a card tail read from the bank (${tail}) reached the model`);
   note('scripted answer shown;',String(chats.length),'model requests, the saved key only, no read value sent');
   note('PASS: the assistant chat on the packaged extension answers through a scripted model');

   // 9b. Hide a card (stl00/Cardybara#198): the bank keeps it, but the overview and the assistant act as if it is not held.
   const HIDE_TAIL='1234',walletCardJs=`[...document.querySelectorAll('.wallet-card')].find(c=>c.innerText.includes(${JSON.stringify(HIDE_TAIL)}))`;
   const hiddenEdit=async()=>(JSON.parse(await evaluate('wallet',`localStorage.getItem('cardybara-card-edits-v1')||'[]'`))).find(e=>e.hidden);
   const toggleHide=async label=>{if(!await until(`the ${label} button on the card ending ${HIDE_TAIL}`,()=>evaluate('wallet',`(()=>{const b=${walletCardJs}?.querySelector('.hide-card-button');if(!b)return false;b.click();return true;})()`)))throw new StepError('no '+label+' button');};
   await evaluate('wallet','location.hash="wallet"');
   const hideName=await until('the name of the card ending '+HIDE_TAIL,()=>evaluate('wallet',`${walletCardJs}?.querySelector('.card-title')?.innerText?.trim()||''`));
   await evaluate('wallet','location.hash="overview"');
   await until('the overview to name the card before it is hidden',async()=>(await pageText('wallet')).includes(hideName));
   await evaluate('wallet','location.hash="wallet"');
   await toggleHide('hide');
   const edit=await until('the hidden flag to be stored',hiddenEdit);
   if(!edit?.cardId)throw new StepError('hiding stored no flag');
   await until('the hidden-cards group',async()=>{const t=await pageText('wallet');return JSON.parse(words('已隐藏的卡')).some(w=>t.includes(w));});
   const cardsLeft=await state();
   if(!Object.values(cardsLeft?.records?.Chase||{}).length)throw new StepError('hiding a card cleared what the bank read');
   await evaluate('wallet','location.hash="overview"');
   await until('the overview to leave out the hidden card',async()=>{const t=await pageText('wallet');return JSON.parse(words('信用卡总览')).some(w=>t.includes(w))&&!t.includes(hideName);});
   note('hid',hideName,': the overview leaves it out, the bank records stay');
   // A new chat, so the earlier answer naming every card is not in the history the model sees.
   bank.model.script=[...chatScript,...scriptedChat];
   const before=bank.model.requests.filter(r=>r.method==='POST').length;
   await evaluate('wallet','location.hash="advisor"');
   await until('the new-chat button',()=>evaluate('wallet',`(()=>{const want=['新对话','New chat','新對話'].map(v=>v.replace(/\\s+/g,''));const b=[...document.querySelectorAll('button')].find(b=>want.includes(b.textContent.replace(/\\s+/g,''))&&!b.disabled);if(!b)return false;b.click();return true;})()`));
   await until('the chat composer to accept text again',()=>evaluate('wallet',`(()=>{const el=document.querySelector('.chat-compose textarea');if(!el||el.disabled)return false;el.focus();return true;})()`));
   await cdp.send('Input.insertText',{text:QUESTION},sessions.wallet);
   await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'},sessions.wallet);
   await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessions.wallet);
   await until('the answer after hiding',async()=>bank.model.requests.filter(r=>r.method==='POST').length>=before+scriptedChat.length&&(await pageText('wallet')).includes(ANSWER_MARK),STEP_MS*2);
   if((await pageText('wallet')).includes(hideName))throw new StepError('the chat names the hidden card');
   const afterHide=bank.model.requests.filter(r=>r.method==='POST').slice(before);
   for(const r of afterHide)if(r.raw.includes(hideName))throw new StepError('the hidden card reached the model: '+hideName);
   const heldList=afterHide[1].body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(Array.isArray);
   if(!heldList?.length||heldList.length!==listed.length-1)throw new StepError('list_cards after hiding did not drop exactly the hidden card: '+JSON.stringify(heldList));
   note('PASS: the assistant does not see the hidden card');
   // 9c. Unhide: the card comes back everywhere at once.
   await evaluate('wallet','location.hash="wallet"');
   await until('the hidden-cards group to open',()=>evaluate('wallet',`(()=>{if(${walletCardJs})return true;const h=document.querySelector('.hidden-cards .ant-collapse-header');if(h)h.click();return false;})()`));
   await toggleHide('unhide');
   await until('the hidden flag to be cleared',async()=>!(await hiddenEdit()));
   await evaluate('wallet','location.hash="overview"');
   await until('the overview to name the card again',async()=>(await pageText('wallet')).includes(hideName));
   note('PASS: a hidden card is left out of the overview and the assistant, and comes back when unhidden');
  }
  if(cards)await manageCards({cdp,evaluate,sessions,until,words,pageText,feeDate:cardFeeDate});
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

// Headless Chrome has no way to answer the extension's permission prompt. So the provider host is first
// allowed the way a user can on the extension's details page (Site access: on specific sites, add a site);
// with the host already allowed, the save button's permission request resolves without a prompt. Afterwards
// site access goes back to all sites. The package is unchanged.
async function siteAccess({cdp,id,attach,evaluate,sessions},change){
 const {targetId}=await cdp.send('Target.createTarget',{url:'chrome://extensions/?id='+id});
 try{
  await attach('extensions',targetId);
  await until('the extensions page API',()=>evaluate('extensions','!!globalThis.chrome?.developerPrivate?.addHostPermission'));
  await evaluate('extensions',`(async()=>{const id=${JSON.stringify(id)};${change}})().then(()=>true)`);
  return await evaluate('extensions',`chrome.developerPrivate.getExtensionInfo(${JSON.stringify(id)}).then(i=>i.permissions.runtimeHostPermissions)`);
 }finally{await cdp.send('Target.closeTarget',{targetId}).catch(()=>{});delete sessions.extensions;}
}
async function allowModelHost(ctx){
 const access=await siteAccess(ctx,`await chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,hostAccess:'ON_SPECIFIC_SITES'});await chrome.developerPrivate.addHostPermission(id,'https://${MODEL_HOST}/*');`);
 if(!access?.hosts?.some(h=>h.granted&&h.host===`https://${MODEL_HOST}/*`))throw new StepError('could not allow the provider host on the extension details page: '+JSON.stringify(access));
 note('site access: on specific sites, with',MODEL_HOST,'added');
}
async function restoreSiteAccess(ctx){
 const access=await siteAccess(ctx,`await chrome.developerPrivate.updateExtensionConfiguration({extensionId:id,hostAccess:'ON_ALL_SITES'});`);
 if(access?.hostAccess!=='ON_ALL_SITES')throw new StepError('site access did not go back to all sites: '+JSON.stringify(access));
 note('site access back to all sites');
}

// The scripted model for --chat: it looks up the held cards, then answers naming them. Each step gets the
// request body the packaged client sent.
const QUESTION='E2E: which cards do I hold?';
const ANSWER_MARK='Synthetic scripted answer';
const toolCall=(id,name,args={})=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
export const scriptedChat=[
 ()=>({content:'',tool_calls:[toolCall('e2e-1','list_cards')]}),
 body=>{const cards=body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(Array.isArray)||[];return {content:`${ANSWER_MARK}: you hold ${cards.map(c=>c.name).join(' and ')||'no cards'}.`};},
];

// The synthetic bank keeps its sign-in in the tab's sessionStorage. Expiring it signs every open
// bank page out and reloads it, as a bank shows its sign-in page when a session times out. A new
// bank tab starts signed out anyway. Returns how many open bank pages were signed out.
async function expireBankSession({cdp,targets}){
 let n=0;
 for(const t of await targets()){
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:true});
  await cdp.send('Runtime.evaluate',{expression:'sessionStorage.removeItem("synthetic-signed-in");location.reload();true'},sessionId).catch(()=>{});
  await cdp.send('Target.detachFromTarget',{sessionId}).catch(()=>{});
  n++;
 }
 await sleep(500);
 return n;
}

// The wallet's header button reads 停止本轮刷新 while a refresh is queued or running.
async function stopFromWallet({clickText,until}){await until('the stop-refresh button',clickText);}
// The guide lives in a closed shadow root; the debugging protocol can still reach its stop button.
async function stopFromGuide({cdp,session,until}){
 await until('the stop button on the reading guide',async()=>{
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true},session);
  const find=n=>{if((n.attributes||[]).some((a,i)=>i%2===0&&a==='data-stop'))return n;for(const c of [...(n.children||[]),...(n.shadowRoots||[])]){const f=find(c);if(f)return f;}return null;};
  const button=find(root);if(!button)return false;
  const {object}=await cdp.send('DOM.resolveNode',{backendNodeId:button.backendNodeId},session);
  await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){this.click()}'},session);
  return true;
 });
}

// --- --cards -------------------------------------------------------------------------------
// A catalogue product at the synthetic bank with a credit that resets on the account anniversary, whose
// English name no other product there contains, so typing it in the search picks exactly that product.
async function anniversaryProduct(){
 const [{benefitProfiles},{cardProducts}]=await Promise.all([import('../src/benefitRules.js'),import('../src/productCatalog.js')]);
 const scoped=cardProducts.filter(p=>p.bank==='Chase'&&p.region==='US'),search=p=>[p.name,...p.aliases].join(' ').toLowerCase();
 for(const product of scoped){
  const profile=benefitProfiles.find(x=>x.productId===product.id);
  if(!profile||profile.coverage==='variant-unconfirmed'||!profile.benefits.some(b=>b.period==='account-anniversary'&&['credit','promo'].includes(b.category)&&b.amount>0&&!b.applicability&&!b.validFrom&&!b.validThrough))continue;
  if(scoped.some(p=>p!==product&&search(p).includes(product.name.toLowerCase())))continue;
  return product;
 }
 throw new StepError('the catalogue has no Chase product with an anniversary credit to test with');
}
async function manageCards({cdp,evaluate,sessions,until,words,pageText,feeDate}){
 const [{anniversaryPeriod},{walletDay}]=await Promise.all([import('../src/feeDate.js'),import('../src/personalBenefits.js')]);
 const product=await anniversaryProduct(),TAIL='9081';
 const local=key=>evaluate('wallet',`JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'null')`);
 const key=async(key,code,vk)=>{for(const type of ['keyDown','keyUp'])await cdp.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})},sessions.wallet);};
 // A closed dialog can linger in a background tab until its animation ends, so the newest match is the live one.
 // Focus a field by selector, select what it holds, and type over it as a user would.
 const type=async(selector,text)=>{
  if(!await until('the field '+selector,()=>evaluate('wallet',`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].at(-1);if(!el||el.disabled)return false;el.focus();el.select?.();return document.activeElement===el;})()`)))throw new StepError('no field '+selector);
  await cdp.send('Input.insertText',{text},sessions.wallet);
 };
 const choose=async(selector,text)=>{await type(selector,text);await sleep(300);await key('Enter','Enter',13);await sleep(300);};
 const drawerText=()=>evaluate('wallet',`[...document.querySelectorAll('.ant-drawer-open .ant-drawer-body')].map(e=>e.innerText).join(' | ')`);
 const openCard=async tail=>{
  await evaluate('wallet','location.hash="wallet"');
  await until('the card ending '+tail,()=>evaluate('wallet',`(()=>{const el=[...document.querySelectorAll('.wallet-card')].find(c=>c.innerText.includes(${JSON.stringify(tail)}));if(!el)return false;el.click();return true;})()`));
  await until('the details of the card ending '+tail,async()=>(await drawerText()).includes(tail));
 };
 const closeDrawer=async()=>{await until('the back-to-cards button',()=>press('.ant-drawer-open button','返回卡片列表'));await until('the card details to close',async()=>!(await evaluate('wallet',`!!document.querySelector('.ant-drawer-open')`)));};
 // Ant Design spaces out a two-character Chinese button label, so labels are compared without spaces.
 const press=(selector,zh)=>evaluate('wallet',`(()=>{const flat=v=>v.replace(/\\s+/g,'');const want=${words(zh)}.map(flat);const b=[...document.querySelectorAll(${JSON.stringify(selector)})].reverse().find(b=>want.includes(flat(b.textContent))&&!b.disabled&&b.offsetParent);if(!b)return false;b.click();return true;})()`);
 const modalOk=async zh=>{if(!await until('the '+zh+' button',()=>press('.ant-modal-footer button',zh)))throw new StepError('no '+zh+' button');};

 const day=walletDay();
 // The wallet tab in front, as the user would have it, so dialogs finish opening and closing.
 await cdp.send('Page.bringToFront',{},sessions.wallet);

 // 10a. Add a card by hand: bank, product from the catalogue (with its art), last digits and fee date.
 await evaluate('wallet','location.hash="wallet"');
 await until('the add-card button',()=>press('button','添加卡片'));
 await choose('.add-card-bank input','Chase');
 await choose('.add-card-product input',product.name);
 await until('the product art preview',()=>evaluate('wallet',`!!document.querySelector('.add-card-form .card-art img')`));
 await type('.add-card-tail',TAIL);
 await type('.add-card-form .fee-month input',String(feeDate.month));
 await type('.add-card-form .fee-day input',String(feeDate.day));
 await modalOk('保存卡片');
 const added=await until('the manual card to be stored',async()=>(await local('cardybara-wallet-cards-v1'))?.find(c=>c.tail===TAIL));
 if(added.bank!=='Chase'||added.identitySource!=='manual')throw new StepError('the manual card was stored wrongly: '+JSON.stringify(added));
 const choice=(await local('cardybara-card-products-v1'))?.find(c=>c.cardId===added.id);
 if(choice?.productId!==product.id)throw new StepError(`the picked product was not stored for the manual card: ${JSON.stringify(choice)}`);
 const edits=async()=>(await local('cardybara-card-edits-v1'))||[];
 const stored=(await edits()).find(e=>e.cardId===added.id);
 if(JSON.stringify(stored?.feeDate)!==JSON.stringify(feeDate))throw new StepError('the fee date was not stored as entered: '+JSON.stringify(stored));
 note('added a manual card by picking a catalogue product, with a fee date');

 // 10b. Its anniversary credit now has a real cycle from that date, and no fee-date prompt shows.
 const expect=anniversaryPeriod(feeDate,day);
 await openCard(TAIL);
 if(await evaluate('wallet',`!!document.querySelector('.ant-drawer-open .fee-date-prompt')`))throw new StepError('the card still asks for its fee date after one was set');
 await until('the card year from the fee date',async()=>{const text=await drawerText();return text.includes(expect.start)&&text.includes(expect.end);});
 await press('.ant-drawer-open button','查看本卡全部');
 await until('an anniversary credit running to the end of the card year',()=>evaluate('wallet',`[...document.querySelectorAll('.ant-drawer-open .credit-row-facts')].some(e=>e.innerText.includes(${JSON.stringify(expect.end)}))`));
 note('the anniversary credit runs',expect.start,'to',expect.end);

 // 10c. Edit it: a new name and another fee date.
 const editCard=async(fill)=>{
  await until('the edit-card button',()=>press('.ant-drawer-open button','编辑卡片信息'));
  await until('the edit-card form',()=>evaluate('wallet',`!!document.querySelector('.card-edit-modal .ant-form')`));
  await fill();await modalOk('保存');
 };
 const renamed='E2E Synthetic Card',next={month:1,day:31};
 await editCard(async()=>{await type('.card-edit-modal #name',renamed);await type('.card-edit-modal .fee-month input',String(next.month));await type('.card-edit-modal .fee-day input',String(next.day));});
 const after=anniversaryPeriod(next,day);
 await until('the edited name and card year',async()=>{const text=await drawerText();return text.includes(renamed)&&text.includes(after.start)&&text.includes(after.end);});
 // A manual card's name is edited in the registry the collector reads; its fee date is the user's overlay.
 const edited=(await edits()).find(e=>e.cardId===added.id),row=(await local('cardybara-wallet-cards-v1'))?.find(c=>c.id===added.id);
 if(row?.name!==renamed||edited?.name||JSON.stringify(edited?.feeDate)!==JSON.stringify(next))throw new StepError('the edit was not stored: '+JSON.stringify({row,edited}));
 note('edited the manual card: name and fee date');
 await closeDrawer();

 // 10d. Correct the name of a card the bank page showed, then reset it to what the bank showed.
 await openCard('1234');
 const bankName=(await evaluate('wallet',`document.querySelector('.ant-drawer-open .card-edit-section .ant-descriptions-item-content')?.innerText||''`)).trim();
 if(!bankName)throw new StepError('the detected card shows no name');
 await editCard(async()=>{await type('.card-edit-modal #name','E2E Corrected Name');});
 await until('the corrected name labelled as set by the user',async()=>{const text=await drawerText();return text.includes('E2E Corrected Name')&&JSON.parse(words('你设置的')).some(w=>text.includes(w));});
 const detectedId=(await edits()).find(e=>e.name==='E2E Corrected Name')?.cardId;
 if(!detectedId)throw new StepError('the correction on the detected card was not stored');
 await until('the reset link',()=>press('.ant-drawer-open button','恢复银行显示的值'));
 await until('the bank name back after the reset',async()=>{const text=await drawerText();return text.includes(bankName)&&!text.includes('E2E Corrected Name');});
 if((await edits()).some(e=>e.cardId===detectedId))throw new StepError('the reset left the correction stored');
 note('corrected a detected card and reset it to the bank value');
 await closeDrawer();

 // 10e. Remove the manual card: it leaves the wallet with its product choice and edits.
 await openCard(TAIL);
 await until('the remove button',()=>press('.ant-drawer-open button','移除此卡'));
 await until('the remove confirmation',()=>press('.ant-modal-confirm button','移除'));
 await until('the manual card to leave the wallet',async()=>!(await pageText('wallet')).includes(renamed)&&!(await local('cardybara-wallet-cards-v1'))?.some(c=>c.tail===TAIL));
 if((await edits()).some(e=>e.cardId===added.id))throw new StepError('the removed card left its edits behind');
 if((await local('cardybara-card-products-v1'))?.some(c=>c.cardId===added.id))throw new StepError('the removed card left its product choice behind');
 const removed=await local('cardybara-wallet-removed-v1');
 if(!removed?.some(r=>r.id===added.id))throw new StepError('the removed card was not recorded as removed');
 note('PASS: a manual card is added from the catalogue with a fee date, gets an anniversary cycle, is edited and removed; a detected card is corrected and reset');
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
// With --restart: the profile is changed while Chrome is closed, and the restart check must notice.
export const BROKEN_RESTART={
 'extension storage lost across a restart':[/records changed across a browser restart/,async profile=>{await rm(join(profile,'Default','Local Extension Settings'),{recursive:true,force:true});}],
};
// With --expired-login: the session is not really expired, so no sign-in is asked for; the check
// must notice instead of passing on a run that never met an expired session.
export const BROKEN_EXPIRED_LOGIN={
 'a bank session that did not expire':[/the run ended as updated instead of asking for a sign-in again/,async()=>0],
};
// With --cancel: one stop is never sent, so the refresh carries on; the check must notice instead of
// passing a refresh that was never stopped.
export const BROKEN_CANCEL={
 'a wallet stop that is never sent':[/timed out waiting for the run to be cancelled/,{stop:async()=>{}}],
 'a guide stop that is never sent':[/timed out waiting for the job to be cancelled from the guide/,{stopGuide:async()=>{}}],
 'a wallet stop at needs-login that is never sent':[/timed out waiting for the job to be cancelled from the wallet/,{stopWaiting:async()=>{}}],
};
// With --chat: a key the provider rejects is never saved, and a model that never answers leaves no answer;
// the check must notice either.
export const BROKEN_CHAT={
 'a key the provider rejects':[/the key was not saved/,{chatKey:'e2e-rejected-'+'1'.repeat(24)}],
 'a model that never gives the answer':[/the chat failed instead of answering|timed out waiting for the scripted answer/,{chatScript:[()=>({content:'',tool_calls:[toolCall('e2e-1','list_cards')]})]}],
};
// With --cards: a card with a fee date that does not exist is never saved; the check must notice.
export const BROKEN_CARDS={
 'a fee date that does not exist':[/timed out waiting for the manual card to be stored/,{cardFeeDate:{month:2,day:30}}],
};
// With --upgrade-from: the records are lost during the upgrade, or the tested package never replaces the
// previous one (made to differ from it so the check can tell); the upgrade check must notice either.
export const BROKEN_UPGRADE={
 'extension storage lost across an upgrade':[/records changed across an upgrade/,{beforeRestart:async profile=>{await rm(join(profile,'Default','Local Extension Settings'),{recursive:true,force:true});}}],
 'a tested package that never replaces the previous one':[/still runs the previous package/,{swap:false,mutatePrevious:async dir=>{const m=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')),f=join(dir,m.background.service_worker);await writeFile(f,await readFile(f,'utf8')+'\n// previous package\n');}}],
};
async function sameFiles(a,b){
 const list=async(dir,base=dir)=>(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?list(join(dir,e.name),base):[join(dir,e.name).slice(base.length+1)]))).flat().sort();
 const [x,y]=[await list(a),await list(b)];
 if(JSON.stringify(x)!==JSON.stringify(y))return false;
 for(const f of x)if(!(await readFile(join(a,f))).equals(await readFile(join(b,f))))return false;
 return true;
}
export async function negativeControls(input,{out,restart=false,expiredLogin=false,cancel=false,chat=false,cards=false,upgradeFrom=null}){
 const escaped=[];
 // With --restart, --expired-login or --cancel only that scenario's controls run; the package controls run
 // in their own step.
 const extended=restart||expiredLogin||cancel||chat||cards||!!upgradeFrom;
 const controls=[...(extended?[]:Object.entries(BROKEN).map(([name,[reason,mutate]])=>[name,reason,{mutate}])),...(restart?Object.entries(BROKEN_RESTART).map(([name,[reason,beforeRestart]])=>[name,reason,{restart:true,beforeRestart}]):[]),...(expiredLogin?Object.entries(BROKEN_EXPIRED_LOGIN).map(([name,[reason,expire]])=>[name,reason,{expiredLogin:true,expire,requireExpired:false}]):[]),...(cancel?Object.entries(BROKEN_CANCEL).map(([name,[reason,broken]])=>[name,reason,{cancel:true,...broken}]):[]),...(chat?Object.entries(BROKEN_CHAT).map(([name,[reason,broken]])=>[name,reason,{chat:true,...broken}]):[]),...(cards?Object.entries(BROKEN_CARDS).map(([name,[reason,broken]])=>[name,reason,{cards:true,...broken}]):[]),...(upgradeFrom?Object.entries(BROKEN_UPGRADE).map(([name,[reason,broken]])=>[name,reason,{upgradeFrom,...broken}]):[])];
 for(const [name,reason,options] of controls){
  console.log(`--- negative control: ${name}`);
  const error=await run(input,{out:join(out,name.replace(/\W+/g,'-')),...options,stepMs:12000}).then(()=>null,e=>e);
  const ok=error&&reason.test(error.message);
  if(!ok)escaped.push(name+(error?` (failed for another reason: ${error.message})`:' (passed)'));
  console.log(ok?`ok: the broken package (${name}) failed as expected`:`ESCAPED: ${name}`);
 }
 if(escaped.length)throw Error('E2E did not catch: '+escaped.join(', '));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const valued=['--out','--upgrade-from'];
 const args=process.argv.slice(2),take=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;if(valued.includes(flag)&&!args[i+1]){console.error(flag+' needs a path');process.exit(2);}return args.splice(i,valued.includes(flag)?2:1).at(-1);};
 const outArg=take('--out'),upgradeFrom=take('--upgrade-from')||null,controls=take('--negative-controls'),restart=!!take('--restart'),expiredLogin=!!take('--expired-login'),cancel=!!take('--cancel'),chat=!!take('--chat'),cards=!!take('--cards');
 if(!args[0]){console.error('usage: node scripts/e2e-extension.mjs <release-dir-or-zip> [--out <dir>] [--negative-controls] [--restart] [--expired-login] [--cancel] [--chat] [--cards] [--upgrade-from <previous-release-dir-or-zip>]');process.exit(2);}
 const out=resolve(outArg||join(root,'.debug/e2e'));
 (controls?negativeControls(args[0],{out,restart,expiredLogin,cancel,chat,cards,upgradeFrom}):run(args[0],{out,restart,expiredLogin,cancel,chat,cards,upgradeFrom})).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1);});
}
