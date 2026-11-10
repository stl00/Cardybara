# Cardybara alpha release

Version metadata lives in release.json. The numeric manifest version is separate from the prerelease label. The release builder packages the standalone wallet, an empty seed of the active banks and locally bundled code. It excludes local data, credentials, personal runtime evidence, source maps and archived ZIPs. ZIP entries have stable ordering/timestamps and per-file checksums.

The standalone build has no ordinary-website bridge content script and no required loopback host access. Bank hosts remain declared; model/loopback hosts are optional. Optional local model requests require the user to configure/consent to that connection. No developer model credentials are provided.

## Release flow

1. Pull request → source/history audit → tests/evals → build → package audit → downloadable Actions artifact.
2. Merge main after checks pass.
3. Update release.json and push its matching v-prefixed tag.
4. CI creates a draft prerelease from the exact verified artifact.
5. Unpack that exact ZIP in a fresh Chrome profile. Do not import the owner's backup. Run the acceptance matrix below. A failed/pending item blocks promotion.
6. Chrome Web Store upload/review/publishing is a separate manual process. Store API credentials have not been requested or configured.

## E2E on the packaged extension

The `E2E` CI job runs after `Verify and package` on every pull request and push. It downloads that job's `cardybara-extension` artifact, checks it against `SHA256SUMS`, and runs `scripts/e2e-extension.mjs` on the exact ZIP without rebuilding: install in a clean headless Chrome profile, open the empty wallet, connect Chase, see needs-login, sign in on the synthetic page, let the reading guide read automatically, and check the fields read back while a minimum the page does not show stays unknown. Due dates are billing items rather than record fields and are not covered by this overview read yet. `secure.chase.com` reaches a local HTTPS server that answers with `tests/fixtures/synthetic-bank.html` through Chrome launch options only (`--host-rules`, a certificate pin for a throwaway key); every other host fails to resolve, and the package is not changed. A second step breaks copies of the same package (no service worker, no bank host permission, a worker that does not start, no reading guide, a reader that does nothing) and fails unless each fails for its expected reason. On failure the job uploads `e2e-output` with the log and screenshots of the wallet and the synthetic page. No secrets are used, so fork pull requests run it too.

Locally: `npm run build:release && npm run test:e2e` (Chrome and `openssl` required; `--out <dir>` keeps artefacts, default `.debug/e2e`). The synthetic bank answers at once, which covers the first-load race fixed in stl00/Cardybara#123; `CARDYBARA_E2E_BANK_DELAY_MS=<ms>` adds latency.

Still to come (#47): a nightly and pre-tag set covering browser restart with records retained, upgrade from the previous package, cancellation, expired login and the assistant chat UI with a scripted model. `E2E` becomes a required check on `main` once it has been stable, which is a branch-protection change for the owner.

## Current public-release blockers

- Real Chrome acceptance of the new empty-wallet onboarding and bank discovery, without an existing owner's backup.
- A standalone AI experience without the developer's local service, with a clear user-owned credential or hosted-account flow.
- Per-bank/product testing beyond the owner's narrow HK Amex and Chase observations.
- Final publisher identity/contact, store listing screenshots, privacy declarations, and reviewer test instructions. Never supply real bank credentials to reviewers.
- Store review has not been performed. CI installs the package in Chrome only against a synthetic bank (below), which is not bank acceptance.

This ZIP is an internal-testing alpha, not a claim that all features, banks, or store requirements are complete. The current cumulative Credit ledger is not a per-voucher redemption ledger. Public eligibility never proves enrollment, usage, reimbursement or a fee waiver.

## Exact-artifact acceptance gate

Create a private pending report with `node scripts/new-acceptance.mjs release/CANDIDATE.zip release/acceptance.private.json`. This command never marks a test passed, and leaves every environment answer and the runtime build empty for the tester to fill in from what they observed. Keep screenshots and actual financial values out of public CI artifacts and Git history.

Required real-Chrome journeys: installation; empty first launch; manual card addition; bank-page discovery; observed field readback; full browser restart with records retained; export/recovery using only the newly created test wallet; cancellation; expired-login recovery; upgrade without lost records. A full browser restart cannot be replaced by reloading a tab. An empty-wallet seed, mocked Chrome APIs or a localhost frontend cannot prove extension installation.

MVP regions: Amex US, Amex HK, Chase, Bank of America, HSBC HK, Standard Chartered HK and Citi US. Amex Canada is archived and not part of acceptance. Citi US stays required, so the gate stays closed until it is really accepted.

For each region, verify every card's balance, statement amount, minimum and payment date against the bank page, plus its Membership Rewards or Ultimate Rewards if it has one, including the actual collection time and executing worker build. An explicit bank statement that a payment is not due may satisfy the minimum and due date, not the balance or statement amount, with its recorded reason. Other rewards programmes are not collected in this version: record `status: "not_collected"` with the programme name and a reason. At Amex the name must be a listed brand, as in the wallet. Neither can stand in for a required programme. Missing data and yearless dates are not completed acceptance: an observed due date records `date` as YYYY-MM-DD and `yearEvidence`, the date text as printed on the bank page, which must contain that year.

Run the frozen held-out assistant eval on a clean checkout of the release tag: `node scripts/eval-holdout.mjs CANDIDATE.zip PRIVATE-REPORT.json`. It refuses local changes, a commit other than the tag's, or a ZIP with another build, and records `heldOutEval` with its source commit in the report; acceptance and promotion check that commit against the tag. The cases are never used for development; see `evals/holdout/README.md`.

`node scripts/acceptance.mjs CANDIDATE.zip PRIVATE-REPORT.json RUNTIME-BUILD` fails closed on a pending case, a held-out assistant eval that did not run on this candidate or fell below its pass rate, old worker, old/mismatched artifact, imported owner backup, developer-service dependency or missing bank acceptance. After it passes, `node scripts/promote-release.mjs CANDIDATE.zip PRIVATE-REPORT.json --publish` reads the expected build from `build-info.js` inside the ZIP rather than the checkout, and additionally compares the GitHub draft asset's SHA-256 before publishing. These checks validate the evidence record; a tester must truthfully observe the real browser and bank results. GitHub owners can bypass local tooling, so the documented review gate remains mandatory.

Billing for every card, and Membership Rewards and Ultimate Rewards, are the required MVP path. AI is optional and must be clearly marked as requiring separate user configuration; it must not block manual setup or rule-based bank collection. Store submission still needs its own review.

## Recovery and data boundaries

Export through the wallet before changing installations; browser origins and extension IDs have separate storage. Keep exports private. No recovery is guaranteed after uninstalling an extension without a backup. Existing local development history is separate from this repository's clean public initial history.

Official process references:
- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://docs.github.com/en/actions/reference/security/secure-use
