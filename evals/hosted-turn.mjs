// The live eval's hosted transport (stl00/Cardybara#258): a turn through the deployed gateway's `/v1/chat`, pinned to
// one Worker version with the version-override header, using the extension's own client (src/cloudChat.js) on the
// synthetic wallet. The check code in evals/live-case.mjs is shared with the own-key path; only the turn differs.
import {runCloudTurn} from '../src/cloudChat.js';
import {sseEvents} from '../src/cloudProtocol.js';
import {WALLET_TOOLS} from '../src/walletSummary.js';
import {hostedError} from '../extension-next/model-client.js';

export const EVAL_ORIGIN='chrome-extension://'+'e'.repeat(32);
export const OVERRIDE_HEADER='Cloudflare-Workers-Version-Overrides';
export const WORKER_NAME='cardybara-gateway';
export const PRODUCTION_URL='https://cardybara-gateway.cardybara.workers.dev';
export const isVersionId=v=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);

/** The transport for runCloudTurn: posts to `${base}/v1/chat` with the invite code and the version override. */
export function hostedPost({base,invite,version,fetch=globalThis.fetch,origin=EVAL_ORIGIN}){
 if(!isVersionId(version))throw Error('--version must be a Worker version id');
 if(!invite)throw Error('no invite code');
 return async(body,{signal}={})=>{
  const r=await fetch(base.replace(/\/$/,'')+'/v1/chat',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+invite,'Content-Type':'application/json',[OVERRIDE_HEADER]:`${WORKER_NAME}="${version}"`},body:JSON.stringify(body),signal});
  if(!r.ok){const code=(await r.json().catch(()=>({})))?.error?.code;throw Object.assign(Error(hostedError(code)),{gatewayCode:code});}
  return r.body;
 };
}

/**
 * A `turn` for runLiveCase. The agent runs in the Worker, so the calls are rebuilt from what the client can see:
 * the wallet calls (with arguments) from each tool_request, and the public tools (names only) from the trace.
 */
export function hostedTurn({post}){
 return async({history,memory,question,context,signal})=>{
  const wallet=[],taps=[];
  const tapped=async(body,options)=>{
   const [watch,pass]=(await post(body,options)).tee();
   taps.push((async()=>{try{for await(const e of sseEvents(watch))if(e?.type==='tool_request')for(const c of e.calls||[]){try{wallet.push({name:c.function.name,args:JSON.parse(c.function.arguments)});}catch{}}}catch{}})());
   return pass;
  };
  const r=await runCloudTurn({history,memory,question,context,signal,post:tapped});
  await Promise.all(taps);
  const publicCalls=(r.trace||[]).filter(t=>t.type==='tool'&&!WALLET_TOOLS.includes(t.name)).map(t=>({name:t.name,args:{}}));
  return {...r,calls:[...wallet,...publicCalls]};
 };
}
