# PLAID_PLAN.md

## Goal

Cardybara: link users' credit card accounts, pull transactions and balances, plus liabilities (statement balance, due date, APR) for billing-cycle tracking (workflow_id: wf_14bd624655e227d5).

## Scope

- Products:
  - `transactions` in `products`: card transactions through `/transactions/sync`, and the card balances that come with the Item (TXN-001, LIAB-007, TXN-021).
  - `liabilities` in `additional_consented_products`: statement balance and date, minimum payment, due date, APRs through `/liabilities/get`; consented at Link, billed only on first use, no coverage cut (LIAB-007, CONV-002).
  - Rejected: `investments` (not a credit-card need), the Balance product (no real-time "refresh now" feature; cached balances are enough for billing cycles), Recurring Transactions and `/transactions/refresh` (paid add-ons, not needed; GUIDE-016), `auth`/`transfer`/`signal` (no money movement; they would also drop credit cards, TXN-021), identity and KYC (not needed).
- Geography: US institutions only (`country_codes: ["US"]`).
- Platform: Cloudflare Worker (`gateway/`, plain JavaScript ES modules) as the trusted backend; the wallet (React) as the client, in the Manifest V3 Chrome extension and in the PWA (web wallet, `https://cardybara-app.pages.dev`, since 2026-11-17). The Link JS SDK runs on a page the Worker serves (WEB-010).
- Environment: sandbox until acceptance passes and the owner tasks below are done.

## Human tasks

States per TASK-001. Re-read from `dashboard_get_state` on 2026-11-17 (round 3) for client "Individual account": link_customizations `default`, both redirect URIs, production authorized with transactions and liabilities for US. The account is a personal free trial with 20 connections (Items); the panel and Link page degrade to "no new connection" when they are used up (`plaid_limit`).

| Task | Why it matters | Where | State |
|------|----------------|-------|-------|
| Install and sign in to the Plaid CLI: `brew install plaid/plaid-cli/plaid && plaid login` (then `plaid teams choose` if there are several teams). Claude then runs `cd gateway && plaid keys write --env sandbox --gitignore` to build `gateway/.env` from `gateway/.env.example`; nobody types or prints the keys (GUIDE-021/022, TASK-010) | Without Sandbox keys the local gateway answers `plaid_unavailable` and the end-to-end Sandbox run cannot happen | Terminal; keys at https://dashboard.plaid.com/developers/keys | verified (owner signed in; `gateway/.env` written, `plaid doctor` all PASS; the Sandbox run below used it) |
| Register the OAuth redirect URIs exactly: `https://cardybara-gateway.cardybara.workers.dev/v2/plaid/link` (production) and `http://localhost:8787/v2/plaid/link` (Sandbox, local `wrangler dev`) | Without them OAuth banks (Chase, Bank of America, …) silently drop out of Link or break mid-flow (OAUTH-001, GUIDE-011). Not needed for the non-OAuth Sandbox run with First Platypus Bank | https://dashboard.plaid.com/developers/api → Allowed redirect URIs | verified (round 2: `redirect_uris` lists both URIs exactly) |
| Production secrets (at go-live, after accounts are deployed): `npx wrangler@4.150.0 secret put PLAID_CLIENT_ID --config gateway/wrangler.jsonc` and `npx wrangler@4.150.0 secret put PLAID_SECRET --config gateway/wrangler.jsonc` (the owner pastes each value into the prompt, never into chat). Claude sets `PLAID_ENV=production`, a random `PLAID_TOKEN_KEY`, the var `PLAID_REDIRECT_URI`, and applies `0003_plaid.sql` remotely | The production Worker answers `plaid_unavailable` until they exist; the token key encrypts every stored access token | Terminal; production keys at https://dashboard.plaid.com/developers/keys | not_applicable for this milestone (Sandbox scope; gateway accounts are not deployed to production yet). Do it at go-live |
| Company profile | Production OAuth institutions stay hidden from Link until the profile is complete (OAUTH-008, TASK-006) | https://dashboard.plaid.com/settings/company | reported_done (owner, 2026-11-17; "Company profile" and "App profile" are page tabs, not open tasks) |
| Data-security questionnaire: Settings → Compliance Center → Tasks → Required documents → **Security practices** | Gates Chase and other production OAuth institutions (OAUTH-008, TASK-006/009); review can take weeks | Settings → Compliance Center | not_applicable for this milestone: 个人版试用阶段锁定，升级 full access 时才开放（owner 2026-11-17 确认锁定）. Locked on the personal free trial, so it cannot be filled in now; it opens when applying to upgrade to full production access. **Go-live task** (see the checklist). Round 2 had recorded it as submitted; that was wrong |
| Data Transparency Messaging / Link use case for production | An unfinished DTM setup makes `/link/token/create` fail with `INVALID_LINK_CUSTOMIZATION` in production (PITFALL-002, CONV-011) | https://dashboard.plaid.com/link | verified (2026-11-17: Dashboard screenshot shows it published in the `default` customization with three uses: Track and manage your finances; Track, manage, and build your credit; Get rewards. `dashboard_get_state` lists the customization `default`) |
| Production access for transactions and liabilities (US) | Product calls fail with `INVALID_PRODUCT` otherwise (TASK-007) | https://dashboard.plaid.com/settings/team/products | verified (production_by_country.US lists both; production is an authorized environment) |
| Dashboard webhook receivers | Item and product webhooks are set per Item through `/link/token/create`'s `webhook`, not in the Dashboard (TASK-003) | — | not_applicable |

