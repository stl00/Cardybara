// Benefit retrieval recall against a hand-labelled golden set. Offline and deterministic: no network, no model.
// Mode raw: the user's question is the query, with no filters.
// Mode rewrite: the golden set's hand-written find_benefits call(s), an upper bound for what a model's rewrite could reach.
// Mode rewriteQuery: the same rewritten query text without its filters, which separates the filters' share from the vocabulary's.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGolden,K} from '../evals/benefit-recall/lib.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const goldenPath=resolve(arg('golden')||resolve(root,'evals/benefit-recall/golden.json'));
const output=resolve(arg('out')||resolve(root,'evals/latest-benefit-recall.json'));

let golden,portfolios,questions,run,score;
try{({golden,portfolios,questions,run,score}=await loadGolden(goldenPath));}catch(e){if(!e.problems)throw e;console.error('Golden set is invalid:\n'+e.problems.map(p=>'  '+p).join('\n'));process.exit(1);}

// Every synthetic card at once: a bigger wallet crowds the top 12. Only recall is valid here, because the other cards' rules are unlabelled.
const allCards=Object.values(portfolios).flatMap(p=>p.cards);
const results=questions.map(q=>{
 const cards=portfolios[q.portfolio].cards;
 return {id:q.id,portfolio:q.portfolio,lang:q.lang,type:q.type,ambiguous:!!q.ambiguous,question:q.question,expected:q.expected,
  raw:score(q,run([{query:q.question}],cards)),rewrite:score(q,run(q.rewrite,cards)),rewriteQuery:score(q,run(q.rewrite.map(c=>({query:c.query})),cards)),
  largeWallet:{raw:score(q,run([{query:q.question}],allCards)).recall,rewrite:score(q,run(q.rewrite,allCards)).recall}};
});

const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const scoredOf=rows=>rows.filter(r=>!r.ambiguous&&r.type!=='absent');
function summary(rows,mode){
 const s=scoredOf(rows).map(r=>r[mode]),absent=rows.filter(r=>r.type==='absent').map(r=>r[mode]);
 return {n:s.length,recallAt12:mean(s.map(x=>x.recall)),hitAt12:mean(s.map(x=>x.recall>0?1:0)),mrr:mean(s.map(x=>x.rr)),zeroResultRate:mean(s.map(x=>x.zero?1:0)),meanReturned:mean(s.map(x=>x.returned)),precision:mean(s.filter(x=>x.precision!=null).map(x=>x.precision)),
  forbiddenHitRate:mean(s.map(x=>x.forbiddenHits.length?1:0)),absent:{n:absent.length,spuriousRate:mean(absent.map(x=>x.spurious?1:0))}};
}
const modes=['raw','rewriteQuery','rewrite'],summaries=rows=>Object.fromEntries(modes.map(m=>[m,summary(rows,m)]));
const groupBy=key=>Object.fromEntries([...new Set(results.map(r=>r[key]))].sort().map(v=>[v,summaries(results.filter(r=>r[key]===v))]));
// Worst first by raw recall, then by what a rewrite could not fix, then by rank.
const total=r=>modes.reduce((a,m)=>a+r[m].recall,0);
const worst=scoredOf(results).toSorted((a,b)=>a.raw.recall-b.raw.recall||total(a)-total(b)||a.raw.rr-b.raw.rr||a.id.localeCompare(b.id)).slice(0,10);
const report={schema:1,dataset:golden.dataset,asOf:golden.asOf,k:K,method:'searchBenefitKnowledge, offline',createdAt:new Date().toISOString(),
 counts:{questions:results.length,scored:scoredOf(results).length,ambiguous:results.filter(r=>r.ambiguous).length,absent:results.filter(r=>r.type==='absent').length},
 overall:summaries(results),largeWallet:{cards:allCards.length,rawRecallAt12:mean(scoredOf(results).map(r=>r.largeWallet.raw)),rewriteRecallAt12:mean(scoredOf(results).map(r=>r.largeWallet.rewrite))},byLanguage:groupBy('lang'),byType:groupBy('type'),byPortfolio:groupBy('portfolio'),
 worst:worst.map(r=>({id:r.id,question:r.question,rawRecall:r.raw.recall,rewriteQueryRecall:r.rewriteQuery.recall,rewriteRecall:r.rewrite.recall,rawReturned:r.raw.returned,missedRaw:r.raw.missed,missedRewrite:r.rewrite.missed})),
 cases:results,
 limitations:['Labels are one annotator’s reading of rule text; acceptable and ambiguous items are not scored.','Rewrite mode is a hand-written upper bound, not a model run.','Development set: do not tune the retriever against these exact questions without adding held-out ones.']};
