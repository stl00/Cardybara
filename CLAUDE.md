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

## Operating model

The owner is the top-level PM and sets outcomes. Claude is the orchestrator: it turns outcomes into GitHub milestones and issues, assigns workstreams, accepts results and reports progress.

Each workstream runs in its own session and git worktree, with one writer per area. Changes outside an area are requested from its owner with what is needed, why, and acceptance criteria.

| Workstream | Area | Outcome |
| --- | --- | --- |
| Collector infrastructure | Local dev collector, `extension-next/background.js`, `engine.js`, `protocol.js` | Real bank refresh works on localhost from source |
| Banks | Bank adapters, navigation and parsing in `extension-next/`, fixtures | Every card reads back correctly, per bank |
| Wallet product | `src/`, `src/translations.json` | UI and new-user flow |
| Release | `.github/`, `scripts/*release*`, acceptance scripts, `release.json` | An accepted installable package |

- Writers do not accept their own work; review is done by a separate read-only agent.
- Do not run bank workstreams in parallel until the collector infrastructure works, because they depend on it.
- Real bank pages are one shared resource: read one bank at a time. Amex regions share a login domain and their sessions replace each other.
- A bank that rejected automation is never retried by Claude in another browser, the owner's everyday Chrome included, whatever the consent. It goes through the plugin's own route; if it also rejects the plugin, mark it unsupported. See `docs/DEBUGGING.md`.
- Batch bank logins into one request to the owner instead of interrupting repeatedly. If a bank blocks automation, stop and report; never evade detection.

**Claude decides alone:** issues, branches, code, PRs, CI fixes, and merges to `main` as above. Choose reversible defaults by convention and report them afterwards.

**Only the owner:** tags, public releases, store submission, bank logins and device confirmations, and any new authorization or external service. When a decision is needed, ask one or two questions at a time, each with a recommendation and a one-line reason.

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
```

## Definition of done

- Tests and `npm run check:release` pass locally; CI is green on the PR.
- UI strings exist in all three languages (`src/translations.json`).
- UI that names a merchant, category or programme uses `src/ItemLogo.jsx`, resolved from knowledge data rather than per-page lists; issuers and reward accounts use `BankMark`. Raw bank descriptions such as transaction merchants stay as read, because matching them risks false matches. `tests/logo-coverage.test.mjs` fails on a new credit or benefit with no icon.
- A logo ships only as an `approved` entry in `src/data/logos.json` with a local file and its source and terms in `public/ASSET-SOURCES.md`. Otherwise the item uses its category icon. Approving a mark whose terms forbid or do not clearly allow this use is the owner's decision; the owner made that decision for the current registry on 2026-11-03 (#50), and each new brand still needs its own.
- The PR states what was verified and at which level — fixture replay, simulated flow, or real bank — and lists what is still `not_run`.
- No private data in the diff (see below). `scripts/audit-release.py` must still pass.

## Honesty about evidence

A passing build, test or replay is not real bank acceptance. Never mark acceptance records `passed` without a real observation, never fill missing amounts with zero, never guess a year for a yearless date, never assign one rewards total to several cards without pool evidence. Report failures and gaps plainly.

## Data and security boundaries

- Bank access is read-only: no payments, transfers, offer enrolment or settings changes. The owner performs logins, passcodes and device confirmations; never read or store passwords, cookies, one-time codes or full card numbers.
- Never commit or upload: `public/data.json`, `.env*` (except `.env.example`), `.debug/`, `release/`, `dist/`, ZIPs, runtime exports, real bank snapshots or screenshots, or absolute personal paths.
- The owner's older private source tree and its git history must never be merged, pushed or referenced as an ancestor here. Port changes as reviewed patches only.
- Model keys stay in the local server's private config; never in client code, the extension package, logs or CI.
