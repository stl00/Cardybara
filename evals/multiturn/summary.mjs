// Job summary and public report of a live multi-turn run. Check outcomes and counts only: no questions, answers or model text.
export const KIND_LABELS={'long-range':'long-range (很早之前)'};
const pct=r=>r===null||r===undefined?'n/a':(r*100).toFixed(1)+'%';
const row=(label,s)=>`| ${label} | ${s.n} | ${s.passed} | ${pct(s.rate)} | ${s.referentApplicable?`${s.referentResolved}/${s.referentApplicable}`:'n/a'} |`;
export function summaryMarkdown(report){
 const s=report.summary,usage=report.usage;
 const out=[`**Weekly live multi-turn eval${report.mode==='live-dry-run'?' (dry run, scripted model, no network)':''}**`,'',
  `Model \`${report.model||'scripted'}\`, ${s.n} dialogues run, strict pass rate ${pct(s.rate)} (expected tool and key arguments, answer completed)${usage?`, spend $${usage.usd.toFixed(4)} of a $${usage.budgetUsd} cap`:''}.`,
  '','| Group | Dialogues | Passed | Strict pass rate | Referent resolved |','| --- | --- | --- | --- | --- |',row('all',s)];
 for(const [kind,v] of Object.entries(s.byKind))out.push(row(KIND_LABELS[kind]||kind,v));
 for(const [lang,v] of Object.entries(s.byLanguage))out.push(row('language '+lang,v));
 if(report.stopped)out.push('',`Stopped before \`${report.stopped.before}\` because the budget cap was reached; ${report.stopped.remaining} dialogues not run.`);
 if(report.fixtureErrors?.length)out.push('',`Fixture errors: ${report.fixtureErrors.length}.`);
 out.push('','Targets from #256: follow-ups at least 90%, much earlier turns (long-range) at least 70%. Numbers only, no regression issue yet. Synthetic wallet only; the report keeps check outcomes and tool names, no model text.');
 return out.join('\n')+'\n';
}
/** The uploaded report: tool names stay, call arguments (model-written text) do not. */
export function publicReport(report){
 return {...report,cases:report.cases.map(({calls,...c})=>({...c,toolCalls:(calls||[]).map(x=>x.name)}))};
}
