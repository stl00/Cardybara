// Screenshots of the real wallet UI for the product site and share images (stl00/Cardybara#239).
//
//   node site/share/capture.mjs
//
// Runs the wallet from source (the same Vite config as `npm run dev`) on its own port, serves the synthetic
// wallet in site/share/fixture/wallet.json as /data.json, and captures pages in a throwaway headless Chrome
// profile into site/assets/shots/. The wallet is scoped to release.json's banks, like the beta package. Nothing here reads public/data.json, a real profile or a real bank.
// The assistant shot uses a scripted model answered inside this script: it asks the wallet's own
// choose_card tool, then writes its answer only from what that tool returned. No model or network is used.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {findChrome} from '../../scripts/dev-collector/chrome-launcher.mjs';
import {pipeCdp} from '../../scripts/e2e-chrome.mjs';
import {releaseConfig,scopeSource,SCOPE_FILE} from '../../scripts/build-scope.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'site/assets/shots');
const fixture=await readFile(join(root,'site/share/fixture/wallet.json'),'utf8');
const PORT=Number(process.env.CARDYBARA_SITE_CAPTURE_PORT||8791);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// The demo wallet is the only data the page can load.
process.env.CARDYBARA_DEV_PORT=String(PORT);
process.env.CARDYBARA_MODEL_CONFIG=join(root,'site/share/fixture/no-model.env');
const server=await createServer({configFile:join(root,'vite.config.mjs'),root,logLevel:'warn',server:{port:PORT,strictPort:true,hmr:false},plugins:[{name:'site-beta-scope',enforce:'pre',transform(code,id){return id.split('?')[0].endsWith('/extension-next/'+SCOPE_FILE)?{code:scopeSource(releaseConfig(new URL('../../',import.meta.url))),map:null}:null;}},{name:'site-demo-wallet',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url.split('?')[0]==='/data.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(fixture);return;}next();});}}]});
await server.listen();
const base=`http://127.0.0.1:${PORT}`;

const profile=await mkdtemp(join(tmpdir(),'cardybara-site-shots-'));
const child=spawn(await findChrome(),['--headless=new','--remote-debugging-pipe','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-extensions','--hide-scrollbars','--force-color-profile=srgb','--lang=zh-CN','about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
const cdp=pipeCdp(child);
const events=[];cdp.on(m=>events.push(m));

async function page(){
 const {targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
 const send=(m,p={})=>cdp.send(m,p,sessionId);
 await send('Page.enable');await send('Runtime.enable');
 // Scripted assistant: the dev wallet reports a model ready, and /api/advisor/chat answers from the tool result.
 await send('Fetch.enable',{patterns:[{urlPattern:'*/api/parser/status*'},{urlPattern:'*/api/advisor/chat*'}]});
 cdp.on(async m=>{
  if(m.sessionId!==sessionId||m.method!=='Fetch.requestPaused')return;
  const {requestId,request}=m.params;const reply=body=>send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  if(request.url.includes('/api/parser/status'))return reply({configured:true,provider:'scripted',model:'scripted',processing:'none',requiresKeyInput:false});
  const payload=JSON.parse(request.postData||'{}');if(process.env.CAPTURE_DEBUG)console.error(JSON.stringify(payload.messages?.filter(m=>m.role==="tool")));
  return reply({message:scriptedModel(payload.messages||[])});
 });
 return {send,async go(url,{width=1280,height=860,scheme='light',language='zh-CN'}={}){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  await send('Page.navigate',{url:base+'/'});await sleep(400);
  await evaluate(send,`localStorage.setItem('cardybara-language',${JSON.stringify(language)});localStorage.setItem('cardybara-pet-v1',JSON.stringify({hidden:true,feeds:0,pos:null}));true`);
  await send('Page.navigate',{url:base+url});await waitFor(send,`!!document.querySelector('.app-layout')`);await sleep(1500);
 }};
}
async function evaluate(send,expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function waitFor(send,expression,ms=20000){const end=Date.now()+ms;while(Date.now()<end){try{if(await evaluate(send,expression))return;}catch{}await sleep(200);}throw Error('timed out waiting for '+expression);}
async function shot(send,name,clip){
 const r=await send('Page.captureScreenshot',{format:'webp',quality:86,captureBeyondViewport:!!clip,...(clip?{clip:{...clip,scale:1}}:{})});
 await writeFile(join(out,name+'.webp'),Buffer.from(r.data,'base64'));console.log('wrote site/assets/shots/'+name+'.webp');
}
async function clipOf(send,selector,pad=0){
 return evaluate(send,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'start'});const r=el.getBoundingClientRect();return {x:Math.max(0,r.x-${pad}),y:Math.max(0,r.y+scrollY-${pad}),width:r.width+${pad*2},height:r.height+${pad*2}};})()`);
}
const click=(send,text,selector='button')=>evaluate(send,`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim().includes(${JSON.stringify(text)}));if(!el)return false;el.click();return true;})()`);

// First turn: ask the wallet's own card-choice tool. Second turn: answer from the tool result only.
function scriptedModel(messages){
 const tool=[...messages].reverse().find(m=>m.role==='tool');
 const user=[...messages].reverse().find(m=>m.role==='user')?.content||'';
 const en=/[a-z]{4}/i.test(user)&&!/[一-鿿]/.test(user);
 if(!tool)return {role:'assistant',content:null,tool_calls:[{id:'call_demo',type:'function',function:{name:'choose_card',arguments:JSON.stringify({category:'dining',categorySource:'stated',amount:80,currency:'USD'})}}]};
 return {role:'assistant',content:answerFrom(JSON.parse(tool.content),en)};
}
function answerFrom(result,en){
 const pick=result.choice||{},top=(result.rows||[]).find(r=>r.card===pick.card)||{},earn=top.earn||{},pv=pick.pointValue||{};
 const rest=(result.rows||[]).map(r=>r.card).filter(c=>c&&c!==pick.card).slice(0,2);
 const value=Number.isFinite(pick.value)?`$${pick.value.toFixed(2)}`:'';
 if(en)return `Use **${pick.card}** for this $80 dinner.\n\n- Restaurants earn ${earn.rate}x ${earn.programme||'points'}: about ${earn.reward} points\n- At ${pv.cents}¢ a point (default valuation) that's worth about ${value}${rest.length?`\n\nNext best: ${rest.join(', ')}.`:''}\n\nBased on your cards' earning rules and your point valuations; limited-time offers aren't included.`;
 return `这顿 80 美元的晚餐，建议用 **${pick.card}**。\n\n- 餐厅 ${earn.rate} 倍 ${earn.programme||'积分'}：约 ${earn.reward} 点\n- 按默认估值每点 ${pv.cents} 美分，约值 ${value}${rest.length?`\n\n其次可以用：${rest.join('、')}。`:''}\n\n按你持有卡的返点规则和积分估值计算，不含限时优惠。`;
}

try{
 await cdp.send('Browser.getVersion');
 await mkdir(out,{recursive:true});
 const {send,go}=await page();
 for(const [language,suffix] of [['zh-CN','zh'],['en-US','en']]){
  await go('/#overview',{language});
  await shot(send,`overview-${suffix}`);
  await shot(send,`chooser-${suffix}`,await clipOf(send,'.purchase-chooser',16));
  await go('/#overview',{language,scheme:'dark'});
  await shot(send,`overview-dark-${suffix}`);
  await go('/#credits',{language});
  await shot(send,`credits-${suffix}`);
  await go('/#wallet',{language});
  await shot(send,`wallet-${suffix}`);
  await go('/#advisor',{language});
  await waitFor(send,`!!document.querySelector('.chat-x textarea')&&!document.querySelector('.chat-x textarea').disabled`);
  const q=language==='en-US'?'Which card for an $80 dinner?':'吃饭 80 美元刷哪张？';
  await evaluate(send,`document.querySelector('.chat-x textarea').focus()`);await send('Input.insertText',{text:q});
  await sleep(200);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  try{await waitFor(send,`document.querySelectorAll('.chat-bubble-assistant').length>0&&!document.querySelector('.chat-progress')`,30000);}catch(e){if(process.env.CAPTURE_DEBUG){console.error(await evaluate(send,`document.querySelector('.chat-x')?.innerText`));}throw e;}await sleep(800);
  await shot(send,`assistant-${suffix}`);
 }
}finally{
 child.kill('SIGKILL');await server.close();await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
