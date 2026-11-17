#!/usr/bin/env node
// Caps and switches for the hosted gateway (docs/GATEWAY.md), in its KV `settings` key. There are no invite codes
// any more (owner decision 2026-11-16); this was scripts/gateway-codes.mjs.
//
//   node scripts/gateway-settings.mjs caps                      # show the caps in KV
//   node scripts/gateway-settings.mjs set-caps [--daily-requests N] [--daily-tokens N] [--monthly-usd X] [--daily-usd X] [--yes]
//                                  (daily caps are per client; raising any cap above its current value needs --yes)
//   node scripts/gateway-settings.mjs switches                  # show the KV switches
//   node scripts/gateway-settings.mjs set-switch disabledTools <tool,tool>|forceModel <model>|assistantOff on|off
//   node scripts/gateway-settings.mjs clear-switch disabledTools|forceModel|assistantOff
//
// Backend: the Cloudflare API when CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and CARDYBARA_KV_NAMESPACE_ID
// are set; otherwise wrangler (logged in) with gateway/wrangler.jsonc.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {parseSwitches,SWITCH_KEYS} from '../gateway/src/switches.js';

const SETTINGS='settings';

export function apiKV({token,account,namespace,fetch=globalThis.fetch}){
 const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/storage/kv/namespaces/${encodeURIComponent(namespace)}`;
 const headers={Authorization:'Bearer '+token};
 const check=async(r,what)=>{if(!r.ok)throw Error(`Cloudflare API ${what} failed with ${r.status}`);return r;};
 return {
  async get(key){const r=await fetch(`${base}/values/${encodeURIComponent(key)}`,{headers});if(r.status===404)return null;return (await check(r,'get')).text();},
  async put(key,value){await check(await fetch(`${base}/values/${encodeURIComponent(key)}`,{method:'PUT',headers:{...headers,'Content-Type':'text/plain'},body:value}),'put');},
 };
}
export function wranglerKV({config=resolve(fileURLToPath(new URL('..',import.meta.url)),'gateway/wrangler.jsonc')}={}){
 const run=args=>execFileSync('npx',['--yes','wrangler@4.150.0','kv','key',...args,'--binding','INVITES','--remote','--config',config],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 return {
  async get(key){try{return run(['get',key,'--text']);}catch(e){if(/not found/i.test(String(e.stderr)))return null;throw Error('wrangler kv get failed');}},
  async put(key,value){run(['put',key,value]);},
 };
}

/** The caps in gateway/wrangler.jsonc vars, which apply while KV has none. */
export function deployedDefaults(file=resolve(fileURLToPath(new URL('..',import.meta.url)),'gateway/wrangler.jsonc')){
 try{
  const vars=JSON.parse(readFileSync(file,'utf8').replace(/^\s*\/\/.*$/gm,'')).vars||{};
  return {dailyRequests:Number(vars.DAILY_REQUESTS_PER_CLIENT),dailyTokens:Number(vars.DAILY_TOKENS_PER_CLIENT),monthlyBudgetUsd:Number(vars.MONTHLY_BUDGET_USD),models:String(vars.ALLOWED_MODELS||'').split(',').map(m=>m.trim()).filter(Boolean)};
 }catch{return {};}
}
const whole=(v,flag)=>{if(v==null)return undefined;if(!/^\d+$/.test(v))throw Error(flag+' must be a whole number');return Number(v);};
/** Runs one command against a KV backend; returns the lines to print. */
export async function command(kv,argv,{defaults={}}={}){
 const args=[...argv],take=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;const v=args[i+1];if(v==null||v.startsWith('--'))throw Error(flag+' needs a value');args.splice(i,2);return v;};
 const op=args.shift();
 if(op==='caps'){const raw=await kv.get(SETTINGS);return [raw?raw.trim():'No caps in KV; the deployed vars apply.'];}
 if(op==='set-caps'){
  const next={...JSON.parse(await kv.get(SETTINGS)||'{}')};
  const r=whole(take('--daily-requests'),'--daily-requests'),t=whole(take('--daily-tokens'),'--daily-tokens'),m=take('--monthly-usd'),dd=take('--daily-usd');
  if(r!=null)next.dailyRequests=r;if(t!=null)next.dailyTokens=t;
  const dollars=(v,flag)=>{const usd=Number(v);if(!(usd>=0)||!Number.isFinite(usd))throw Error(flag+' must be a number of dollars');return usd;};
  if(m!=null)next.monthlyBudgetUsd=dollars(m,'--monthly-usd');
  if(dd!=null)next.dailyBudgetUsd=dollars(dd,'--daily-usd');
  if(r==null&&t==null&&m==null&&dd==null)throw Error('set-caps needs --daily-requests, --daily-tokens, --monthly-usd or --daily-usd');
  // A typo can multiply spend, so raising a cap above what applies now must be confirmed.
  const yes=args.includes('--yes'),before={...defaults,...JSON.parse(await kv.get(SETTINGS)||'{}')};
  // An unset daily budget is the monthly one / 30.
  if(before.dailyBudgetUsd==null&&before.monthlyBudgetUsd!=null)before.dailyBudgetUsd=before.monthlyBudgetUsd/30;
  const raised=['dailyRequests','dailyTokens','monthlyBudgetUsd','dailyBudgetUsd'].filter(k=>next[k]!=null&&before[k]!=null&&next[k]>before[k]);
  if(raised.length&&!yes)throw Error('This raises '+raised.map(k=>`${k} from ${before[k]} to ${next[k]}`).join(', ')+'. Run again with --yes to confirm.');
  await kv.put(SETTINGS,JSON.stringify(next));
  return ['Caps now: '+JSON.stringify(next)];
 }
 if(op==='switches'){
  const raw=JSON.parse(await kv.get(SETTINGS)||'{}'),shown=Object.fromEntries(SWITCH_KEYS.filter(k=>k in raw).map(k=>[k,raw[k]]));
  const {invalid}=parseSwitches(raw,defaults.models||[]);
  return [Object.keys(shown).length?JSON.stringify(shown):'No switches set.',...(invalid.length?['Ignored by the gateway as invalid: '+invalid.join(', ')]:[])];
 }
 if(op==='set-switch'){
  const name=args.shift(),value=args.shift();
  if(!SWITCH_KEYS.includes(name)||value==null)throw Error('set-switch disabledTools <tool,tool> | forceModel <model> | assistantOff on|off');
  const parsed=name==='disabledTools'?value.split(',').map(v=>v.trim()).filter(Boolean):name==='assistantOff'?(value==='on'?true:value==='off'?false:value):value;
  // The same check the gateway applies on each request, so a value that would be ignored is refused here.
  if(name==='forceModel'&&!(defaults.models||[]).length)throw Error('forceModel needs ALLOWED_MODELS from gateway/wrangler.jsonc, which could not be read');
  const {invalid}=parseSwitches({[name]:parsed},defaults.models||[]);
  if(invalid.length)throw Error(name==='forceModel'?'forceModel must be one of ALLOWED_MODELS ('+defaults.models.join(', ')+')':name==='assistantOff'?'assistantOff takes on or off':'disabledTools takes tool names: a-z, 0-9 and _, separated by commas');
  const next={...JSON.parse(await kv.get(SETTINGS)||'{}'),[name]:parsed};
  await kv.put(SETTINGS,JSON.stringify(next));
  return [`${name} is now ${JSON.stringify(parsed)}. KV can take about a minute, and the gateway caches it for 30 seconds.`];
 }
 if(op==='clear-switch'){
  const name=args[0];if(!SWITCH_KEYS.includes(name))throw Error('clear-switch disabledTools | forceModel | assistantOff');
  const next={...JSON.parse(await kv.get(SETTINGS)||'{}')};delete next[name];
  await kv.put(SETTINGS,JSON.stringify(next));
  return [name+' cleared.'];
 }
 throw Error('usage: gateway-settings.mjs caps | set-caps [--daily-requests N] [--daily-tokens N] [--monthly-usd X] [--daily-usd X] | switches | set-switch <name> <value> | clear-switch <name>');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,CARDYBARA_KV_NAMESPACE_ID:namespace}=process.env;
 const kv=token&&account&&namespace?apiKV({token,account,namespace}):wranglerKV();
 command(kv,process.argv.slice(2),{defaults:deployedDefaults()}).then(lines=>{console.log(lines.join('\n'));},e=>{console.error(e.message);process.exit(2);});
}
