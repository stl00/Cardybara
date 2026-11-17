// stl00/Cardybara#478: the baseline report. Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {summarise, format, weekStart, weightedQuantile, DEFAULT_PRICES} from '../scripts/assistant-baseline.mjs';

const root = new URL('..', import.meta.url).pathname;
const row = (o = {}) => ({timestamp: '2026-11-17 10:00:00', _sample_interval: 1, answered: 1, repaired: 0, fallback: 0, error: '', prompt_tokens: 1000, completion_tokens: 100, duration_ms: 2000, ...o});
const many = (n, o) => Array.from({length: n}, () => row(o));
const prices = {inputUsdPerMTok: 1, outputUsdPerMTok: 2};

test('weeks start on Monday UTC and bad timestamps are skipped', () => {
  assert.equal(weekStart('2026-11-22 23:59:59'), '2026-11-16');
  assert.equal(weekStart('2026-11-23'), '2026-11-23');
  const r = summarise([row(), {answered: 1}], prices, {minTurns: 1});
  assert.equal(r.skippedRows, 1);
});

test('sampling weights scale every count, rate and cost', () => {
  // One kept row stands for 10 turns, one repaired row stands for 10 turns: repair rate 50%, not 1 in 2 by luck of counting.
  const heavy = summarise([row({_sample_interval: 10}), row({_sample_interval: 10, repaired: 1})], prices, {minTurns: 1});
  assert.equal(heavy.weeks[0].turns, 20);
  assert.equal(heavy.weeks[0].repairRate, 0.5);
  // Unequal weights: 9 clean turns vs 1 repaired turn is 10%, though the rows are 1:1.
  const skew = summarise([row({_sample_interval: 9}), row({_sample_interval: 1, repaired: 1})], prices, {minTurns: 1});
  assert.ok(Math.abs(skew.weeks[0].repairRate - 0.1) < 1e-9);
  // Tokens per answered turn are weighted too: (9*1100 + 1*1100) / 10.
  assert.equal(skew.weeks[0].tokensPerAnsweredTurn, 1100);
  assert.equal(weightedQuantile([{value: 1, weight: 9}, {value: 100, weight: 1}], 0.95), 100);
  assert.equal(weightedQuantile([{value: 1, weight: 9}, {value: 100, weight: 1}], 0.5), 1);
});

test('an empty dataset gives an empty report and no proposals', () => {
  for (const input of [[], {data: []}, null]) {
    const r = summarise(input, DEFAULT_PRICES);
    assert.deepEqual(r.weeks, []);
    assert.equal(r.observed, null);
    assert.equal(r.proposals, null);
    assert.match(format(r), /nothing is proposed/);
  }
});

test('a week with fewer turns than minTurns is shown but is not used for proposals', () => {
  const thin = summarise([...many(5, {timestamp: '2026-11-10 10:00:00'}), ...many(30, {timestamp: '2026-11-17 10:00:00', repaired: 1})], prices, {minTurns: 20});
  assert.equal(thin.weeks.length, 2);
  assert.equal(thin.weeks[0].enoughData, false);
  assert.deepEqual(thin.weeksUsed, ['2026-11-16']);
  assert.equal(thin.observed.repairRate, 1, 'the thin week does not dilute the pooled figure');
  assert.match(format(thin), /2026-11-09 \(too few turns\)/);
  assert.equal(summarise(many(5), prices, {minTurns: 20}).proposals, null);
});

test('a data point with an error code is a failed turn, and a tool_request is not a turn but still costs tokens', () => {
  const rows = [...many(18), row({answered: 0, error: 'provider_error', prompt_tokens: 500, completion_tokens: 0}), row({answered: 0, error: 'timeout', prompt_tokens: 0, completion_tokens: 0}),
    row({answered: 0, error: '', tool_request: 1, prompt_tokens: 2000, completion_tokens: 0})];
  const w = summarise(rows, prices, {minTurns: 1}).weeks[0];
  assert.equal(w.turns, 20);
  assert.equal(w.answered, 18);
  assert.equal(w.answerSuccessRate, 0.9);
  assert.equal(w.errorRate, 0.1);
  // all tokens (18*1100 + 500 + 2000) over 18 answered turns, priced at 1 / 2 USD per million
  assert.equal(w.tokensPerAnsweredTurn, (18 * 1100 + 2500) / 18);
  assert.ok(Math.abs(w.usdPerAnsweredTurn - (18 * 1000 + 2500) * 1e-6 / 18 - 18 * 100 * 2e-6 / 18) < 1e-12);
});

test('cost per conversation states its proxy and proposals are marked as proposals', () => {
  const r = summarise(many(40, {repaired: 0}), prices, {minTurns: 20, turnsPerConversation: 4});
  const perTurn = (1000 * 1 + 100 * 2) / 1e6;
  assert.ok(Math.abs(r.weeks[0].usdPerConversation - perTurn * 4) < 1e-12);
  assert.match(r.conversationProxy, /x 4 turns per conversation/);
  assert.match(r.proposalNote, /Proposals for the owner/);
  const repair = r.proposals.find(p => p.metric === 'repair rate');
  assert.equal(repair.observed, 0);
  assert.equal(repair.proposed, 5, 'ceiling never below the 5% the alert check uses');
  assert.match(format(r), /PROPOSALS for the owner/);
});

test('CLI reads a file or stdin, makes no network call and rejects bad options', () => {
  const input = JSON.stringify({data: many(25)});
  const run = args => spawnSync(process.execPath, ['scripts/assistant-baseline.mjs', ...args], {cwd: root, input, encoding: 'utf8'});
  const ok = run(['--json', '--min-turns', '10']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).weeks[0].turns, 25);
  assert.match(run(['-']).stdout, /Proposed targets/);
  assert.equal(run(['--nope']).status, 1);
});
