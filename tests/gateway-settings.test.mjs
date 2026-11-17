import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,apiKV,deployedDefaults} from '../scripts/gateway-settings.mjs';
import {localGateway} from '../gateway/src/local.mjs';

const ORIGIN='chrome-extension://'+'a'.repeat(32);

test('the invite-code commands are gone',async()=>{
 const kv=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN}}).env.INVITES;
 for(const op of [['issue','t01'],['list'],['revoke','t01'],['restore','t01']])await assert.rejects(()=>command(kv,op),/usage: gateway-settings\.mjs caps/,op[0]);
 assert.equal(kv.data.size,0);
});
test('set-caps writes the caps the gateway reads from KV, and raising one needs --yes',async()=>{
 const g=localGateway({vars:{ALLOWED_ORIGINS:ORIGIN}}),kv=g.env.INVITES;
 const defaults=deployedDefaults();assert.deepEqual(defaults,{dailyRequests:200,dailyTokens:300000,monthlyBudgetUsd:10,models:['deepseek-flash']});
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
 const calls=[];const fetch=async(url,init={})=>{calls.push({url,init});return url.endsWith('missing')?new Response('',{status:404}):new Response('{}');};
 const kv=apiKV({token:'synthetic-token',account:'acct',namespace:'ns',fetch});
 assert.equal(await kv.get('missing'),null);await kv.put('settings','{}');
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