## Implementation checklist

- [x] `gateway/migrations/0003_plaid.sql`: `plaid_items` (encrypted access token, institution, duplicate-check keys, sync cursor, status, accounts and liabilities snapshot), `plaid_transactions`, `plaid_link_sessions`; all three in `TABLES` (DATA-001).
- [x] `gateway/src/plaid.js`: fetch-based Plaid client (one host from `PLAID_ENV`, `Plaid-Version: 2020-09-14`, request_ids logged, backoff with jitter for transient errors; GUIDE-004/005, ITEM-004/013, DATA-006); AES-GCM token sealing bound to the Item id (DATA-001, GUIDE-002).
- [x] Link session: `POST /v2/plaid/link` creates the link_token (transactions in products, liabilities consented, US, credit-card filter, 365 days, webhook, redirect_uri when set) and a one-time handle (GUIDE-010, DATA-004, TXN-009).
- [x] `gateway/src/plaidPage.js`: the Link page (Plaid CDN script, nonce CSP; pre-initialized, opened on click; OAuth return resumes with the same link_token and `receivedRedirectUri`; onExit distinguishes abandonment from errors; metadata and link_session_id posted to the server; WEB-001/003/004/006/010/011, OAUTH-003/004).
- [x] Exchange: duplicate check before the exchange, exchange persisted before anything else, institution name from `/institutions/get_by_id`, then one `/transactions/sync` and one `/liabilities/get`, in sequence (GUIDE-013/015/017, ITEM-011/014, TXN-003).
- [x] `/transactions/sync`: count 500, pages buffered, added/modified/removed applied and the cursor written in one D1 batch after `has_more` is false; restart from the starting cursor on `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`; PFC v2 pinned; `transactions_update_status` drives the "still importing" state (TXN-002/004/006/007/008/011, DATA-007).
- [x] `/liabilities/get`: APRs kept as a list by type; every field nullable; `NO_LIABILITY_ACCOUNTS`/`PRODUCT_NOT_READY` keep the old snapshot (LIAB-002/003/008).
- [x] Webhook receiver `POST /v2/plaid/webhook`: ES256-only JWT via `jose` (pinned 6.2.13), key by kid cached until `expired_at`, 5-minute age, constant-time SHA-256 of the raw body; 200 at once, work in `waitUntil`; SYNC_UPDATES_AVAILABLE → sync, LIABILITIES DEFAULT_UPDATE → liabilities, ITEM ERROR/PENDING_DISCONNECT/PENDING_EXPIRATION/LOGIN_REPAIRED/USER_PERMISSION_REVOKED → status; webhooks are triggers only (WEBHOOK-001/003/004/005/006/007).
- [x] Errors and Item health: ITEM_LOGIN_REQUIRED → `login_required` and update mode (`POST /v2/plaid/link {itemId}`: access_token, no products, no exchange); ITEM_NOT_FOUND → purge; `DELETE /v2/plaid/item` and account deletion call `/item/remove` first (ITEM-002/003/005).
- [x] Extension: `src/plaidClient.js` (bearer session only, allow-listed cache), `src/plaidCards.js` (issuer + last four match onto wallet cards; Plaid fills balance, limit, available, statement, minimum and due date when newer; manual edits still win), `src/PlaidCards.jsx` (panel on the bank-connections page: due date, statement balance, minimum, balance, limit, purchase APR, status, reconnect, sync, disconnect), `platform.plaid.open` in `src/platform/extension.js` (a tab) and, since 2026-11-17, `src/platform/web.js` (the PWA's own window; the Link page sends it back to the listed PWA origin's `#settings`, where the panel sits). UI strings in `src/i18n/plaid.json`.
- [x] Tests: `tests/gateway-plaid.test.mjs` (9 cases, fake Plaid, real ES256 webhooks), `tests/plaid-wallet.test.mjs` (4 cases); account, router and table tests updated.
- [x] Docs: `docs/GATEWAY.md` "Plaid-linked credit cards", `PRIVACY.md` "Plaid-linked US credit cards".
- [x] Sandbox end-to-end in a real browser with `user_good` and `user_transactions_dynamic`, plus the `error_ITEM_LOCKED` error path (2026-11-17; see Acceptance round 1).
- [x] PWA (2026-11-17): `platform.plaid` on the web, panel on the PWA's settings page for every signed-in account; `ALLOWED_ORIGINS` lists the PWA's exact origin (`https://cardybara-app.pages.dev`; locally `http://127.0.0.1:8766` under `LOCAL_DEV=1`); the Link page returns only to a listed web origin; `plaid_unavailable` and the plan cap (`plaid_limit`: `TRIAL_CONNECTION_LIMIT`, `CREDITS_EXHAUSTED`, `ADDITION_LIMIT`, not retried) degrade the panel; tests in `tests/gateway-plaid.test.mjs` (11 cases) and `tests/plaid-panel.test.mjs`.
- [ ] Production go-live (owner tasks above; accounts must be deployed first): apply to upgrade from the personal free trial to full production access, then fill in the Security practices questionnaire (Settings → Compliance Center, unlocked by that application) before OAuth institutions such as Chase; production secrets; deploy the gateway with the new `ALLOWED_ORIGINS`.

