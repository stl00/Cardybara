// A scripted stand-in for the hosted gateway, for the browser checks of the web wallet (#463). It runs the gateway's own
// request handler on in-memory bindings (gateway/src/local.mjs) behind a loopback HTTPS server; its provider is a scripted
// model that streams its answer. Chrome is pointed at it with a host rule, so the wallet calls the real gateway origin
// (the one the shipped Content-Security-Policy names) and nothing leaves this machine. Synthetic data only, no secret.
import {execFileSync} from 'node:child_process';
import {createHash, createPublicKey} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localGateway} from '../../gateway/src/local.mjs';
import {staticHandler} from '../../scripts/web-chrome.mjs';
import {providerResponse} from './agent-target.mjs';

export const ANSWER_MARK = 'Synthetic scripted answer';
export const QUESTION = 'Which card should I use for dining?';
const PROVIDER_KEY = 'scripted-gateway-provider-key-not-real';

// `host`: the gateway's host name (from the shipped _headers). `dir`: the built web app, served over HTTPS (the gateway admits
// only an https web origin) at `pageHost` by the same loopback server, with its shipped headers.
// `script`: one scripted model message per provider call.
export const PAGE_HOST = 'wallet.cardybara.test';
export async function startScriptedGateway({host, dir, pageHost = PAGE_HOST, script = [() => ({content: `${ANSWER_MARK}: use the card you added.`})], dailyRequests = 50} = {}) {
  const work = await mkdtemp(join(tmpdir(), 'cardybara-gateway-'));
  const key = join(work, 'key.pem'), cert = join(work, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=' + host, '-addext', `subjectAltName=DNS:${host},DNS:${pageHost}`], {stdio: 'ignore'});
  const spki = createHash('sha256').update(createPublicKey(await readFile(cert)).export({type: 'spki', format: 'der'})).digest('base64');
  const state = {handle: null, requests: [], providerCalls: 0};
  const page = await staticHandler(dir);
  const server = createServer({key: await readFile(key), cert: await readFile(cert)}, (req, res) => {
    if ((req.headers.host || '').split(':')[0] === pageHost) { page(req, res); return; }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      state.requests.push({method: req.method, path: req.url, origin: req.headers.origin || null, authorization: req.headers.authorization || null, raw});
      if (!state.handle) { res.writeHead(503).end(); return; }
      const headers = Object.fromEntries(['origin', 'authorization', 'content-type', 'access-control-request-method', 'access-control-request-headers'].filter(h => req.headers[h]).map(h => [h, req.headers[h]]));
      const response = await state.handle(new Request(`https://${host}${req.url}`, {method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : {body: raw})}));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { res.end(); return; }
      const reader = response.body.getReader();
      res.on('close', () => { reader.cancel().catch(() => {}); });
      try { for (;;) { const {done, value} = await reader.read(); if (done) break; res.write(Buffer.from(value)); } } catch {}
      res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    host, pageOrigin: 'https://' + pageHost, port: server.address().port, spki, requests: state.requests, providerCalls: () => state.providerCalls,
    // The gateway allows only the page's origin, known once the page's server is up.
    allow(origin) {
      state.handle = localGateway({
        vars: {PROVIDER_KEY, ALLOWED_ORIGINS: origin, DAILY_REQUESTS_PER_CLIENT: String(dailyRequests)},
        fetch: async (url, init) => {
          const body = JSON.parse(init.body), step = script[state.providerCalls++];
          if (!step) return new Response(JSON.stringify({error: {message: 'scripted: no step ' + state.providerCalls}}), {status: 500, headers: {'Content-Type': 'application/json'}});
          return providerResponse({message: await step(body)}, {stream: body.stream === true});
        },
      }).handle;
    },
    chromeArgs: () => [`--host-rules=MAP ${host} 127.0.0.1:${server.address().port}, MAP ${pageHost} 127.0.0.1:${server.address().port}`, '--ignore-certificate-errors-spki-list=' + spki],
    async close() { await new Promise(r => { server.close(r); server.closeAllConnections(); }); await rm(work, {recursive: true, force: true}); },
  };
}
