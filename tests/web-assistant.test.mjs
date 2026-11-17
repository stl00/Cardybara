// The web wallet uses the hosted assistant with no invite code (stl00/Cardybara#389): there is no extension storage,
// so the hosted service is on, own-key mode does not exist, the CSP names exactly the gateway, and the request is
// the same one the extension sends. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GATEWAY_ORIGIN,PROVIDERS,HOSTED,keyStatus,hostedReady,ownKeyAllowed,saveKey,setModelEnabled,postAgent,validKey} from '../extension-next/model-client.js';
import {runCloudTurn} from '../src/cloudChat.js';
import {MAX_REQUEST_BYTES} from '../src/cloudProtocol.js';
import {webHeaders,webGatewayOrigin} from '../scripts/web-build.mjs';
import platform from '../src/platform/index.js';

const SENTINEL='9876543210';
const card={id:'acct-web-test',bank:'Amex',region:'US',name:'American Express Gold Card',balance:1234.56,tail:'7319',due:'2026-11-23'};
const sse=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{status:200,headers:{'Content-Type':'text/event-stream'}});

test('the web channel has no extension storage and is not the dev server', () => {
  assert.equal(globalThis.chrome, undefined);
  assert.equal(platform.kind, 'web');
});

test('the web origin chats with no code: the hosted service is on and nothing is stored', async () => {
  const status = await keyStatus();
  assert.deepEqual([status.provider, status.hosted, status.ready, status.saved], [HOSTED, true, true, false]);
  assert.equal(await hostedReady(), true);
});

test('own-key mode is unavailable on the web', async () => {
  assert.equal(await ownKeyAllowed(), false);
  await assert.rejects(saveKey({provider: 'deepseek', key: 'sk-' + 'a'.repeat(30)}), /storage_unavailable/);
  await assert.rejects(setModelEnabled(false), /model_not_ready/);
  assert.equal(validKey('sk-' + 'a'.repeat(30)), true);
});

test('CSP connect-src allows exactly the gateway origin', () => {
  assert.equal(webGatewayOrigin({}), GATEWAY_ORIGIN);
  const csp = /Content-Security-Policy:\s*(.+)/.exec(webHeaders(webGatewayOrigin({})))[1];
  const connect = /(?:^|;)\s*connect-src\s+([^;]*)/.exec(csp)[1].trim().split(/\s+/);
  assert.deepEqual(connect, ["'self'", GATEWAY_ORIGIN]);
  assert.equal(webGatewayOrigin({CARDYBARA_GATEWAY_ORIGIN: 'https://staging.example'}), 'https://staging.example');
});

test('a web chat turn posts one hosted-agent request that passes the cloudProtocol checks', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({url, init});
    return sse([{type: 'done', answer: 'Synthetic answer.', memory: {}, history: [], tools: []}]);
  };
  try {
    const r = await runCloudTurn({question: 'Which card for dining?', context: {cards: [card], events: [], day: '2026-10-28', language: 'en-US'}, post: postAgent});
    assert.equal(r.answer, 'Synthetic answer.');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(seen.length, 1);
  const {url, init} = seen[0];
  assert.equal(url, PROVIDERS[HOSTED].agent);
  assert.equal(new URL(url).origin, GATEWAY_ORIGIN);
  assert.equal(init.credentials, 'omit');
  assert.ok(!Object.keys(init.headers).some(h => /authorization/i.test(h)), 'no credential is sent');
  assert.ok(new TextEncoder().encode(init.body).byteLength <= MAX_REQUEST_BYTES);
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ['history', 'memory', 'question', 'summary']);
  for (const secret of ['1234.56', '7319', '2026-11-23', 'acct-web-test', SENTINEL]) assert.ok(!init.body.includes(secret), secret + ' left the browser');
});