## Acceptance

- Round 0 (2026-11-17, commit "Link US credit cards through Plaid…"): FAIL, 4 open. Passed: CHECK-001–006, 010–014 (unit and route tests on a fake Plaid API with real ES256 webhooks; `wrangler dev --env local` booted under workerd and all 10 new routes answered, 503 `plaid_unavailable` without keys). Open:
  - CHECK-007: the redirect URI is passed when `PLAID_REDIRECT_URI` is set, but not registered in the Dashboard (owner task).
  - CHECK-008: no Sandbox run yet; blocked on the Plaid CLI login task.
  - CHECK-009: owner tasks still `needs_human` / `cannot_verify`.
  - CHECK-015: goal shown only on synthetic data; needs `user_good` and a second persona (`user_transactions_dynamic`) in Sandbox.
- Round 1 (2026-11-17, commit 333ae4f, no Plaid code change since round 0): FAIL, 2 open, both owner Dashboard tasks; 13 passed. The workflow is at implement round 2, waiting on the owner.
  - Ran: `wrangler dev --env local` with Sandbox keys from `gateway/.env`; a local account (sign-up and email code); `POST /v2/plaid/link`; the returned Link page in a real browser.
  - CHECK-008 passed: the page loads Plaid's `link-initialize.js` under its nonce CSP (`window.Plaid` defined, Link iframe opens). First Platypus Bank (non-OAuth), `user_good` / `pass_good`: Link listed only the two credit cards (account filter), then `/item/public_token/exchange` → `/institutions/get_by_id` → `/transactions/sync` → `/liabilities/get`, page "Connected". `GET /v2/plaid/cards`: Plaid Credit Card ••3333 statement balance 1708.77 (2019-05-28), due date 2020-05-28, minimum 20, balance 410, limit 2000, four APRs (purchase 12.5%); 72 transactions.
  - CHECK-015 passed on two personas (SANDBOX-009): `user_good` above answers "when is it due and how much"; Business Credit Card ••9999 has no liability data and every liability field is null without error. `user_transactions_dynamic`: one card ••2000, balance 500, no liabilities (nulls), 64 transactions with one pending. `POST /v2/plaid/refresh` then synced and refreshed liabilities for both Items (`ok`/`ok`), 136 transactions before and after (no duplicates, CHECK-005).
  - CHECK-012: `user_good` / `error_ITEM_LOCKED` → Link's error, exit; the page shows Plaid's display message and "Try again", `/v2/plaid/link/exit` logged `ITEM_LOCKED` / `requires_credentials`, and no Item was stored.
  - CHECK-013: every new route answered a real request (`/v2/plaid/link`, page, `/link/token`, `/link/complete`, `/link/exit`, `/cards`, `/transactions`, `/refresh`); `DELETE /v2/plaid/item` and `/webhook` by tests (localhost gets no webhooks).
  - CHECK-003: the wrangler log holds no key or access token (only `PLAID_SECRET ("(hidden)")`); `gateway/.env` was never read or printed.
  - Open: CHECK-007, `redirect_uris` is still empty in the Dashboard (owner task; the First Platypus run does not use OAuth). CHECK-009, the owner tasks above are still `needs_human` / `cannot_verify`.
