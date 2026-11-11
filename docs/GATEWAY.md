# Hosted gateway and assistant

Beta testers chat without their own model key. A Cloudflare Worker holds the owner's provider key and, for testers with an invite code:

- runs the **assistant agent** (`POST /v1/chat`, stl00/Cardybara#210): the agent loop, system prompt, model calls and the tools over public knowledge run in the Worker and stream the answer; the tools that read the wallet run in the extension, which posts back only their results (below);
- relays **single completions** (`POST /v1/chat/completions`, stl00/Cardybara#208), used for AI card-type suggestions.

The wallet is never uploaded. Prompt, model and knowledge changes ship by redeploying the Worker, without an extension release.

**Beta UI:** the hosted service is the only mode testers see: one invite code in Settings, no model key field, no provider choice, and no model-assisted bank parsing. An own provider key is a developer-only mode (local development and the owner's live evals), switched on by setting `chrome.storage.local` `cardybara-dev-own-key: true` from the extension's DevTools; no wallet UI sets it, and `saveKey` refuses an own key without it.

Production URL: `https://cardybara-gateway.cardybara.workers.dev` (`GATEWAY_ORIGIN` in `extension-next/model-client.js`; a test keeps the manifest's optional host permission equal to it).

Code: `gateway/src/gateway.js` (router, middleware, model proxy and the `UsageLedger` Durable Object), `gateway/src/agent.js` (the `/v1/chat` agent route), `gateway/src/worker.js` (the main module: only the fetch handler and `UsageLedger`, as Workers requires), `gateway/wrangler.jsonc`, `gateway/scripts/mock-provider.mjs`, `scripts/gateway-set-key.sh`, `scripts/gateway-codes.mjs`, `scripts/build-gateway.mjs`. The agent itself is the shared code in `src/`: `agentSession.js` (loop), `chatProtocol.js` (system prompt, reply checks), `walletAgent.js` (tools), `answerGrounding.js` / `actionClaims.js` (checks), `walletSummary.js` (per-turn summary), `cloudProtocol.js` (wire format) and `cloudChat.js` (the extension's client). Tests: `tests/gateway.test.mjs`, `tests/gateway-codes.test.mjs`, `tests/cloud-agent.test.mjs`, `tests/wallet-summary.test.mjs`, the agent suites again with `CARDYBARA_AGENT=cloud` (`npm run check:agent:cloud`), and the packaged-extension E2E `--chat --hosted`, which runs the same Worker code locally.

## The hosted assistant (`/v1/chat`)

**Split.** Cloud: `runAgentTurn` from `src/agentSession.js`, the system prompt from `src/chatProtocol.js`, every model call, and the public-knowledge tools `list_cards`, `find_benefits`, `get_card_rules`, `convert_points`, `find_protections`, `points_accounts`, which run on the summary's held products against the catalogue, benefit rules, transfer routes, point-value defaults and pooling rules bundled from `src/data`. Extension: the chat UI, rendering the stream, and the wallet tools `choose_card`, `query_credits`, `plan_flight` (`WALLET_TOOLS`), which read credit marks, fee dates and point-value overrides.

**What the extension sends** (`src/cloudProtocol.js`, checked field by field by the Worker; anything else is `400 bad_request`):
- the question; the trimmed history (questions, answers and `choose_card` arguments; never a tool result); the conversation memory (`src/conversationState.js`);
- the **wallet summary** (`src/walletSummary.js`): per held card its name (a name with any digit is replaced by its catalogue product's name, so no tail or amount can travel in it), bank, region, currency, catalogue product id and whether a fee date is set; and the user's point-value overrides (programme id and cents). Hidden cards are left out. No balance, statement, minimum, due date, tail, credit mark or bank text. The Worker turns it into system context with each card's programme and pooling rule;
- in a continuation only: the turn's tool-call rounds, each with the results of the wallet tools that round asked for, keyed by call id.

**A turn.** The Worker streams server-sent events: `model` (a model call starts; the extension drops its draft), `delta` (answer text), `progress`, then one of `done` (the checked answer, memory, trimmed history), `tool_request` or `error`. When the model calls a wallet tool, the Worker runs nothing of that round, sends `tool_request` with the round's messages, the wallet calls, the remembered trip dates and a signature, and ends the stream. The extension checks that every requested call is a wallet tool of the newest round, runs it locally, and posts the same turn again with the rounds and those results only. The Worker replays the signed rounds without asking the model again (public tools run again, deterministically) and continues. A turn has at most 5 model rounds plus one repair.

**No server state.** Nothing is stored between requests. Rounds are signed with HMAC-SHA256 (key derived from `TURN_KEY` if set, else `PROVIDER_KEY`), binding the invite code id, a 10-minute expiry, the question, history, memory, summary and every round's message: the extension can only answer calls the agent made (`400 turn_invalid`), and a stale continuation is `409 turn_expired`.

**Checks.** Grounding and action-claim checks (`answerGrounding.js`, `actionClaims.js`) run in the Worker on every answer, against the knowledge results it computed and the wallet results the extension posted for this turn, with the same single repair and code-written fallback as before. The streamed draft is shown while it arrives; only the final checked answer is kept, and a repair is never streamed.

**Caps and limits.** Every model call of a turn reserves its worst case and settles it, exactly as on the proxy, so a turn of three calls counts three requests against the daily cap. Body limit `MAX_BODY_BYTES`, history ≤ 64 messages, ≤ 150 summary cards, ≤ 4 calls a round, each wallet result ≤ 60,000 characters, wallet day within three days of the Worker's clock. Stopping the chat cancels the turn in the Worker: the provider call is aborted and its worst case stays charged.

**Log line** (one per request): time, route, code id, status, error code, `model_calls`, summed prompt and completion tokens, `rounds_replayed`, `wallet_results`, `wallet_calls`, `answered`. Never a question, answer, card, summary or result.

**Own key.** The developer-only own-key mode keeps running the same agent code (`src/agentSession.js`) in the extension against the provider directly, so local development and the owner's live evals need no Worker. One loop, two transports; the beta UI offers only the hosted service.

## What the gateway does

- **Router:** `ROUTE_TABLE` in `gateway.js` lists each route with its path, method, whether it needs an invite code, and its handler: `POST /v1/chat` (the assistant, `agent.js`), `POST /v1/chat/completions` (model proxy) and `POST /v1/invite` (checks a code, costs nothing, nothing forwarded). Everything else is 404/405.
- **Middleware** (exported, reused by later routes): `authenticate` (invite code), `readJson` (content type and body cap), `reserve` (caps; returns `settle`), `callProvider` (owner key, timeout, errors as codes).
- **Invite codes:** `Authorization: Bearer cdy_…` (43 random base64url characters, 256 bits). Workers KV stores only `invite:<sha256 of the code>` → `{hash, id, status, issued, dailyRequests?, dailyTokens?}`; the digest is compared again in constant time. The code itself is never stored or logged. A per-code cap can only lower the global one.
- **Caps:** per code per UTC day (requests and tokens) and one global monthly budget in USD. Before forwarding, a single Durable Object reserves the request's worst case (body bytes as input tokens plus `max_tokens` as output, priced with `PRICE_*`); the check and the increment run in one queued operation, so parallel requests cannot overrun a cap. After the reply the reservation is replaced by the provider's actual usage. A refusal (4xx, 429) releases its cost but still counts as a request; a timeout, dropped connection, 5xx, redirect, garbled reply or reply without usage keeps the worst case, because the provider may have billed it. Actual use above the worst case is charged in full and logged with `overrun: true`: that means the worst-case assumption (a token is at least one byte, reasoning off) broke, so re-check it whenever `PROVIDER_URL` or the model changes. The first request of each day prunes counters and stale reservations older than yesterday. Over a cap the gateway answers `429` with `daily_requests`, `daily_tokens` or `monthly_budget`, and the chat says so in Chinese, Traditional Chinese or English. The global caps start from the vars in `wrangler.jsonc` and can be changed in KV without a deploy (`set-caps` below).
- **Streaming:** a request with `"stream": true` is forwarded with `stream_options.include_usage` and the provider's server-sent events pass through unchanged (size-capped); the final usage chunk settles the reservation and writes the log line when the stream ends. A stream without usage keeps its worst case. The assistant route reads the same provider stream itself (`readStream` in `agent.js`) and re-emits its own events.
- **Forwarded fields only:** `model` (must be in `ALLOWED_MODELS`), `messages` (text roles only), `tools`, `tool_choice`, `max_tokens` (≤ `MAX_OUTPUT_TOKENS`), `temperature`, `response_format` (`json_object`/`text`), `stream`. Reasoning is forced off; any other field is dropped. Body limit `MAX_BODY_BYTES` (256 KB), enforced while streaming.
- **CORS:** only `ALLOWED_ORIGINS`. The alpha is loaded unpacked, so every tester's extension id differs; the default `chrome-extension://*` admits any extension origin but no web page. The invite code is the real gate. Once the id is pinned (store listing or a manifest `key`), set the exact `chrome-extension://<id>`.
- **Errors:** provider failures pass through as a code only (`provider_rejected`, `provider_rate_limited`, `provider_error`, `provider_unreachable`, `provider_timeout`); provider text never reaches the client because it can echo the request. Redirects are never followed.
- **Logging:** one JSON line per request: time, route, code id, status, error code, prompt and completion tokens. Never bodies, codes, keys or wallet data. Workers Logs keeps these lines for reading usage; the platform's invocation logs (request metadata) are turned off in `wrangler.jsonc` so no request header is kept. After the first deploy, open one log entry in the dashboard and confirm it carries no `Authorization` header.
- **Rate limit:** a Workers Rate Limiting binding (`RATE_LIMITER`, 60 requests a minute per IPv4 address or IPv6 /64) runs before any invite lookup, so guessing codes cannot exhaust KV reads. The gateway refuses to run without it (except a local run against an http mock). A limited request is still a Worker invocation, so it does not protect the Workers request quota; on workers.dev there is no WAF in front.
- **Fail closed:** a missing `PROVIDER_KEY`, binding, model list, origin list or a malformed number answers `503 gateway_not_configured`.

## Run it locally

Needs Node 22 for wrangler. From `gateway/`:

```sh
cp .dev.vars.example .dev.vars                 # synthetic PROVIDER_KEY the mock accepts; .dev.vars is gitignored
node scripts/mock-provider.mjs &               # mock provider on 127.0.0.1:8799
npx wrangler@4.150.0 dev --env local --port 8798
```

Seed a code with `npx wrangler@4.150.0 kv key put --binding INVITES --local --env local invite:<sha256> '{"hash":"<sha256>","id":"local-01","status":"active"}'`, then `POST http://127.0.0.1:8798/v1/chat/completions` with `Origin: chrome-extension://` plus 32 letters a–p, `Authorization: Bearer <code>` and a JSON body. Verified 2026-11-11 with wrangler 4.150.0: a chat reaches the mock, a code with `dailyRequests: 2` got exactly two completions out of five (four in parallel), bad origin and bad code are refused.

The assistant: seed one active and one revoked code (`"status":"revoked"`), then from the repository root `node scripts/gateway-dev-smoke.mjs http://127.0.0.1:8798 --invite <active> --revoked <revoked>`. It runs one turn through the extension's own client with a synthetic wallet (the mock calls `list_cards` and `query_credits`, so the turn makes one round trip) and the controls that must fail: a revoked code, a wallet field beside the question, a forged round. Verified 2026-11-11 against `npm run build:gateway`'s bundle in workerd (Miniflare 3.20250718); not yet under `wrangler dev` (needs Node 22).

## Deploy (orchestrator, via wrangler or the Cloudflare API)

The Worker imports the agent and the public knowledge from `src/`, so it is uploaded as one bundled ES module. No account id is committed; the KV namespace id (`332d4b90299846508c1c85fc2c51411c`, not a secret) is in `gateway/wrangler.jsonc`.

1. Upload with wrangler, which bundles `gateway/src/worker.js` itself: `npx wrangler@4.150.0 deploy --config gateway/wrangler.jsonc --env=""` (the top-level environment). Or with the Workers scripts API: `npm run build:gateway` writes `gateway/dist/worker.js` (about 2.9 MB, 350 KB gzipped; never committed); upload it as the only module, as the main module `worker.js`, with the vars of `wrangler.jsonc`, the `INVITES` KV binding, the `USAGE` Durable Object binding (class `UsageLedger`), the `RATE_LIMITER` ratelimit binding and migration `v1` (`new_sqlite_classes: ["UsageLedger"]`, already applied). No new binding, var, secret or migration since #208; `TURN_KEY` is an optional secret for the round signatures (without it they use a key derived from `PROVIDER_KEY`). The Worker answers `503 gateway_not_configured` until the provider key is set.
2. **Plan: Workers Paid.** The assistant runs benefit search and the other knowledge tools in the Worker: about 5–30 ms of CPU per tool call, and about 300 ms to load the knowledge on a cold start (measured in Node). That is over the Free plan's 10 ms of CPU per request, so the account needs Workers Paid (US$5 a month, 30 s CPU by default); on Free the assistant would fail with error 1102 while the proxy keeps working.
3. **Owner, once:** set the provider key without anyone else handling it. Required before testers get codes: create a separate DeepSeek key for the gateway with its own spend limit at the provider, and put it in the same file as `DEEPSEEK_GATEWAY_API_KEY`; the script uses it in preference to `DEEPSEEK_API_KEY`. The provider-side limit backs up the gateway's own budget, and gateway spend stays apart from personal use.

   ```sh
   CARDYBARA_MODEL_CONFIG=/path/to/.env.local scripts/gateway-set-key.sh
   ```

   It reads `DEEPSEEK_API_KEY` from that file and pipes it to `wrangler secret put PROVIDER_KEY`; the key is never printed. Run it again to rotate.
4. Issue codes (below) and test one with the extension: a question that needs a wallet tool ("本期酒店 credit 用了吗？") exercises the round trip.

Emergency stop: `node scripts/gateway-codes.mjs set-caps --monthly-usd 0` (KV caching can take about a minute to apply it everywhere), or `npx wrangler secret delete PROVIDER_KEY --config gateway/wrangler.jsonc` (every request then answers 503). A leaked provider key: rotate it at the provider, then run `gateway-set-key.sh` again.

## Invite codes and caps

`scripts/gateway-codes.mjs` uses the Cloudflare API when `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CARDYBARA_KV_NAMESPACE_ID` are set, otherwise a logged-in wrangler.

```sh
node scripts/gateway-codes.mjs issue t01 [--daily-requests 100] [--daily-tokens 500000]   # prints the code once
node scripts/gateway-codes.mjs list                                                       # ids, status, caps; never codes
node scripts/gateway-codes.mjs revoke t01        # and: restore t01
node scripts/gateway-codes.mjs caps
node scripts/gateway-codes.mjs set-caps --monthly-usd 5                                   # raising any cap needs --yes
```

Hand a code to the tester privately; it is not stored anywhere and cannot be shown again (issue a new one after revoking). Use short ids such as `t01`, not names: the id is what appears in logs. KV changes can take about a minute to reach every location.

| Cap | Var default | Meaning |
| --- | --- | --- |
| `dailyRequests` / `DAILY_REQUESTS_PER_CODE` | 200 | completions per code per UTC day |
| `dailyTokens` / `DAILY_TOKENS_PER_CODE` | 300000 | tokens per code per UTC day (worst case reserved up front) |
| `monthlyBudgetUsd` / `MONTHLY_BUDGET_USD` | 10 | all codes together, per calendar month (UTC) |
| `PRICE_INPUT_USD_PER_MTOK` / `PRICE_OUTPUT_USD_PER_MTOK` | 0.6 / 2.4 | set at or above the provider's list price; cache discounts are not counted, so spend is over-estimated |
| `MAX_OUTPUT_TOKENS` | 8192 | the wallet's bank parsing asks for 8192 |

## Read usage

- Cloudflare dashboard → Workers → `cardybara-gateway` → Logs: filter by `code` for one tester, sum `prompt_tokens` / `completion_tokens`, or filter by `error` (`daily_requests`, `monthly_budget`, `invite_revoked`…).
- Live: `npx wrangler@4.150.0 tail cardybara-gateway --format pretty`.
- The provider's own usage page is the source of truth for money spent.

## Expected monthly cost

- **Cloudflare:** Workers Paid, US$5 a month, because the assistant's knowledge tools need more CPU than the Free plan's 10 ms per request (Deploy, step 2). Requests, KV reads and Durable Object use of a friends beta stay within what that plan includes.
- **Model:** bounded by the monthly budget (default US$10; `set-caps --monthly-usd` changes it), the gateway's ceiling, with the provider-side spend limit on a dedicated key as the backstop. One code's daily cap (default 300,000 tokens, at most about US$0.70 a day at the example prices) limits how fast a leaked code can drain it; revoke a leaked code at once. A chat question is usually 2–4 completions, each one a request against the daily cap (200 requests are about 60 questions); with the tool list each completion sends several thousand input tokens. As a rough guide, at US$0.6 input / US$2.4 output per million tokens, a question of about 20,000 input and 1,000 output tokens costs about US$0.015, so US$10 covers roughly 650 questions a month. Check the provider's current prices and set `PRICE_*` to match.

## Privacy

The assistant runs in the Worker: it receives the question, the trimmed history, the wallet summary (held products, regions, programmes, point-value overrides, fee date set or not; never an amount, tail, statement, payment data or hidden card) and, for a wallet tool it asked for, that tool's result only. These pass to the model provider and are not stored by the gateway; the gateway logs only the code id, time, token counts, counts of rounds and results, and status. Card-type recognition (bank, region and card name) passes through the proxy route the same way. Wallet tools never return balances or card numbers. Model-assisted bank parsing is off with the hosted service (`parserStatus` reports `hosted_no_parsing` and `completeBody` refuses it), so bank figures never go through the gateway; it stays available with an own key. The invite code lives only in the extension's `chrome.storage.local`, like an own key, and is sent only to the gateway.
