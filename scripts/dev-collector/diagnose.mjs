// Dev-only: writes a redacted structure report for the dedicated Chrome's bank tabs. Attaches only; it
// never starts Chrome. Run after signing in, with the page in question open: npm run diagnose:bank
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser} from './chrome-launcher.mjs';
import {createChromeAdapter,hostPermissions} from './chrome-adapter.mjs';
import {redactStructureText,structureReport} from './structure-report.js';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),home=resolve(process.env.CARDYBARA_COLLECTOR_HOME||join(root,'.debug/dev-collector')),extensionRoot=join(root,'extension-next');
const manifest=JSON.parse(await readFile(join(extensionRoot,'manifest.json'),'utf8'));
const adapter=createChromeAdapter({extensionRoot,permittedHosts:hostPermissions(manifest),openBrowser:()=>openBrowser({profile:join(home,'chrome-profile'),launch:false})});
await adapter.connect().catch(()=>{console.error('The dedicated Chrome is not open. Start a refresh from the wallet first.');process.exit(1);});
const dir=join(root,'.debug/structure');await mkdir(dir,{recursive:true,mode:0o700});
let count=0;
for(const tab of await adapter.chrome.tabs.query({})){
 if(!tab.url)continue;
 const [{result}]=await adapter.chrome.scripting.executeScript({target:{tabId:tab.id},func:structureReport,args:[redactStructureText.toString()]});
 const file=join(dir,result.host+'-'+Date.now()+'.json');await writeFile(file,JSON.stringify(result,null,1)+'\n',{mode:0o600});
 console.log('Wrote',file.slice(root.length+1),'rows:',result.rows.length);count++;
}
if(!count)console.log('No bank tab is open.');
adapter.close();process.exit(0);