- Round 2 (2026-11-17, commit 8b0fe86; no Plaid code changed since 333ae4f): **PASS**, all 15 checks passed. CHECK-007 now verified: the Dashboard lists both redirect URIs exactly. CHECK-009: every human task is verified, reported_done by the owner (company profile/questionnaire, DTM), or not_applicable for this Sandbox milestone (production secrets, Dashboard webhooks). Workflow wf_14bd624655e227d5 is done. **Correction (2026-11-17):** CHECK-009 rested on the owner's word that the security questionnaire was submitted; the Compliance Center still shows Security practices as an open task, so that item should not have passed. Not covered by a live run: OAuth institutions in Sandbox and live webhooks (signed-webhook tests only).

- Round 3 (2026-11-17, PWA, commits 0807dce and dc32639): **FAIL on CHECK-009 only** (14 passed), with the Security practices questionnaire as needs_human. Round 4 (same code): the owner confirmed the questionnaire is locked on the personal free trial and opens only with the upgrade to full access, so it is not_applicable for this milestone and a go-live task. **Round 4 verdict: PASS, all 15 checks**; workflow wf_14bd624655e227d5 done. The code is the round 3 code (dc32639); the evidence below is from the round 3 run. The PWA (`src/platform/web.js`) and the gateway's web-origin handling changed, so the round 2 verdict no longer applied; re-run below. CHECK-009 fails because the Security practices questionnaire (Settings → Compliance Center) is not done; the code checks all pass.
  - Ran: `wrangler dev --env local` with Sandbox keys and `ALLOWED_ORIGINS` naming a local PWA origin; the web build pointed at that gateway (a scratch build, not committed) served on `http://127.0.0.1:8791`; the built-in browser at the mobile preset (375×812, Android Chrome user agent).
  - PWA → settings page (Plaid panel, signed out: explanation, no Add) → sign-up with email code → panel "no cards yet" from `GET /v2/plaid/cards` → "添加信用卡": same window to the gateway's Link page with "Back to Cardybara" → Link: First Platypus Bank (non-OAuth), `user_good` / `pass_good`, only the two credit cards listed → Share data → Finish without saving → `/link/complete` 200 (exchange, institution, `/transactions/sync`, `/liabilities/get`) → the page went back to `http://127.0.0.1:8791/#settings` by itself → the panel shows Plaid Credit Card ••3333: due date 2020-05-28, statement balance US$1,708.77, minimum US$20.00, balance US$410.00, limit US$2,000.00, purchase APR 12.5%, statement date 2019-05-28; Business Credit Card ••9999: balance US$5,020.00, limit US$10,000.00, liability fields "未知".
  - CORS: preflight from the PWA origin 204 with that exact `Access-Control-Allow-Origin`; from `http://evil.example` 403. The Link page embeds only the listed web origin as a place to go back to.
  - Degradation: the same gateway with `PLAID_ENV=off` → every Plaid route 503 `plaid_unavailable`; the PWA panel shows "Plaid 连接服务还没开通，钱包照常使用。", no Add or Sync button, cached cards still shown. The plan cap (`TRIAL_CONNECTION_LIMIT`) → 429 `plaid_limit` after one call, by test.
  - Logs: no access, public or link token in the wrangler log; `PLAID_SECRET ("(hidden)")` only; `gateway/.env` not read.
  - After the run, the panel's Add/Sync buttons moved from the card's title bar into its body (the title was cut to "通过 …" at phone width); layout only, no Plaid call or state changed. Re-checked on the PWA at 375×812 against the same Sandbox gateway: full title, Add and Sync shown, cards unchanged.

