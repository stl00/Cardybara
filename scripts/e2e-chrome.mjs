// Chrome over a debugging pipe for the packaged-extension E2E, and a bounded start that survives a Chrome
// that starts slowly or not at all on a cold CI runner (stl00/Cardybara#211).
//
// The harness talks to Chrome over --remote-debugging-pipe, so there is no HTTP /json/version endpoint to
// poll; asking Browser.getVersion over the pipe is the same readiness check. The start only covers Chrome
// answering at the browser level, before the extension is installed: nothing the extension does can make
// Chrome answer, and every later step keeps its own single timeout.

const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// `timeoutMs` is a function so a run can change its step timeout after the pipe is open.
export function pipeCdp(child,{timeoutMs=()=>30000}={}){
 // Split on NUL bytes before decoding, so a character split across chunks is never mangled.
 let next=0,buffer=Buffer.alloc(0),gone=null;const pending=new Map(),handlers=new Set();
 const fail=reason=>{gone=gone||reason;for(const [id,p] of pending){pending.delete(id);p.reject(Error(`${p.method}: ${gone}`));}};
 child.on('error',e=>fail('Chrome did not start ('+e.message+')'));
 child.stdio[3].on('error',e=>fail('pipe closed ('+e.message+')'));
 child.stdio[4].on('error',e=>fail('pipe closed ('+e.message+')'));
 child.on('exit',(code,signal)=>fail(`Chrome exited (${signal||code})`));
 child.stdio[4].on('data',chunk=>{
  buffer=Buffer.concat([buffer,chunk]);let i;
  while((i=buffer.indexOf(0))>=0){
   let msg;try{msg=JSON.parse(buffer.subarray(0,i).toString('utf8'));}catch{msg={};}buffer=buffer.subarray(i+1);
   if(msg.id!=null&&pending.has(msg.id)){const {resolve,reject,method}=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(`${method}: ${msg.error.message}`)):resolve(msg.result);}
   // An answer to a request that already timed out (an earlier readiness attempt) is dropped here.
   else if(msg.id==null)for(const h of handlers)h(msg);
  }
 });
 return {
  send(method,params={},sessionId,ms=timeoutMs()){if(gone)return Promise.reject(Error(`${method}: ${gone}`));const id=++next;child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject,method});setTimeout(()=>{if(pending.delete(id))reject(Error(method+': no answer'));},ms);});},
  on(h){handlers.add(h);},
  get gone(){return gone;},
 };
}

// Start Chrome and wait, within a bound, until it answers Browser.getVersion. Each launch gets `budgetMs`;
// inside it the check is asked again with a growing wait (firstWaitMs, doubling up to maxWaitMs), so a
// Chrome that exits is noticed at once instead of after a full step timeout. A launch that never answers is
// killed and Chrome is launched once more; `launch(n)` decides what the n-th launch starts on (a fresh
// profile for a first start, the same profile for a restart). Which launch and attempt answered is logged.
export async function startChrome(launch,{launches=2,budgetMs=30000,firstWaitMs=1000,maxWaitMs=8000,note=()=>{}}={}){
 const reasons=[];
 for(let n=1;n<=launches;n++){
  const browser=await launch(n);
  const started=Date.now();let wait=firstWaitMs,reason='no answer';
  for(let attempt=1;;attempt++){
   const t0=Date.now(),left=budgetMs-(t0-started);
   if(left<=0)break;
   try{
    const version=await browser.cdp.send('Browser.getVersion',{},undefined,Math.min(wait,left));
    note(`chrome answered on launch ${n} of ${launches}, attempt ${attempt}, after ${Date.now()-started} ms`);
    return {browser,version};
   }catch(e){reason=e.message;}
   if(browser.cdp.gone)break;
   // An error that came back early (not a timeout) waits out the rest of this attempt, so the loop never spins.
   await sleep(Math.max(0,Math.min(wait-(Date.now()-t0),budgetMs-(Date.now()-started))));
   wait=Math.min(wait*2,maxWaitMs);
  }
  reasons.push(`launch ${n}: ${reason} after ${Date.now()-started} ms`);
  note(`chrome launch ${n} of ${launches} gave no DevTools answer (${reason}, ${Date.now()-started} ms)`+(n<launches?'; killing it and launching again':''));
  await kill(browser.child);
 }
 throw Error(`Chrome never answered over DevTools (${reasons.join('; ')})`);
}

async function kill(child){
 if(child.exitCode!==null||child.signalCode!==null)return;
 const exited=new Promise(r=>child.once('exit',r));
 child.kill('SIGKILL');
 let timer;await Promise.race([exited,new Promise(r=>{timer=setTimeout(r,5000);})]);clearTimeout(timer);
}
