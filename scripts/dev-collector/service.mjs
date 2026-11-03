// Dev-only child of the Vite server: the unmodified extension-next/background.js under Node.
// Restarted when collector source changes; the dedicated Chrome and its bank sessions stay up.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './chrome-launcher.mjs';
import {SYNTHETIC_METHODS} from './cdp.mjs';
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

const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8'));
const adapter=createChromeAdapter({
 extensionRoot,storagePath:join(home,'storage.json'),permittedHosts:hostPermissions(manifest),devOrigin:env.CARDYBARA_DEV_ORIGIN,prepareTab,
 openBrowser:({launch})=>openBrowser({profile:join(home,'chrome-profile'),launch,headless:env.CARDYBARA_COLLECTOR_HEADLESS==='1',noSandbox:env.CARDYBARA_COLLECTOR_NO_SANDBOX==='1',...(synthetic?{extraMethods:SYNTHETIC_METHODS}:{})}),
 notifyWallet:message=>post({event:'wallet',message}),
 // The run stops here rather than retrying; only the host and the signal are reported.
 onBlocked:async({host,reason})=>{
  console.error('[dev-collector] bank blocked the browser:',host,reason);
  await adapter.fromWallet({type:'cancel',requestId:crypto.randomUUID()}).catch(()=>{});
  post({event:'wallet',message:{channel:'cardybara-extension',type:'error',error:'银行拦截了开发浏览器（'+host+'，'+reason+'），已停止本次读取。'}});
 }
});
globalThis.chrome=adapter.chrome;
// The registry's origin is the extension's identity here, not a server to call.
const realFetch=globalThis.fetch;
globalThis.fetch=(url,...rest)=>String(url).startsWith(ORIGIN)?Promise.reject(Error('dev_collector_parser_disabled')):realFetch(url,...rest);
await import('../../extension-next/background.js');
// Reattach to a Chrome left running by the previous service instance; never launch one for this.
await adapter.connect({launch:false}).catch(()=>{});
process.on('message',async({id,message})=>{
 try{
  // Start Chrome before the refresh so its launch time is not charged to tab timeouts.
  if(message?.type==='refresh')await adapter.connect();
  post({event:'reply',id,result:await adapter.fromWallet(message)});
 }catch(error){console.error('[dev-collector] request failed',label(error));post({event:'reply',id,result:{ok:false,error:error?.message==='chrome_not_found'?'未找到 Chrome，请设置 CARDYBARA_CHROME_PATH。':'无法启动开发浏览器，请重试。'}});}
});
post({event:'ready'});
