// Per-request metrics for the hosted assistant (stl00/Cardybara#257): one Workers Analytics Engine data point per
// `/v1/chat` turn and per `/v1/chat/completions` request, so production quality is read with SQL, not by scrolling
// logs. The field mapping is documented in docs/GATEWAY.md ("Metrics"); keep the two in step.
//
// A data point holds only release identity, counts, durations and outcome codes. It never holds a question, an
// answer, a card, a wallet summary or an invite code: the code's id (not the code) is the one index.

/** Blob and double positions, in order. Analytics Engine addresses them as blob1.. and double1..; the names are for the docs. */
export const BLOBS=['route','version_id','prompt_hash','snapshot_id','model','error','tool_counts'];
export const DOUBLES=['status','model_calls','rounds_replayed','wallet_calls','prompt_tokens','completion_tokens','duration_ms','repaired','fallback','model_answered','tool_request','answered','public_tool_calls','wallet_results'];

const flag=v=>v?1:0;
const count=v=>Number.isFinite(v)&&v>=0?Math.round(v):0;
const text=v=>typeof v==='string'?v.slice(0,96):'';
/** "find_benefits:2,get_card_rules:1": tool names (never arguments or results) with how many times each ran. */
const toolCounts=counts=>Object.entries(counts||{}).filter(([k,n])=>/^[a-z_]{1,48}$/.test(k)&&n>0).sort(([a],[b])=>a<b?-1:1).map(([k,n])=>k+':'+n).join(',');

/**
 * The data point for one finished request, from the log record (route, code id, status, tokens, counts) and the
 * agent's own summary of the turn (ctx.metrics: model, prompt hash, snapshot, repaired, fallback, tool counts).
 * Returns null for routes that are not metered.
 */
export function metricsPoint(ctx,durationMs){
 const r=ctx.record,m=ctx.metrics||{};
 if(r.route!=='agent'&&r.route!=='chat')return null;
 const answered=r.route==='agent'?!!r.answered:r.status===200&&!r.error;
 return {
  indexes:[text(r.code)||'none'],
  blobs:[r.route,text(ctx.env?.CF_VERSION_METADATA?.id),text(m.promptHash),text(m.snapshotId),text(m.model),text(r.error),toolCounts(m.tools)],
  doubles:[count(r.status),count(r.model_calls),count(r.rounds_replayed),count(r.wallet_calls),count(r.prompt_tokens),count(r.completion_tokens),count(durationMs),
   flag(m.repaired),flag(m.fallback),flag(answered&&!m.fallback),flag(m.toolRequest),flag(answered),count(m.publicToolCalls),count(r.wallet_results)],
 };
}

/** Writes the point. Never throws and never waits: a missing binding, a throwing binding or a bad record costs nothing. */
export function writeMetrics(ctx,durationMs){
 try{
  const dataset=ctx.env?.AGENT_METRICS;
  if(!dataset||typeof dataset.writeDataPoint!=='function')return;
  const point=metricsPoint(ctx,durationMs);
  if(point)dataset.writeDataPoint(point);
 }catch{}
}

/** First 8 hex digits of a SHA-256: enough to tell one prompt from another, nothing to read back. */
export async function shortHash(value){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 return [...bytes.slice(0,4)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
