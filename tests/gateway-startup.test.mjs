// Workers rejects a script that spends too much CPU at startup (error 10021). The agent and the public knowledge it
// bundles build their indexes when first evaluated, so the built Worker must load them on the first /v1/chat request,
// never when the script starts, and the proxy route must never load them. Measured on the real bundle in a fresh
// process: starting the script and serving the proxy must cost a small fraction of what loading the agent costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildGateway} from '../scripts/build-gateway.mjs';

const local=new URL('../gateway/src/local.mjs',import.meta.url).href;
// Runs in a fresh Node process: imports the bundle, serves one request on in-memory bindings with a stub provider,
// and prints the milliseconds each step took.
const probe=(bundle,path)=>`
const {memoryKV,memoryDurableObject,addInvite}=await import(${JSON.stringify(local)});
let t=performance.now();
const worker=await import(${JSON.stringify(pathToFileURL(bundle).href)});
const importMs=performance.now()-t;
globalThis.fetch=async()=>Response.json({choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}});
const env={PROVIDER_KEY:'synthetic-provider-key-not-real',ALLOWED_ORIGINS:'chrome-extension://*',ALLOW_HTTP_PROVIDER:'1',INVITES:memoryKV(),USAGE:memoryDurableObject(worker.UsageLedger)};
const code='cdy_'+'startup-test-only-'.padEnd(43,'0');await addInvite(env.INVITES,code,{id:'startup'});
const day=new Date().toISOString().slice(0,10);
const body=${JSON.stringify(path)}==='/v1/chat'?{question:'hi',history:[],memory:{},summary:{schema:1,day,language:'en-US',cards:[],pointValues:[]}}:{messages:[{role:'user',content:'hi'}],max_tokens:10};
t=performance.now();
const r=await worker.default.fetch(new Request('https://gateway.test'+${JSON.stringify(path)},{method:'POST',headers:{Origin:'chrome-extension://'+'a'.repeat(32),Authorization:'Bearer '+code,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){}});
await r.text();
console.log(JSON.stringify({importMs,requestMs:performance.now()-t,status:r.status}));`;
const run=(bundle,path)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',probe(bundle,path)],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}).trim().split('\n').at(-1));

test('the built Worker starts without loading the agent, and the proxy never loads it',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-gateway-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const {out,metafile}=await buildGateway(join(dir,'worker.mjs'));
 // Without timing: the agent reaches the Worker only through a dynamic import, the one thing a bundler keeps lazy.
 const toAgent=Object.entries(metafile.inputs).flatMap(([from,i])=>i.imports.filter(x=>x.path==='gateway/src/agent.js').map(x=>[from,x.kind]));
 assert.deepEqual(toAgent,[['gateway/src/gateway.js','dynamic-import']],'agent.js must only be imported dynamically, by gateway.js');
 // The best of three, so a busy machine cannot fail the check; the agent figure is the cheapest load seen.
 const best=(path,key)=>Math.min(...[0,1,2].map(()=>run(out,path)[key]));
 const proxy=run(out,'/v1/chat/completions');assert.equal(proxy.status,200);
 const agentLoad=best('/v1/chat','requestMs'),startup=best('/v1/chat/completions','importMs'),proxyRequest=best('/v1/chat/completions','requestMs');
 assert.equal(run(out,'/v1/chat').status,200,'the agent route still answers');
 // Loading the agent costs hundreds of ms; starting the script and a proxy request must each be a small part of it.
 assert.ok(agentLoad>4*startup,`starting the script (${startup.toFixed(0)} ms) is not small next to loading the agent (${agentLoad.toFixed(0)} ms)`);
 assert.ok(agentLoad>4*proxyRequest,`a proxy request (${proxyRequest.toFixed(0)} ms) loads the agent (${agentLoad.toFixed(0)} ms)`);
 assert.ok(startup<150,`starting the script took ${startup.toFixed(0)} ms`);
});
