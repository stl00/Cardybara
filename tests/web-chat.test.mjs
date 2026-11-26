// #463: the web wallet's assistant, driven end to end in real headless Chrome at 375 px on the built dist/web, served with
// its shipped _headers (so the real Content-Security-Policy applies), against a scripted loopback gateway. A synthetic card
// is entered by hand, the assistant is asked one question and its streamed answer shows. Negative control: a gateway that
// refuses over its daily cap makes the same check fail, and the wallet shows the cap message, not a blank answer.
// Runs only in CI's `npm run test:web` (SEPARATE in scripts/run-tests.mjs), like the other Chrome checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {WEB_DIR, PHONE, withPhone, openManualAdd} from './helpers/mobile-chrome.mjs';
import {startScriptedGateway, ANSWER_MARK, QUESTION} from './helpers/scripted-gateway.mjs';
import {headersFor} from '../scripts/web-chrome.mjs';
import {findChrome} from '../scripts/dev-collector/chrome-launcher.mjs';
import {GUIDE_KEY} from '../src/webFirstLaunch.js';

const required = process.env.npm_lifecycle_event === 'test:web';
const SENTINEL_TAIL = '7391';
const SENTINEL_DUE = '2031-03-17';
const CAP_MESSAGE = '今天从这个网络使用托管服务的次数已到上限，请明天再试。';
// The request contract of src/cloudProtocol.js: a first request carries exactly these fields.
const REQUEST_FIELDS = ['history', 'memory', 'question', 'summary'];

const skip = (!required && !existsSync(WEB_DIR) && 'dist/web is not built (npm run build:web); npm run test:web runs this')
  || await findChrome().then(() => false, () => 'no Chrome on this machine');

// The gateway origin the shipped CSP allows: the page may talk to it and to its own origin, nothing else.
async function shippedGateway() {
  const csp = headersFor(await readFile(join(WEB_DIR, '_headers'), 'utf8'))['Content-Security-Policy'];
  const connect = /(?:^|;)\s*connect-src\s+([^;]*)/.exec(csp)[1].trim().split(/\s+/).filter(s => s !== "'self'");
  assert.equal(connect.length, 1, 'connect-src names exactly one origin besides the page');
  return new URL(connect[0]);
}

// Enters one synthetic card by hand, opens the assistant and asks the question. Returns what the page made.
async function chat({dailyRequests}) {
  assert.ok(!required || existsSync(WEB_DIR), 'dist/web must be built (npm run build:web) before npm run test:web');
  const gatewayUrl = await shippedGateway();
  const gateway = await startScriptedGateway({host: gatewayUrl.hostname, dir: WEB_DIR, dailyRequests});
  const requested = [];
  try {
    return await withPhone(async c => {
      gateway.allow(gateway.pageOrigin);
      await c.page('Network.enable');
      await c.goto('/');
      await c.until(`document.querySelector('.empty-wallet-manual')`, 'the empty wallet');
      await openManualAdd(c, '.empty-wallet-manual');
      await c.until(`document.querySelector('.product-tile')`, 'the card catalogue');
      await c.tap('.product-tile');
      await c.until(`document.querySelector('.add-card-tail')`, 'the add-card form');
      await c.type('.add-card-tail', SENTINEL_TAIL);
      await c.evaluate(`document.querySelectorAll('.add-card-form .ant-input-number-input')[0].focus()`);
      await c.page('Input.insertText', {text: '12'});
      await c.evaluate(`document.querySelectorAll('.add-card-form .ant-input-number-input')[1].focus()`);
      await c.page('Input.insertText', {text: '15'});
      await c.tap('.add-card-modal .ant-btn-primary');
      await c.until(`!document.querySelector('.add-card-modal') && document.querySelector('.payment-assistant')`, 'the saved card');
      // A due date by hand too, so the wallet holds a value that must never reach the gateway.
      await c.tap('.mobile-tabbar [data-nav-key="wallet"]');
      await c.until(`document.querySelector('.card-title')`, 'the card list');
      await c.tap('.card-title');
      await c.until(`document.querySelector('.ant-drawer .manual-bill-edit')`, 'the card detail');
      await c.tap('.ant-drawer .manual-bill-edit');
      await c.until(`document.querySelector('.manual-bill-modal input#due')`, 'the statement form');
      await c.setValue('.manual-bill-modal input#due', SENTINEL_DUE);
      await c.tap('.manual-bill-modal .ant-btn-primary');
      await c.until(`!document.querySelector('.manual-bill-modal .ant-modal-container')`, 'the statement form to close');
      assert.ok((await c.text()).includes(SENTINEL_DUE), 'the due date shows on the card');
      // The assistant page, the way the sidebar's link opens it (the wallet routes on the hash).
      await c.evaluate(`location.hash = 'advisor'`);
      await c.until(`document.querySelector('.chat-compose textarea') && !document.querySelector('.chat-compose textarea').disabled`, 'the chat composer');
      await c.type('.chat-compose textarea', QUESTION);
      await c.page('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r'});
      const outcome = await c.until(`document.body.innerText.includes(${JSON.stringify(ANSWER_MARK)}) || document.body.innerText.includes(${JSON.stringify(CAP_MESSAGE)})`, 'an answer or the cap message', 20000).then(() => 'settled');
      await c.pause(300);
      const a = await c.audit();
      return {text: await c.text(), audit: a, outcome, requested, gatewayOrigin: gatewayUrl.origin, pageOrigin: c.origin, gateway};
    }, {
      origin: gateway.pageOrigin,
      args: gateway.chromeArgs(),
      init: `localStorage.setItem('cardybara-language','zh-CN');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');`,
      onEvent: msg => { if (msg.method === 'Network.requestWillBeSent') requested.push(msg.params.request.url); },
    });
  } finally { await gateway.close(); }
}

