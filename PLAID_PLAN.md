# PLAID_PLAN.md

## Goal

Cardybara: link users' credit card accounts, pull transactions and balances, plus liabilities (statement balance, due date, APR) for billing-cycle tracking (workflow_id: wf_14bd624655e227d5).

## Scope

- Products:
  - `transactions` in `products`: card transactions through `/transactions/sync`, and the card balances that come with the Item (TXN-001, LIAB-007, TXN-021).
  - `liabilities` in `additional_consented_products`: statement balance and date, minimum payment, due date, APRs through `/liabilities/get`; consented at Link, billed only on first use, no coverage cut (LIAB-007, CONV-002).
  - Rejected: `investments` (not a credit-card need), the Balance product (no real-time "refresh now" feature; cached balances are enough for billing cycles), Recurring Transactions and `/transactions/refresh` (paid add-ons, not needed; GUIDE-016), `auth`/`transfer`/`signal` (no money movement; they would also drop credit cards, TXN-021), identity and KYC (not needed).
- Geography: US institutions only (`country_codes: ["US"]`).
- Platform: Cloudflare Worker (`gateway/`, plain JavaScript ES modules) as the trusted backend; the Manifest V3 Chrome extension's wallet (React) as the client. The Link JS SDK runs on a page the Worker serves (WEB-010).
- Environment: sandbox until acceptance passes and the owner tasks below are done.

## Human tasks

States per TASK-001. Read from `dashboard_get_state` on 2026-11-17 for client "Individual account".

| Task | Why it matters | Where | State |
|------|----------------|-------|-------|
| Install and sign in to the Plaid CLI: `brew install plaid/plaid-cli/plaid && plaid login` (then `plaid teams choose` if there are several teams). Claude then runs `cd gateway && plaid keys write --env sandbox --gitignore` to build `gateway/.env` from `gateway/.env.example`; nobody types or prints the keys (GUIDE-021/022, TASK-010) | Without Sandbox keys the local gateway answers `plaid_unavailable` and the end-to-end Sandbox run cannot happen | Terminal; keys at https://dashboard.plaid.com/developers/keys | needs_human |
| Register the OAuth redirect URIs exactly: `https://cardybara-gateway.cardybara.workers.dev/v2/plaid/link` (production) and `http://localhost:8787/v2/plaid/link` (Sandbox, local `wrangler dev`) | Without them OAuth banks (Chase, Bank of America, …) silently drop out of Link or break mid-flow (OAUTH-001, GUIDE-011). Not needed for the non-OAuth Sandbox run with First Platypus Bank | https://dashboard.plaid.com/developers/api → Allowed redirect URIs | needs_human (redirect_uris is empty) |
| Production secrets (at go-live, after accounts are deployed): `npx wrangler@4.150.0 secret put PLAID_CLIENT_ID --config gateway/wrangler.jsonc` and `npx wrangler@4.150.0 secret put PLAID_SECRET --config gateway/wrangler.jsonc` (the owner pastes each value into the prompt, never into chat). Claude sets `PLAID_ENV=production`, a random `PLAID_TOKEN_KEY`, the var `PLAID_REDIRECT_URI`, and applies `0003_plaid.sql` remotely | The production Worker answers `plaid_unavailable` until they exist; the token key encrypts every stored access token | Terminal; production keys at https://dashboard.plaid.com/developers/keys | needs_human (production not yet in scope: accounts are not deployed) |
| Company profile and the data-security questionnaire | Production OAuth institutions, Chase first, stay hidden from Link until these are approved (OAUTH-008, TASK-006/009); start early, review can take weeks | https://dashboard.plaid.com/settings/company | cannot_verify (not readable through the tools) |
| Data Transparency Messaging / Link use case for production | An unfinished DTM setup makes `/link/token/create` fail with `INVALID_LINK_CUSTOMIZATION` in production (PITFALL-002, CONV-011) | https://dashboard.plaid.com/link | cannot_verify |
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
- [x] Extension: `src/plaidClient.js` (bearer session only, allow-listed cache), `src/plaidCards.js` (issuer + last four match onto wallet cards; Plaid fills balance, limit, available, statement, minimum and due date when newer; manual edits still win), `src/PlaidCards.jsx` (panel on the bank-connections page: due date, statement balance, minimum, balance, limit, purchase APR, status, reconnect, sync, disconnect), `platform.plaid.open` in `src/platform/extension.js` only (the web wallet has no Plaid). UI strings in `src/i18n/plaid.json`.
- [x] Tests: `tests/gateway-plaid.test.mjs` (9 cases, fake Plaid, real ES256 webhooks), `tests/plaid-wallet.test.mjs` (4 cases); account, router and table tests updated.
- [x] Docs: `docs/GATEWAY.md` "Plaid-linked credit cards", `PRIVACY.md` "Plaid-linked US credit cards".
- [ ] Sandbox end-to-end with `user_good` in a real browser (blocked on the CLI task above).
- [ ] Production go-live (owner tasks above; accounts must be deployed first).

## Acceptance

- Round 0 (2026-11-17, commit "Link US credit cards through Plaid…"): FAIL, 4 open. Passed: CHECK-001–006, 010–014 (unit and route tests on a fake Plaid API with real ES256 webhooks; `wrangler dev --env local` booted under workerd and all 10 new routes answered, 503 `plaid_unavailable` without keys). Open:
  - CHECK-007: the redirect URI is passed when `PLAID_REDIRECT_URI` is set, but not registered in the Dashboard (owner task).
  - CHECK-008: no Sandbox run yet; blocked on the Plaid CLI login task.
  - CHECK-009: owner tasks still `needs_human` / `cannot_verify`.
  - CHECK-015: goal shown only on synthetic data; needs `user_good` and a second persona (`user_transactions_dynamic`) in Sandbox.

## Maintenance

This integration is maintained with the Plaid MCP; this file is its durable state. Agents working in this repository: consult build_guidance before modifying any Plaid-touching code, and re-run build_check_acceptance before reporting such a change as working. The acceptance above applies only to the code as it was verified — later changes invalidate it.

## How to test

### Automated (no keys)

1. `node --test tests/gateway-plaid.test.mjs tests/plaid-wallet.test.mjs`
2. Expected: 13 passing cases.

### Link a Sandbox credit card locally

1. Once: `cd gateway && plaid keys write --env sandbox --gitignore` (Claude runs this after `plaid login`); make sure `gateway/.dev.vars` does not exist, since wrangler then ignores `.env`.
2. `npx wrangler@4.150.0 d1 migrations apply cardybara-accounts --local --env local --config gateway/wrangler.jsonc`, then `npx wrangler@4.150.0 dev --env local --config gateway/wrangler.jsonc` (http://localhost:8787).
3. Build a dev extension pointed at that gateway, sign up in Settings with any test email, open the bank-connections page and press "Add a credit card".
4. In the Link tab, choose First Platypus Bank, sign in with `user_good` / `pass_good`, select the credit card, finish.
5. Expected: the tab says "Connected"; back in the wallet the Plaid panel lists "Plaid Credit Card" with a due date, statement balance, minimum payment, balance, limit and purchase APR. "Sync" pulls again; "Disconnect" removes it.
6. Error path: password `error_ITEM_LOCKED` shows Plaid's message on the Link page and nothing is stored.

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
- JWT verification uses `jose` 6.2.13 (pinned, published more than two weeks before adoption); it is the one npm package allowed in the Worker bundle (this session).

## Open questions

- None blocking. Before production: whether accounts ship first (they are a prerequisite) and when to start the company profile and security questionnaire.
