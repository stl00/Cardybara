// Baseline report for the hosted assistant (stl00/Cardybara#478, part of #256): turns the rows the Analytics Engine
// SQL API returns for `cardybara_agent_metrics` into per-week quality and cost figures, and into PROPOSED targets for
// the owner's table in #256. The query it expects is in docs/GATEWAY.md ("Baseline report").
//
//   node scripts/assistant-baseline.mjs rows.json            # or `-`/no argument for stdin
//   options: --input-usd-per-mtok X --output-usd-per-mtok Y --turns-per-conversation N --min-turns N --json
//
// The CLI reads a file or stdin only. It holds no token and makes no network call: fetching the rows is an owner/ops step.
// The data point has no conversation id by design (privacy), so "per conversation" is a stated proxy, not a measurement.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// The gateway's own default prices (gateway/src/gateway.js, docs/GATEWAY.md "Caps"): USD per million tokens.
export const DEFAULT_PRICES = Object.freeze({inputUsdPerMTok: 0.6, outputUsdPerMTok: 2.4});
export const DEFAULTS = Object.freeze({minTurns: 20, turnsPerConversation: 3, monthlyBudgetUsd: 10});

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const weightOf = row => { const w = Number(row._sample_interval ?? row.sample_interval ?? row.w); return Number.isFinite(w) && w > 0 ? w : 1; };
const round = (v, d = 4) => v === null ? null : Math.round(v * 10 ** d) / 10 ** d;

/** Monday (UTC) of the week a timestamp or date falls in, as YYYY-MM-DD; null if it cannot be read. */
export function weekStart(value) {
  const text = String(value ?? '').trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T00:00:00Z' : /Z|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Weighted quantile: the smallest value whose cumulative weight reaches q of the total. */
export function weightedQuantile(items, q) {
  const sorted = items.filter(i => i.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, i) => s + i.weight, 0);
  if (!total) return null;
  let acc = 0;
  for (const i of sorted) { acc += i.weight; if (acc >= q * total - 1e-9) return i.value; }
  return sorted.at(-1).value;
}

const cost = (input, output, prices) => (input * prices.inputUsdPerMTok + output * prices.outputUsdPerMTok) / 1e6;

function figures(rows, prices, turnsPerConversation) {
  let turns = 0, answered = 0, repaired = 0, fallback = 0, errors = 0, tokensIn = 0, tokensOut = 0;
  const durations = [];
  for (const r of rows) {
    const w = weightOf(r);
    tokensIn += w * num(r.prompt_tokens); tokensOut += w * num(r.completion_tokens); // every request is spend, a tool_request too
    const isAnswered = num(r.answered) === 1, hasError = String(r.error ?? '').trim() !== '';
    if (!isAnswered && !hasError) continue; // a request that only asked for wallet tools is not a turn (as in the alert check)
    turns += w;
    if (hasError) errors += w;
    if (isAnswered) {
      answered += w; repaired += w * (num(r.repaired) ? 1 : 0); fallback += w * (num(r.fallback) ? 1 : 0);
      durations.push({value: num(r.duration_ms), weight: w});
    }
  }
  const rate = (n, d) => d > 0 ? n / d : null;
  const perAnswered = d => answered > 0 ? d / answered : null;
  const usd = perAnswered(cost(tokensIn, tokensOut, prices));
  return {
    turns: round(turns, 2), answered: round(answered, 2),
    answerSuccessRate: rate(answered, turns), errorRate: rate(errors, turns),
    repairRate: rate(repaired, answered), fallbackRate: rate(fallback, answered),
    p50DurationMs: weightedQuantile(durations, 0.5), p95DurationMs: weightedQuantile(durations, 0.95),
    tokensPerAnsweredTurn: perAnswered(tokensIn + tokensOut),
    usdPerAnsweredTurn: usd, usdPerConversation: usd === null ? null : usd * turnsPerConversation,
  };
}

const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const floorTo = (v, step) => Math.floor(v / step + 1e-9) * step;

/** Proposed targets from the pooled weeks that have enough turns. Rules are stated in the output. */
function propose(observed, config) {
  if (!observed || !(observed.turns >= config.minTurns)) return null;
  const pct = v => v === null ? null : Math.round(v * 100);
  const out = [];
  const add = (metric, obs, proposed, unit, rule) => out.push({metric, observed: obs, proposed, unit, rule});
  add('answer success', pct(observed.answerSuccessRate), Math.max(0, Math.min(95, floorTo(pct(observed.answerSuccessRate) - 2, 1))), '%', 'floor: the lower of 95% and observed minus 2 points');
  if (observed.repairRate !== null) add('repair rate', pct(observed.repairRate), Math.max(5, ceilTo(pct(observed.repairRate) * 2, 1)), '%', 'ceiling: double the observed rate, at least 5% (the alert check uses the same rule)');
  if (observed.fallbackRate !== null) add('fallback rate', pct(observed.fallbackRate), Math.max(5, ceilTo(pct(observed.fallbackRate) * 2, 1)), '%', 'ceiling: double the observed rate, at least 5% (the alert check uses the same rule)');
  if (observed.p95DurationMs !== null) add('p95 duration', round(observed.p95DurationMs / 1000, 1), ceilTo(observed.p95DurationMs * 1.5 / 1000, 1), 's', 'ceiling: 1.5 times the observed p95, rounded up to a second');
  if (observed.usdPerConversation !== null) {
    add('USD per conversation', round(observed.usdPerConversation, 4), round(ceilTo(observed.usdPerConversation * 1.5, 0.005), 3), 'USD', `ceiling: 1.5 times observed, rounded up to half a cent; at that ceiling the ${config.monthlyBudgetUsd} USD monthly budget covers about ${Math.floor(config.monthlyBudgetUsd / ceilTo(observed.usdPerConversation * 1.5, 0.005))} conversations`);
  }
  return out;
}

