// Hourly alert check and KV switches (stl00/Cardybara#259). Synthetic query results and an in-memory GitHub only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,readThresholds,runAlerts,DEFAULT_THRESHOLDS,HOUR_SQL,WEEK_SQL,LABELS} from '../gateway/src/alerts.js';
import {parseSwitches,withoutDisabledTools,unavailableText} from '../gateway/src/switches.js';
import {callLedger,SETTINGS_KEY} from '../gateway/src/gateway.js';
import {localGateway} from '../gateway/src/local.mjs';
import {cloudGateway} from './helpers/agent-target.mjs';
import {runCloudTurn} from '../src/cloudChat.js';
import {buildWalletSummary} from '../src/walletSummary.js';
import worker from '../gateway/src/worker.js';
import {command} from '../scripts/gateway-settings.mjs';

const NOW=Date.parse('2026-11-10T12:00:00Z');
const spend=pct=>({micros:pct*1e4,budgetMicros:1e6});
const state=(results,signal)=>results.find(r=>r.signal===signal).state;

test('budget threshold: 80 percent of the monthly budget or more breaches',()=>{
 assert.equal(state(evaluate({spend:spend(79.9)}),'budget'),'ok');
 assert.equal(state(evaluate({spend:spend(80)}),'budget'),'breach');
 assert.equal(state(evaluate({spend:null}),'budget'),'unknown');
});
test('error rate: 5 percent over the last hour, and only with at least 20 turns',()=>{
 const hour=(turns,errors)=>({turns,errors,repaired:0,fallbacks:0});
 assert.equal(state(evaluate({hour:hour(100,4)}),'errors'),'ok');
 assert.equal(state(evaluate({hour:hour(100,5)}),'errors'),'breach');
 assert.equal(state(evaluate({hour:hour(19,19)}),'errors'),'unknown','too few turns to judge');
 assert.equal(state(evaluate({hour:hour(20,1)}),'errors'),'breach');
 assert.equal(state(evaluate({hour:null}),'errors'),'unknown');
});
test('repair and fallback rate: at least double the 7-day mean, with at least 20 turns',()=>{
 const week={turns:1000,repaired:100,fallbacks:20};// means 10% and 2%
 const hour=(repaired,fallbacks,turns=50)=>({turns,errors:0,repaired,fallbacks});
 assert.equal(state(evaluate({hour:hour(9,0),week}),'repair'),'ok');// 18%
 assert.equal(state(evaluate({hour:hour(10,0),week}),'repair'),'breach');// 20%
 assert.equal(state(evaluate({hour:hour(0,1),week}),'fallback'),'ok');// 2%
 assert.equal(state(evaluate({hour:hour(0,5),week}),'fallback'),'breach');// 10% vs 2%
 assert.equal(state(evaluate({hour:hour(10,5,19),week}),'repair'),'unknown');
 assert.equal(state(evaluate({hour:hour(10,5),week:null}),'repair'),'unknown');
 // A mean of zero must not make one repair an incident: the floor applies.
 assert.equal(state(evaluate({hour:hour(1,0),week:{turns:1000,repaired:0,fallbacks:0}}),'repair'),'ok');
 assert.equal(state(evaluate({hour:hour(5,0),week:{turns:1000,repaired:0,fallbacks:0}}),'repair'),'breach');
});
test('thresholds come from KV settings.alerts over the defaults; an invalid one is ignored',()=>{
 assert.deepEqual(readThresholds(null).thresholds,DEFAULT_THRESHOLDS);
 const {thresholds,invalid}=readThresholds({alerts:{budgetPercent:50,errorPercent:'high',minTurns:2.5,rateMultiple:3}});
 assert.equal(thresholds.budgetPercent,50);assert.equal(thresholds.rateMultiple,3);assert.equal(thresholds.errorPercent,5);assert.equal(thresholds.minTurns,20);
 assert.deepEqual(invalid.sort(),['errorPercent','minTurns']);
 assert.equal(state(evaluate({spend:spend(50)},thresholds),'budget'),'breach');
});

