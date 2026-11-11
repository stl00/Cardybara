#!/usr/bin/env node
// Invite codes and caps for the hosted gateway (docs/GATEWAY.md). KV holds only the SHA-256 digest of a code;
// a new code is printed once, here, and is never stored or shown again.
//
//   node scripts/gateway-codes.mjs issue <tester-id> [--daily-requests N] [--daily-tokens N]
//   node scripts/gateway-codes.mjs list
//   node scripts/gateway-codes.mjs revoke <tester-id>
//   node scripts/gateway-codes.mjs restore <tester-id>
//   node scripts/gateway-codes.mjs caps                      # show the global caps in KV
//   node scripts/gateway-codes.mjs set-caps [--daily-requests N] [--daily-tokens N] [--monthly-usd X]
//
// Backend: the Cloudflare API when CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CARDYBARA_KV_NAMESPACE_ID
// are set; otherwise wrangler (logged in) with gateway/wrangler.jsonc. Tester ids are short labels such as
// t01, not names: they appear in the gateway's logs.
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const PREFIX='invite:',SETTINGS='settings',ID=/^[a-z0-9-]{1,32}$/;
export const newCode=()=>'cdy_'+randomBytes(32).toString('base64url');
export const digest=code=>createHash('sha256').update(code).digest('hex');

export function apiKV({token,account,namespace,fetch=globalThis.fetch}){
 const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/storage/kv/namespaces/${encodeURIComponent(namespace)}`;
 const headers={Authorization:'Bearer '+token};
 const check=async(r,what)=>{if(!r.ok)throw Error(`Cloudflare API ${what} failed with ${r.status}`);return r;};
 return {
  async get(key){const r=await fetch(`${base}/values/${encodeURIComponent(key)}`,{headers});if(r.status===404)return null;return (await check(r,'get')).text();},
  async put(key,value){await check(await fetch(`${base}/values/${encodeURIComponent(key)}`,{method:'PUT',headers:{...headers,'Content-Type':'text/plain'},body:value}),'put');},
  async list(prefix){const names=[];let cursor='';do{const r=await check(await fetch(`${base}/keys?prefix=${encodeURIComponent(prefix)}${cursor?'&cursor='+encodeURIComponent(cursor):''}`,{headers}),'list');const j=await r.json();names.push(...j.result.map(k=>k.name));cursor=j.result_info?.cursor||'';}while(cursor);return names;},
 };
}
export function wranglerKV({config=resolve(fileURLToPath(new URL('..',import.meta.url)),'gateway/wrangler.jsonc')}={}){
 const run=args=>execFileSync('npx',['--yes','wrangler@4.150.0','kv','key',...args,'--binding','INVITES','--remote','--config',config],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 return {
  async get(key){try{return run(['get',key,'--text']);}catch(e){if(/not found/i.test(String(e.stderr)))return null;throw Error('wrangler kv get failed');}},
  async put(key,value){run(['put',key,value]);},
  async list(prefix){return JSON.parse(run(['list','--prefix',prefix])).map(k=>k.name);},
 };
}

const whole=(v,flag)=>{if(v==null)return undefined;if(!/^\d+$/.test(v))throw Error(flag+' must be a whole number');return Number(v);};
async function invites(kv){
 const out=[];
 for(const name of await kv.list(PREFIX)){const raw=await kv.get(name);if(!raw)continue;try{out.push({key:name,record:JSON.parse(raw)});}catch{}}
 return out;
}
/** Runs one command against a KV backend; returns the lines to print. */
export async function command(kv,argv){
 const args=[...argv],take=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;const v=args[i+1];if(v==null||v.startsWith('--'))throw Error(flag+' needs a value');args.splice(i,2);return v;};
 const op=args.shift();
 if(op==='issue'){
  const dailyRequests=whole(take('--daily-requests'),'--daily-requests'),dailyTokens=whole(take('--daily-tokens'),'--daily-tokens'),id=args[0];
  if(!id||!ID.test(id))throw Error('issue <tester-id>: a-z, 0-9 and -, up to 32 characters');
  if((await invites(kv)).some(i=>i.record.id===id&&i.record.status==='active'))throw Error(`${id} already has an active code; revoke it first`);
  const code=newCode(),hash=digest(code);
  await kv.put(PREFIX+hash,JSON.stringify({hash,id,status:'active',issued:new Date().toISOString().slice(0,10),...(dailyRequests!=null?{dailyRequests}:{}),...(dailyTokens!=null?{dailyTokens}:{})}));
  return [`Invite code for ${id}. Give it to the tester privately; it is not stored and will not be shown again:`,'',`  ${code}`,''];
 }
 if(op==='list'){
  const all=await invites(kv);if(!all.length)return ['No invite codes.'];
  return all.sort((a,b)=>String(a.record.id).localeCompare(b.record.id)).map(({record:r})=>[r.id,r.status,r.issued||'',r.dailyRequests!=null?`requests/day ${r.dailyRequests}`:'',r.dailyTokens!=null?`tokens/day ${r.dailyTokens}`:'',`digest ${String(r.hash).slice(0,8)}…`].filter(Boolean).join('  '));
 }
 if(op==='revoke'||op==='restore'){
  const id=args[0];if(!id||!ID.test(id))throw Error(op+' <tester-id>');
  const want=op==='revoke'?'revoked':'active',hits=(await invites(kv)).filter(i=>i.record.id===id);
  if(!hits.length)throw Error('no code for '+id);
  for(const {key,record} of hits)await kv.put(key,JSON.stringify({...record,status:want}));
  return [`${id}: ${hits.length} code(s) ${want}. Workers KV can take about a minute to reach every location.`];
 }
 if(op==='caps'){const raw=await kv.get(SETTINGS);return [raw?raw.trim():'No caps in KV; the deployed vars apply.'];}
 if(op==='set-caps'){
  const next={...JSON.parse(await kv.get(SETTINGS)||'{}')};
  const r=whole(take('--daily-requests'),'--daily-requests'),t=whole(take('--daily-tokens'),'--daily-tokens'),m=take('--monthly-usd');
  if(r!=null)next.dailyRequests=r;if(t!=null)next.dailyTokens=t;
  if(m!=null){const usd=Number(m);if(!(usd>=0)||!Number.isFinite(usd))throw Error('--monthly-usd must be a number of dollars');next.monthlyBudgetUsd=usd;}
  if(r==null&&t==null&&m==null)throw Error('set-caps needs --daily-requests, --daily-tokens or --monthly-usd');
  await kv.put(SETTINGS,JSON.stringify(next));
  return ['Caps now: '+JSON.stringify(next)];
 }
 throw Error('usage: gateway-codes.mjs issue <id> [--daily-requests N] [--daily-tokens N] | list | revoke <id> | restore <id> | caps | set-caps [--daily-requests N] [--daily-tokens N] [--monthly-usd X]');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,CARDYBARA_KV_NAMESPACE_ID:namespace}=process.env;
 const kv=token&&account&&namespace?apiKV({token,account,namespace}):wranglerKV();
 command(kv,process.argv.slice(2)).then(lines=>{console.log(lines.join('\n'));},e=>{console.error(e.message);process.exit(2);});
}