## Maintenance

This integration is maintained with the Plaid MCP; this file is its durable state. Agents working in this repository: consult build_guidance before modifying any Plaid-touching code, and re-run build_check_acceptance before reporting such a change as working. The acceptance above applies only to the code as it was verified — later changes invalidate it.

## How to test

### Automated (no keys)

1. `node --test tests/gateway-plaid.test.mjs tests/plaid-wallet.test.mjs tests/plaid-panel.test.mjs`
2. Expected: 20 passing cases.

### Link a Sandbox credit card locally

1. Once: `cd gateway && plaid keys write --env sandbox --gitignore` (Claude runs this after `plaid login`; the CLI defaults to production, so `--env sandbox` is required); make sure `gateway/.dev.vars` does not exist, since wrangler then ignores `.env`.
2. Wrangler needs Node 22: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Then `npx wrangler@4.150.0 d1 migrations apply cardybara-accounts --local --env local --config gateway/wrangler.jsonc` and `npx wrangler@4.150.0 dev --env local --config gateway/wrangler.jsonc --port 8787 --ip 127.0.0.1`.
3. Either build a dev extension pointed at that gateway, sign up in Settings and press "Add a credit card" on the bank-connections page; or, without the extension: `POST /v2/account/signup` and `/v2/account/verify` with `Origin: chrome-extension://<any 32 letters a–p>` (the local email code is in the file wrangler names after "send_email binding called"), then `POST /v2/plaid/link` with the bearer and open the returned URL in a browser. Opening a second Link URL in the same tab changes only the fragment: reload the page.
4. In Link: "Continue without phone number", search "First Platypus", choose "First Platypus Bank" (not the OAuth entries), sign in with `user_good` / `pass_good`, Continue, Share data, "Finish without saving".
5. Expected: the page says "Connected"; `GET /v2/plaid/cards` (or the wallet's Plaid panel) shows Plaid Credit Card ••3333 with due date 2020-05-28, statement balance 1708.77, minimum 20, balance 410, limit 2000 and purchase APR 12.5%; Plaid Business Credit Card ••9999 has no liability data (nulls). "Sync" (`POST /v2/plaid/refresh`, once a minute per Item) pulls again; "Disconnect" removes it.
6. Second persona: repeat with `user_transactions_dynamic` / `pass_good`: one card ••2000, balance 500, no liabilities, about 64 transactions with one pending.
7. Error path: `user_good` / `error_ITEM_LOCKED` → exit Link; the page shows Plaid's message and "Try again", and nothing is stored.
8. OAuth banks: the redirect URIs are registered (round 2); set the var `PLAID_REDIRECT_URI=http://localhost:8787/v2/plaid/link` locally, then pick an OAuth Sandbox bank (e.g. "Platypus OAuth Bank") in Link; expect the bank page to return to the Link page and finish with "Connected".

### Link from the PWA (phone size)

1. Start the local gateway as above, adding `--var "ALLOWED_ORIGINS:chrome-extension://*,http://127.0.0.1:<port>"` for the port you serve the PWA on (the local env already lists `http://127.0.0.1:8766`, `npm run preview`'s port).
2. Build the web wallet against that gateway into a scratch folder, without committing: set `GATEWAY_ORIGIN` in `extension-next/model-client.js` to `http://127.0.0.1:8787`, `npx vite build --mode web --outDir <scratch>/web-local`, then `git checkout extension-next/model-client.js`. Serve the folder: `python3 -m http.server <port> --bind 127.0.0.1`.
3. Open `http://127.0.0.1:<port>/#settings` at phone size (the built-in browser's mobile preset). Expected, signed out: the card "通过 Plaid 连接的美国信用卡" explains that signing in is needed, with no Add button.
4. Sign up in "账号与同步" with any `@example.test` address (the code is in the file wrangler names after "send_email binding called"). Expected: the Plaid panel says "还没有连接信用卡。" with "添加信用卡".
5. Press "添加信用卡". Expected: the same window shows the gateway's "Add a credit card" page with a "Back to Cardybara" link. Link First Platypus Bank with `user_good` / `pass_good` as in steps 4–5 above.
6. Expected: "Connected. Going back to Cardybara…", then the PWA's settings page by itself, showing Plaid Credit Card ••3333 with due date 2020-05-28 and statement balance US$1,708.77 (minimum 20, balance 410, limit 2,000, APR 12.5%).
7. Degradation: restart the gateway with `--var PLAID_ENV:off` and reload. Expected: "Plaid 连接服务还没开通，钱包照常使用。", no Add or Sync button, the cached cards still shown.

## Decisions made

Integration-surface choices (GUIDE-020). The owner acts as top-level PM and delegated these to the orchestrating session, which proposed them; this session kept them unless noted.

- All Plaid calls live in the `gateway` Worker under `/v2/plaid/*`, on the existing `/v2/account` bearer sessions; `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` are Worker secrets, never in the extension (orchestrator).
- The access token is AES-GCM encrypted in D1 with a key derived from a separate secret, `PLAID_TOKEN_KEY` (not `ACCOUNT_SECRET`), so either can be rotated alone; the Item id is the associated data, so a row copied to another Item does not decrypt (this session).
- The Worker hosts the Link page at `GET /v2/plaid/link` (an MV3 extension cannot load remote script); the same URL is the OAuth `redirect_uri`. The extension opens it in a normal tab, not `launchWebAuthFlow`, because Plaid's OAuth may open a pop-up (orchestrator; this session chose the tab).
- The page knows the user only through a one-time link-session handle in the URL fragment, moved into the page's localStorage at once (it survives the OAuth redirect) and stored server-side only as a hash; the server returns the same link_token for it (this session).
- Synced transactions and the liabilities snapshot are stored in D1 per user (the sync cursor must be server-side anyway); the extension reads them from `/v2/plaid/cards` and `/v2/plaid/transactions`. This means card figures from Plaid do reach the server, unlike bank-page reading; `PRIVACY.md` says so (this session).
- 365 days of history at first Link (`transactions.days_requested`), for annual credit tracking (#272); it cannot be raised later without re-linking (this session).
- Link shows credit-card accounts only (`account_filters`); the panel and Link page say so before Link opens (this session).
- Wallet mapping: a Plaid card fills the wallet card with the same issuer (Chase, Amex US, BOA, Citi US by institution name) and last four digits; an ambiguous or unknown match fills nothing and the card stays in the Plaid panel; no wallet card is created from Plaid (this session).
- No polling: webhooks drive updates in production; the "Sync" button is the explicit user action and the reconcile path for missed webhooks (once a minute per Item); a local run has no webhooks (WEBHOOK-005) (this session).
- Funnel: `/v2/plaid/link/complete` and `/v2/plaid/link/exit` record `link_session_id`, status and error code on the gateway log line. No third-party analytics (project rule) (this session).
- 2026-11-17, owner: the PWA (web wallet) connects Plaid too, open to every signed-in account (no allowlist). This replaces the earlier "web wallet is manual entry only" rule for Plaid. Whether the personal (free trial) plan's terms allow serving several users has not been checked; the owner knows (owner, relayed by the session "Play 版 PWA 上线时间").
- The PWA goes to the Link page in its own window, not a pop-up or tab (a home-screen PWA has none, and OAuth must not run in an iframe, OAUTH-007); the page sends it back only to an origin the gateway lists, carried in the fragment and checked against a list the server embeds in the page (this session).
- JWT verification uses `jose` 6.2.13 (pinned, published more than two weeks before adoption); it is the one npm package allowed in the Worker bundle (this session).

## Open questions

- None blocking. Before production: whether accounts ship first (they are a prerequisite) and when to start the company profile and security questionnaire.
