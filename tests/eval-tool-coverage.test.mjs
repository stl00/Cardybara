// Every assistant tool must appear at all three eval levels, or sit on the dated exemption list below (#483).
// Offline: the tool name in an evals/fixtures.mjs case (comments ignored). Live: a case named in evals/live/config.json
// whose expectTool/expectTools/expectAllTools has the tool. Multi-turn: a dialogue whose expect.tool is the tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {agentTools} from '../src/walletAgent.js';
import {liveCases} from '../evals/fixtures.mjs';
import {dialogues} from '../evals/multiturn/dialogues.mjs';

const LEVELS = ['offline', 'live', 'multiturn'];
// Dated exemptions: {tool, level, reason, issue, since}. Today's gaps for the points and trip tools were closed by
// #481 (live) and #482 (multi-turn), so what is left is the tool no user question chooses and the live set's missing find_benefits case. Remove an entry when it is covered.
const EXEMPTIONS = [
  {tool: 'find_benefits', level: 'live', issue: 38, since: '2026-11-17',
    reason: 'No find_benefits case is in evals/live/config.json, which is at its cap of 14; a case must be swapped in or the cap raised (no separate issue yet, tracked by the epic).'},
  ...LEVELS.map(level => ({tool: 'list_cards', level, issue: 'by design', since: '2026-11-17',
    reason: 'Reads the wallet for the model before other tools; no user question is answered by it alone, so no case can expect it.'})),
];

const registry = agentTools.map(t => t.function.name);
const config = JSON.parse(readFileSync(new URL('../evals/live/config.json', import.meta.url), 'utf8'));
const fixtureSource = readFileSync(new URL('../evals/fixtures.mjs', import.meta.url), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const liveTools = liveCases.filter(c => config.cases.includes(c.id))
  .flatMap(c => [c.expectTool, ...(c.expectTools || []), ...(c.expectAllTools || [])]);
const evidence = {
  offline: tool => new RegExp(`\\b${tool}\\b`).test(fixtureSource),
  live: tool => liveTools.includes(tool),
  multiturn: tool => dialogues.some(d => d.expect?.tool === tool),
};

// Problem lines for a tool list, an evidence map and an exemption list.
export function problems(tools, has, exemptions) {
  const out = [];
  for (const tool of tools) for (const level of LEVELS) {
    const covered = has[level](tool), exempt = exemptions.some(e => e.tool === tool && e.level === level);
    if (!covered && !exempt) out.push(`${tool} has no ${level} case and no exemption`);
    if (covered && exempt) out.push(`${tool} is covered at ${level} but still exempted`);
  }
  for (const e of exemptions) if (!tools.includes(e.tool)) out.push(`exemption for unknown tool ${e.tool}`);
  return out;
}

test('every assistant tool has an offline case, a live case and a multi-turn dialogue, or a dated exemption', () => {
  assert.ok(registry.length >= 9);
  assert.deepEqual(problems(registry, evidence, EXEMPTIONS), []);
});

test('each exemption names its tool, level, reason, issue and date', () => {
  for (const e of EXEMPTIONS) {
    assert.ok(LEVELS.includes(e.level), e.level);
    assert.ok(e.reason.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(e.since) && (typeof e.issue === 'number' || e.issue === 'by design'), JSON.stringify(e));
  }
});

test('negative control: a tool added without a case or exemption fails, and so does a stale exemption', () => {
  const added = [...registry, 'new_tool'];
  assert.deepEqual(problems(added, evidence, EXEMPTIONS), LEVELS.map(l => `new_tool has no ${l} case and no exemption`));
  assert.deepEqual(problems(added, evidence, [...EXEMPTIONS, {tool: 'new_tool', level: 'live'}]).filter(p => p.startsWith('new_tool is')), []);
  const stale = [...EXEMPTIONS, {tool: 'choose_card', level: 'live', issue: 1}];
  assert.deepEqual(problems(registry, evidence, stale), ['choose_card is covered at live but still exempted']);
  assert.deepEqual(problems(registry, evidence, [{tool: 'gone_tool', level: 'live'}]).filter(p => p.includes('gone_tool')), ['exemption for unknown tool gone_tool']);
});
