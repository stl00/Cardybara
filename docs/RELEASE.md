# Cardybara alpha release

Version metadata lives in release.json. The numeric manifest version is separate from the prerelease label. The release builder packages the standalone wallet, an empty seven-provider seed and locally bundled code. It excludes local data, credentials, personal runtime evidence, source maps and archived ZIPs. ZIP entries have stable ordering/timestamps and per-file checksums.

The standalone build has no ordinary-website bridge content script and no required loopback host access. Bank hosts remain declared; model/loopback hosts are optional. Optional local model requests require the user to configure/consent to that connection. No developer model credentials are provided.

## Release flow

1. Pull request → source/history audit → tests/evals → build → package audit → downloadable Actions artifact.
2. Merge main after checks pass.
3. Update release.json and push its matching v-prefixed tag.
4. CI creates a draft prerelease from the exact verified artifact.
5. Unpack that exact ZIP in a fresh Chrome profile. Do not import the owner's backup. Run the acceptance matrix below. A failed/pending item blocks promotion.
6. Chrome Web Store upload/review/publishing is a separate manual process. Store API credentials have not been requested or configured.

## Current public-release blockers

- Real Chrome acceptance of the new empty-wallet onboarding and bank discovery, without an existing owner's backup.
- A standalone AI experience without the developer's local service, with a clear user-owned credential or hosted-account flow.
- Per-bank/product testing beyond the owner's narrow HK Amex and Chase observations.
- Final publisher identity/contact, store listing screenshots, privacy declarations, and reviewer test instructions. Never supply real bank credentials to reviewers.
- Browser installation and store review have not been performed by CI.

This ZIP is an internal-testing alpha, not a claim that all features, banks, or store requirements are complete. The current cumulative Credit ledger is not a per-voucher redemption ledger. Public eligibility never proves enrollment, usage, reimbursement or a fee waiver.

## Exact-artifact acceptance gate

Create a private pending report with `node scripts/new-acceptance.mjs release/CANDIDATE.zip release/acceptance.private.json`. This command never marks a test passed. Keep screenshots and actual financial values out of public CI artifacts and Git history.

Required real-Chrome journeys: installation; empty first launch; manual card addition; bank-page discovery; observed field readback; full browser restart with records retained; export/recovery using only the newly created test wallet; cancellation; expired-login recovery; upgrade without lost records. A full browser restart cannot be replaced by reloading a tab. An empty-wallet seed, mocked Chrome APIs or a localhost frontend cannot prove extension installation.

For each of the seven bank regions, verify every card's rewards, balance, statement amount, minimum and payment date against the bank page, including the actual collection time and executing worker build. An explicit bank statement that a payment is not due may satisfy a payment field with its recorded reason. Missing data and yearless dates are not completed acceptance.

`node scripts/acceptance.mjs CANDIDATE.zip PRIVATE-REPORT.json RUNTIME-BUILD` fails closed on a pending case, old worker, old/mismatched artifact, imported owner backup, developer-service dependency or missing bank acceptance. After it passes, `node scripts/promote-release.mjs CANDIDATE.zip PRIVATE-REPORT.json --publish` additionally compares the GitHub draft asset's SHA-256 before publishing. These checks validate the evidence record; a tester must truthfully observe the real browser and bank results. GitHub owners can bypass local tooling, so the documented review gate remains mandatory.

Bank rewards and billing are the required MVP path. AI is optional and must be clearly marked as requiring separate user configuration; it must not block manual setup or rule-based bank collection. Store submission still needs its own review.

## Recovery and data boundaries

Export through the wallet before changing installations; browser origins and extension IDs have separate storage. Keep exports private. No recovery is guaranteed after uninstalling an extension without a backup. Existing local development history is separate from this repository's clean public initial history.

Official process references:
- https://developer.chrome.com/docs/webstore/prepare
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://docs.github.com/en/actions/reference/security/secure-use
