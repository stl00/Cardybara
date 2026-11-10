# Held-out assistant eval

`evals/` is a development set: cases there guided the code, so passing them is not an accuracy estimate. This folder is the held-out level (#41): cases written on 2026-11-09 from public card terms, before any run against the code they test, and never used for development.

- **What it covers:** the offline assistant layer, with the same checks as `scripts/eval-agent.mjs`: benefit retrieval in three languages, card choice from earning rules, credit plans over dates and marks, public fee rules, and answer grounding. No model is called.
- **When it runs:** only for a release candidate, on a clean checkout of its release tag `v<label>` (CI builds the draft from that tag). `node scripts/eval-holdout.mjs CANDIDATE.zip PRIVATE-REPORT.json` refuses uncommitted changes, a `HEAD` that is not the tag's commit, a ZIP whose `BUILD_ID` differs, or a held-out set that does not match its manifest; then it writes `heldOutEval`, including `sourceCommit`, into the private acceptance report. Untracked files such as the report or ZIP are ignored by the clean-tree check; `promote-release.mjs` also compares `sourceCommit` with the commit the tag points at on GitHub. There is no development command for it on purpose.
- **Gate:** `scripts/acceptance.mjs` and `scripts/promote-release.mjs` fail closed unless `heldOutEval` exists for these exact artifact bytes and build, on the commit the release tag points at, on the frozen dataset hash, within seven days, with all `caseCount` cases run and a pass rate of at least `minPassRate` (`manifest.json`).
- **Frozen:** `manifest.json` records one SHA-256 over `cases.mjs`, `context.mjs` (the held-out wallet, kept apart from the development fixtures) and `run.mjs` (the checks). `tests/holdout-eval.test.mjs` fails if they differ, if a held-out id or question also appears in the development set, or if a retired case is still here or was not moved into the development set.
- **A failing case:** fixing it uses the case for development, so the fix PR moves it to `evals/fixtures.mjs`, lists its id under `retired`, and writes a new unseen case in its place. Never edit a held-out expectation to match the code.

## Baseline · 2026-11-09

Recorded once when the set was frozen, against `main` at `adb6711`: 24 of 27 passed (89%, gate at 80%). The three failures are real gaps, left unfixed here:

- `ho-nonsense-empty`: a query about a product that does not exist still returns benefit records.
- `ho-claims-transfer`: a claim that points were already transferred, worded differently from the development cases, is not caught by grounding.
- `ho-claims-enrollment-en`: "You are now enrolled" is not caught as an unverified enrollment.
