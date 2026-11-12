// Renders the share images from site/share/templates into site/share/out (stl00/Cardybara#239).
//
//   node site/share/render.mjs                 # share images only
//   node site/share/render.mjs --preview DIR   # also screenshots of site/index.html (desktop, phone, dark) into DIR
//
// The templates use the screenshots in site/assets/shots, which `node site/share/capture.mjs` makes from the real
// wallet UI with a synthetic wallet. Rendering is offline: headless Chrome opens local files only.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {findChrome} from '../../scripts/dev-collector/chrome-launcher.mjs';
import {pipeCdp} from '../../scripts/e2e-chrome.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const templates=join(root,'site/share/templates'),out=join(root,'site/share/out');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const IMAGES=[
 ['og',1200,630],
 ['carousel-1',1080,1440],['carousel-2',1080,1440],['carousel-3',1080,1440],['carousel-4',1080,1440],
 ['square',1080,1080],
];
const previewAt=process.argv.indexOf('--preview'),previewDir=previewAt>0?process.argv[previewAt+1]:null;

const profile=await mkdtemp(join(tmpdir(),'cardybara-share-'));
const child=spawn(await findChrome(),['--headless=new','--remote-debugging-pipe','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-extensions','--hide-scrollbars','--force-color-profile=srgb','--allow-file-access-from-files','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
const cdp=pipeCdp(child);
try{
 await cdp.send('Browser.getVersion');
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
 const send=(m,p={})=>cdp.send(m,p,sessionId);
 await send('Page.enable');await send('Runtime.enable');
 const ready=async()=>{for(let i=0;i<100;i++){const r=await send('Runtime.evaluate',{expression:`document.readyState==='complete'&&[...document.images].every(i=>i.complete||i.loading==='lazy'||!i.offsetParent)&&[...document.querySelectorAll('[data-shot]')].every(e=>e.dataset.ready)`,returnByValue:true});if(r.result.value)return;await sleep(100);}throw Error('page did not finish loading');};
 const capture=async(url,width,height,file,{scale=1,scheme='light',full=false,mobile=false}={})=>{
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  await send('Page.navigate',{url});await sleep(300);await ready();await send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});await sleep(200);
  const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:full});
  await writeFile(file,Buffer.from(r.data,'base64'));console.log('wrote '+file.replace(root,''));
 };
 await mkdir(out,{recursive:true});
 for(const [name,w,h] of IMAGES)await capture(pathToFileURL(join(templates,name+'.html')).href,w,h,join(out,name+'.png'));
 if(previewDir){
  await mkdir(previewDir,{recursive:true});
  const site=pathToFileURL(join(root,'site/index.html')).href;
  await capture(site,1280,860,join(previewDir,'site-desktop.png'),{full:true});
  await capture(site+'?lang=en',1280,860,join(previewDir,'site-desktop-en.png'),{full:true});
  await capture(site,1280,860,join(previewDir,'site-dark.png'),{scheme:'dark'});
  await capture(site,390,844,join(previewDir,'site-phone.png'),{full:true,mobile:true,scale:2});
 }
}finally{child.kill('SIGKILL');await rm(profile,{recursive:true,force:true}).catch(()=>{});}
