// Ranking analysis for #147: is the hand-set benefit search rubric sound? Offline and deterministic; changes nothing in src/.
//   node scripts/benefit-ranking-lab.mjs [--out=report.json]
// 1. Parity: the lab's copy of the rubric must return exactly what production returns, on every question and mode.
// 2. Rankers: production rubric vs plain BM25 vs BM25 with the structural signals, on dev and held-out.
// 3. Sensitivity: each rubric weight ×0.5…×1.5, one at a time, on dev only.
// 4. Tuning check: the sensitive weights tuned on dev under precision, forbidden and no-answer constraints, then read on held-out.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGolden} from '../evals/benefit-recall/lib.mjs';
import {rubricSearch,bm25Search,DEFAULT_WEIGHTS} from '../evals/benefit-recall/rankers.mjs';
import {searchBenefitKnowledge} from '../src/benefitSearch.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('out')||resolve(root,'evals/latest-benefit-recall-lab.json'));
const sets={dev:await loadGolden(resolve(root,'evals/benefit-recall/golden.json')),heldOut:await loadGolden(resolve(root,'evals/benefit-recall/holdout.json'))};
const MODES={A:q=>[{query:q.question}],B:q=>q.rewrite.map(c=>({query:c.query})),C:q=>q.rewrite};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;

// big: every portfolio's cards held at once, so the top 12 binds. Only recall and MRR are valid there (other cards' rules are unlabelled).
function evaluate(search,set,{big=false}={}){
 const {questions,portfolios,run,score}=set,out={},all=Object.values(portfolios).flatMap(p=>p.cards);
 for(const [mode,calls] of Object.entries(MODES)){
  const scored=[],absent=[];
  if(big&&mode!=='A'&&mode!=='C')continue;
  for(const q of questions){if(q.ambiguous||(big&&q.type==='absent'))continue;const s=score(q,run(calls(q),big?all:portfolios[q.portfolio].cards,search));(q.type==='absent'?absent:scored).push(s);}
  out[mode]={recall:mean(scored.map(s=>s.recall)),mrr:mean(scored.map(s=>s.rr)),precision:mean(scored.filter(s=>s.precision!=null).map(s=>s.precision)),
   forbidden:mean(scored.map(s=>s.forbiddenHits.length?1:0)),noAnswerNoise:mean(absent.map(s=>s.spurious?1:0)),returned:mean(scored.map(s=>s.returned)),n:scored.length,absent:absent.length};
 }
 return out;
}

// 1. Parity
const lab=rubricSearch(),mismatches=[];
for(const [name,set] of Object.entries(sets))for(const q of set.questions)for(const [mode,calls] of Object.entries(MODES)){
 const cards=set.portfolios[q.portfolio].cards,a=set.run(calls(q),cards).ranked.map(([id])=>id).join(),b=set.run(calls(q),cards,lab).ranked.map(([id])=>id).join();
 if(a!==b)mismatches.push(`${name} ${q.id} ${mode}`);
}
if(mismatches.length){console.error('The lab rubric no longer matches production:\n  '+mismatches.slice(0,10).join('\n  '));process.exit(1);}

// 2. Rankers
const rankers={rubric:searchBenefitKnowledge,bm25:bm25Search(),bm25Structure:bm25Search({structure:true})};
const comparison=Object.fromEntries(Object.entries(rankers).map(([name,search])=>[name,{dev:evaluate(search,sets.dev),heldOut:evaluate(search,sets.heldOut)}]));
// A few BM25 settings, read on dev only, so the comparison is not against one arbitrary configuration.
const bm25Grid=[];
for(const titleWeight of [1,2,3])for(const k1 of [1.2])for(const outsideShare of [0.3,0.5,0.7]){const r=evaluate(bm25Search({structure:true,titleWeight,k1,outsideShare}),sets.dev);bm25Grid.push({titleWeight,k1,outsideShare,A:r.A,C:r.C});}

