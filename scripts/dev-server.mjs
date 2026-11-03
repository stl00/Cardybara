// Loopback-only development wallet and credential-holding parser proxy.
// .env.local is never served, logged, or bundled into the extension.
import http from 'node:http';
import {chatAgent,validateChat} from './chat-agent.mjs';
import {parseAdvisorIntent} from './advisor-model.mjs';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {modelRequest,validateModel} from '../extension-next/agent-core.js';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),dist=resolve(root,'dist');
const env={};for(const line of (await readFile(process.env.CARDYBARA_MODEL_CONFIG||resolve(root,'.env.local'),'utf8').catch(()=>'')).split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
export function createWalletHandler({port=Number(process.env.CARDYBARA_DEV_PORT||8766),staticFiles=true}={}){
const allowed=new Set(['http://127.0.0.1:'+port,'http://localhost:'+port,...(env.CARDYBARA_EXTENSION_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.zip':'application/zip'};
let active=0;
return async(req,res)=>{
 const origin=req.headers.origin;
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
 try{
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){json(403,{error:'invalid_host'});return;}
  if(req.url.startsWith('/api/')){
   if(origin&&!allowed.has(origin)){json(403,{error:'origin_not_allowed'});return;}
   if(origin)res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
   if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Cardybara-Client','Access-Control-Max-Age':'600'});res.end();return;}
   if(req.method==='GET'&&req.url==='/api/parser/status'){json(200,{configured:!!env.DEEPSEEK_API_KEY,provider:'deepseek',model:env.DEEPSEEK_MODEL||'deepseek-flash',processing:'cloud-via-loopback',requiresKeyInput:false});return;}
   if(req.url==='/api/advisor/chat'){
    if(req.method!=='POST'||req.headers['x-cardybara-client']!=='extension'||!req.headers['content-type']?.startsWith('application/json')){json(400,{error:'invalid_request'});return;}
    if(active>=1){json(429,{error:'model_busy'});return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>180000){json(413,{error:'payload_too_large'});return;}}
    let payload;try{payload=JSON.parse(body);validateChat(payload);}catch{json(400,{error:'invalid_chat'});return;}
    const controller=new AbortController();res.on('close',()=>controller.abort());
    active++;try{json(200,{message:await chatAgent(env,payload,fetch,controller.signal)});}finally{active--;}return;
   }
   if(req.url==='/api/advisor/intent'){
    if(req.method!=='POST'||req.headers['x-cardybara-client']!=='extension'||!req.headers['content-type']?.startsWith('application/json')){json(400,{error:'invalid_request'});return;}
    if(active>=1){json(429,{error:'model_busy'});return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>8000){json(413,{error:'payload_too_large'});return;}}
    const payload=JSON.parse(body);if(Object.keys(payload).some(k=>k!=='question')||typeof payload.question!=='string'||payload.question.length<1||payload.question.length>1500){json(400,{error:'invalid_question'});return;}
    active++;try{json(200,{intent:await parseAdvisorIntent(env,payload.question),provider:'deepseek',walletSent:false});}finally{active--;}return;
   }
   if(req.method!=='POST'||req.url!=='/api/parser/parse'||req.headers['x-cardybara-client']!=='extension'||!req.headers['content-type']?.startsWith('application/json')){json(400,{error:'invalid_request'});return;}
   if(!env.DEEPSEEK_API_KEY){json(503,{error:'model_not_configured'});return;}
   if(env.DEEPSEEK_BASE_URL&&env.DEEPSEEK_BASE_URL.replace(/\/$/,'')!=='https://api.deepseek.com'){json(503,{error:'unexpected_model_destination'});return;}
   if(active>=1){json(429,{error:'parser_busy'});return;}
   let text='';for await(const chunk of req){text+=chunk;if(text.length>100000){json(413,{error:'payload_too_large'});return;}}
   const {snapshot}=JSON.parse(text);
   if(!snapshot||!Array.isArray(snapshot.blocks)||snapshot.blocks.length>60||!Array.isArray(snapshot.aliases)||snapshot.aliases.length>40||!Array.isArray(snapshot.links)||snapshot.links.length>12||snapshot.blocks.some(b=>typeof b.text!=='string'||b.text.length>1500)){json(400,{error:'invalid_snapshot'});return;}
   const request=modelRequest({provider:'deepseek',key:env.DEEPSEEK_API_KEY,model:env.DEEPSEEK_MODEL||'deepseek-flash'},snapshot);
   active++;try{
    const response=await fetch(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body),signal:AbortSignal.timeout(24000),redirect:'error'});
    if(!response.ok){json(response.status===429?429:502,{error:'model_request_failed'});return;}
    const body=await response.json(),content=body.choices?.[0]?.message?.content;
    if(typeof content!=='string'||content.length>150000)throw Error('invalid_model_output');
    const raw=JSON.parse(content);validateModel(raw,snapshot);json(200,{raw});
   }finally{active--;}
   return;
  }
  if(!staticFiles){json(404,{error:'not_found'});return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  const path=decodeURIComponent(req.url.split('?')[0]);if(path.split('/').some(x=>x.startsWith('.'))){res.writeHead(404);res.end();return;}
  const file=resolve(dist,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(dist+sep)){res.writeHead(404);res.end();return;}
  if(!(await stat(file)).isFile())throw Error('missing');
  const b=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:b);
 }catch(error){if(!res.headersSent)json(req.url.startsWith('/api/')?502:404,{error:req.url.startsWith('/api/')?'parser_failed':'not_found'});else res.end();}
};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.CARDYBARA_DEV_PORT||8766);
 const server=http.createServer(createWalletHandler({port}));
 server.listen(port,'127.0.0.1',()=>console.log('Cardybara wallet preview: http://127.0.0.1:'+port+' (model credentials stay on this machine)'));
}
