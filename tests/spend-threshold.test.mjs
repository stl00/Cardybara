// #246: batch-made spend-unlock rules carry the spend they need, in the shape the hand-made rules use.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {getKnowledgeRule,inspectRuleRequirements,ruleRevisions,validateKnowledge} from '../src/knowledge.js';

const root=fileURLToPath(new URL('..',import.meta.url)),DAY='2026-11-12';
const read=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
const batches=readdirSync(join(root,'docs/knowledge/card-batches')).filter(n=>n.startsWith('batch-')).map(n=>read(`docs/knowledge/card-batches/${n}`));
const stated=batches.flatMap(b=>b.cards.flatMap(c=>(c.credits||[]).filter(r=>r.spendThreshold).map(row=>({id:`rule.${c.id}.${row.key}`,row}))));
const helper=(row,currency='USD')=>{const run=spawnSync('python3',['scripts/spend_threshold.py'],{cwd:root,input:JSON.stringify({row,currency}),encoding:'utf8'});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);};
const BA='rule.chase-us-british-airways-visa-signature-credit-card.travel-together',AER='rule.chase-us-aer-lingus-visa-signature-credit-card.companion-ticket';
const RESORT='rule.chase-us-disney-inspire-visa-card.resort-stays',TICKETS='rule.chase-us-disney-inspire-visa-card.park-tickets';
// #250: five more, read again on the same day. All count every purchase on the card.
const SPARK='rule.capital-one-us-spark-cash-plus-card.fee-refund',EXPLORER='rule.chase-us-united-explorer-card.travel-credit',BOUNTIFUL='rule.chase-us-marriott-bonvoy-bountiful-credit-card.free-night';
const UNITED_BIZ='rule.chase-us-united-business-card.economy-plus',CLUB_BIZ='rule.chase-us-united-club-business-card.economy-plus';
// #244: made after #246, so the batch row stated the threshold from the start and the rule has one revision.
const ASCENT='rule.boa-us-atmos-rewards-ascent-visa-signature.companion-fare';
// #252: free nights added as first revisions that already carry the threshold; tests/chase-free-nights.test.mjs checks them.
const FREE_NIGHTS=['chase-us-world-of-hyatt-credit-card','chase-us-ihg-one-rewards-premier-select-credit-card','chase-us-ihg-one-rewards-business-credit-card'].map(id=>`rule.${id}.spend-free-night`);
const MORE={[SPARK]:[150000,'account-anniversary'],[EXPLORER]:[10000,'calendar-year'],[BOUNTIFUL]:[15000,'calendar-year'],[UNITED_BIZ]:[25000,'calendar-year'],[CLUB_BIZ]:[40000,'calendar-year']};

test('the companion tickets and the Disney Inspire spend rewards expose their spend threshold',()=>{
 assert.equal(validateKnowledge().valid,true);
 assert.deepEqual(stated.map(s=>s.id).sort(),[AER,ASCENT,BA,RESORT,TICKETS,...Object.keys(MORE),...FREE_NIGHTS].sort());
 const want={[BA]:[30000,'calendar-year'],[AER]:[30000,'calendar-year'],[RESORT]:[2000,'account-anniversary'],[TICKETS]:[200,'account-anniversary'],...MORE};
 for(const [id,[amount,period]] of Object.entries(want)){
  const rule=getKnowledgeRule(id,{asOf:DAY});
  assert.equal(rule.revision,2,id);assert.equal(rule.terms.spendThreshold,amount,id);assert.equal(rule.terms.period,period,id);
  assert.equal(rule.evidence.checkedAt,DAY,id);
  // The amount is the issuer's: one of the rule's own quotes states it.
  assert.ok(rule.original.quotes.some(q=>q.text.includes('$'+amount.toLocaleString('en-US'))),id);
  // Only the threshold changed from the revision before.
  const [first,second]=ruleRevisions(id);
  assert.equal(first.terms.spendThreshold,undefined,id);assert.deepEqual(second.content,first.content,id);assert.deepEqual(second.original,first.original,id);
  assert.equal(second.supersedes,first.revisionId,id);
 }
});