// 3. Sensitivity on dev
const FACTORS=[0.5,0.75,1,1.25,1.5],base=evaluate(lab,sets.dev),baseBig=evaluate(lab,sets.dev,{big:true});
const sensitivity={};
for(const key of Object.keys(DEFAULT_WEIGHTS).filter(k=>k!=='minScore')){
 const curve=FACTORS.map(f=>{const s=rubricSearch({[key]:DEFAULT_WEIGHTS[key]*f}),r=evaluate(s,sets.dev),g=evaluate(s,sets.dev,{big:true});return {factor:f,value:DEFAULT_WEIGHTS[key]*f,A:r.A,C:r.C,bigA:g.A,bigC:g.C};});
 const span=(m,k)=>Math.max(...curve.map(c=>c[m][k]))-Math.min(...curve.map(c=>c[m][k]));
 const spans={mrrA:span('A','mrr'),mrrC:span('C','mrr'),bigRecallA:span('bigA','recall'),bigRecallC:span('bigC','recall'),recallA:span('A','recall'),recallC:span('C','recall'),precisionA:span('A','precision'),precisionC:span('C','precision'),noiseA:span('A','noAnswerNoise'),noiseC:span('C','noAnswerNoise'),forbiddenA:span('A','forbidden')};
 // Flat: recall moves under 1 point and precision under 2 points across ×0.5…×1.5, with no change in forbidden hits.
 const sensitive=spans.bigRecallA>=0.01||spans.bigRecallC>=0.01||spans.mrrA>=0.02||spans.mrrC>=0.02||spans.recallA>=0.01||spans.recallC>=0.01||spans.precisionA>=0.02||spans.precisionC>=0.02||spans.forbiddenA>0||spans.noiseA>0||spans.noiseC>0;
 sensitivity[key]={curve,spans,sensitive};
}

// 4. Tuning check: only the sensitive weights, on dev, under constraints; held-out is read once at the end.
const sensitiveKeys=Object.keys(sensitivity).filter(k=>sensitivity[k].sensitive);
const ok=r=>['A','C'].every(m=>r[m].precision>=base[m].precision-0.01&&r[m].forbidden<=base[m].forbidden&&r[m].noAnswerNoise<=base[m].noAnswerNoise);
// Recall in the labelled wallets and in the big wallet, with MRR as a smaller term; constraints guard precision, forbidden and noise.
const objective=(r,g)=>(r.A.recall+r.C.recall+g.A.recall+g.C.recall)/4+0.25*(r.A.mrr+r.C.mrr)/2;
let best={weights:{},dev:base,big:baseBig,score:objective(base,baseBig)},tried=0;
// Coordinate search: one weight at a time over the same factors, two passes, keeping a change only if it passes the constraints.
for(let pass=0;pass<2;pass++)for(const key of sensitiveKeys)for(const f of FACTORS){
 const weights={...best.weights,[key]:DEFAULT_WEIGHTS[key]*f},s=rubricSearch(weights),r=evaluate(s,sets.dev),g=evaluate(s,sets.dev,{big:true});tried++;
 if(ok(r)&&objective(r,g)>best.score+0.002)best={weights,dev:r,big:g,score:objective(r,g)};
}
const tuned={weights:best.weights,tried,dev:best.dev,devBig:best.big,devBigDefault:baseBig,heldOut:evaluate(rubricSearch(best.weights),sets.heldOut),heldOutDefault:comparison.rubric.heldOut,heldOutBig:evaluate(rubricSearch(best.weights),sets.heldOut,{big:true}),heldOutBigDefault:evaluate(lab,sets.heldOut,{big:true})};
const bigComparison=Object.fromEntries(Object.entries(rankers).map(([name,search])=>[name,{dev:evaluate(search,sets.dev,{big:true}),heldOut:evaluate(search,sets.heldOut,{big:true})}]));

// 5. A score floor, which production does not have: how much no-answer noise it removes, and at what recall cost.
const floors=[0,3,5,7,8,10,12].map(minScore=>{const s=rubricSearch({minScore});return {minScore,dev:evaluate(s,sets.dev),heldOut:evaluate(s,sets.heldOut)};});
const report={schema:1,createdAt:new Date().toISOString(),parity:'exact',sets:{dev:sets.dev.golden.dataset,heldOut:sets.heldOut.golden.dataset},comparison,bigComparison,floors,bm25Grid,sensitivity,tuning:tuned};
await writeFile(output,JSON.stringify(report,null,1)+'\n');

