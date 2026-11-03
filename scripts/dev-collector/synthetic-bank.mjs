// Dev-only: answers bank URLs from a local synthetic page so the whole flow can run through the
// real Chrome and wallet UI without contacting a bank. Interception stays off in a real run.
import {readFile} from 'node:fs/promises';
export function syntheticPrepareTab(mode){
 const file=name=>readFile(new URL('../../tests/fixtures/'+name,import.meta.url));
 const pages={'secure.chase.com':file('synthetic-bank.html'),'secure.bankofamerica.com':file('synthetic-boa.html'),'www.bankofamerica.com':file('synthetic-boa.html'),'retail.sc.com':file('synthetic-sc-hk.html'),'www.sc.com':file('synthetic-sc-hk.html')};
 const blocked=mode==='blocked';
 const seen=new WeakSet();
 return async(conn,sessionId)=>{
  if(!seen.has(conn)){
   seen.add(conn);
   conn.on('event',async(method,params,session)=>{
    if(method!=='Fetch.requestPaused')return;
    await conn.send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:blocked?403:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'},...(mode==='csp'?[{name:'Content-Security-Policy',value:"script-src 'none'; style-src 'none'"}]:[])],body:(blocked?Buffer.from('<title>Access Denied</title>Synthetic block'):await (pages[new URL(params.request.url).hostname]||pages['secure.chase.com'])).toString('base64')},session).catch(()=>{});
   });
  }
  await conn.send('Fetch.enable',{patterns:[{urlPattern:'https://*/*'}]},sessionId);
 };
}