/**
 * rows: agent-route rows from the SQL API (see docs/GATEWAY.md "Baseline report"), one per data point, each with
 * `_sample_interval` and the metrics fields. prices: {inputUsdPerMTok, outputUsdPerMTok}.
 * config: {minTurns, turnsPerConversation, monthlyBudgetUsd}.
 */
export function summarise(rows, prices = DEFAULT_PRICES, config = {}) {
  const cfg = {...DEFAULTS, ...config};
  const p = {...DEFAULT_PRICES, ...prices};
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.data) ? rows.data : [];
  const byWeek = new Map();
  let skipped = 0;
  for (const row of list) {
    const week = weekStart(row.week ?? row.timestamp ?? row.day);
    if (!week) { skipped++; continue; }
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(row);
  }
  const weeks = [...byWeek.keys()].sort().map(week => {
    const f = figures(byWeek.get(week), p, cfg.turnsPerConversation);
    return {week, enoughData: f.turns >= cfg.minTurns, ...f};
  });
  const usable = weeks.filter(w => w.enoughData).map(w => w.week);
  const pooled = usable.length ? figures(usable.flatMap(w => byWeek.get(w)), p, cfg.turnsPerConversation) : null;
  const observed = pooled && {...pooled};
  return {
    prices: p, config: cfg, skippedRows: skipped, weeks,
    observed: pooled, weeksUsed: usable,
    conversationProxy: `USD per conversation = USD per answered turn x ${cfg.turnsPerConversation} turns per conversation (an assumption: the data has no conversation id, by design)`,
    proposals: propose(observed, cfg),
    proposalNote: 'Proposals for the owner to accept or change; nothing here is a target until the owner sets it in #256.',
  };
}

const pc = v => v === null || v === undefined ? '-' : (v * 100).toFixed(1) + '%';
const n0 = v => v === null || v === undefined ? '-' : String(Math.round(v));
const usd = v => v === null || v === undefined ? '-' : v.toFixed(4);

/** Plain-text report for a terminal or an issue comment. */
export function format(report) {
  const lines = [];
  lines.push(`Prices: ${report.prices.inputUsdPerMTok} / ${report.prices.outputUsdPerMTok} USD per million input / output tokens. Weeks with fewer than ${report.config.minTurns} turns are shown but not used.`);
  lines.push('', '| week (Mon, UTC) | turns | success | repair | fallback | p50 ms | p95 ms | tokens/answer | USD/answer | USD/conv |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const w of report.weeks) {
    const thin = !w.enoughData;
    lines.push(`| ${w.week}${thin ? ' (too few turns)' : ''} | ${n0(w.turns)} | ${thin ? '-' : pc(w.answerSuccessRate)} | ${thin ? '-' : pc(w.repairRate)} | ${thin ? '-' : pc(w.fallbackRate)} | ${thin ? '-' : n0(w.p50DurationMs)} | ${thin ? '-' : n0(w.p95DurationMs)} | ${thin ? '-' : n0(w.tokensPerAnsweredTurn)} | ${thin ? '-' : usd(w.usdPerAnsweredTurn)} | ${thin ? '-' : usd(w.usdPerConversation)} |`);
  }
  if (!report.weeks.length) lines.push('| (no rows) | | | | | | | | | |');
  lines.push('', report.conversationProxy);
  lines.push('', 'Proposed targets (PROPOSALS for the owner, not decisions)');
  if (!report.proposals) lines.push(`No week has ${report.config.minTurns} turns yet, so nothing is proposed.`);
  else for (const p of report.proposals) lines.push(`- ${p.metric}: observed ${p.observed}${p.unit}, proposed ${/floor/.test(p.rule) ? 'floor' : 'ceiling'} ${p.proposed}${p.unit} (${p.rule})`);
  if (report.skippedRows) lines.push('', `${report.skippedRows} row(s) skipped: no readable timestamp.`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = {file: null, json: false, prices: {}, config: {}};
  const value = (i, name) => { const v = Number(argv[i + 1]); if (!Number.isFinite(v) || v < 0) throw new Error(`${name} needs a non-negative number`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--input-usd-per-mtok') opts.prices.inputUsdPerMTok = value(i++, a);
    else if (a === '--output-usd-per-mtok') opts.prices.outputUsdPerMTok = value(i++, a);
    else if (a === '--turns-per-conversation') opts.config.turnsPerConversation = value(i++, a);
    else if (a === '--min-turns') opts.config.minTurns = value(i++, a);
    else if (a === '--monthly-budget-usd') opts.config.monthlyBudgetUsd = value(i++, a);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.file = a;
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const text = readFileSync(opts.file && opts.file !== '-' ? opts.file : 0, 'utf8');
    const report = summarise(JSON.parse(text), opts.prices, opts.config);
    console.log(opts.json ? JSON.stringify(report, null, 2) : format(report));
  } catch (error) { console.error(error.message); process.exit(1); }
}