const p=x=>(100*x).toFixed(1).padStart(5),row=(label,r)=>`${label.padEnd(16)}`+['A','B','C'].map(m=>` │ ${p(r[m].recall)} ${p(r[m].precision)} ${p(r[m].forbidden)} ${p(r[m].noAnswerNoise)}`).join('');
const head=`${''.padEnd(16)}`+['A','B','C'].map(m=>` │ ${m} rec  prec forb noans`.padEnd(26)).join('');
console.log('Parity: lab rubric matches production exactly on every question and mode.\n');
for(const set of ['dev','heldOut']){console.log(`${set} (${set==='dev'?sets.dev.questions.length:sets.heldOut.questions.length} questions)\n${head}`);for(const [name,r] of Object.entries(comparison))console.log(row(name,r[set]));console.log('');}
console.log('All cards held at once (recall / MRR), A and C:');for(const [name,r] of Object.entries(bigComparison))console.log(`  ${name.padEnd(14)} dev A ${p(r.dev.A.recall)} ${p(r.dev.A.mrr)} C ${p(r.dev.C.recall)} ${p(r.dev.C.mrr)} · held-out A ${p(r.heldOut.A.recall)} ${p(r.heldOut.A.mrr)} C ${p(r.heldOut.C.recall)} ${p(r.heldOut.C.mrr)}`);console.log('');
const bestGrid=bm25Grid.toSorted((a,b)=>(b.A.recall+b.C.recall)-(a.A.recall+a.C.recall))[0];
console.log(`Best BM25+structure setting on dev: titleWeight ${bestGrid.titleWeight}, k1 ${bestGrid.k1}, outsideShare ${bestGrid.outsideShare} → A ${p(bestGrid.A.recall)} / C ${p(bestGrid.C.recall)}, precision A ${p(bestGrid.A.precision)} / C ${p(bestGrid.C.precision)}\n`);
console.log('Sensitivity on dev (span over ×0.5…×1.5, points): recall A/C · MRR A/C · big-wallet recall A/C · precision A/C · no-answer noise A/C · forbidden A');
for(const [key,s] of Object.entries(sensitivity))console.log(`  ${key.padEnd(17)} ${String(DEFAULT_WEIGHTS[key]).padStart(3)}  ${p(s.spans.recallA)}${p(s.spans.recallC)} ·${p(s.spans.mrrA)}${p(s.spans.mrrC)} ·${p(s.spans.bigRecallA)}${p(s.spans.bigRecallC)} ·${p(s.spans.precisionA)}${p(s.spans.precisionC)} ·${p(s.spans.noiseA)}${p(s.spans.noiseC)} ·${p(s.spans.forbiddenA)}  ${s.sensitive?'SENSITIVE':'flat'}`);
console.log(`\nTuning sensitive weights on dev (${tried} settings tried): ${JSON.stringify(tuned.weights)}`);
console.log(head);console.log(row('dev default',base));console.log(row('dev tuned',tuned.dev));console.log(row('held-out default',tuned.heldOutDefault));console.log(row('held-out tuned',tuned.heldOut));
console.log(`big wallet recall A/C: dev ${p(baseBig.A.recall)}/${p(baseBig.C.recall)} → ${p(best.big.A.recall)}/${p(best.big.C.recall)} · held-out ${p(tuned.heldOutBigDefault.A.recall)}/${p(tuned.heldOutBigDefault.C.recall)} → ${p(tuned.heldOutBig.A.recall)}/${p(tuned.heldOutBig.C.recall)}`);
console.log('\nScore floor (not in production): recall A · precision A · no-answer noise A, dev | held-out');
for(const f of floors)console.log(`  ≥${String(f.minScore).padStart(2)}  ${p(f.dev.A.recall)} ${p(f.dev.A.precision)} ${p(f.dev.A.noAnswerNoise)} | ${p(f.heldOut.A.recall)} ${p(f.heldOut.A.precision)} ${p(f.heldOut.A.noAnswerNoise)}`);
console.log('\nReport: '+output);
