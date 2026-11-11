# Hosted model gateway

Step 1 of the half-local, half-cloud assistant (stl00/Cardybara#208). Beta testers can chat without their own model key: the extension sends each chat completion to a small Cloudflare Worker that holds the owner's provider key and forwards the request to the provider. The agent loop, tools, knowledge and wallet data stay in the extension exactly as with an own key; the gateway only relays one completion at a time.

Code: `gateway/src/worker.js` (Worker and the `UsageLedger` Durable Object), `gateway/wrangler.toml`, `gateway/scripts/` (invite codes, local mock provider). Tests: `tests/gateway.test.mjs`, and the packaged-extension E2E `--chat --hosted` runs the same Worker code locally.

**Everything in "Owner steps" is owner-only.** Claude does not create the account, deploy, set secrets or issue codes.

## What the gateway does

- **Routes:** `POST /v1/chat/completions` (forwarded) and `POST /v1/invite` (checks a code, costs nothing, nothing forwarded). Everything else is 404/405.
- **Invite codes:** `Authorization: Bearer cdy_…` (43 random base64url characters, 256 bits). Workers KV stores only `invite:<sha256 of the code>` → `{hash, id, status, dailyRequests?, dailyTokens?}`; the digest is compared again in constant time. The code itself is never stored or logged. A per-code cap can only lower the global one.
- **Caps:** per code per UTC day (requests and tokens) and one global monthly budget in USD. Before forwarding, a single Durable Object reserves the request's worst case (body bytes as input tokens plus `max_tokens` as output, priced with `PRICE_*`); the check and the increment run in one queued operation, so parallel requests cannot overrun a cap. After the reply the reservation is replaced by the provider's actual usage; a failed completion releases its cost but still counts as a request; a reply without usage keeps the worst case. Over a cap the gateway answers `429` with `daily_requests`, `daily_tokens` or `monthly_budget`, and the chat says so in Chinese, Traditional Chinese or English.
- **Forwarded fields only:** `model` (must be in `ALLOWED_MODELS`), `messages` (text roles only), `tools`, `tool_choice`, `max_tokens` (≤ `MAX_OUTPUT_TOKENS`), `temperature`, `response_format` (`json_object`/`text`). Reasoning is forced off and streaming is off; any other field is dropped. Body limit `MAX_BODY_BYTES` (256 KB), enforced while streaming.
- **CORS:** only `ALLOWED_ORIGINS` (exact `chrome-extension://<id>` origins). Empty means no client at all.
- **Errors:** provider failures pass through as a status class only (`provider_rejected`, `provider_rate_limited`, `provider_error`, `provider_unreachable`, `provider_timeout`); provider text never reaches the client because it can echo the request. Redirects are never followed.
- **Logging:** one JSON line per request: time, route, code id, status, error code, prompt and completion tokens. Never bodies, codes, keys or wallet data. Workers Logs keeps these lines for reading usage.
- **Fail closed:** a missing `PROVIDER_KEY`, binding, model list, origin list or a malformed number answers `503 gateway_not_configured`.

## Run it locally

Needs Node 22 for wrangler. From `gateway/`:

```sh
cp .dev.vars.example .dev.vars                 # synthetic PROVIDER_KEY the mock accepts; .dev.vars is gitignored
node scripts/mock-provider.mjs &               # mock provider on 127.0.0.1:8799
npx wrangler@4.150.0 kv key put --binding INVITES --local --env local invite:<hash> '<record>'   # from scripts/invite.mjs, with --local
npx wrangler@4.150.0 dev --env local --port 8798
```

Then `POST http://127.0.0.1:8798/v1/chat/completions` with `Origin: chrome-extension://` plus 32 letters a–p, `Authorization: Bearer <code>` and a JSON body. Verified 2026-11-11 with wrangler 4.150.0: a chat reaches the mock, a code with `dailyRequests: 2` gets exactly two completions out of five (four of them in parallel), bad origin and bad code are refused.

## Owner steps

### 1. Create the Worker (once)

1. Create a Cloudflare account (the Free plan is enough to start) and run `npx wrangler@4.150.0 login`.
2. Create the invite store: `npx wrangler kv namespace create INVITES`. Put the printed `id` in `gateway/wrangler.toml` in place of `REPLACE_WITH_KV_NAMESPACE_ID`. (The id is not a secret; a PR can carry it.)
3. Set the provider key as a secret, from `gateway/`: `npx wrangler secret put PROVIDER_KEY` and paste the DeepSeek key at the prompt. It is never a var, never in a file, never in CI.
4. Set `ALLOWED_ORIGINS` in `wrangler.toml` (see "Extension origin" below), check the caps and prices, then `npx wrangler deploy` from `gateway/`. The Durable Object migration runs on the first deploy.
5. Tell Claude the Worker's URL (`https://cardybara-gateway.<your-subdomain>.workers.dev`, or a custom domain). Claude then changes `GATEWAY_ORIGIN` in `extension-next/model-client.js` and the matching optional host permission in `extension-next/manifest.json` in one PR (a test keeps the two equal). Until then the extension uses the reserved name `cardybara-gateway.invalid`, which never resolves; the hosted option shows "托管服务还没有开通" and the default stays "使用自己的 key". With the real origin set, hosted becomes the default for new users.

### Extension origin

Chrome derives an unpacked extension's id from its folder, so testers who load the alpha ZIP unpacked each have a different id. Two options:

- **Pinned id (recommended once there is a store listing or a `key` in the manifest):** `ALLOWED_ORIGINS = "chrome-extension://<id>"`, comma-separated for several.
- **Friends beta from the unpacked ZIP:** `ALLOWED_ORIGINS = "chrome-extension://*"`, which admits any extension origin but no web page. The invite code remains the real gate either way; CORS only stops web pages from using a leaked code in other people's browsers.

### 2. Issue and revoke invite codes

```sh
node gateway/scripts/invite.mjs t01                         # optional: --daily-requests 100 --daily-tokens 500000
```

It prints the code once (hand it to the tester privately; it is not stored anywhere) and the `wrangler kv key put` command that stores only its digest. Use short ids such as `t01`, not names: the id is what appears in logs. To revoke, run the printed `node gateway/scripts/invite.mjs --revoke-hash <hash> t01` and then the command it prints; or delete the key with `npx wrangler kv key delete --binding INVITES --remote invite:<hash>`. KV changes can take up to about a minute to reach every location.

### 3. Set caps

In `wrangler.toml` `[vars]`, then `npx wrangler deploy`:

| Var | Default | Meaning |
| --- | --- | --- |
| `DAILY_REQUESTS_PER_CODE` | 200 | completions per code per UTC day |
| `DAILY_TOKENS_PER_CODE` | 1000000 | tokens per code per UTC day (worst case reserved up front) |
| `MONTHLY_BUDGET_USD` | 10 | all codes together, per calendar month (UTC) |
| `PRICE_INPUT_USD_PER_MTOK` / `PRICE_OUTPUT_USD_PER_MTOK` | 0.6 / 2.4 | set at or above the provider's list price; cache discounts are not counted, so spend is over-estimated |
| `MAX_OUTPUT_TOKENS` | 8192 | the wallet's bank parsing asks for 8192 |
| `ALLOWED_MODELS` | deepseek-flash | the model the extension sends |

Emergency stop: `npx wrangler secret delete PROVIDER_KEY` (every request then answers 503), or set `MONTHLY_BUDGET_USD = "0"` and deploy. A leaked provider key: rotate it at the provider, then `wrangler secret put PROVIDER_KEY` again.

### 4. Read usage

- Cloudflare dashboard → Workers → `cardybara-gateway` → Logs (Workers Logs is enabled in `wrangler.toml`): filter by `code` for one tester, sum `prompt_tokens` / `completion_tokens`, or filter by `error` (`daily_requests`, `monthly_budget`, `invite_revoked`…).
- Live: `npx wrangler tail cardybara-gateway --format pretty`.
- The provider's own usage page is the source of truth for money spent.

## Expected monthly cost

- **Cloudflare:** a friends beta fits the Workers Free plan (100,000 requests a day; KV free reads; SQLite-backed Durable Objects are on the Free plan). The Workers Paid plan is US$5 a month if the beta grows past that.
- **Model:** bounded by `MONTHLY_BUDGET_USD` (default US$10), the hard ceiling. A chat question is usually 2–4 completions; with the tool list each completion sends several thousand input tokens. As a rough guide, at US$0.6 input / US$2.4 output per million tokens, a question of about 20,000 input and 1,000 output tokens costs about US$0.015, so US$10 covers roughly 650 questions a month. Check the provider's current prices and set `PRICE_*` to match.

## Privacy

Chat content passes through the Cardybara gateway to the model provider and is not stored by the gateway; the gateway logs only the code id, time, token counts and status. The same wallet data rules apply as with an own key: the assistant's tools never send balances or card numbers to the model. The invite code lives only in the extension's `chrome.storage.local`, like an own key, and is sent only to the gateway.
