# Hosted gateway and assistant

Beta testers chat without their own model key and without an invite code (invite codes were dropped by the owner on 2026-11-16). A Cloudflare Worker holds the owner's provider key and:

- runs the **assistant agent** (`POST /v1/chat`, stl00/Cardybara#210): the agent loop, system prompt, model calls and the tools over public knowledge run in the Worker and stream the answer; the tools that read the wallet run in the extension, which posts back only their results (below);
- relays **single completions** (`POST /v1/chat/completions`, stl00/Cardybara#208), used for AI card-type suggestions.

The wallet is never uploaded. Prompt, model and knowledge changes ship by redeploying the Worker, without an extension release.

**Beta UI:** the hosted service is the only mode testers see, and it is on out of the box: Settings → AI service shows it ready with a switch to turn AI off, and no code, model key field or provider choice; there is no model-assisted bank parsing. The extension sends no credential, and needs no host permission for the gateway: its requests are plain CORS requests the gateway answers for extension origins. A setting saved by an older build that still holds an invite code is rewritten without the code the first time it is read. An own provider key is a developer-only mode (local development and the owner's live evals), switched on by setting `chrome.storage.local` `cardybara-dev-own-key: true` from the extension's DevTools; no wallet UI sets it, and `saveKey` refuses an own key without it.

Production URL: `https://cardybara-gateway.cardybara.workers.dev` (`GATEWAY_ORIGIN` in `extension-next/model-client.js`; a test keeps the manifest's optional host permission equal to it).

Code: `gateway/src/gateway.js` (router, middleware, model proxy and the `UsageLedger` Durable Object), `gateway/src/agent.js` (the `/v1/chat` agent route), `gateway/src/worker.js` (the main module: only the fetch handler and `UsageLedger`, as Workers requires), `gateway/wrangler.jsonc`, `gateway/scripts/mock-provider.mjs`, `scripts/gateway-set-key.sh`, `scripts/gateway-set-alert-secrets.sh`, `scripts/gateway-settings.mjs` (caps and switches), `scripts/build-gateway.mjs`. The agent itself is the shared code in `src/`: `agentSession.js` (loop), `chatProtocol.js` (system prompt, reply checks), `walletAgent.js` (tools), `answerGrounding.js` / `actionClaims.js` (checks), `walletSummary.js` (per-turn summary), `cloudProtocol.js` (wire format) and `cloudChat.js` (the extension's client). Tests: `tests/gateway.test.mjs`, `tests/gateway-settings.test.mjs`, `tests/cloud-agent.test.mjs`, `tests/wallet-summary.test.mjs`, the agent suites again with `CARDYBARA_AGENT=cloud` (`npm run check:agent:cloud`), and the packaged-extension E2E `--chat --hosted`, which runs the same Worker code locally.

## The hosted assistant (`/v1/chat`)

**Split.** Cloud: `runAgentTurn` from `src/agentSession.js`, the system prompt from `src/chatProtocol.js`, every model call, and the public-knowledge tools `list_cards`, `find_benefits`, `get_card_rules`, `convert_points`, `find_protections`, `points_accounts`, which run on the summary's held products against the catalogue, benefit rules, transfer routes, point-value defaults and pooling rules bundled from `src/data`. Extension: the chat UI, rendering the stream, and the wallet tools `choose_card`, `query_credits`, `plan_flight` (`WALLET_TOOLS`), which read credit marks, fee dates and point-value overrides.

**What the extension sends** (`src/cloudProtocol.js`, checked field by field by the Worker; anything else is `400 bad_request`):
- the question; the trimmed history (questions, answers and `choose_card` arguments; never a tool result); the conversation memory (`src/conversationState.js`);
- the **wallet summary** (`src/walletSummary.js`): per held card its name (a name with any digit is replaced by its catalogue product's name, so no tail or amount can travel in it), bank, region, currency, catalogue product id and whether a fee date is set; and the user's point-value overrides (programme id and cents). Hidden cards are left out. No balance, statement, minimum, due date, tail, credit mark or bank text. The Worker turns it into system context with each card's programme and pooling rule;
- in a continuation only: the turn's tool-call rounds, each with the results of the wallet tools that round asked for, keyed by call id.

**A turn.** The Worker streams server-sent events: `model` (a model call starts; the extension drops its draft), `delta` (answer text), `progress`, then one of `done` (the checked answer, memory, trimmed history), `tool_request` or `error`. When the model calls a wallet tool, the Worker runs nothing of that round, sends `tool_request` with the round's messages, the wallet calls, the remembered trip dates and a signature, and ends the stream. The extension checks that every requested call is a wallet tool of the newest round, runs it locally, and posts the same turn again with the rounds and those results only. The Worker replays the signed rounds without asking the model again (public tools run again, deterministically) and continues. A turn has at most 5 model rounds plus one repair.

**No server state.** Nothing is stored between requests. Rounds are signed with HMAC-SHA256 (key derived from `TURN_KEY` if set, else `PROVIDER_KEY`), binding a 10-minute expiry, the question, history, memory, summary and every round's message: the extension can only answer calls the agent made (`400 turn_invalid`), and a stale continuation is `409 turn_expired`.

**Checks.** Grounding and action-claim checks (`answerGrounding.js`, `actionClaims.js`) run in the Worker on every answer, against the knowledge results it computed and the wallet results the extension posted for this turn, with the same single repair and code-written fallback as before. The streamed draft is shown while it arrives; only the final checked answer is kept, and a repair is never streamed.

**Caps and limits.** Every model call of a turn reserves its worst case and settles it, exactly as on the proxy, so a turn of three calls counts three requests against the client's daily cap. Body limit `MAX_BODY_BYTES`, history ≤ 64 messages, ≤ 150 summary cards, ≤ 4 calls a round, each wallet result ≤ 60,000 characters, wallet day within three days of the Worker's clock. Stopping the chat cancels the turn in the Worker: the provider call is aborted and its worst case stays charged.

**Log line** (one per request): time, route, status, error code (and, for a cap, `limit`: `client_requests`, `client_tokens`, `daily_budget` or `monthly_budget`), `model_calls`, summed prompt and completion tokens, `rounds_replayed`, `wallet_results`, `wallet_calls`, `answered`. Never a question, answer, card, summary or result.

**Own key.** The developer-only own-key mode keeps running the same agent code (`src/agentSession.js`) in the extension against the provider directly, so local development and the owner's live evals need no Worker. One loop, two transports; the beta UI offers only the hosted service.

## What the gateway does

- **Router:** `ROUTE_TABLE` in `gateway.js` lists each route with its path, method and handler: `POST /v1/chat` (the assistant, `agent.js`), `POST /v1/chat/completions` (model proxy), `POST /v1/invite` (kept for older builds, below) and the Web Push routes below. No route needs a credential. Everything else is 404/405.
- **Middleware** (exported, reused by later routes): `clientId` (the salted daily hash below), `readJson` (content type and body cap), `reserve` (caps; returns `settle`), `callProvider` (owner key, timeout, errors as codes).
- **No invite codes; older builds keep working.** Extension builds from before 2026-11-16 send `Authorization: Bearer cdy_…` on every request and check a saved code with `POST /v1/invite`. The gateway ignores the header on every route, and `/v1/invite` always answers `200 {"status":"active"}` (with or without a code, nothing forwarded, nothing counted), so those builds work unchanged. The old `invite:` records in KV are no longer read.
- **Client id:** a client is its network address (`CF-Connecting-IP`; an IPv6 address counts by its /48, a whole site's allocation, so one subscriber cannot spread over 65,536 /64s; an IPv4-mapped IPv6 address `::ffff:a.b.c.d` counts as its IPv4). A request without `CF-Connecting-IP` is `400 bad_request` (log `reason: no_client_address`): Cloudflare always sets it, and without it every caller would share one bucket. The Worker never stores the address: it uses `clientId`, the first 128 bits of HMAC-SHA256 over the UTC day and that address, keyed by the required secret `CLIENT_SALT` (at least 16 characters; without it the gateway answers `503 gateway_not_configured`). Only a local run (`LOCAL_DEV=1`: the `local` env of `wrangler.jsonc`, the tests and the E2E) may go without the header and falls back to a key derived from `PROVIDER_KEY`. The id changes every UTC day, so one day's counters cannot be linked to another's, and it cannot be turned back into an address without the secret. It is the key of the per-client counters and of the rate limiter, and is never logged or written to metrics.
- **Caps:** per client per UTC day (requests and tokens), and two budgets in USD for all clients together: per UTC day (`DAILY_BUDGET_USD`, default the monthly budget / 30, so spend spread over many addresses cannot burn the month in a day) and per calendar month. Before forwarding, a single Durable Object reserves the request's worst case (body bytes as input tokens plus `max_tokens` as output, priced with `PRICE_*`); the check and the increment run in one queued operation, so parallel requests cannot overrun a cap. After the reply the reservation is replaced by the provider's actual usage. A refusal (4xx, 429) releases its cost but still counts as a request; a timeout, dropped connection, 5xx, redirect, garbled reply or reply without usage keeps the worst case, because the provider may have billed it. Actual use above the worst case is charged in full and logged with `overrun: true`: that means the worst-case assumption (a token is at least one byte, reasoning off) broke, so re-check it whenever `PROVIDER_URL` or the model changes. The first request of each UTC day deletes every earlier day's per-client keys (`d:` model use, `p:` push writes) and reservations older than yesterday, and strips the client's day key from yesterday's still-open reservations, which keep only what the month and day budgets need; so a client id is kept for its own UTC day only. A Durable Object alarm set for just after midnight UTC does the same when no request comes, and a reservation that settles after midnight does not write its day back. Over a client's daily cap the gateway answers `429 daily_requests` or `429 daily_tokens`, and over either budget `429 monthly_budget`: the codes every extension build already knows. The log line's `limit` says exactly which cap it was. The chat says so in Chinese, Traditional Chinese or English ("this network has reached today's limit" for the client's caps, "the hosted service reached its usage limit" for the budgets). The caps start from the vars in `wrangler.jsonc` and can be changed in KV without a deploy (`set-caps` below).
- **Streaming:** a request with `"stream": true` is forwarded with `stream_options.include_usage` and the provider's server-sent events pass through unchanged (size-capped); the final usage chunk settles the reservation and writes the log line when the stream ends. A stream without usage keeps its worst case. The assistant route reads the same provider stream itself (`readStream` in `agent.js`) and re-emits its own events.
- **Forwarded fields only:** `model` (must be in `ALLOWED_MODELS`), `messages` (text roles only), `tools`, `tool_choice`, `max_tokens` (≤ `MAX_OUTPUT_TOKENS` on the agent; ≤ 600 on the proxy), `temperature`, `response_format` (`json_object`/`text`), `stream`. Reasoning is forced off; any other field is dropped. Body limit `MAX_BODY_BYTES` (256 KB), enforced while streaming. **`/v1/chat/completions` takes only what its one real use, card-type suggestion, needs** (`COMPLETION_LIMITS` in `gateway.js`): `max_tokens` ≤ 600 (600 when missing), at most 4 messages and 32,000 characters of message text and tools in all; anything larger is `400 bad_request`, so the credential-free proxy is not a general-purpose model.
- **CORS:** only `ALLOWED_ORIGINS`. The alpha is loaded unpacked, so every tester's extension id differs; the default `chrome-extension://*` admits any extension origin but no web page. The origin check stops other web pages, not a determined script (which can send any `Origin`): spend is bounded by the per-client daily cap, the rate limiter and the monthly budget. Once the id is pinned (store listing or a manifest `key`), set the exact `chrome-extension://<id>`. The hosted web wallet is admitted by listing its exact `https://` origin (comma-separated, no path, no wildcards; `http://` is never allowed).
- **Errors:** provider failures pass through as a code only (`provider_rejected`, `provider_rate_limited`, `provider_error`, `provider_unreachable`, `provider_timeout`); provider text never reaches the client because it can echo the request. Redirects are never followed.
- **Logging:** one JSON line per request: time, route, status, error code, prompt and completion tokens. Never bodies, codes, keys, addresses, client ids or wallet data. Workers Logs keeps these lines for reading usage; the platform's invocation logs (request metadata) are turned off in `wrangler.jsonc` so no request header is kept. After the first deploy, open one log entry in the dashboard and confirm it carries no `Authorization` header.
- **Rate limit:** a Workers Rate Limiting binding (`RATE_LIMITER`, 60 requests a minute per client, keyed by the hashed client id) runs before any KV or ledger call. The gateway refuses to run without it (except a local run against an http mock). A limited request is still a Worker invocation, so it does not protect the Workers request quota; on workers.dev there is no WAF in front.
- **Fail closed:** a missing `PROVIDER_KEY`, `CLIENT_SALT` (outside `LOCAL_DEV`), `USAGE` or `RATE_LIMITER` binding, model list, origin list or a malformed number answers `503 gateway_not_configured`. The KV binding (`INVITES`, a name kept from the invite codes) is optional for chat: without it the vars caps apply and Web Push answers `push_unavailable`.

## Run it locally

Needs Node 22 for wrangler. From `gateway/`:

```sh
cp .dev.vars.example .dev.vars                 # synthetic PROVIDER_KEY the mock accepts; .dev.vars is gitignored
node scripts/mock-provider.mjs &               # mock provider on 127.0.0.1:8799
npx wrangler@4.150.0 dev --env local --port 8798
```

Then `POST http://127.0.0.1:8798/v1/chat/completions` with `Origin: chrome-extension://` plus 32 letters a–p and a JSON body; no code is needed. The local env sets `LOCAL_DEV=1` (no `CF-Connecting-IP` or `CLIENT_SALT` needed) and allows 20 requests per client a day (`DAILY_REQUESTS_PER_CLIENT`).

The assistant: from the repository root `node scripts/gateway-dev-smoke.mjs http://127.0.0.1:8798`. It runs one turn through the extension's own client with a synthetic wallet (the mock calls `list_cards` and `query_credits`, so the turn makes one round trip), the same turn as an older build that sends a code and checks `/v1/invite`, and the controls that must fail: a wallet field beside the question, a forged round. Verified 2026-11-16 against `npm run build:gateway`'s bundle served from Node on the in-memory bindings with the mock provider; not yet under `wrangler dev` or workerd (needs Node 22).

## Deploy (orchestrator, via wrangler or the Cloudflare API)

The Worker imports the agent and the public knowledge from `src/`, so it is uploaded as one bundled ES module. No account id is committed; the KV namespace id (`332d4b90299846508c1c85fc2c51411c`, not a secret) is in `gateway/wrangler.jsonc`.

1. Upload with wrangler, which bundles `gateway/src/worker.js` itself: `npx wrangler@4.150.0 deploy --config gateway/wrangler.jsonc --env=""` (the top-level environment). Or with the Workers scripts API: `npm run build:gateway` writes `gateway/dist/worker.js` (about 2.9 MB, 350 KB gzipped; never committed); upload it as the only module, as the main module `worker.js`, with the vars of `wrangler.jsonc`, the `INVITES` KV binding, the `USAGE` Durable Object binding (class `UsageLedger`), the `RATE_LIMITER` ratelimit binding and migration `v1` (`new_sqlite_classes: ["UsageLedger"]`, already applied). Since the invite codes were dropped the vars are `DAILY_REQUESTS_PER_CLIENT`, `DAILY_TOKENS_PER_CLIENT`, `PUSH_WRITES_PER_CLIENT` and `MAX_PUSH_DEVICES`, with `DAILY_BUDGET_USD` optional (the old `*_PER_CODE` names are still read if the new ones are missing); Since #208 the Worker also has the `AGENT_METRICS` Analytics Engine binding (dataset `cardybara_agent_metrics`), the `CF_VERSION_METADATA` binding, the `VAPID_SUBJECT` var and the Cron Triggers `7 * * * *` and `*/15 * * * *`; no new migration (the ledger's alarm needs none). **Required secret `CLIENT_SALT`** (at least 16 random characters, for example `openssl rand -base64 32 | npx wrangler@4.150.0 secret put CLIENT_SALT --config gateway/wrangler.jsonc`, never printed or committed): set it before or with the deploy that drops the invite codes, or every request answers `503 gateway_not_configured`. Rotating it only restarts that day's per-client counts. Optional secret `TURN_KEY` for the round signatures (without it they use a key derived from `PROVIDER_KEY`). The Worker answers `503 gateway_not_configured` until the provider key and the salt are set.
2. **Startup and plan.** Workers rejects a script that spends too much CPU at startup (error 10021). The agent and its knowledge build their indexes when first evaluated (about 400 ms), so `gateway.js` imports `agent.js` lazily: the script starts in about 15 ms, the first `/v1/chat` request on an instance pays the load, and the proxy and invite routes never do (`tests/gateway-startup.test.mjs` measures the built bundle). That first-request load and the knowledge tools (about 5–30 ms of CPU per call) are over the Free plan's 10 ms of CPU per request, so the account needs Workers Paid (US$5 a month, 30 s CPU by default); on Free the assistant would fail with error 1102 while the proxy keeps working.
3. **Owner, once:** set the provider key without anyone else handling it. Required before the hosted service opens: create a separate DeepSeek key for the gateway with its own spend limit at the provider, and put it in the same file as `DEEPSEEK_GATEWAY_API_KEY`; the script uses it in preference to `DEEPSEEK_API_KEY`. The provider-side limit backs up the gateway's own budget, and gateway spend stays apart from personal use.

   ```sh
   CARDYBARA_MODEL_CONFIG=/path/to/.env.local scripts/gateway-set-key.sh
   ```

   It reads `DEEPSEEK_API_KEY` from that file and pipes it to `wrangler secret put PROVIDER_KEY`; the key is never printed. Run it again to rotate.
4. Test with the extension: a question that needs a wallet tool ("本期酒店 credit 用了吗？") exercises the round trip.

Emergency stop: `node scripts/gateway-settings.mjs set-caps --monthly-usd 0` (KV caching can take about a minute to apply it everywhere), or `npx wrangler secret delete PROVIDER_KEY --config gateway/wrangler.jsonc` (every request then answers 503). A leaked provider key: rotate it at the provider, then run `gateway-set-key.sh` again.

## Caps

`scripts/gateway-settings.mjs` (was `gateway-codes.mjs`; its invite commands are gone) uses the Cloudflare API when `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `CARDYBARA_KV_NAMESPACE_ID` are set, otherwise a logged-in wrangler.

```sh
node scripts/gateway-settings.mjs caps
node scripts/gateway-settings.mjs set-caps --daily-requests 100 --monthly-usd 5                 # raising any cap needs --yes
```

KV changes can take about a minute to reach every location.

| Cap | Var default | Meaning |
| --- | --- | --- |
| `dailyRequests` / `DAILY_REQUESTS_PER_CLIENT` | 200 | model calls per client per UTC day (a chat question is 2–4) |
| `dailyTokens` / `DAILY_TOKENS_PER_CLIENT` | 300000 | tokens per client per UTC day (worst case reserved up front; at most about US$0.70 a day at the example prices) |
| `monthlyBudgetUsd` / `MONTHLY_BUDGET_USD` | 10 | all clients together, per calendar month (UTC) |
| `dailyBudgetUsd` / `DAILY_BUDGET_USD` | monthly / 30 (about 0.33) | all clients together, per UTC day; `set-caps --daily-usd` |
| `PUSH_WRITES_PER_CLIENT` | 20 | Web Push PUT and DELETE per client per UTC day (`429 push_daily_limit`) |
| `MAX_PUSH_DEVICES` | 5000 | push devices stored in all; a PUT of a new device beyond it is `503 push_capacity` |
| `PRICE_INPUT_USD_PER_MTOK` / `PRICE_OUTPUT_USD_PER_MTOK` | 0.6 / 2.4 | set at or above the provider's list price; cache discounts are not counted, so spend is over-estimated |
| `MAX_OUTPUT_TOKENS` | 8192 | the wallet's bank parsing asks for 8192 |

The per-client defaults are the old per-code ones, so a tester gets the same daily allowance as with a code. A client is a network address, so people behind one address (a household, an office, a carrier NAT) share it; if that bites, raise `dailyRequests` / `dailyTokens` with `set-caps --yes`, which applies at once with no deploy. The monthly budget stays the ceiling on total spend.

## Read usage

- Cloudflare dashboard → Workers → `cardybara-gateway` → Logs: sum `prompt_tokens` / `completion_tokens` by `route`, or filter by `error` (`daily_requests`, `daily_tokens`, `monthly_budget`, `push_daily_limit`, `push_capacity`, `rate_limited`…) and `limit`. There is no per-tester view: the log carries no client or code id.
- Live: `npx wrangler@4.150.0 tail cardybara-gateway --format pretty`.
- The provider's own usage page is the source of truth for money spent.

## Metrics

Besides the log line, the Worker writes one Workers Analytics Engine data point per `/v1/chat` turn and per `/v1/chat/completions` request (`gateway/src/metrics.js`), so quality is read with SQL. The binding `AGENT_METRICS` (dataset `cardybara_agent_metrics`) and `CF_VERSION_METADATA` are declared in `gateway/wrangler.jsonc`; without them (local runs, tests) nothing is written and nothing fails. A write is wrapped and not awaited, so it can neither fail nor slow a turn. A data point holds counts, durations, codes and release identity only: never a question, an answer, a card, a wallet summary, an address or a client id. Refused requests are written too.

| Field | Meaning |
| --- | --- |
| `index1` | the route (`agent` or `chat`); until 2026-11-16 it was the invite code id |
| `blob1` `route` | `agent` (`/v1/chat`) or `chat` (`/v1/chat/completions`) |
| `blob2` `version_id` | Worker version id from the version metadata binding |
| `blob3` `prompt_hash` | first 8 hex digits of the SHA-256 of the system prompt (`src/chatProtocol.js`); agent route only |
| `blob4` `snapshot_id` | knowledge `snapshotId` from `src/data/knowledge/manifest.json`; agent route only |
| `blob5` `model` | model name sent to the provider |
| `blob6` `error` | error code, empty when none |
| `blob7` `tool_counts` | `name:count,…` of tools the turn ran (names only); a `tool_request` lists the wallet calls it asked for |
| `double1` `status` | HTTP status |
| `double2` `model_calls` | model calls made by this request |
| `double3` `rounds_replayed` | tool rounds of an earlier request replayed in this one |
| `double4` `wallet_calls` | wallet calls this request asked the extension for (a `tool_request`) |
| `double5` `prompt_tokens`, `double6` `completion_tokens` | provider usage, as in the log line |
| `double7` `duration_ms` | whole request, including the streamed answer |
| `double8` `repaired` | 1 when the answer needed the single repair |
| `double9` `fallback` | 1 when code wrote the answer after a failed repair |
| `double10` `model_answered` | 1 when the model's own answer was sent (answered and not `fallback`) |
| `double11` `tool_request` | 1 when the turn ended asking for wallet tools |
| `double12` `answered` | 1 when an answer was sent |
| `double13` `public_tool_calls` | public-knowledge tool calls in an answered turn |
| `double14` `wallet_results` | wallet tool results the extension sent with this request |

Example queries against the SQL API (`POST https://api.cloudflare.com/client/v4/accounts/<account>/analytics_engine/sql`; the account id stays out of Git):

```sql
-- repair rate and fallback rate by version per day (answered agent turns)
SELECT toDate(timestamp) AS day, blob2 AS version, SUM(_sample_interval) AS turns,
  SUM(_sample_interval * double8) / SUM(_sample_interval) AS repair_rate,
  SUM(_sample_interval * double9) / SUM(_sample_interval) AS fallback_rate
FROM cardybara_agent_metrics WHERE blob1 = 'agent' AND double12 = 1 AND timestamp > NOW() - INTERVAL '14' DAY
GROUP BY day, version ORDER BY day, version
```

```sql
-- p95 duration by route
SELECT blob1 AS route, quantileWeighted(0.95, double7, _sample_interval) AS p95_ms
FROM cardybara_agent_metrics WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY route
```

```sql
-- tokens by route per day
SELECT toDate(timestamp) AS day, blob1 AS route,
  SUM(_sample_interval * (double5 + double6)) AS tokens
FROM cardybara_agent_metrics WHERE timestamp > NOW() - INTERVAL '7' DAY GROUP BY day, route ORDER BY day, tokens DESC
```

Deployed with the binding on 2026-11-16 (code version `95179795`; setting `CF_ACCOUNT_ID` made version `1e8803f6` with the same code; #371). The three queries above were run that day against the live dataset after one synthetic turn (a throwaway invite code `m371`, revoked afterwards, and a made-up one-card wallet): each returned one row, and the full data point held only the code id, route, version, prompt hash, snapshot id, model, `list_cards:1` and counts, no question, answer or wallet value. The SQL API answers within about a minute of a write; a new dataset appears in `SHOW TABLES` with its first point.

## Alerts and switches

### Hourly alert check

A Cron Trigger (`7 * * * *` in `gateway/wrangler.jsonc`) runs the Worker's `scheduled` handler (`gateway/src/alerts.js`). It is a handler of the gateway Worker, not a second Worker: it needs the `UsageLedger` and KV bindings directly (a second Worker would need cross-script Durable Object bindings), and it reports the version id of the code it runs with.

Each run reads the last hour and the 7 days before it from the metrics dataset through the Analytics Engine SQL API (sampling corrected with `_sample_interval`), and the month-to-date spend from `UsageLedger`. A turn is an agent request that ended with an answer or an error code; a request that only asked the extension for wallet tools is not counted.

| Signal | Breach when | Needs |
| --- | --- | --- |
| `budget` | month-to-date spend is at least 80% of the monthly budget (the KV `monthlyBudgetUsd` or `MONTHLY_BUDGET_USD`) | the ledger |
| `errors` | error rate over the last hour is at least 5% | at least 20 turns in the hour |
| `repair` | repair rate of the last hour is at least double its mean over the 7 days before (and at least 5%, so a mean of zero does not make one repair an incident) | at least 20 turns in the hour |
| `fallback` | the same for the fallback rate | at least 20 turns in the hour |

Defaults are in code (`DEFAULT_THRESHOLDS`); KV `settings.alerts` overrides each one: `{"alerts":{"budgetPercent":80,"errorPercent":5,"rateMultiple":2,"minRatePercent":5,"minTurns":20}}`. A value that is not a positive number is ignored and logged.

### Incident flow

- A breach opens one GitHub issue per signal, titled `Assistant alert: <signal>`, labelled `agent-incident` and `P1`. The body holds the aggregates that tripped it, the checked time, the Worker version id and a link to this section. Never a client id, a question or per-turn data. If an incident for the signal is already open, the check comments on it instead of opening another (once per hourly check while the breach lasts).
- The next check where the signal is healthy comments "Healthy again" and closes the issue. A signal that cannot be judged (fewer than 20 turns, or the source could not be read) neither opens nor closes anything.
- What to do: `budget` is the spend guard (raise the cap with `set-caps --yes` only if the spend is expected; `assistantOff` below stops the assistant at once); `errors` and `fallback` after a release: compare by `version_id` (Metrics) and roll back (Release); `repair` points at a prompt or model change.
- The Worker sends no push notification, and nothing is rolled back automatically.

Live since 2026-11-16 (#371): both Cron Triggers are deployed, the secret `CF_ACCOUNT_ID` is set (not a credential) and the labels `agent-incident` and `P1` exist. Optional var `GITHUB_REPO` (default `stl00/Cardybara`). Without the two tokens the check logs what is missing (`github_token_missing`, `sql_token_missing`) and does nothing; without the SQL one it still checks the budget.

Owner step, once: create a fine-grained GitHub token with Issues: write on this repository only and a Cloudflare API token with Account Analytics: Read, put them in a local env file as `GATEWAY_GITHUB_TOKEN=` and `GATEWAY_ANALYTICS_SQL_TOKEN=`, then run the line below. It pipes each value straight to `wrangler secret put` (`GITHUB_TOKEN`, `ANALYTICS_SQL_TOKEN`) and prints only the names; a name missing from the file is skipped.

```sh
CARDYBARA_ALERT_SECRETS=/path/to/.env.local scripts/gateway-set-alert-secrets.sh
```

### KV switches

Stored in the KV key `settings` beside the caps, read on each request through a 30-second cache (a change takes up to about a minute in KV plus 30 seconds here):

| Switch | Effect |
| --- | --- |
| `disabledTools` (list of tool names) | the tools are removed from the list the model sees; a tool the model still names is rejected by the agent loop |
| `forceModel` (a name in `ALLOWED_MODELS`) | every model call uses this model whatever the client asked |
| `assistantOff` (`true`) | `/v1/chat` answers "temporarily unavailable" in the wallet's language (zh-CN, zh-TW, en-US) with no model call and no charge; it is not counted as an answered turn |

An invalid value (wrong type, a model not in `ALLOWED_MODELS`, a tool name that is not `a-z0-9_`) is ignored, never applied, and logged as `{"switch":"<key>","ignored":"invalid_value"}` without the value.

```sh
node scripts/gateway-settings.mjs switches
node scripts/gateway-settings.mjs set-switch disabledTools find_benefits,get_card_rules
node scripts/gateway-settings.mjs set-switch forceModel deepseek-flash
node scripts/gateway-settings.mjs set-switch assistantOff on        # off to turn it back
node scripts/gateway-settings.mjs clear-switch disabledTools
```

`set-switch` checks the same rules as the gateway and refuses an invalid value; `forceModel` is checked against `ALLOWED_MODELS` in `gateway/wrangler.jsonc`.

## Release (staged, by Worker version)

`scripts/gateway-release.mjs` wraps wrangler so a new gateway build is tested as the exact Worker version that will take traffic, then ramped, instead of replacing the gateway in one step. It is an owner/ops tool: nothing in it runs in CI on pull requests, every step prints what it will run, and any step that acts on a version refuses to run without an explicit version id. Add `--dry-run` to print the steps and stop.

1. `node scripts/gateway-release.mjs upload` uploads a new version at 0% traffic and prints its version id.
2. `node scripts/gateway-release.mjs eval <version> --out=dir [--baseline=report.json]` runs the pinned live eval (`scripts/live-eval.mjs --target=hosted`) through `POST /v1/chat`, with the `Cloudflare-Workers-Version-Overrides` header pinning the request to that version. Wallet tools run locally on the synthetic wallet, as in the extension. No credential is needed; the eval's requests count against the per-client daily cap of the machine that runs it. The report records the version id; a baseline from another version makes the run a new baseline candidate, not a regression by itself.
3. `ramp <version> 10 --stable <current-version>`, then `ramp <version> 50 --stable <current-version>`, then `ramp <version> 100`.
4. `rollback <current-version>` sends 100% of traffic back.

At each step compare the new version with the stable one by `version_id` (see Metrics): repair rate (`double8`), fallback rate (`double9`) and error rate (`blob6` non-empty, or `double1` of 500 and above). Roll back when the new version's fallback or error rate is clearly above the stable version's over a comparable number of turns, or when the hosted eval has a case that passed on the stable version and fails now. `scripts/live-eval.mjs --target=hosted --dry-run` runs the hosted transport against an in-process gateway with a canned provider (no network, no code) and is covered by `tests/gateway-release.test.mjs`.

Owner steps: run the first real staged release. (The `CARDYBARA_EVAL_INVITE` secret is no longer read and can be deleted.)

## Web Push reminders (`/v1/push`)

The hosted web wallet's reminders (#373, #380) are Web Push. The ui side (service worker, permission prompt, IndexedDB wallet) is a separate issue; this is the gateway half.

- **Routes:** `PUT /v1/push` (no credential; counted against the client's `PUSH_WRITES_PER_CLIENT` and, for a new device, the global `MAX_PUSH_DEVICES`, both in `UsageLedger` before KV is written) takes exactly `{device, subscription:{endpoint, keys:{p256dh, auth}}, times:[{at, kind}]}` and replaces the device's whole record. `device` is a random 22 to 43 character base64url id the wallet makes; `at` is a whole-second UTC Unix timestamp, at most 200 entries, from one day ago to 400 days ahead; `kind` is `payment`, `fee` or `credit`. `DELETE /v1/push` (no credential; counted like a PUT) takes `{device}` and forgets it, giving its place back (a device that is not there is not an error). `GET /v1/push/key` returns `{publicKey}`, the VAPID public key the wallet subscribes with. Anything else in a body is `400 bad_request`; without the VAPID secrets all three answer `503 push_unavailable`. Add the web wallet's exact `https://` origin to `ALLOWED_ORIGINS` (#378).
- **Endpoints:** the Worker posts to the subscription's endpoint, so it must be `https`, without credentials or a port, on a browser vendor's push host (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com`; `PUSH_HOSTS` in `push.js`). A client cannot aim the Worker at another address.
- **Stored:** one KV key `push:<device>` in the `INVITES` namespace (no new resource) holding `{subscription, times}` and, as key metadata, the earliest fire time and the expiry. Nothing else: no card name, bank, tail, amount, date text, address or client id. A device not updated for 60 days is deleted by KV's own expiry (each PUT starts the 60 days again; the cron's rewrites keep the original expiry). A push service answering 404 or 410 deletes the device.
- **Sending:** the Cron Trigger `*/15 * * * *` lists the `push:` keys (one list call, the earliest fire time is in the metadata), reads only the devices that are due, sends one payload-free push each (`POST` with `Authorization: vapid t=<ES256 JWT>, k=<public key>`, `TTL: 86400`) and removes the times it sent. A push service answering 400, 403, 404 or 410 will never take the subscription: the device is deleted at once and its place freed. A failed push (5xx, 429, network) stays due for the next run and is dropped after 2 days. At most 200 devices a run, the rest 15 minutes later, to stay under the 1,000 subrequests of an invocation. Due devices are taken round robin by device id from where the last full run stopped (the KV key `pushcursor`), not oldest fire time first, so devices claiming an old fire time cannot starve the others. The hourly alert trigger (`7 * * * *`) is unchanged.
- **VAPID keys:** `scripts/gateway-set-vapid.sh` (owner, once) makes the P-256 pair and puts `VAPID_PRIVATE_KEY` (PKCS#8, base64url) and `VAPID_PUBLIC_KEY` (raw point, base64url) as Worker secrets; the private key goes straight into `wrangler secret put` and is never printed. It refuses to replace an existing pair unless `ROTATE=1`, because a new pair invalidates every subscription. `VAPID_SUBJECT` (a var in `wrangler.jsonc`) is the contact URL push services see.
- **Log line:** route `push`, status and `times` (the count of fire times); the endpoint, keys and device id are never logged. The cron logs counts only (`due`, `sent`, `gone`, `failed`, `expired`).
- **Free tier at 100 devices:** the cron is 96 invocations a day and 96 KV list calls (free limit 1,000 a day). KV reads are the due devices only (about 100 a day if each fires once; free limit 100,000). Writes are one per wallet update plus one per send (a few hundred a day at most; free limit 1,000), and the gateway already runs on Workers Paid, which includes millions of each. No new paid product.

## Accounts (`/v2/account`)

Email and password accounts and one server copy of the wallet document per user (#412, epic #410). Code: `gateway/src/accounts.js`; schema: `gateway/migrations/0001_accounts.sql`; tests: `tests/gateway-accounts.test.mjs`. Per-user access, document schema, export and the log-capture test are #413 ("Who can see what" below). The `/v1` routes are unchanged.

- **Routes** (JSON bodies, checked key by key; anything else is `400 bad_request`; the session is `Authorization: Bearer cbs_…`, never a cookie):

  | Route | Body | Answer |
  | --- | --- | --- |
  | `POST /v2/account/signup` | `{email, password}` | `202 {status:"code_sent"}` always; mails a 6-digit code. An email that already has a verified account gets a notice mail instead (no code), so the answer never tells whether an account exists |
  | `POST /v2/account/verify` | `{email, code}` | `200 {token, expiresAt}`: email verified, signed in |
  | `POST /v2/account/session` | `{email, password}` | sign in: `200 {token, expiresAt}`; unknown email and wrong password are both `401 invalid_credentials`; right password, unverified email `403 email_unverified` |
  | `DELETE /v2/account/session` | bearer | `200`: this session signed out |
  | `POST /v2/account/password/forgot` | `{email}` | `202` always; a reset code is mailed only if the account exists |
  | `POST /v2/account/password/reset` | `{email, code, password}` | `200 {token, expiresAt}`: new password, **every** older session revoked |
  | `POST /v2/account/password` | bearer, `{currentPassword, newPassword}` | `200`: every other session revoked, this one kept |
  | `GET /v2/account/wallet` | bearer | `200 {revision, formatVersion, document, updatedAt}`; revision 0 and `document: null` before the first write |
  | `PUT /v2/account/wallet` | bearer, `{baseRevision, formatVersion, document}` | `200 {revision, size}` if `baseRevision` is the stored revision (0 for none); otherwise `409 {error:{code:"stale_revision", revision}}`; over `WALLET_MAX_BYTES` (default 512 KiB) `413 too_large`; a document outside the schema `422 invalid_document` |
  | `GET /v2/account/export` | bearer | `200 {account, credentials, wallet, sessions, pendingEmailCodes}`: everything the server holds for this user (the password hash is named, not shown) |
  | `DELETE /v2/account` | bearer, `{password}` | `200`: every row of the user in every table deleted |

- **Passwords:** at least 10 characters, PBKDF2-SHA256 through WebCrypto with a random 16-byte salt per user and 100,000 iterations (the most Workers' WebCrypto allows; the count is stored per user so a later raise can rehash on sign-in). An unknown email still spends one hash so its answer takes as long as a wrong password.
- **Email codes:** 6 digits, uniform; stored only as an HMAC keyed by the secret `ACCOUNT_SECRET`; 10 minutes; one use; deleted after 5 wrong tries (`code_invalid`, `code_expired`).
- **Sessions:** 32 random bytes; only their SHA-256 is stored; 30 days.
- **Limits:** every route goes through `RATE_LIMITER` per client like the `/v1` routes. Per email (keyed by an HMAC of the email in `auth_limits`, the same for emails with no account): 5 failed sign-ins within 15 minutes lock sign-in for 15 minutes, even with the right password (`429 account_locked` with `Retry-After`); at most 5 code mails an hour (`429 too_many_codes`).
- **Tables:** `users` (id, email, verified, password hash, salt, iterations), `email_codes`, `sessions`, `wallets` (`user_id`, `revision`, `document` JSON, `format_version`, `size`, `updated_at`), `auth_limits`. Deleting an account empties all five for the user (tested).
- **Log line:** route (`account_*`), status, error code, `user` (first 16 hex of an HMAC of the session's user id) and `size` (blob bytes). No email, password, code, token or wallet content (tested with a capture of every line).
- **Until configured** the account routes answer `503 account_unavailable`: they need the D1 binding `DB`, the `send_email` binding `EMAIL`, the var `ACCOUNT_EMAIL_FROM` and the secret `ACCOUNT_SECRET` (at least 16 characters). The top-level environment in `gateway/wrangler.jsonc` has none of them yet, so deploying this code changes nothing for existing builds.

### Passkeys (`/v2/account/passkey`, #461)

WebAuthn sign-in for an existing account, as a second way in beside email and password (the password stays; nothing here replaces it). Code: `gateway/src/passkeys.js`; schema: `gateway/migrations/0002_passkeys.sql` (apply it after 0001 with the same `wrangler d1 migrations apply`); tests: `tests/gateway-passkeys.test.mjs` (a software authenticator, `tests/helpers/virtual-authenticator.mjs`) and `tests/account-passkey-phone.test.mjs` (real headless Chrome at 375 px with Chrome's virtual authenticator).

| Route | Body | Answer |
| --- | --- | --- |
| `GET /v2/account/passkey/status` | none | `200 {enabled}`; true only when `PASSKEY_ORIGIN` is set. The PWA hides its passkey controls until it is true |
| `POST /v2/account/passkey/register/options` | bearer, `{}` | `200 {challengeId, publicKey}`: creation options for this user (discoverable credential, `attestation: none`, ES256 or RS256, existing passkeys excluded) |
| `POST /v2/account/passkey/register/verify` | bearer, `{challengeId, credential, name}` | `200 {id}` |
| `GET /v2/account/passkey` | bearer | `200 {passkeys:[{id, name}]}` |
| `DELETE /v2/account/passkey/:id` | bearer | `200`; an id that is not the caller's is `404 not_found` |
| `POST /v2/account/passkey/login/options` | `{}` | `200 {challengeId, publicKey}`: no email asked, the authenticator picks the credential |
| `POST /v2/account/passkey/login/verify` | `{challengeId, credential}` | `200 {token, expiresAt, email}`: a normal 30-day session |

- **Relying party:** the var `PASSKEY_ORIGIN` is the PWA's exact origin (`https://…`, no path; `http://localhost` only with `LOCAL_DEV=1`); the rpId is its hostname, and `clientDataJSON.origin` must equal it. The gateway's own CORS list (`ALLOWED_ORIGINS`) must name the same origin. Unset, the passkey routes answer `503 passkey_unavailable`.
- **Challenges:** 32 random bytes in `passkey_challenges`, bound to a purpose and a user, good for 5 minutes, and deleted the moment they are read, before anything is verified: a replay, a retry after a wrong answer and an expired one all get `400 challenge_expired`.
- **Checks:** type, challenge, origin, `crossOrigin`, rpIdHash, user-presence flag, the signature over `authData || SHA-256(clientDataJSON)` (ES256 or RS256, public key stored as JWK), the userHandle when sent, and a signature counter that must rise unless both sides are 0. Anything wrong is `401 passkey_invalid`. Attestation is not asked for and not checked.
- **Limits:** at most 10 passkeys per account; the per-client rate limiter covers every route. A passkey signs in only a verified account.
- **Tables:** `passkeys` (credential id, user, name, public key, algorithm, signature counter, created) and `passkey_challenges`. Deleting the account empties both for the user (tested); the export lists each passkey's name and date, never its key.
- **Extension:** it signs in through the PWA with `chrome.identity.launchWebAuthFlow` (split from #461 into its own issue); a passkey made on the web origin cannot be used from `chrome-extension://`.

### Who can see what (#413)

- **Per-user access:** every `/v2/account` handler takes the user from the bearer session (`session()` in `accounts.js`); no route reads a user id from the body, path or query, and a body key it does not know is `400 bad_request`. User A's session cannot read, overwrite or delete user B's blob (tested).
- **What is stored:** the wallet document only, checked against `gateway/src/walletSchema.js`: the nine sections of #411 (`cards`, `cardEdits`, `productChoices`, `paymentStates`, `pointValues`, `reminders`, `favorites`, `benefitEvents`, `costEvents`), JSON values only, strings up to 4,000 characters, depth 8, and no key such as `evidence`, `rawText`, `html` or `screenshot` at any depth. Anything else is `422 invalid_document` and nothing is stored. The per-section item shapes are tightened when #411 fixes them.
- **Who can read D1:** the server copy is readable, not encrypted against the operator. The only people who can read the `wallets` table are those who can open the owner's Cloudflare account (dashboard, `wrangler d1 execute`, API token). Claude does not read user rows; it reads them only when the owner asks for a named issue, and then takes the least needed and keeps it out of Git and issues. Counts and sizes for operations come from the log line and Analytics Engine, not from rows.
- **Logs and observability:** route, status, error code, user id hash and blob size only; Workers observability sees the same line, never a request body.
- **Export and delete:** `GET /v2/account/export` and `DELETE /v2/account` (above) cover all five tables; delete is tested to leave 0 rows in each.

### Run accounts locally

`node --test tests/gateway-accounts.test.mjs` runs every case on the gateway's own code with an in-memory D1 (`memoryD1` in `gateway/src/local.mjs`, which applies the real migration file) and a mail stand-in that keeps the messages (`memoryMail`). Under wrangler (Node 22): `npx wrangler@4.150.0 d1 migrations apply cardybara-accounts --local --env local --config gateway/wrangler.jsonc`, then `wrangler dev --env local` as in "Run it locally"; the local env has a local D1 and an `EMAIL` binding. **Not yet run under `wrangler dev` or workerd** (this machine has Node 21); in particular how local `wrangler dev` handles `send_email` for Email Sending is not verified.

### To deploy accounts (not done; needs the orchestrator, and the owner where marked)

1. Create the D1 database (included usage only, no paid plan): `npx wrangler@4.150.0 d1 create cardybara-accounts`. Add to the top level of `gateway/wrangler.jsonc`: `"d1_databases": [{"binding": "DB", "database_name": "cardybara-accounts", "database_id": "<id from create>", "migrations_dir": "migrations"}]` (the id is not a secret). Apply the schema: `npx wrangler@4.150.0 d1 migrations apply cardybara-accounts --remote --config gateway/wrangler.jsonc`.
2. Email Sending: onboard the sender domain (DNS records Cloudflare gives for SPF/DKIM) and pick the sender, then add `"send_email": [{"name": "EMAIL"}]` and the var `ACCOUNT_EMAIL_FROM` (for example `Cardybara <no-reply@…>` on that domain). Which domain to send from is the owner's choice (#410 approved the service, not a domain).
3. Secret `ACCOUNT_SECRET`: `openssl rand -base64 32 | npx wrangler@4.150.0 secret put ACCOUNT_SECRET --config gateway/wrangler.jsonc`, never printed or committed. Rotating it voids open email codes and restarts the per-email counters; passwords and sessions are not affected.
4. Add the web wallet's exact `https://` origin to `ALLOWED_ORIGINS` if not there yet (#378), deploy, and check `POST /v2/account/signup` with a test mailbox.

### Price and limits (checked 2026-11-16 on Cloudflare's public pages)

- **Email Sending** ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/), page updated 2026-06-09): outbound mail to arbitrary recipients needs Workers Paid (not available on Free); 3,000 emails a month included per account, then US$0.35 per 1,000. Mail to verified destination addresses is free and not counted. [Limits](https://developers.cloudflare.com/email-service/platform/limits/) (page updated 2026-10-30): 25 MiB per message, 50 recipients; the daily sending quota is not published (new accounts start low and it grows with sending history) — unknown for this account. The gateway already runs on Workers Paid, so no new plan; at most 5 code mails per email per hour keeps one address from using the quota up, but the account-wide monthly total is bounded only by the per-client `RATE_LIMITER`.
- **D1** ([pricing](https://developers.cloudflare.com/d1/platform/pricing/), page updated 2026-10-30): Workers Paid includes 25 billion rows read and 50 million rows written a month and 5 GB storage (overage US$0.001 per million rows read, US$1.00 per million rows written, US$0.75 per GB-month). A friends beta (a few hundred users, a wallet of up to 512 KiB each, a few writes per sign-in or sync) stays far inside that.

## Expected monthly cost

- **Cloudflare:** Workers Paid, US$5 a month, because the assistant's knowledge tools need more CPU than the Free plan's 10 ms per request (Deploy, step 2). Requests, KV reads and Durable Object use of a friends beta stay within what that plan includes. Accounts (once deployed) add D1 and Email Sending, both within what Workers Paid includes for a beta (3,000 emails a month; Accounts, "Price and limits").
- **Model:** bounded by the monthly budget (default US$10; `set-caps --monthly-usd` changes it), the gateway's ceiling, with the provider-side spend limit on a dedicated key as the backstop. One client's daily cap (default 300,000 tokens, at most about US$0.70 a day at the example prices) limits how fast one network address can drain it; someone with many addresses is held by the daily budget (default monthly / 30, about US$0.33 a day), so the month cannot be burned in a day; the budgets, not the per-client cap, are the ceiling (`assistantOff` or `set-caps --monthly-usd 0` stop it at once). A chat question is usually 2–4 completions, each one a request against the daily cap (200 requests are about 60 questions); with the tool list each completion sends several thousand input tokens. As a rough guide, at US$0.6 input / US$2.4 output per million tokens, a question of about 20,000 input and 1,000 output tokens costs about US$0.015, so US$10 covers roughly 650 questions a month. Check the provider's current prices and set `PRICE_*` to match.

## Privacy

The assistant runs in the Worker: it receives the question, the trimmed history, the wallet summary (held products, regions, programmes, point-value overrides, fee date set or not; never an amount, tail, statement, payment data or hidden card) and, for a wallet tool it asked for, that tool's result only. These pass to the model provider and are not stored by the gateway; the gateway logs only the time, route, token counts, counts of rounds and results, and status; to enforce the per-client daily cap it keeps a salted hash of the network address (never the address) for that UTC day only, deleted after midnight UTC; the metrics data points (Metrics) add only counts, durations, codes and release identity. Card-type recognition (bank, region and card name) passes through the proxy route the same way. Wallet tools never return balances or card numbers. Model-assisted bank parsing is off with the hosted service (`parserStatus` reports `hosted_no_parsing` and `completeBody` refuses it), so bank figures never go through the gateway; it stays available with an own key. There is no invite code; the extension sends the gateway no credential.

Accounts (`/v2/account`, once deployed): the server holds the email, a slow password hash, hashed codes and sessions, and, for a user who turns sync on, a readable copy of the wallet document (owner decision 2026-11-16, #410); D1 encrypts it at rest. Deleting the account deletes all of it. The log line keeps route, status and error code only.