test('the web assistant answers a question from the scripted gateway at 375 px', {timeout: 150000, skip}, async () => {
  const r = await chat({dailyRequests: 50});
  assert.ok(r.text.includes(ANSWER_MARK), 'the streamed answer shows');
  assert.ok(!r.text.includes(CAP_MESSAGE), 'no cap message');
  assert.equal(r.audit.vw, PHONE.width);
  assert.ok(r.audit.scrollWidth <= PHONE.width, `no horizontal scroll (${r.audit.scrollWidth}px)`);

  // Every request the page made went to its own origin or the gateway, nothing else.
  const origins = new Set(r.requested.filter(u => !/^(data|blob|about):/.test(u)).map(u => new URL(u).origin));
  assert.ok(origins.has(r.gatewayOrigin), 'the page reached the gateway');
  for (const o of origins) assert.ok(o === r.pageOrigin || o === r.gatewayOrigin, `a request went to ${o}`);

  // What the gateway received: the agent request only, with the fields the contract allows and none of the wallet's values.
  const posts = r.gateway.requests.filter(q => q.method === 'POST');
  assert.ok(posts.length >= 1 && posts.every(q => q.path === '/v1/chat'), 'only the agent route was posted to: ' + posts.map(q => q.path));
  for (const q of r.gateway.requests) {
    assert.equal(q.origin, r.pageOrigin, 'the gateway saw the page origin');
    assert.equal(q.authorization, null, 'no credential was sent');
  }
  for (const q of posts) {
    const body = JSON.parse(q.raw);
    assert.deepEqual(Object.keys(body).sort(), REQUEST_FIELDS, 'the request holds only the contract fields');
    assert.equal(body.question, QUESTION);
    for (const secret of [SENTINEL_TAIL, SENTINEL_DUE]) assert.ok(!q.raw.includes(secret), `${secret} left the browser`);
  }
});

test('negative control: a gateway over its daily cap makes the check fail and the wallet shows the cap message', {timeout: 150000, skip}, async () => {
  const r = await chat({dailyRequests: 0});
  assert.ok(r.text.includes(CAP_MESSAGE), 'the cap message shows');
  assert.ok(!r.text.includes(ANSWER_MARK), 'no answer');
  assert.ok(r.gateway.requests.some(q => q.method === 'POST' && q.path === '/v1/chat'), 'the wallet did ask the gateway');
  // The positive check's assertion on the answer would fail on this page: that is what makes it a control.
  assert.throws(() => assert.ok(r.text.includes(ANSWER_MARK), 'the streamed answer shows'));
});

// #655: the mic button, at phone and desktop width, with a mocked recognizer (no microphone). VOICE_SHOTS=<dir> keeps
// screenshots of the composer on the empty synthetic wallet.
const DESKTOP = {width: 1280, height: 800};
const MIC = '.chat-compose .chat-mic';
const BOX = '.chat-compose textarea';
const HEARD = 'which card for dinner?';
const fakeRecognizer = mode => mode === 'none'
  ? `Object.defineProperty(window,'SpeechRecognition',{value:undefined});Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined});`
  : `window.__recs=[];window.SpeechRecognition=class{
      static available(){return Promise.resolve(${JSON.stringify(mode === 'local' ? 'available' : 'unavailable')})}
      constructor(){window.__recs.push(this)}
      start(){}
      stop(){this.onend&&this.onend()}
      abort(){}
      say(t){this.onresult({results:[[{transcript:t}]]})}
    };`;