test('a rule made with its threshold states it in its first revision',()=>{
 const rule=getKnowledgeRule(ASCENT,{asOf:DAY});
 assert.equal(rule.revision,1);assert.equal(ruleRevisions(ASCENT).length,1);
 assert.equal(rule.terms.spendThreshold,6000);assert.equal(rule.terms.period,'account-anniversary');assert.equal(rule.terms.spendScope,undefined);
 assert.ok(rule.original.quotes.some(q=>q.text.includes('$6,000')));
 // The prior anniversary year is not the calendar year, so the account's calendar-year spend does not prove it.
 assert.deepEqual(rule.conditions.all,[]);
});

test('a calendar-year threshold on all purchases is a condition; a category threshold is not',()=>{
 for(const id of [BA,AER]){
  const rule=getKnowledgeRule(id,{asOf:DAY});
  assert.deepEqual(rule.conditions.all,[{field:'account.eligibleCalendarYearSpend',op:'gte',value:30000,currency:'USD',timeScope:'current-or-earned-year-needs-account-proof'}]);
  assert.equal(rule.terms.spendScope,undefined);
  assert.equal(inspectRuleRequirements(id,{account:{eligibleCalendarYearSpend:1000}},{asOf:DAY}).result,'requirements-not-met');
 }
 for(const [id,[amount,period]] of Object.entries(MORE)){
  const rule=getKnowledgeRule(id,{asOf:DAY});assert.equal(rule.terms.spendScope,undefined,id);
  // A membership-year threshold gets no condition: the account's calendar-year spend does not prove it.
  if(period!=='calendar-year'){assert.deepEqual(rule.conditions.all,[],id);continue;}
  assert.deepEqual(rule.conditions.all,[{field:'account.eligibleCalendarYearSpend',op:'gte',value:amount,currency:'USD',timeScope:'current-or-earned-year-needs-account-proof'}],id);
  assert.equal(inspectRuleRequirements(id,{account:{eligibleCalendarYearSpend:amount-1}},{asOf:DAY}).result,'requirements-not-met',id);
 }
 // Disney counts only Disney purchases of one kind, so the account's total spend proves nothing.
 for(const id of [RESORT,TICKETS]){const rule=getKnowledgeRule(id,{asOf:DAY});assert.equal(rule.terms.spendScope,'category');assert.deepEqual(rule.conditions.all,[]);}
});

test('spend-unlock rows that are not one spend amount, or whose page could not be read again, state no threshold',()=>{
 // #250: per-$ accruals, ride and purchase counts, dated offers and the Bilt housing points are not a single threshold.
 // The nine American Express rows keep revision 1 because their pages returned no text signed out on 2026-11-12.
 const rows=batches.flatMap(b=>b.cards.flatMap(c=>(c.credits||[]).filter(r=>r.category==='spend-unlock'&&!r.spendThreshold).map(r=>`rule.${c.id}.${r.key}`)));
 assert.equal(rows.length,23);
 for(const id of rows){const rule=getKnowledgeRule(id,{asOf:DAY});assert.equal(rule.terms.spendThreshold,undefined,id);assert.equal(rule.revision,1,id);}
 for(const key of ['a-list-tqp','mqd-boost','pqp','lyft','streaming','housing-points'])assert.ok(rows.some(id=>id.endsWith('.'+key)),key);
});

test('every batch row that states a threshold matches its rule',()=>{
 for(const {id,row} of stated){
  const {terms,conditions,errors}=helper(row),rule=getKnowledgeRule(id,{asOf:DAY});
  assert.deepEqual(errors,[],id);assert.equal(rule.terms.spendThreshold,terms.spendThreshold,id);assert.equal(rule.terms.spendScope,terms.spendScope,id);assert.deepEqual(rule.conditions.all,conditions,id);
 }
});