// A fake GitHub and SQL API behind one fetch.
function world({hour={turns:100,errors:0,repaired:0,fallbacks:0},week={turns:1000,repaired:0,fallbacks:0},issues=[]}={}){
 const w={hour,week,issues,calls:[],failSql:false};
 w.fetch=async(url,init={})=>{
  w.calls.push(url);
  if(url.includes('/analytics_engine/sql')){
   if(w.failSql)return new Response('x',{status:500});
   assert.equal(init.headers.Authorization,'Bearer synthetic-sql-token');
   const row=init.body===HOUR_SQL?w.hour:init.body===WEEK_SQL?w.week:assert.fail('unexpected query');
   return Response.json({data:[row]});
  }
  assert.equal(init.headers.Authorization,'Bearer synthetic-github-token');
  const m=url.match(/\/repos\/stl00\/Cardybara(\/issues(?:\/(\d+))?(\/comments)?)(\?.*)?$/);
  if(!m)assert.fail('unexpected url '+url);
  const [, ,num,comments,query]=m;
  if(!num&&query)return Response.json(w.issues.filter(i=>i.state==='open'));
  if(!num&&init.method==='POST'){const b=JSON.parse(init.body);const i={number:w.issues.length+1,state:'open',comments:[],...b};w.issues.push(i);return Response.json(i);}
  const issue=w.issues.find(i=>i.number===Number(num));
  if(comments){issue.comments.push(JSON.parse(init.body).body);return Response.json({});}
  Object.assign(issue,JSON.parse(init.body));return Response.json(issue);
 };
 return w;
}
async function alertEnv({spentUsd=0,settings,vars={}}={}){
 const g=localGateway({vars:{GITHUB_TOKEN:'synthetic-github-token',ANALYTICS_SQL_TOKEN:'synthetic-sql-token',CF_ACCOUNT_ID:'synthetic-account',CF_VERSION_METADATA:{id:'ver-test-1'},...vars}});
 if(spentUsd)await callLedger(g.env,'reserve',{code:'t01',day:'2026-11-10',month:'2026-11',tokens:1,micros:spentUsd*1e6,maxRequests:10,maxTokens:10,maxMicros:1e12});
 if(settings)await g.env.INVITES.put(SETTINGS_KEY,JSON.stringify(settings));
 return g.env;
}
const run=(env,w,logs=[])=>runAlerts(env,{fetch:w.fetch,now:()=>NOW,log:l=>logs.push(l)});

test('a breach opens one labelled incident with aggregates only; the same signal is not opened twice',async()=>{
 const env=await alertEnv({spentUsd:8.5}),w=world(),logs=[];
 const first=await run(env,w,logs);
 assert.deepEqual(first.done,['budget:opened']);
 assert.equal(w.issues.length,1);
 const [issue]=w.issues;
 assert.deepEqual(issue.labels,LABELS);assert.deepEqual(LABELS,['agent-incident','P1']);
 assert.match(issue.title,/budget/);
 assert.match(issue.body,/usedPercent: 85/);assert.match(issue.body,/ver-test-1/);assert.match(issue.body,/docs\/GATEWAY\.md#alerts-and-switches/);
 assert.ok(!/t01|synthetic-(github|sql)-token|synthetic-account/.test(issue.body+logs.join('')),'no code id, token or account in the body or the log');
 const second=await run(env,w);
 assert.deepEqual(second.done,['budget:commented']);
 assert.equal(w.issues.length,1,'one open incident per signal');
 assert.equal(issue.comments.length,1);
});
test('the next healthy check comments and closes the incident',async()=>{
 const env=await alertEnv({spentUsd:8.5}),w=world();
 await run(env,w);
 // Raising the budget in KV makes the same spend healthy.
 await env.INVITES.put(SETTINGS_KEY,JSON.stringify({monthlyBudgetUsd:100}));
 const r=await run(env,w);
 assert.deepEqual(r.done,['budget:closed']);
 assert.equal(w.issues[0].state,'closed');assert.match(w.issues[0].comments.at(-1),/Healthy again/);
 assert.deepEqual((await run(env,w)).done,[],'nothing open, nothing to do');
});
test('too few turns neither opens nor closes an incident',async()=>{
 const env=await alertEnv(),w=world({hour:{turns:5,errors:5,repaired:5,fallbacks:5}});
 assert.deepEqual((await run(env,w)).done,[]);
 const open=world({hour:{turns:5,errors:0,repaired:0,fallbacks:0},issues:[{number:7,state:'open',title:'Assistant alert: errors',labels:LABELS,comments:[]}]});
 assert.deepEqual((await run(env,open)).done,[]);assert.equal(open.issues[0].state,'open');
});
test('error, repair and fallback breaches each open their own incident from the metrics queries',async()=>{
 const env=await alertEnv(),w=world({hour:{turns:100,errors:10,repaired:30,fallbacks:20},week:{turns:1000,repaired:100,fallbacks:20}});
 const r=await run(env,w);
 assert.deepEqual(r.done.sort(),['errors:opened','fallback:opened','repair:opened']);
 for(const i of w.issues)assert.ok(!/blob[0-9]|double[0-9]|index1/.test(i.body),'aggregates only');
});
test('an unreadable metrics source leaves its signals unknown; the budget is still checked',async()=>{
 const env=await alertEnv({spentUsd:9}),w=world();w.failSql=true;const logs=[];
 assert.deepEqual((await run(env,w,logs)).done,['budget:opened']);
 assert.ok(logs.some(l=>l.includes('metrics_unreadable')));
});
test('without the GitHub token the check does nothing and says so',async()=>{
 const env=await alertEnv({spentUsd:9,vars:{GITHUB_TOKEN:undefined}}),w=world(),logs=[];
 assert.deepEqual(await run(env,w,logs),{skipped:'github_token_missing'});assert.equal(w.calls.length,0);
});
test('the Worker has a scheduled handler that runs the check',async()=>{
 const env=await alertEnv({spentUsd:9}),w=world(),waits=[];
 const original=globalThis.fetch;globalThis.fetch=w.fetch;
 try{await worker.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);}finally{globalThis.fetch=original;}
 assert.equal(w.issues.length,1);
});

