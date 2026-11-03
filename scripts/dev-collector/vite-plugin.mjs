// Dev-only: connects the Vite page to the collector service. apply:'serve' keeps this out of
// `vite build`, and nothing under scripts/ is packaged (scripts/audit-release.py enforces both).
import {fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const COLLECTOR_ROUTE='/__cardybara/collector/';
const here=fileURLToPath(new URL('.',import.meta.url)),extensionDir=fileURLToPath(new URL('../../extension-next/',import.meta.url));
const MAX_BODY=20000,REPLY_TIMEOUT=60000;

export function collectorGuard(req,port){
 const hosts=['127.0.0.1:'+port,'localhost:'+port];
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))return 'not_loopback';
 if(!hosts.includes(req.headers.host))return 'invalid_host';
 if(req.headers.origin&&!hosts.some(h=>req.headers.origin==='http://'+h))return 'origin_not_allowed';
 if(!['same-origin','none',undefined].includes(req.headers['sec-fetch-site']))return 'cross_site';
 return null;
}
export function watchedSource(file){return file.endsWith('.js')&&file.startsWith(extensionDir)||file.endsWith('.mjs')&&file.startsWith(here);}

export function collectorPlugin({forkService=fork,env=process.env}={}){
 return {
  name:'cardybara-dev-collector',apply:'serve',
  transformIndexHtml(){return env.CARDYBARA_DEV_COLLECTOR==='0'?[]:[{tag:'script',attrs:{type:'module',src:COLLECTOR_ROUTE+'bridge.js'},injectTo:'head-prepend'}];},
  configureServer(server){
   if(env.CARDYBARA_DEV_COLLECTOR==='0')return;
   const port=server.config.server.port,clients=new Set(),waiting=new Map();let child=null,nextId=1,stopping=false,timer=null,delay=1000;
   const broadcast=m=>{for(const res of clients)res.write('data: '+JSON.stringify(m)+'\n\n');};
   const fail=()=>{for(const respond of waiting.values())respond({ok:false,errorCode:'collector_restarting'});waiting.clear();};
   const start=()=>{
    const current=forkService(fileURLToPath(new URL('./service.mjs',import.meta.url)),[],{env:{...env,CARDYBARA_DEV_ORIGIN:'http://127.0.0.1:'+port}});
    child=current;current.on('error',()=>{});
    current.on('message',m=>{
     if(m.event==='reply'){waiting.get(m.id)?.(m.result);waiting.delete(m.id);}
     else if(m.event==='wallet')broadcast(m.message);
     else if(m.event==='ready'){delay=1000;broadcast({restarted:true});}
    });
    current.on('exit',()=>{if(child!==current)return;child=null;fail();if(!stopping){timer=setTimeout(start,delay);delay=Math.min(delay*2,30000);}});
   };
   const restart=()=>{clearTimeout(timer);delay=1000;const old=child;child=null;fail();old?.removeAllListeners('exit');old?.kill();start();};
   let debounce=null;
   server.watcher.on('change',file=>{if(watchedSource(file)){clearTimeout(debounce);debounce=setTimeout(restart,150);}});
   server.httpServer?.once('close',()=>{stopping=true;clearTimeout(timer);clearTimeout(debounce);child?.kill();});
   start();
   server.middlewares.use(async(req,res,next)=>{
    if(!req.url?.startsWith(COLLECTOR_ROUTE))return next();
    const reject=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error}));};
    const refused=collectorGuard(req,port);if(refused)return reject(403,refused);
    const route=req.url.slice(COLLECTOR_ROUTE.length).split('?')[0];
    if(route==='bridge.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(new URL('./page-bridge.js',import.meta.url)));return;}
    if(route==='events'&&req.method==='GET'){
     res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.write(':ok\n\n');
     clients.add(res);req.on('close',()=>clients.delete(res));return;
    }
    if(route==='message'&&req.method==='POST'){
     if(req.headers['x-cardybara-client']!=='dev-collector'||!req.headers['content-type']?.startsWith('application/json'))return reject(400,'invalid_request');
     let body='';for await(const chunk of req){body+=chunk;if(body.length>MAX_BODY)return reject(413,'payload_too_large');}
     let message;try{message=JSON.parse(body);}catch{return reject(400,'invalid_request');}
     if(!child?.connected)return reject(503,'collector_starting');
     const id=nextId++;
     const answer=setTimeout(()=>{if(waiting.delete(id)){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:false,errorCode:'collector_unavailable'}));}},REPLY_TIMEOUT);
     waiting.set(id,result=>{clearTimeout(answer);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));});
     child.send({id,message},()=>{});return;
    }
    reject(404,'not_found');
   });
  }
 };
}