async function voice(mode, desktop) {
  const gatewayUrl = await shippedGateway();
  const gateway = await startScriptedGateway({host: gatewayUrl.hostname, dir: WEB_DIR});
  try {
    return await withPhone(async c => {
      gateway.allow(gateway.pageOrigin);
      if (desktop) await c.page('Emulation.setDeviceMetricsOverride', {...DESKTOP, deviceScaleFactor: 1, mobile: false});
      await c.goto('/#advisor');
      await c.until(`document.querySelector('${BOX}') && !document.querySelector('${BOX}').disabled`, 'the chat composer');
      if (mode === 'none') {
        await c.pause(300);
        assert.equal(await c.evaluate(`!!document.querySelector('${MIC}')`), false, 'no mic button without the API');
        return;
      }
      const value = () => c.evaluate(`document.querySelector('${BOX}').value`);
      const pressed = () => c.evaluate(`document.querySelector('${MIC}').getAttribute('aria-pressed')`);
      const shoot = async name => {
        if (!process.env.VOICE_SHOTS) return;
        for (const scheme of ['light', 'dark']) {
          await c.page('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: scheme}]});
          await c.pause(500);
          await c.shot(join(process.env.VOICE_SHOTS, `${name}-${scheme}.png`));
        }
        await c.page('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'light'}]});
      };
      await shoot(`composer-${desktop ? 'desktop' : 'phone'}-${mode}`);
      await c.type(BOX, 'Tonight:');
      await c.tap(MIC);
      if (mode === 'cloud') {
        await c.until(`document.querySelector('.ant-modal-confirm')`, 'the cloud notice');
        await shoot(`notice-${desktop ? 'desktop' : 'phone'}`);
        assert.equal(await c.evaluate(`window.__recs.length`), 0, 'no recognizer before consent');
        await c.tap('.ant-modal-confirm .ant-btn-default');
        await c.until(`!document.querySelector('.ant-modal-confirm')`, 'the notice to close');
        assert.equal(await c.evaluate(`window.__recs.length`), 0, 'declining makes none');
        await c.tap(MIC);
        await c.until(`document.querySelector('.ant-modal-confirm')`, 'the notice again');
        await c.tap('.ant-modal-confirm .ant-btn-primary');
      }
      await c.until(`window.__recs.length===1 && document.querySelector('${MIC}[aria-pressed="true"]')`, 'the recording state');
      assert.equal(await c.evaluate(`window.__recs[0].lang`), 'en-US');
      assert.equal(await c.evaluate(`window.__recs[0].processLocally===true`), mode === 'local');
      await c.evaluate(`window.__recs[0].say(${JSON.stringify(HEARD)})`);
      await c.pause(100);
      assert.equal(await value(), `Tonight: ${HEARD}`);
      await shoot(`recording-${desktop ? 'desktop' : 'phone'}-${mode}`);
      await c.tap(MIC);
      await c.pause(200);
      assert.equal(await pressed(), 'false');
      assert.equal(await value(), `Tonight: ${HEARD}`);
      assert.equal(await c.evaluate(`document.activeElement===document.querySelector('${BOX}')`), true, 'focus returns to the box');
      assert.equal(await c.evaluate(`document.querySelectorAll('.chat-bubble').length`), 0, 'nothing was sent');
      assert.ok(!gateway.requests.some(q => q.path === '/v1/chat' && q.method === 'POST'), 'the gateway got no question');
      const a = await c.audit();
      assert.ok(a.scrollWidth <= a.vw, `no horizontal scroll (${a.scrollWidth}px)`);
      // Checked before Settings, whose account card asks the scripted gateway for routes it does not have.
      assert.deepEqual(c.errors, []);
      if (mode === 'cloud') {
        // The consent is remembered, and Settings takes it back.
        await c.evaluate(`location.hash='settings'`);
        await c.until(`document.querySelector('.voice-settings .ant-switch-checked')`, 'the voice setting, on');
        await c.tap('.voice-settings .ant-switch');
        await c.until(`!document.querySelector('.voice-settings .ant-switch-checked')`, 'the voice setting, off');
        assert.equal(await c.evaluate(`localStorage.getItem('cardybara-voice-cloud-v1')`), null);
      }
    }, {
      origin: gateway.pageOrigin,
      args: gateway.chromeArgs(),
      init: `localStorage.setItem('cardybara-language','en-US');localStorage.setItem(${JSON.stringify(GUIDE_KEY)},'1');` + fakeRecognizer(mode),
    });
  } finally { await gateway.close(); }
}

for (const desktop of [false, true]) for (const mode of ['none', 'local', 'cloud']) {
  test(`voice input, ${desktop ? 'desktop' : 'phone'}, ${mode === 'none' ? 'no speech API: no button' : mode + ' recognizer: the words reach the box and nothing is sent'}`, {timeout: 90000, skip}, () => voice(mode, desktop));
}