// --- Switches
test('parseSwitches keeps valid values and names the invalid ones',()=>{
 const models=['m-a','m-b'];
 assert.deepEqual(parseSwitches({disabledTools:['x_y','x_y','z'],forceModel:'m-b',assistantOff:true},models),{switches:{disabledTools:['x_y','z'],forceModel:'m-b',assistantOff:true},invalid:[]});
 const bad=parseSwitches({disabledTools:'x',forceModel:'m-c',assistantOff:'yes'},models);
 assert.deepEqual(bad.invalid,['disabledTools','forceModel','assistantOff']);
 assert.deepEqual(bad.switches,{disabledTools:[],forceModel:null,assistantOff:false});
 assert.deepEqual(parseSwitches({disabledTools:['Bad Name']},models).invalid,['disabledTools']);
 assert.deepEqual(parseSwitches(undefined,models).switches,{disabledTools:[],forceModel:null,assistantOff:false});
});
test('withoutDisabledTools removes tools and a tool_choice that names one',()=>{
 const t=n=>({type:'function',function:{name:n}});
 const out=withoutDisabledTools({tools:[t('a'),t('b')],tool_choice:{type:'function',function:{name:'a'}}},['a']);
 assert.deepEqual(out.tools.map(x=>x.function.name),['b']);assert.equal(out.tool_choice,'auto');
 const none=withoutDisabledTools({tools:[t('a')],tool_choice:'auto'},['a']);
 assert.ok(!('tools' in none)&&!('tool_choice' in none));
});

const DAY='2026-10-28',clock={t:Date.parse(DAY+'T12:00:00Z')};
const ctxFor=language=>({cards:[],events:[],day:DAY,language});
const say=content=>()=>({message:{role:'assistant',content}});
async function switchGateway(settings,{vars={},logs=[],replies=[say('synthetic answer')]}={}){
 clock.t=Date.parse(DAY+'T12:00:00Z');let n=0;
 const g=await cloudGateway({vars,log:l=>logs.push(l),now:()=>clock.t,request:(p,s,o)=>replies[Math.min(n++,replies.length-1)](p,s,o)});
 if(settings!==undefined)await g.env.INVITES.put(SETTINGS_KEY,typeof settings==='string'?settings:JSON.stringify(settings));
 return {...g,logs,turn:(language='zh-CN')=>runCloudTurn({question:'synthetic question',context:ctxFor(language),post:g.post}).catch(e=>{throw g.thrown()||e;})};
}
const toolNames=body=>(body.tools||[]).map(t=>t.function.name);

