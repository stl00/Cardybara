// A small Chrome DevTools driver for the phone-width tests: dist/web served from loopback in headless Chrome at
// 375x812 (mobile emulation), synthetic state only, no bank and no network beyond 127.0.0.1.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WEB_DIR, serve} from '../../scripts/web-chrome.mjs';
import {findChrome, SANDBOX_SAFE_ARGS} from '../../scripts/dev-collector/chrome-launcher.mjs';

export {WEB_DIR};
export const PHONE = {width: 375, height: 812};
const wait = ms => new Promise(r => setTimeout(r, ms));

function cdpPipe(child) {
  let next = 0, buffer = Buffer.alloc(0), gone = null;
  const pending = new Map();
  const fail = reason => { gone = gone || reason; for (const [id, p] of pending) { pending.delete(id); p.reject(Error(`${p.method}: ${gone}`)); } };
  child.on('error', e => fail('Chrome failed to start (' + e.message + ')'));
  child.on('exit', (code, signal) => fail(`Chrome exited (${signal || code})`));
  for (const s of [child.stdio[3], child.stdio[4]]) s.on('error', e => fail('pipe closed (' + e.message + ')'));
  child.stdio[4].on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    let i;
    while ((i = buffer.indexOf(0)) >= 0) {
      const msg = JSON.parse(buffer.subarray(0, i).toString('utf8'));
      buffer = buffer.subarray(i + 1);
      const p = msg.id === undefined ? null : pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); }
    }
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (gone) return reject(Error(`${method}: ${gone}`));
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error(method + ': no answer in 30 s')); }, 30000);
    pending.set(id, {resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); }, method});
    child.stdio[3].write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0');
  });
}

// Runs inside the page. `overflow`: a visible element that sticks out of the 375 px viewport and is not clipped by a
// scroll container of its own. `small`: a visible control whose hit area is under 44 px either way.
export const AUDIT = `(()=>{
  const vw=document.documentElement.clientWidth,round=n=>Math.round(n*10)/10;
  const label=el=>el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+[...el.classList].slice(0,3).map(c=>'.'+c).join('')+' "'+(el.getAttribute('aria-label')||el.innerText||el.value||'').trim().replace(/\\s+/g,' ').slice(0,30)+'"';
  const shown=el=>{const s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0;};
  const hidden=e=>{const s=getComputedStyle(e);return s.display==='none'||s.visibility==='hidden'||+s.opacity===0;};
  const reallyShown=el=>{for(let e=el;e&&e!==document.body;e=e.parentElement)if(hidden(e))return false;return !el.closest('[aria-hidden="true"],[inert]');};
  const clipped=el=>{for(let p=el.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o!=='visible'){const r=p.getBoundingClientRect();if(r.left>=-1&&r.right<=vw+1)return true;}}return false;};
  const overflow=[],small=[];
  for(const el of document.body.querySelectorAll('*')){
    if(/^(SCRIPT|STYLE|LINK|META|HEAD|TITLE|PATH|G|DEFS|CIRCLE|RECT|LINE|POLYLINE)$/i.test(el.tagName)||el instanceof SVGElement&&el.tagName!=='svg')continue;
    if(!shown(el)||!reallyShown(el))continue;
    const r=el.getBoundingClientRect();
    if((r.right>vw+1||r.left<-1)&&!clipped(el)){
      // Only the outermost offender: a child of an element already reported adds nothing.
      if(!overflow.some(o=>o.el.contains(el)))overflow.push({el,why:label(el)+' '+round(r.left)+'..'+round(r.right)});
    }
  }
  const sel='button,a[href],input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox],[role=radio],.ant-select-selector,.ant-checkbox-wrapper,.ant-radio-wrapper,.ant-segmented-item,.ant-tabs-tab';
  for(const el of document.body.querySelectorAll(sel)){
    if(!shown(el)||!reallyShown(el))continue;
    if(el.closest('.ant-select-selector')&&!el.matches('.ant-select-selector'))continue;
    if(el.matches('.ant-select-selection-search-input,[disabled],.ant-btn-icon-only[aria-hidden]'))continue;
    // An inline link inside a sentence is exempt (WCAG 2.5.8); every other control is measured by the box a finger hits.
    if(el.matches('a:not(.ant-btn)')&&getComputedStyle(el).display==='inline')continue;
    const box=el.matches('input,.ant-switch,.ant-segmented-item')?(el.closest('.ant-input-number,.ant-input-affix-wrapper,.ant-picker,.ant-select,label,.ant-segmented-item')||el):el;
    if(el.closest('[role=tablist]')&&el.matches('[role=tab]')===false&&el.matches('button'))continue;
    const r=box.getBoundingClientRect();
    if(r.bottom<0||r.top>innerHeight*3)continue;
    if((r.width<43.5||r.height<43.5)&&!small.some(o=>o.el===box))small.push({el:box,why:label(box)+' '+round(r.width)+'x'+round(r.height)});
  }
  const strip=l=>l.map(o=>o.why);
  return {scrollWidth:document.documentElement.scrollWidth,vw,bodyScrollWidth:document.body.scrollWidth,overflow:strip(overflow),small:strip(small),
    modals:[...document.querySelectorAll('.ant-modal-container,.ant-drawer-section')].filter(e=>!hidden(e)&&reallyShown(e)).map(e=>{const r=e.getBoundingClientRect();return {cls:(e.closest('.ant-modal,.ant-drawer')||e).className.replace(/css-\S+/g,'').trim().slice(0,60),l:round(r.left),r:round(r.right),t:round(r.top),b:round(r.bottom)};})};
})()`;