await writeFile(output,JSON.stringify(report,null,1)+'\n');

const pct=x=>x==null?'   -':(100*x).toFixed(0).padStart(3)+'%';
const num=x=>x==null?'   -':x.toFixed(2).padStart(4);
const cell=m=>`${pct(m.recallAt12)} ${num(m.mrr)} ${pct(m.zeroResultRate)} ${pct(m.precision)} ${m.meanReturned==null?'   -':m.meanReturned.toFixed(1).padStart(4)}`;
const line=(label,g)=>`${label.padEnd(13)}${String(g.raw.n).padStart(4)} │ ${modes.map(m=>cell(g[m])).join(' │ ')}`;
const out=[`Benefit retrieval recall@${K} · ${golden.dataset} · asOf ${golden.asOf}`,
 `${report.counts.questions} questions: ${report.counts.scored} scored, ${report.counts.absent} absent, ${report.counts.ambiguous} ambiguous`,
 'A raw question, no filters · B rewritten query, no filters · C rewritten query + filters (upper bound)',
 'recall@12 · MRR · zero = no results · prec = expected share of returned non-acceptable rules · n = rules returned',
 `${''.padEnd(17)} │ ${['A','B','C'].map(m=>`${m} recall  MRR zero  prec   n`.padStart(30)).join(' │ ')}`,line('overall',report.overall),''];
for(const [title,groups] of [['language',report.byLanguage],['type',report.byType],['portfolio',report.byPortfolio]]){out.push(`by ${title}`);for(const [k,v] of Object.entries(groups))if(v.raw.n)out.push(line(k,v));out.push('');}
out.push(`questions with a forbidden rule in the top ${K}: ${modes.map((m,i)=>'ABC'[i]+' '+pct(report.overall[m].forbiddenHitRate).trim()).join(', ')}`);
out.push(`absent questions returning unrelated rules (n=${report.overall.raw.absent.n}): ${modes.map((m,i)=>'ABC'[i]+' '+pct(report.overall[m].absent.spuriousRate).trim()).join(', ')}`,'');
for(const [lang,g] of Object.entries(report.byLanguage))if(g.raw.absent.n)out.push(`  ${lang} (n=${g.raw.absent.n}): ${modes.map((m,i)=>'ABC'[i]+' '+pct(g[m].absent.spuriousRate).trim()).join(', ')}`);
out.push(`all ${allCards.length} synthetic cards held at once: recall A ${pct(report.largeWallet.rawRecallAt12).trim()}, C ${pct(report.largeWallet.rewriteRecallAt12).trim()}`,'');
out.push('10 worst questions (recall A / B / C)');
for(const w of report.worst)out.push(`  ${pct(w.rawRecall)} /${pct(w.rewriteQueryRecall)} /${pct(w.rewriteRecall)}  ${w.id}  ${w.question}`);
out.push('',`Report: ${output}`);
console.log(out.join('\n'));
// Opt-in thresholds for a future gate; npm scripts do not pass them yet.
const gates=[['min-raw',report.overall.raw.recallAt12],['min-rewrite',report.overall.rewrite.recallAt12]].filter(([name])=>arg(name)!==undefined);
for(const [name] of gates)if(!Number.isFinite(Number(arg(name)))){console.error(`--${name} must be a number`);process.exit(2);}
const failed=gates.filter(([name,value])=>value<Number(arg(name)));
for(const [name,value] of failed)console.error(`recall ${pct(value).trim()} is below --${name}=${arg(name)}`);
if(failed.length)process.exitCode=1;
