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
