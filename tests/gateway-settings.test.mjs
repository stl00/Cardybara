import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
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
 // The daily budget: raising it above monthly / 30 needs --yes too.
 await assert.rejects(()=>command(kv,['set-caps','--daily-usd','5'],{defaults}),/raises dailyBudgetUsd/);
 await command(kv,['set-caps','--daily-usd','0.05'],{defaults});assert.equal(JSON.parse(await kv.get('settings')).dailyBudgetUsd,0.05);
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
test('gateway-set-alert-secrets.sh pipes both tokens to wrangler by name and never prints them',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cardybara-alerts-')),gh='synthetic-github-token-'+'1'.repeat(20),sql='synthetic-analytics-token-'+'2'.repeat(20);
 // A stand-in npx that stores stdin in a file named after the secret (the word after "put").
 writeFileSync(join(dir,'npx'),`#!/bin/sh\nname=""\nwhile [ $# -gt 0 ]; do if [ "$1" = put ]; then name="$2"; fi; shift; done\ncat > "${dir}/stdin-$name"\n`);chmodSync(join(dir,'npx'),0o755);
 const run=(file,extra={})=>{
  const r=spawnSync('bash',['scripts/gateway-set-alert-secrets.sh'],{env:{...process.env,PATH:dir+':'+process.env.PATH,CARDYBARA_ALERT_SECRETS:file,...extra},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return {status:r.status,out:r.stdout,err:r.stderr};
 };
 const clean=r=>{for(const v of [gh,sql]){assert.ok(!r.out.includes(v));assert.ok(!r.err.includes(v));}};
 writeFileSync(join(dir,'both.env'),`OTHER=1\nGATEWAY_GITHUB_TOKEN="${gh}"\nGATEWAY_ANALYTICS_SQL_TOKEN='${sql}'\n`);
 const ok=run(join(dir,'both.env'));
 assert.equal(ok.status,0);clean(ok);
 assert.match(ok.out,/GITHUB_TOKEN set/);assert.match(ok.out,/ANALYTICS_SQL_TOKEN set/);
 assert.equal(readFileSync(join(dir,'stdin-GITHUB_TOKEN'),'utf8'),gh);
 assert.equal(readFileSync(join(dir,'stdin-ANALYTICS_SQL_TOKEN'),'utf8'),sql);
 // A name missing from the file is skipped and reported by name only; the other is still set.
 writeFileSync(join(dir,'one.env'),`GATEWAY_GITHUB_TOKEN=${gh}\n`);
 rmSync(join(dir,'stdin-ANALYTICS_SQL_TOKEN'));
 const one=run(join(dir,'one.env'));
 assert.equal(one.status,0);clean(one);assert.match(one.err,/No usable GATEWAY_ANALYTICS_SQL_TOKEN/);
 assert.equal(existsSync(join(dir,'stdin-ANALYTICS_SQL_TOKEN')),false);
 // A value shorter than 16 characters is not used, and nothing set exits 3 without echoing the value.
 writeFileSync(join(dir,'short.env'),'GATEWAY_GITHUB_TOKEN=short-value\nGATEWAY_ANALYTICS_SQL_TOKEN=tiny\n');
 rmSync(join(dir,'stdin-GITHUB_TOKEN'));
 const short=run(join(dir,'short.env'));
 assert.equal(short.status,3);assert.ok(!short.out.includes('short-value')&&!short.err.includes('short-value'));
 assert.equal(existsSync(join(dir,'stdin-GITHUB_TOKEN')),false);
 // Nothing set at all also exits 3.
 writeFileSync(join(dir,'empty.env'),'OTHER=1\n');
 assert.equal(run(join(dir,'empty.env')).status,3);
 // A missing file, or no variable at all, is refused before wrangler runs.
 assert.equal(run(join(dir,'nope.env')).status,2);
 assert.equal(run('').status,2);
});
