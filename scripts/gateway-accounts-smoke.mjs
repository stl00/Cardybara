#!/usr/bin/env node
// Account routes end to end against a running gateway (#412): sign up, verify with the mailed code (and a wrong code
// after it), sign in, a wrong password, the wallet revision check and size cap, password reset revoking the old
// session, account deletion and the per-email lockout. Synthetic data only: fresh throwaway emails per run, synthetic
// passwords and an empty wallet document.
//
//   node scripts/gateway-accounts-smoke.mjs http://127.0.0.1:8798 --mail-dir gateway/.wrangler/tmp/email
//       `wrangler dev --env local`: wrangler writes each send_email message to a file under that folder; the code is
//       read from the newest one. Nothing is mailed.
//   node scripts/gateway-accounts-smoke.mjs https://<gateway> --email <test mailbox> --origin https://cardybara.dev
//       Production: real mails go to the test mailbox and the script asks for each 6-digit code on the terminal.
// Prints one line per step (route, status, pass/fail), never the code, the password or a token.
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {migrateWalletDocument} from '../src/walletDocument.js';

const argv=process.argv.slice(2),base=(argv[0]||'').replace(/\/$/,'');
const opt=name=>{const i=argv.indexOf('--'+name);return i>=0?argv[i+1]:undefined;};
if(!/^https?:\/\//.test(base)){console.error('usage: gateway-accounts-smoke.mjs <gateway url> [--mail-dir dir | --email addr] [--origin origin]');process.exit(2);}
const mailDir=opt('mail-dir'),origin=opt('origin')||'http://127.0.0.1:8776';
const email=opt('email')||`smoke.${Date.now().toString(36)}@example.test`;
const password='synthetic-smoke-pass-1',newPassword='synthetic-smoke-pass-2';
if(!mailDir&&!opt('email')){console.error('give --mail-dir (local) or --email (a test mailbox you can read)');process.exit(2);}

const call=async(method,path,body,token)=>{
 const r=await fetch(base+path,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 let json=null;try{json=await r.json();}catch{}
 return {status:r.status,json};
};
const mailFiles=()=>{
 const out=[];const walk=d=>{let names=[];try{names=readdirSync(d);}catch{return;}for(const n of names){const p=join(d,n),s=statSync(p);if(s.isDirectory())walk(p);else if(n.endsWith('.txt'))out.push({p,t:s.mtimeMs});}};
 walk(mailDir);return out;
};
let seen=new Set(mailDir?mailFiles().map(f=>f.p):[]);
async function nextCode(what){
 if(mailDir){
  for(let i=0;i<50;i++){
   const fresh=mailFiles().filter(f=>!seen.has(f.p)).sort((a,b)=>b.t-a.t);
   if(fresh.length){fresh.forEach(f=>seen.add(f.p));const code=/\b(\d{6})\b/.exec(readFileSync(fresh[0].p,'utf8'))?.[1];if(code)return code;}
   await new Promise(r=>setTimeout(r,100));
  }
  throw Error('no mail with a code under '+mailDir);
 }
 const rl=createInterface({input:process.stdin,output:process.stdout});
 const code=(await rl.question(`6-digit ${what} code mailed to the test mailbox: `)).trim();rl.close();return code;
}

let failed=0;
const check=(step,r,want,extra=true)=>{const ok=r.status===want&&extra;if(!ok)failed++;console.log(`${ok?'pass':'FAIL'}  ${step}  ${r.status}${ok?'':` (want ${want}${r.json?.error?.code?', got '+r.json.error.code:''})`}`);return ok;};

const signup=await call('POST','/v2/account/signup',{email,password});
check('POST signup',signup,202,signup.json?.status==='code_sent');
const verified=await call('POST','/v2/account/verify',{email,code:await nextCode('sign-up')});
check('POST verify',verified,200,/^cbs_/.test(verified.json?.token||''));
let token=verified.json?.token;
const reused=await call('POST','/v2/account/verify',{email,code:'000000'});
check('POST verify, wrong code after use',reused,400,['code_invalid','code_expired'].includes(reused.json?.error?.code));
const wrong=await call('POST','/v2/account/session',{email,password:'synthetic-wrong-pass'});
check('POST session, wrong password',wrong,401,wrong.json?.error?.code==='invalid_credentials');
const signedIn=await call('POST','/v2/account/session',{email,password});
check('POST session',signedIn,200,/^cbs_/.test(signedIn.json?.token||''));
const empty=await call('GET','/v2/account/wallet',undefined,token);
check('GET wallet (empty)',empty,200,empty.json?.revision===0&&empty.json?.document===null);
const document=migrateWalletDocument({});
const put=await call('PUT','/v2/account/wallet',{baseRevision:0,formatVersion:document.formatVersion??1,document},token);
check('PUT wallet',put,200,put.json?.revision===1);
const stale=await call('PUT','/v2/account/wallet',{baseRevision:0,formatVersion:document.formatVersion??1,document},token);
check('PUT wallet, stale revision',stale,409,stale.json?.error?.code==='stale_revision');
const big={...document,cards:[{id:'synthetic-big',note:'x'.repeat(600*1024)}]};
check('PUT wallet, over WALLET_MAX_BYTES',await call('PUT','/v2/account/wallet',{baseRevision:1,formatVersion:document.formatVersion??1,document:big},token),413);
check('POST password/forgot',await call('POST','/v2/account/password/forgot',{email}),202);
const reset=await call('POST','/v2/account/password/reset',{email,code:await nextCode('reset'),password:newPassword});
check('POST password/reset',reset,200,/^cbs_/.test(reset.json?.token||''));
check('GET wallet with the pre-reset session',await call('GET','/v2/account/wallet',undefined,token),401);
token=reset.json?.token;
check('DELETE account',await call('DELETE','/v2/account',{password:newPassword},token),200);
check('POST session after delete',await call('POST','/v2/account/session',{email,password:newPassword}),401);
// Lockout on a second throwaway address (the per-email limit applies whether or not an account exists).
const locked=`smoke.lock.${Date.now().toString(36)}@example.test`;
for(let i=0;i<5;i++)await call('POST','/v2/account/session',{email:locked,password:'synthetic-wrong-pass'});
const sixth=await call('POST','/v2/account/session',{email:locked,password:'synthetic-wrong-pass'});
check('POST session, 6th failure in 15 min',sixth,429,sixth.json?.error?.code==='account_locked');
console.log(failed?`${failed} step(s) failed`:'all steps passed');
process.exit(failed?1:0);
