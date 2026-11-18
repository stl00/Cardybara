# Cardybara — engineering guide for Claude

@AGENTS.md

Cardybara (卡疲扒拉) is a local credit-card wallet: React 19 + Ant Design (default theme, zh-CN / zh-TW / en) packaged as a Manifest V3 Chrome extension with read-only bank collection. MVP scope: Amex US/HK, Chase, BOA, HSBC HK, SC HK, Citi US — balance, statement amount, minimum payment and due date for every card; rewards for Amex Membership Rewards and Chase Ultimate Rewards only. Amex CA is archived.

Read before changing behaviour: `README.md`, `docs/DEBUGGING.md` (dev loop and evidence levels), `docs/RELEASE.md` (release gate).

## Delivery lifecycle

Every change follows the same path. Do not skip steps or merge them together.

1. **Track** — non-trivial work starts from a GitHub issue (bug, feature or bank-coverage). Describe bank behaviour in words or with synthetic values; never paste real amounts, card numbers or screenshots into GitHub.
2. **Branch** — branch from an up-to-date `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`, `test/…`. One concern per branch. Never commit directly to `main`.
3. **Develop locally** — run the source with `npm run dev` and fix against the same code that ships. Reproduce bank problems as sanitized fixtures first; real bank pages are for confirming, not for iterating.
4. **Test** — a bug fix lands with a regression test that fails without it. Run the narrowest relevant check while iterating and `npm run check:release` before pushing.
5. **Commit** — imperative subject ≤ 72 chars (`Fix Chase minimum when no payment is due`), body explains why. Keep commits buildable.
6. **Pull request** — push and open a PR against `main` using the template; link the issue (`Closes #n`). Start as draft while work is in progress.
7. **CI** — `Verify and package` must be green. Only a CI artifact can be a release candidate; a local `build:release` is for checks. Never hand-copy files into an installed extension directory.
8. **Review and merge** — an independent review agent that did not write the change reviews the PR. Claude squash-merges once CI is green and review findings are resolved (owner authorized 2026-11-03). After review is resolved, turn on GitHub auto-merge (`gh pr merge --squash --auto`) instead of waiting or asking the owner to watch CI (owner authorized 2026-11-04). If a PR falls behind `main`, update it, and re-review only when the update changes behaviour. Merging to `main` is integration, not a release or bank acceptance. Never force-push shared branches or bypass branch protection.
9. **Release** — bump `release.json`, tag `v<label>`; CI creates a draft prerelease from the verified artifact. Promote only after the exact-artifact acceptance in `docs/RELEASE.md` passes. Tags, releases and store submissions always need the owner's go-ahead.
   The **web channel** (the PWA, #373) is the exception: a green `main` deploys itself to Cloudflare Pages with no tag and no owner step (owner decision 2026-11-16). See "One source, two channels" below.

## Operating model

The owner is the top-level PM and sets outcomes. Claude is the orchestrator: it turns outcomes into GitHub milestones and issues, assigns workstreams, accepts results and reports progress.

Each workstream runs in its own session and git worktree, with one writer per area. Changes outside an area are requested from its owner with what is needed, why, and acceptance criteria.

| Workstream | Area | Outcome |
| --- | --- | --- |
| Collector infrastructure | Local dev collector, `extension-next/background.js`, `engine.js`, `protocol.js` | Real bank refresh works on localhost from source |
| Banks | Bank adapters, navigation and parsing in `extension-next/`, fixtures | Every card reads back correctly, per bank |
| Wallet product | `src/`, `src/i18n/*.json` | UI and new-user flow |
| Release | `.github/`, `scripts/*release*`, acceptance scripts, `release.json` | An accepted installable package |

- Writers do not accept their own work; review is done by a separate read-only agent.
- Do not run bank workstreams in parallel until the collector infrastructure works, because they depend on it.
- Real bank pages are one shared resource: read one bank at a time. Amex regions share a login domain and their sessions replace each other.
- A bank that rejected automation is never retried by Claude in another browser, the owner's everyday Chrome included, whatever the consent. It goes through the plugin's own route; if it also rejects the plugin, mark it unsupported. See `docs/DEBUGGING.md`.
- Batch bank logins into one request to the owner instead of interrupting repeatedly. If a bank blocks automation, stop and report; never evade detection.

**Claude decides alone:** issues, branches, code, PRs, CI fixes, and merges to `main` as above. Choose reversible defaults by convention and report them afterwards.

**Only the owner:** tags, public extension releases, store submission, bank logins and device confirmations, and any new authorization or external service. When a decision is needed, ask one or two questions at a time, each with a recommendation and a one-line reason.

## One source, two channels

The wallet in `src/` is one codebase shipped to two channels (owner decision 2026-11-16, #373). **Target state, being built in #374 (web build and CD) and #375 (platform adapter); until they merge there is no web build or web deploy, and `chrome.*` is still called from a few files in `src/`.**

| Channel | Artifact | Ships when | Gate |
| --- | --- | --- | --- |
| Extension | CI ZIP | owner tags `v<label>` | exact-artifact acceptance in `docs/RELEASE.md` |
| Web (PWA) | `dist/web` | every `main` commit whose build, web checks and mobile E2E jobs are all green | the deploy job `needs:` those jobs on the same commit |

- **Where it deploys:** its own Pages project `cardybara-app`, its own workflow and a protected `web` environment. The product site (`site/`, `.github/workflows/site.yml`, project `cardybara`) is unchanged: manual only, production needs the owner's go-ahead. Creating the free `cardybara-app` project and `web` environment falls under the owner's standing Cloudflare operations authorization; a paid plan still needs the owner.
- **PR previews:** only for PRs from branches of this repository, triggered by `pull_request`. Never use `pull_request_target`; fork PRs get no deploy. The token has Pages: Edit only and lives in the `web` environment.
- **Platform adapter:** shared code never calls a platform API directly. Storage, notifications, bank collection and the assistant transport go through `src/platform/` (`extension.js`, `web.js`); a capability a channel lacks (bank collection on the web) is absent, not faked. A new `chrome.*` API call outside `src/platform/extension.js` is a review finding.
- **Versions:** both artifacts are built and tested from the same commit. The extension is identified by its `release.json` label; the web build by its commit SHA, which its About page shows instead of the extension's label (#379).
- **Web red lines,** enforced by the `dist/web` check script; a PR that breaks one cannot merge: the web wallet reads no bank pages and has no automatic import except Plaid-linked US credit cards for a signed-in account, through the gateway (owner 2026-11-16, Plaid added 2026-11-17, `PLAID_PLAN.md`); wallet data is uploaded only when the user turns on account sync, and bank credentials never are (#410; a signed-out or sync-off wallet uploads no wallet data; web push stores only a subscription and fire times, #380); no analytics, cookies or third-party requests; CSP `connect-src` allows only the gateway; the static wallet needs no invite code.
- **Older cached builds keep running:** gateway routes stay backward compatible (change a shape under a new path such as `/v2/...`). Stored wallet data carries a format version; a change to it ships with a migration and its test, and a build that finds a newer version than it knows reads without writing and tells the user to reload. A deploy that changed the data format is fixed forward, never rolled back. A new service worker must take over from the previous one's cache.
- **Rollback:** for any other bad deploy, redeploy the previous green commit.

## Commands

```sh
npm ci && npm run init:local     # once; init never overwrites an existing wallet
npm run dev                      # source dev server (default 127.0.0.1:8766; pass -- --port N for another)
npm run check:fixtures           # parse-only pass over bank samples
npm run debug:bank               # field replays + the full regression list
npm run test:refresh             # collector / state machine / UI-logic regressions
npm run check:chase              # per-bank subsets: check:chase, check:hk
npm run check:agent              # chat agent tests + offline eval
npm run check:release            # everything CI runs, including build and package audit
npm run build:dev-extension      # local dev extension with the scheduled refresh; never a release candidate
```

## Definition of done

- Tests and `npm run check:release` pass locally; CI is green on the PR.
- UI strings exist in all three languages (`src/i18n/<area>.json`; a key in two files fails the build).
- UI that names a merchant, category or programme uses `src/ItemLogo.jsx`, resolved from knowledge data rather than per-page lists; issuers and reward accounts use `BankMark`. Raw bank descriptions such as transaction merchants stay as read, because matching them risks false matches. `tests/logo-coverage.test.mjs` fails on a new credit or benefit with no icon.
- A logo ships only as an `approved` entry in `src/data/logos.json` with a local file and its source and terms in `public/ASSET-SOURCES.md`. Otherwise the item uses its category icon. Approving a mark whose terms forbid or do not clearly allow this use is the owner's decision; the owner made that decision for the current registry on 2026-11-03 (#50), and each new brand still needs its own.
- The PR states what was verified and at which level — fixture replay, simulated flow, or real bank — and lists what is still `not_run`.
- No private data in the diff (see below). `scripts/audit-release.py` must still pass.

## Honesty about evidence

A passing build, test or replay is not real bank acceptance. Never mark acceptance records `passed` without a real observation, never fill missing amounts with zero, never guess a year for a yearless date (the wallet's one rule is the year nearest the day it was read, shown as inferred; collection and acceptance never add one), never assign one rewards total to several cards without pool evidence. Report failures and gaps plainly.

## Data and security boundaries

- Bank access is read-only: no payments, transfers, offer enrolment or settings changes. The owner performs logins, passcodes and device confirmations; never read or store passwords, cookies, one-time codes or full card numbers.
- Never commit or upload: `public/data.json`, `.env*` (except `.env.example`), `.debug/`, `release/`, `dist/`, ZIPs, runtime exports, real bank snapshots or screenshots, or absolute personal paths.
- The owner's older private source tree and its git history must never be merged, pushed or referenced as an ancestor here. Port changes as reviewed patches only.
- A model key the owner enters lives only in the extension's `chrome.storage.local` (owner decision 2026-11-05). Never put it in code, the extension package, logs, diagnostics reports, exports, Git or CI, and send it only to the model provider's API.
