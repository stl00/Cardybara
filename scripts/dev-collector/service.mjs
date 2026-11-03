// Dev-only child of the Vite server: the unmodified extension-next/background.js under Node.
// Restarted when collector source changes; the dedicated Chrome and its bank sessions stay up.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './chrome-launcher.mjs';
import {SYNTHETIC_ARGS,SYNTHETIC_METHODS} from './cdp.mjs';
import {createChromeAdapter,hostPermissions} from './chrome-adapter.mjs';
import {ORIGIN} from '../../extension-next/providers.js';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),extensionRoot=join(root,'extension-next');
const env=process.env,home=resolve(env.CARDYBARA_COLLECTOR_HOME||join(root,'.debug/dev-collector'));
const synthetic=env.CARDYBARA_SYNTHETIC_BANK;
if(synthetic&&!env.CARDYBARA_COLLECTOR_HOME)throw Error('synthetic_bank_requires_separate_home');
const prepareTab=synthetic?(await import('./synthetic-bank.mjs')).syntheticPrepareTab(synthetic):undefined;
const post=m=>{if(process.connected)process.send(m);};
const label=e=>String(e?.name||'Error')+': '+String(e?.message||'').replace(/\d/g,'#').slice(0,80);
process.on('unhandledRejection',error=>console.error('[dev-collector] unhandled',label(error)));
process.on('disconnect',()=>process.exit(0));

const stopRun=async errorCode=>{await adapter.fromWallet({type:'cancel',requestId:crypto.randomUUID()}).catch(()=>{});post({event:'wallet',message:{channel:'cardybara-extension',type:'error',errorCode}});};
const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8'));
const adapter=createChromeAdapter({
 extensionRoot,storagePath:join(home,'storage.json'),permittedHosts:hostPermissions(manifest),devOrigin:env.CARDYBARA_DEV_ORIGIN,prepareTab,
 openBrowser:({launch})=>openBrowser({profile:join(home,'chrome-profile'),launch,headless:env.CARDYBARA_COLLECTOR_HEADLESS==='1',noSandbox:env.CARDYBARA_COLLECTOR_NO_SANDBOX==='1',...(synthetic?{extraMethods:SYNTHETIC_METHODS,extraArgs:SYNTHETIC_ARGS}:{})}),
 notifyWallet:message=>post({event:'wallet',message}),
 onBlocked:async({tabId,host,reason})=>{
  // Stops only the run reading that tab, without retrying; only host and signal are reported.
  console.error('[dev-collector] bank page signal:',host,reason);
  const {state}=await adapter.fromWallet({type:'hello',requestId:crypto.randomUUID()});
  if(state?.run?.status==='running'&&state.run.jobs.some(j=>j.tabId===tabId))await stopRun('bank_blocked');
 },
 onBrowserLost:async()=>{
  const {state}=await adapter.fromWallet({type:'hello',requestId:crypto.randomUUID()});
  if(state?.run?.status==='running')await stopRun('browser_closed');
 }
});
globalThis.chrome=adapter.chrome;
// The registry's origin is the extension's identity here, not a server to call.
const realFetch=globalThis.fetch;
globalThis.fetch=(url,...rest)=>String(url).startsWith(ORIGIN)?Promise.reject(Error('dev_collector_parser_disabled')):realFetch(url,...rest);
await import('../../extension-next/background.js');
process.on('message',async({id,message})=>{
 try{
  // Only a refresh may start Chrome, and its launch time is not charged to tab timeouts.
  if(message?.type==='refresh')await adapter.connect({launch:true});
  post({event:'reply',id,result:await adapter.fromWallet(message)});
 }catch(error){console.error('[dev-collector] request failed',label(error));post({event:'reply',id,result:{ok:false,errorCode:error?.message==='chrome_not_found'?'chrome_not_found':'chrome_start_failed'}});}
});
// Reattach to a Chrome left running by the previous service instance; never launch one for this.
void adapter.connect().catch(()=>{});
post({event:'ready'});
