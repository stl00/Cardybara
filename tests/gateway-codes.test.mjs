import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,digest,apiKV,deployedDefaults} from '../scripts/gateway-codes.mjs';
import {localGateway} from '../gateway/src/local.mjs';
import {INVITE_PATTERN,ROUTES} from '../gateway/src/gateway.js';

const ORIGIN='chrome-extension://'+'a'.repeat(32);
const invite=(g,code)=>g.handle(new Request('https://gateway.test'+ROUTES.invite,{method:'POST',headers:{Origin:ORIGIN,Authorization:'Bearer '+code}}));

test('issue prints a new code once, stores only its digest, and the gateway accepts it until revoked',async()=>{
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN}}),kv=g.env.INVITES;
 const out=(await command(kv,['issue','t01','--daily-requests','50'])).join('\n');
 const code=out.match(/cdy_[A-Za-z0-9_-]+/g);assert.equal(code.length,1,'printed once');assert.match(code[0],INVITE_PATTERN);
 const stored=[...kv.data.entries()];assert.equal(stored.length,1);
 assert.equal(stored[0][0],'invite:'+digest(code[0]));assert.ok(!JSON.stringify(stored).includes(code[0]),'the code itself is not stored');
 assert.equal(JSON.parse(stored[0][1]).dailyRequests,50);
 assert.equal((await invite(g,code[0])).status,200);
 await assert.rejects(()=>command(kv,['issue','t01']),/already has an active code/);
 const list=(await command(kv,['list'])).join('\n');assert.match(list,/t01\s+active/);assert.ok(!list.includes(code[0]));
 await command(kv,['revoke','t01']);assert.equal((await invite(g,code[0])).status,403);
 await command(kv,['restore','t01']);assert.equal((await invite(g,code[0])).status,200);
 await assert.rejects(()=>command(kv,['issue','Tester Name']),/tester-id/);await assert.rejects(()=>command(kv,['revoke','t99']),/no code/);
});
test('set-caps writes the global caps the gateway reads from KV, and raising one needs --yes',async()=>{
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN}}),kv=g.env.INVITES;
 const defaults=deployedDefaults();assert.deepEqual(defaults,{dailyRequests:200,dailyTokens:300000,monthlyBudgetUsd:10});
 await assert.rejects(()=>command(kv,['set-caps','--monthly-usd','1000'],{defaults}),/raises monthlyBudgetUsd from 10 to 1000.*--yes/);
 assert.equal(await kv.get('settings'),null,'nothing written without --yes');
 await command(kv,['set-caps','--monthly-usd','1000','--yes'],{defaults});assert.equal(JSON.parse(await kv.get('settings')).monthlyBudgetUsd,1000);
 await command(kv,['set-caps','--monthly-usd','0'],{defaults});assert.equal(JSON.parse(await kv.get('settings')).monthlyBudgetUsd,0,'lowering never needs --yes');
 await kv.delete('settings');
 await command(kv,['set-caps','--daily-requests','1','--monthly-usd','2.5']);
 assert.deepEqual(JSON.parse(await kv.get('settings')),{dailyRequests:1,monthlyBudgetUsd:2.5});
 await command(kv,['set-caps','--daily-tokens','1000']);assert.deepEqual(JSON.parse(await kv.get('settings')),{dailyRequests:1,monthlyBudgetUsd:2.5,dailyTokens:1000});
 for(const bad of [['set-caps'],['set-caps','--daily-requests','-1'],['set-caps','--monthly-usd','lots'],['set-caps','--daily-requests']])await assert.rejects(()=>command(kv,bad),Error,bad.join(' '));
});
test('the API backend talks only to the KV namespace it was given',async()=>{
 const calls=[];const fetch=async(url,init={})=>{calls.push({url,init});return url.includes('/keys?')?new Response(JSON.stringify({result:[{name:'invite:x'}],result_info:{cursor:''}})):url.endsWith('missing')?new Response('',{status:404}):new Response('{}');};
 const kv=apiKV({token:'synthetic-token',account:'acct',namespace:'ns',fetch});
 assert.deepEqual(await kv.list('invite:'),['invite:x']);assert.equal(await kv.get('missing'),null);await kv.put('settings','{}');
 for(const c of calls){assert.ok(c.url.startsWith('https://api.cloudflare.com/client/v4/accounts/acct/storage/kv/namespaces/ns/'));assert.equal(c.init.headers.Authorization,'Bearer synthetic-token');}
 assert.equal(calls.at(-1).init.method,'PUT');
});
test('gateway-set-key.sh pipes the key to wrangler and never prints it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-setkey-')),key='synthetic-model-key-'+'7'.repeat(20);
 writeFileSync(join(dir,'model.env'),`OTHER=1\nDEEPSEEK_API_KEY="${key}"\n`);
 // A stand-in npx that records its arguments and stdin.
 writeFileSync(join(dir,'npx'),`#!/bin/sh\necho "$@" > "${dir}/args"\ncat > "${dir}/stdin"\n`);chmodSync(join(dir,'npx'),0o755);
 const out=execFileSync('bash',['scripts/gateway-set-key.sh'],{env:{...process.env,PATH:dir+':'+process.env.PATH,CARDYBARA_MODEL_CONFIG:join(dir,'model.env')},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.ok(!out.includes(key));assert.equal(readFileSync(join(dir,'stdin'),'utf8'),key);
 assert.match(readFileSync(join(dir,'args'),'utf8'),/wrangler@[\d.]+ secret put PROVIDER_KEY --config .*gateway\/wrangler\.jsonc/);
 // A dedicated gateway key is preferred over the personal one.
 const gatewayKey='synthetic-gateway-key-'+'8'.repeat(20);writeFileSync(join(dir,'both.env'),`DEEPSEEK_API_KEY=${key}\nDEEPSEEK_GATEWAY_API_KEY='${gatewayKey}'\n`);
 const out2=execFileSync('bash',['scripts/gateway-set-key.sh'],{env:{...process.env,PATH:dir+':'+process.env.PATH,CARDYBARA_MODEL_CONFIG:join(dir,'both.env')},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.ok(!out2.includes(gatewayKey));assert.equal(readFileSync(join(dir,'stdin'),'utf8'),gatewayKey);
 writeFileSync(join(dir,'empty.env'),'OTHER=1\n');
 assert.throws(()=>execFileSync('bash',['scripts/gateway-set-key.sh'],{env:{...process.env,PATH:dir+':'+process.env.PATH,CARDYBARA_MODEL_CONFIG:join(dir,'empty.env')},stdio:'pipe'}));
});