test('disabledTools removes the tool from the model\'s tool list',async()=>{
 const before=await switchGateway(undefined);await before.turn();
 const names=toolNames(before.providerRequests[0]);assert.ok(names.includes('list_cards'),'the tool is offered by default');
 const g=await switchGateway({disabledTools:['list_cards']});await g.turn();
 const after=toolNames(g.providerRequests[0]);
 assert.ok(!after.includes('list_cards'));assert.equal(after.length,names.length-1);
});
test('forceModel replaces the model, and must be in ALLOWED_MODELS',async()=>{
 const vars={ALLOWED_MODELS:'deepseek-flash,deepseek-pro'};
 const g=await switchGateway({forceModel:'deepseek-pro'},{vars});await g.turn();
 assert.equal(g.providerRequests[0].model,'deepseek-pro');
});
test('assistantOff answers "temporarily unavailable" in each language with no model call',async()=>{
 const g=await switchGateway({assistantOff:true});
 const texts={};
 for(const lang of ['zh-CN','zh-TW','en-US']){const r=await g.turn(lang);texts[lang]=r.answer;assert.equal(r.answer,unavailableText(lang));}
 assert.equal(g.providerRequests.length,0,'the provider is never called');
 assert.match(texts['zh-CN'],/暂时不可用/);assert.match(texts['zh-TW'],/暫時無法使用/);assert.match(texts['en-US'],/temporarily unavailable/);
 assert.equal(new Set(Object.values(texts)).size,3);
});
test('an invalid switch value is ignored and logged by key, never applied',async()=>{
 const logs=[];
 const g=await switchGateway({assistantOff:'true',forceModel:'not-allowed-model',disabledTools:'list_cards'},{logs});
 const r=await g.turn();
 assert.equal(r.answer,'synthetic answer','assistantOff:"true" is not on');
 assert.equal(g.providerRequests[0].model,'deepseek-flash');
 assert.ok(toolNames(g.providerRequests[0]).includes('list_cards'));
 const lines=logs.filter(l=>l.includes('"switch"')).map(l=>JSON.parse(l));
 assert.deepEqual(lines.map(l=>l.switch).sort(),['assistantOff','disabledTools','forceModel']);
 assert.ok(!logs.join('').includes('not-allowed-model'),'the bad value is not logged');
});
test('switches are cached briefly: a change shows after the cache time, not before',async()=>{
 const g=await switchGateway({assistantOff:true});
 assert.match((await g.turn('en-US')).answer,/temporarily unavailable/);
 await g.env.INVITES.put(SETTINGS_KEY,JSON.stringify({}));
 assert.match((await g.turn('en-US')).answer,/temporarily unavailable/,'still cached');
 clock.t+=31000;
 assert.equal((await g.turn('en-US')).answer,'synthetic answer');
});
test('a malformed settings value turns nothing on',async()=>{
 const g=await switchGateway('not json');
 assert.equal((await g.turn()).answer,'synthetic answer');
});

// --- Commands
test('gateway-settings sets, shows and clears the switches, and refuses an invalid value',async()=>{
 const kv=localGateway().env.INVITES,defaults={models:['deepseek-flash']};
 await command(kv,['set-caps','--monthly-usd','5']);
 await command(kv,['set-switch','disabledTools','list_cards,find_benefits'],{defaults});
 await command(kv,['set-switch','forceModel','deepseek-flash'],{defaults});
 await command(kv,['set-switch','assistantOff','on'],{defaults});
 const stored=JSON.parse(await kv.get(SETTINGS_KEY));
 assert.deepEqual(stored,{monthlyBudgetUsd:5,disabledTools:['list_cards','find_benefits'],forceModel:'deepseek-flash',assistantOff:true},'the caps stay');
 assert.match((await command(kv,['switches'],{defaults})).join('\n'),/"assistantOff":true/);
 await assert.rejects(()=>command(kv,['set-switch','forceModel','other-model'],{defaults}),/ALLOWED_MODELS/);
 await assert.rejects(()=>command(kv,['set-switch','assistantOff','maybe'],{defaults}),/on or off/);
 await assert.rejects(()=>command(kv,['set-switch','disabledTools','Bad Name'],{defaults}),/tool names/);
 await assert.rejects(()=>command(kv,['set-switch','nope','x'],{defaults}),/set-switch/);
 await command(kv,['clear-switch','assistantOff']);
 assert.equal('assistantOff' in JSON.parse(await kv.get(SETTINGS_KEY)),false);
 await assert.rejects(()=>command(kv,['clear-switch','monthlyBudgetUsd']),/clear-switch/);
});