test('a threshold the quotes do not state, or in another currency or period, is refused',()=>{
 const row={category:'spend-unlock',period:'calendar-year',quote:'Earn a ticket every calendar year you make $30,000 in purchases',spendThreshold:{amount:30000,currency:'USD',period:'calendar-year'}};
 assert.deepEqual(helper(row),{terms:{spendThreshold:30000},conditions:[{field:'account.eligibleCalendarYearSpend',op:'gte',value:30000,currency:'USD',timeScope:'current-or-earned-year-needs-account-proof'}],errors:[]});
 assert.deepEqual(helper({...row,quote:'after you spend $60K in purchases',spendThreshold:{...row.spendThreshold,amount:60000}}).terms,{spendThreshold:60000});
 assert.deepEqual(helper({category:'spend-unlock',period:'calendar-year',quote:'Earn a ticket'}),{terms:{},conditions:[],errors:[]},'no threshold stated, none written');
 const refused=change=>{const out=helper({...row,...change});assert.deepEqual(out.terms,{});assert.deepEqual(out.conditions,[]);return out.errors.join(' ');};
 assert.match(refused({spendThreshold:{...row.spendThreshold,amount:3000}}),/not in any of the quotes/);
 assert.match(refused({quote:'you make $130,000 in purchases'}),/not in any of the quotes/);
 assert.match(refused({spendThreshold:{...row.spendThreshold,currency:'HKD'}}),/currency/);
 assert.match(refused({spendThreshold:{...row.spendThreshold,period:'account-anniversary'}}),/period/);
 assert.match(refused({category:'credit'}),/spend-unlock/);
 assert.match(refused({spendThreshold:{...row.spendThreshold,amount:'30000'}}),/whole number/);
 assert.match(refused({spendThreshold:{...row.spendThreshold,secondAmount:60000}}),/takes amount/);
});

test('curate-card-batch.py writes the threshold from a batch row',()=>{
 // The real script on a copy of the data, with the British Airways card taken out and put back from its batch row.
 const dir=mkdtempSync(join(tmpdir(),'cardybara-spend-'));
 try{
  for(const path of ['scripts','src/data','src/i18n','docs/knowledge','public/ASSET-SOURCES.md'])cpSync(join(root,path),join(dir,path),{recursive:true});
  // The script needs OpenCC only to make Traditional Chinese text, which this test does not read.
  mkdirSync(join(dir,'stub'));writeFileSync(join(dir,'stub/opencc.py'),'class OpenCC:\n    def __init__(self, *a):\n        pass\n\n    def convert(self, text):\n        return text\n');
  const pid='chase-us-british-airways-visa-signature-credit-card',rulesPath=join(dir,'src/data/knowledge/rules.json'),json=p=>JSON.parse(readFileSync(p,'utf8'));
  writeFileSync(rulesPath,JSON.stringify(json(rulesPath).filter(r=>!r.id.startsWith(`rule.${pid}.`))));
  const source=batches.find(b=>b.cards.some(c=>c.id===pid)),batchPath=join(dir,'one.json');
  const run=()=>spawnSync('python3',['scripts/curate-card-batch.py',batchPath],{cwd:dir,env:{...process.env,PYTHONPATH:join(dir,'stub')},encoding:'utf8'});
  writeFileSync(batchPath,JSON.stringify({...source,cards:source.cards.filter(c=>c.id===pid)}));
  const done=run();assert.equal(done.status,0,done.stderr);
  const made=json(rulesPath).find(r=>r.id===BA),shipped=getKnowledgeRule(BA,{asOf:DAY});
  assert.equal(made.terms.spendThreshold,30000);assert.deepEqual(made.terms,shipped.terms);assert.deepEqual(made.conditions,shipped.conditions);
  // A threshold that is not in the row's quotes stops the run and writes nothing.
  const card=structuredClone(source.cards.find(c=>c.id===pid));card.credits.find(r=>r.key==='travel-together').spendThreshold.amount=25000;
  writeFileSync(rulesPath,JSON.stringify(json(rulesPath).filter(r=>!r.id.startsWith(`rule.${pid}.`))));
  writeFileSync(batchPath,JSON.stringify({...source,cards:[card]}));
  const bad=run();assert.notEqual(bad.status,0);assert.match(bad.stderr,/travel-together: spendThreshold 25000 is not in any of the quotes/);
  assert.equal(json(rulesPath).some(r=>r.id===BA),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
