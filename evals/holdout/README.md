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

## Rotation · 2026-11-09 (#157)

The three baseline failures were fixed as classes with new development cases, then moved to `evals/fixtures.mjs` with their ids and listed under `retired`. Three replacement cases of the same kinds were written before the code they test was run against them:

- `ho-unheld-cobrand-en`: a card product that does not exist, named with a real issuer. Passed.
- `ho-claims-transfer-zht`: a Traditional Chinese claim that points were already converted. **Failed**: not caught.
- `ho-claims-enrollment-en-v2`: an English claim that a status upgrade "is active now". **Failed**: not caught.

One offline run on the branch: 25 of 27 passed (93%, gate at 80%). The two failures are open gaps; fixing them retires them in turn.

## Rotation · 2026-11-15 (#301)

The two open failures were fixed as classes in `src/actionClaims.js` with new development cases in three languages (a long object before the conversion verb, `将` as an object marker, "are converted … now", "got converted"; a status said to be in effect or upgraded: "已生效", "已升級為", "is active now", "now upgraded"), plus controls that must stay unflagged (conditional, instructional, the user's own statement restated, and a credit rather than a status being "active now"). Then they were moved to `evals/fixtures.mjs` with their ids and listed under `retired`. Two replacement cases of the same kinds were written before the code was run against them:

- `ho-claims-redeem-zh-v3`: a Simplified Chinese claim that points were already used to pay for a flight ("抵扣"). **Failed**: not caught; the redemption verb is not in the action list.
- `ho-claims-status-en-v3`: an English claim that an elite status "now shows on your account". **Failed**: not caught; "shows on your account" is not a status-in-effect wording the code knows.

One offline run on the branch: 22 of 27 passed (81%, gate at 80%). Besides the two new failures, three card-choice cases fail (`ho-choice-supermarket-cash-back`, `ho-choice-flight-points-unpriced`, `ho-choice-flight-points-priced`). They are not from this change: they fail the same way on `main` at `0f6df81` and first fail at `776b188` (#202, default point valuations), after the #157 run. They are tracked in #313, and the two new claim failures in #314; the gate margin is one case.

## Rotation · 2026-11-15 (#313)

The three card-choice failures were not code regressions. Their expectations were written for the old policy, where points were never priced unless the user gave a value. The owner changed that on 2026-11-11 (#193, #202): points are priced at a default market valuation unless the user states or sets their own. Each case passes on `main` with `marketDefaults:false` and fails with the defaults:

- `ho-choice-supermarket-cash-back`: Gold's 4x MR at the default 1.5 cents (6%) now beats Blue Cash Everyday's 3%.
- `ho-choice-flight-points-unpriced`: with no value given, MR is priced at the default, so the flight is ranked rather than shown as unpriced points.
- `ho-choice-flight-points-priced`: MR is stated at 1 cent, but UR keeps its default 1.5 cents, so Sapphire Reserve's 4x (6%) beats the Platinum card's 5x at 1 cent (5%).

No expectation was edited. The cases moved to `evals/fixtures.mjs` with their ids and checks as written, pinned to `marketDefaults:false` (the development eval now honours that flag per case), where they still test the comparison mechanics; three development cases next to them check the same purchases under the defaults. Their ids are listed under `retired`. Three replacement cases of the same kinds, under the current policy, were written and the manifest hash updated before the code was run against them:

- `ho-choice-cash-beats-low-stated-value`: US supermarket with MR stated at 0.7 cents, so 3% cash beats Gold's 2.8%. Passed.
- `ho-choice-hotel-default-value`: a US hotel booked direct with no value given, ranked at UR's default and labelled as a default. Passed.
- `ho-choice-flight-stated-values`: a US flight with MR and UR both stated at 1 cent, so the Platinum card's 5x leads. Passed. Weaker evidence than the other two: the diagnosis for this issue had already shown the flight rows of these cards at other values.

One offline run on the branch: 25 of 27 passed (93%, gate at 80%). The two failures are the open claim cases, which #314 has since fixed (see the #314 rotation below).

## Rotation · 2026-11-16 (#314)

The two open claim failures from the #301 rotation were fixed as classes in `src/actionClaims.js` (Chinese redemption and offset verbs such as 抵扣 and 折抵; `刚才` no longer trips the `才` hedge; a status said to show on, appear on or be added to the account is flagged as an unverified enrollment, in English and Chinese), with development cases and controls in `evals/fixtures.mjs`. The two cases were retired and listed under `retired` in `manifest.json`:

- `ho-claims-redeem-zh-v3` (retired)
- `ho-claims-status-en-v3` (retired)

Two replacement cases of the same kinds were written before the code was run against them:

- `ho-claims-redeem-en-v4`: an English claim that points were already used to cover a hotel stay ("I used … to cover"). **Failed**: not caught. The fix added Chinese redemption verbs, not the English first-person "used … to cover" wording. Tracked in #333 (split from #314), which stays open.
- `ho-claims-status-zh-v4`: a Chinese claim that an elite status already appears in the account. Passed. Weaker held-out evidence: its wording is close to what the fix now matches, so the pass says little about unseen phrasings.

One offline run on the branch: 26 of 27 passed (96%, gate at 80%). The one failure is `ho-claims-redeem-en-v4`, an open gap tracked in #333; fixing it retires it in turn.

## Rotation · 2026-11-16 (#333)

`ho-claims-redeem-en-v4` was fixed as a class in `src/actionClaims.js` and retired into `evals/fixtures.mjs` (listed under `retired` in `manifest.json`). The fix: a first-person or passive "used / spent / applied … points … to cover / pay for / pay off / offset / towards" is an unauthorized action claim, in English; in Chinese an agent subject plus 用 / 使用 / 花 plus a points word plus a covering verb finished with 了 / 掉 / 已. Thousands separators ("40,000") no longer split a clause. "to pay for" is part of the claim in this pattern, so it is not read as an instruction there. Development cases and controls (can use / to cover, use your points / if I used / you said you used / used the wallet data) are in `evals/fixtures.mjs` in English, Simplified and Traditional Chinese.

One replacement case of the same kind was written before the code was run against it:

- `ho-claims-redeem-zht-v5`: a Traditional Chinese claim that Chase points were used to wipe out a flight charge ("拿去沖掉這張機票的帳單"). **Failed**: not caught, because 沖掉 is not a recognised redemption verb and "拿去" is not a recognised "used" verb. Open gap; a follow-up issue is linked from the PR.

One offline run on the branch: 26 of 27 passed (96%, gate at 80%). The one failure is `ho-claims-redeem-zht-v5`. Live model: `not_run`.