export async function withPhone(fn, {dir = WEB_DIR, init = ''} = {}) {
  const work = await mkdtemp(join(tmpdir(), 'cardybara-phone-'));
  let server, child;
  try {
    server = await serve(dir);
    const origin = `http://127.0.0.1:${server.address().port}`;
    child = spawn(await findChrome(), ['--user-data-dir=' + join(work, 'profile'), '--remote-debugging-pipe', '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', ...SANDBOX_SAFE_ARGS, 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']});
    const send = cdpPipe(child);
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const page = (m, p) => send(m, p, sessionId);
    await page('Page.enable');
    await page('Runtime.enable');
    await page('Emulation.setDeviceMetricsOverride', {...PHONE, deviceScaleFactor: 2, mobile: true});
    await page('Emulation.setEmulatedMedia', {features: [{name: 'prefers-color-scheme', value: 'light'}]});
    if (init) await page('Page.addScriptToEvaluateOnNewDocument', {source: init});
    const evaluate = async expression => {
      const r = await page('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const ctl = {
      origin, evaluate, page,
      goto: async path => { await page('Page.navigate', {url: origin + path}); await ctl.until(`!!document.querySelector('#root > *')`); },
      // Polls a page expression until it is truthy.
      until: async (expr, what = expr, ms = 8000) => {
        for (let t = 0; t < ms / 50; t++) { if (await evaluate(`!!(${expr})`)) return; await wait(50); }
        throw Error('timed out waiting for ' + what);
      },
      pause: wait,
      audit: () => evaluate(AUDIT),
      text: () => evaluate(`document.body.innerText`),
      // A real tap: scrolls the element into view, then sends touch-style mouse events at its centre.
      tap: async (selector, match) => {
        const text = typeof match === 'string' ? match : match?.text;
        const find = `(()=>{const all=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'});const e=${text ? `all.find(e=>(e.innerText||e.value||e.getAttribute('aria-label')||'').includes(${JSON.stringify(text)}))` : 'all[0]'};if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`;
        let at = null;
        for (let t = 0; t < 100 && !at; t++) { at = await evaluate(find); if (!at) await wait(50); }
        if (!at) throw Error(`nothing to tap: ${selector}${text ? ' / ' + text : ''}`);
        await wait(60);
        at = await evaluate(find);
        for (const type of ['mousePressed', 'mouseReleased']) await page('Input.dispatchMouseEvent', {type, x: at.x, y: at.y, button: 'left', clickCount: 1});
        await wait(150);
      },
      // Focuses a field and types into it like a keyboard would.
      type: async (selector, value) => {
        await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});e.focus();if(e.select)e.select();})()`);
        await page('Input.insertText', {text: value});
        await wait(100);
      },
      // Sets a controlled input the way a date picker does, then lets React see it.
      setValue: async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`),
      shot: async file => writeFile(file, Buffer.from((await page('Page.captureScreenshot', {format: 'png'})).data, 'base64')),
    };
    return await fn(ctl);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit').catch(() => {}); child.kill(); await Promise.race([exited, wait(5000)]); }
    server?.closeAllConnections?.();
    server?.close();
    await rm(work, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
  }
}
