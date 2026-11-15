import test from 'node:test';
import assert from 'node:assert/strict';
import {judgeTopRules,judgeMessages,parseJudgement,JUDGE_TOP} from '../src/benefitAnswerJudge.js';

// #289: the answer judge only decides whether the top rules answer; the model call is injected, so no network here.
const rule=(id,title,summary)=>({id,content:{title,summary}});
const rules=[rule('a','机场贵宾室','Priority Pass 休息室'),rule('b','航空杂费抵扣','行李费'),rule('c','c','c'),rule('d','d','d'),rule('e','e','e'),rule('f','f','f')];

test('the prompt shows only the top rules, numbered', () => {
 const [system,user]=judgeMessages('Is airport parking free?',rules.slice(0,JUDGE_TOP));
 assert.match(system.content,/JSON/);
 assert.match(user.content,/^Question: Is airport parking free\?/);
 assert.match(user.content,/1\. 机场贵宾室 — Priority Pass 休息室/);
 assert.doesNotMatch(user.content,/\b6\. /);
});

test('model output is read strictly', () => {
 assert.deepEqual(parseJudgement('{"answers":[2,1,2,9]}',5),[1,0]);
 assert.deepEqual(parseJudgement('Sure: {"answers":[]}',5),[]);
 assert.equal(parseJudgement('none of them',5),null);
 assert.equal(parseJudgement('{"answers":["1"]}',5),null);
});

test('no answering rule empties the result; any answering rule keeps the whole list', async () => {
 let seen=0;
 const none=await judgeTopRules('Is airport parking free?',rules,async m=>{seen=m[1].content.split('\n').filter(l=>/^\d+\. /.test(l)).length;return '{"answers":[]}';});
 assert.equal(seen,JUDGE_TOP);assert.deepEqual(none.rules,[]);assert.equal(none.answers,false);
 const some=await judgeTopRules('lounge?',rules,async()=>'{"answers":[1]}');
 assert.equal(some.rules,rules);assert.equal(some.answers,true);
});

test('unreadable output and empty results fail open without changing anything', async () => {
 const bad=await judgeTopRules('q',rules,async()=>'I think rule 1');
 assert.equal(bad.rules,rules);assert.equal(bad.unreadable,true);
 let called=false;const empty=await judgeTopRules('q',[],async()=>{called=true;return '{}';});
 assert.deepEqual(empty.rules,[]);assert.equal(called,false);
});

// #291: the gate decides from search fields only; the judge runs on weak matches only.
import {isWeakMatch,gatedJudge,JUDGE_GATE} from '../src/benefitAnswerJudge.js';
const hit=(score,worded=false)=>({...rule('x'+score,'t','s'),retrieval:{score,worded,strong:true}});
test('weak means a low best score and no worded match; thresholds are configurable', () => {
 assert.equal(isWeakMatch([hit(8),hit(5)]),true);
 assert.equal(isWeakMatch([hit(JUDGE_GATE.topScoreBelow+1),hit(5)]),false,'high score is strong');
 assert.equal(isWeakMatch([hit(8,true),hit(5)]),false,'a worded match is strong');
 assert.equal(isWeakMatch([]),false,'nothing returned: nothing to judge');
 assert.equal(isWeakMatch([hit(20)],{topScoreBelow:30,requireNoWorded:true}),true);
 assert.equal(isWeakMatch([hit(8,true)],{topScoreBelow:15,requireNoWorded:false}),true);
});
test('strong matches skip the model; weak matches go to the judge and none empties the list', async () => {
 let calls=0;const complete=async()=>{calls++;return '{"answers":[]}';};
 const strong=[hit(40,true),hit(30)],s=await gatedJudge('q',strong,complete);
 assert.equal(calls,0);assert.equal(s.rules,strong);assert.equal(s.gated,'strong');assert.equal(s.judged,false);
 const weak=[hit(6),hit(4)],w=await gatedJudge('q',weak,complete);
 assert.equal(calls,1);assert.deepEqual(w.rules,[]);assert.equal(w.gated,'weak');assert.equal(w.answers,false);
 const kept=await gatedJudge('q',weak,async()=>'{"answers":[2]}');
 assert.equal(kept.rules,weak);assert.equal(kept.answers,true);
 const open=await gatedJudge('q',weak,async()=>'unreadable');
 assert.equal(open.rules,weak);assert.equal(open.unreadable,true);
});

// The eval script can re-score the gate from stored verdicts with no model and no spend; ids without a verdict stay unknown.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('offline re-score reads stored verdicts and never calls a model', () => {
 const dir=mkdtempSync(join(tmpdir(),'judge-'));
 // No stored verdicts at all: every weak question is unknown and keeps its rules, so the numbers equal plain mode A.
 writeFileSync(join(dir,'stored.json'),JSON.stringify({sets:{golden:{rows:[]}}}));
 const out=join(dir,'out.json');
 const r=spawnSync(process.execPath,['scripts/eval-benefit-judge.mjs',`--from-report=${join(dir,'stored.json')}`,`--out=${out}`,'--sets=golden'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
 const g=JSON.parse(readFileSync(out,'utf8')).sets.golden;
 assert.deepEqual(g.after,g.before);assert.ok(g.unknownIds.length>0);assert.ok(g.judgeShare>0&&g.judgeShare<0.5);assert.equal(g.judgements.none,0);
});
