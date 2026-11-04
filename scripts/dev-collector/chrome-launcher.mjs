// Dev-only launcher for the dedicated collector Chrome. The browser outlives the Node
// service on purpose: reloading collector code must not end the owner's bank session.
import {spawn as nodeSpawn} from 'node:child_process';
import {chmod,mkdir,readFile,rm,access,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {assertLoopbackUrl,connectCdp} from './cdp.mjs';

const CANDIDATES=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'];
export async function findChrome(env=process.env){
 if(env.CARDYBARA_CHROME_PATH)return env.CARDYBARA_CHROME_PATH;
 for(const path of CANDIDATES){try{await access(path);return path;}catch{}}
 throw Error('chrome_not_found');
}
const personalProfiles=()=>[join(homedir(),'Library/Application Support/Google/Chrome'),join(homedir(),'.config/google-chrome'),join(homedir(),'.config/chromium')];
export function assertDedicatedProfile(profile,personal=personalProfiles()){
 const path=resolve(profile);
 if(personal.some(p=>path===p||path.startsWith(p+sep)))throw Error('personal_chrome_profile_refused');
 return path;
}
// No automation or anti-detection flags: this is a plain Chrome with a loopback debugging port.
// Port 0 lets Chrome pick a free port and record it in the profile's DevToolsActivePort.
export function chromeArgs(profile,{headless=false,noSandbox=false,extraArgs=[]}={}){
 return ['--user-data-dir='+profile,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check',...(headless?['--headless=new']:[]),...(noSandbox?['--no-sandbox']:[]),...extraArgs,'about:blank'];
}
export function parseActivePort(text){
 const [port,path]=String(text).trim().split('\n');
 if(!/^\d{1,5}$/.test(port||'')||!/^\/devtools\/browser\/[\w-]+$/.test(path||''))throw Error('invalid_active_port');
 return assertLoopbackUrl('ws://127.0.0.1:'+port+path);
}
// A home is either synthetic or real for life: a synthetic run must never reuse a real browser
// (no DNS block, real session), and a real run must never read through a synthetic one.
export async function claimHomeMode(home,mode){
 await mkdir(home,{recursive:true,mode:0o700});
 const path=join(home,'mode'),existing=await readFile(path,'utf8').catch(()=>null);
 if(existing!==null&&existing!==mode)throw Error('collector_home_mode_conflict');
 if(existing===null){
  // A home from before this marker holds a real profile.
  const used=await access(join(home,'chrome-profile')).then(()=>true,()=>false);
  if(used&&mode!=='real')throw Error('collector_home_mode_conflict');
  await writeFile(path,mode,{mode:0o600});
 }
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function openBrowser({profile,chromePath,headless=false,noSandbox=false,extraArgs,extraMethods,launch=true,spawn=nodeSpawn,connect=connectCdp,timeoutMs=45000}){
 const dir=assertDedicatedProfile(profile),portFile=join(dir,'DevToolsActivePort');
 const attach=async()=>connect(parseActivePort(await readFile(portFile,'utf8')),{extraMethods});
 try{return await attach();}catch(error){if(!launch)throw error;}
 // One retry before treating the port file as stale: removing a live browser's file strands it.
 await pause(500);try{return await attach();}catch{}
 await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 await rm(portFile,{force:true});
 const child=spawn(chromePath||await findChrome(),chromeArgs(dir,{headless,noSandbox,extraArgs}),{detached:true,stdio:'ignore'});
 child.on?.('error',()=>{});child.unref?.();
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){try{return await attach();}catch{await pause(150);}}
 throw Error('chrome_start_timeout');
}
