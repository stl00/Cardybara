# Benefit retrieval recall

`npm run eval:benefit-recall` measures how well `searchBenefitKnowledge` (`src/benefitSearch.js`), the search behind the assistant's `find_benefits` tool, finds the right benefit rules. It is offline and deterministic: no network, no model. It prints a report and writes `evals/latest-benefit-recall.json` (git-ignored). It is a report, not a release gate. Issue #127.

## Golden set

`golden.json` has 129 questions in Simplified Chinese, Traditional Chinese and English: direct questions, paraphrases with words outside the search vocabulary, colloquial and Hong Kong wording, typos, multi-intent questions and two-plan comparisons. Each question runs against one of four synthetic portfolios of public products (US premium, Hong Kong, US co-brand, US everyday). None of them is anyone's real wallet.

Each question lists, as `ALIAS:suffix` references to `rule.<productId>.<suffix>` in `src/data/knowledge/rules.json`:

- `expected`: rules that should be in the top 12. Labels come from each rule's title, summary, category and scenario, not from running the search.
- `acceptable`: defensible either way; not scored.
- `forbidden`: rules that must not appear, such as a different hotel brand.
- `rationale`: why.
- `rewrite`: the hand-written ideal `find_benefits` call or calls: a short query in the user's language plus `scenarioId` / `category` / `programme` chosen from the question and the tool's enums. Every rewrite must pass `validateToolCall`.

Questions marked `ambiguous` are reported but not scored. `absent` questions have no relevant rule in their portfolio, so the right answer is no results. The script refuses to run if a reference does not resolve to a benefit rule active on the set's `asOf` date, so knowledge changes that remove or rename a labelled rule show up immediately.

## Held-out set

`holdout.json` has 115 more questions written the same way: 106 scored and 9 absent. v1 had 53 (50 scored), and v2 added 62 on 2026-11-09 for #147, written before any ranker was run on them. Numbers in the Progress table and the live-run sections use v1; the rubric analysis below uses v2. They use two portfolios the development set does not have (US business, US hotel and airline co-brands), plus two of its portfolios with new wording. Rule: **never look at held-out failures when changing the vocabulary, tool prompts or knowledge tags.** Tune on `golden.json` only, then report both sets. `npm run eval:benefit-recall` runs both. The held-out report goes to `evals/latest-benefit-recall-holdout.json`.

## Modes

| Mode | Query | Filters | What it measures |
| --- | --- | --- | --- |
| A | the user's question | none | the search with no help from the model |
| B | the rewritten query | none | what clean wording alone gets, which tests the vocabulary and regexes |
| C | the rewritten query | the rewrite's filters | the upper bound if the model rewrites and fills filters well |

A→C is the value of query rewrite. Whatever C still misses is a vocabulary, taxonomy or data problem. Several calls in one rewrite are merged by best rank, each keeping its own top 12, as the model would see them.

Metrics: recall@12 (expected rules found ÷ min(expected, 12)), MRR, zero-result rate, precision (expected share of returned rules, ignoring acceptable ones), mean rules returned, forbidden-hit rate, and the share of absent questions that return unrelated rules. All are broken down by language, question type and portfolio. A last line re-runs A and C with all 24 synthetic cards held at once. Only recall is valid there, because the other cards' rules are unlabelled.

## Baseline (golden asOf 2026-11-09, after independent review)

120 scored, 7 absent, 2 ambiguous.

| | A raw | B rewritten text | C rewrite + filters |
| --- | --- | --- | --- |
| recall@12 | 69% | 81% | 99% |
| MRR | 0.67 | 0.80 | 0.91 |
| zero results | 18% | 14% | 0% |
| precision | 60% | 70% | 74% |
| forbidden hit | 3% | 2% | 0% |
| absent → unrelated results | 57% | 43% | 14% |
| recall, 24-card wallet | 63% | — | 93% |

Recall by language for A / B / C: English 52% / 63% / 98%, Simplified Chinese 84% / 96% / 98%, Traditional Chinese 65% / 78% / 100%. By type: paraphrase 47% / 69% / 100%, typo 47% / 100% / 100%. 30 of 120 questions find none of their expected rules in mode A, and 22 of them get no results at all.

Held-out baseline (50 scored): recall@12 A 64% / B 77% / C 96%, zero results 26% / 20% / 2%, and 58% / — / 90% with all 26 cards. By language: English 57 / 57 / 90, Simplified Chinese 79 / 97 / 99, Traditional Chinese 55 / 82 / 100. The held-out set agrees with the development set, so the findings below are not an artefact of the development questions.

## Progress

Recall@12 for A / B / C after each retrieval change (#131). Dev = `golden.json`, held-out = `holdout.json`.

| Change | Dev A / B / C | Held-out A / B / C |
| --- | --- | --- |
| Baseline (#130) | 69.4 / 81.4 / 98.5 | 64.3 / 76.8 / 95.6 |
| 1. Programme and scenario tags (`scripts/curate-benefit-tags-2026-11-09.py`) | 69.6 / 82.0 / 99.4 | 64.3 / 76.8 / 96.0 |
| 2. Vocabulary: Traditional→Simplified, glossary, programme aliases (`src/benefitVocabulary.js`) | 94.8 / 98.8 / 99.4 | 81.6 / 92.1 / 98.0 |
| 3. Tool contract: always fill scenarioId/category, Chinese keywords, programme aliases in the filter, zero-result suggestions, whole-card questions | 95.4 / 99.4 / 100.0 | 81.6 / 92.1 / 98.0 |
| 4. Soft scenario/category filters (bonus inside, strong word match needed outside) | 95.4 / 99.4 / 100.0 | 81.6 / 92.1 / 98.0 |

After step 2:
- **English recall** (dev / held-out): A 88.8 / 78.6, B 98.0 / 83.3.
- **Where the words came from:** the glossary and the Cantonese characters come from development-set failures. The programme aliases are the general names of every brand in `entities.json`, not picked from failures. Some of them happen to appear only in held-out questions.
- **Contamination check:** an independent review removed the aliases and characters that only held-out questions use, and held-out A stayed at 82.6%. Dropping the two-character abbreviations (加航, 美航, 新航), which matched inside longer airline names, cost 1 point.
- **Overfitting:** mode A gained 25.4 points on dev and 17.3 on held-out. Part of the remaining gap was already in the baseline (5 points), because two held-out portfolios are new. Trust the held-out gain.
- **Precision:** dev A 58% → 60%, held-out A 54% → 53%.
- **Absent questions:** more of them return something on dev (57% → 71%), because more words now match.
- **Sample size:** held-out has only 50 scored questions; per-portfolio rows have 7–19 each and are noisy.

Step 3 barely moves the offline numbers. Mode C already assumes a model that fills filters and writes good queries; step 3 is what asks the model to do so, and only a live run can measure that. The offline gain is the whole-card question (`c-delta-en`): words that name a held card are set aside, so "What Delta perks do I have?" lists that card's benefits.

Known gap: whole-card detection reads only English card words, so a Chinese card name (國泰卡有什麼福利) still goes through ordinary scoring.

No new scenario enum was added (such as flight, car-rental or purchase-protection). After steps 1–2, mode C misses no dev question. Flight benefits carry both `travel` and `airport`; rentals sit under `ground-transport` + `protection`; purchase protection sits under `shopping` + `protection`. A new enum would need every rule retagged and a new label set, with nothing to show for it now.

## Live model run (2026-11-09)

`npm run eval:benefit-recall:live` sends each scored question to the configured model (DeepSeek `deepseek-flash`) with the production system prompt and tools, on the same synthetic portfolios. Other tools the model calls first (list_cards, query_credits …) run locally. The first round that calls `find_benefits` ends the question, and the `find_benefits` arguments the model wrote are scored like mode C. It needs the owner's approval because it costs money. It has a spend cap (`--max-usd`), counts tokens, and estimates cost at assumed peak prices: $0.30/M uncached input, $0.006/M cached, $1.20/M output. One run per code version, at the production temperature, so expect a few points of run-to-run noise.

| Recall@12, all scored questions | Dev (120) | Held-out (50) |
| --- | --- | --- |
| Hand-written ideal rewrite (mode C) | 99.4 → 100.0 | 98.0 |
| Real model, before step 3 (#136 code) | 68.6 | 69.0 |
| Real model, after step 3 (#140 code) | **74.6** | **69.5** |
| Same model calls with filters made soft (filtered ∪ unfiltered, computed offline) | 83.4 | 83.5 |
| Same model calls with scenario/category dropped (computed offline) | 82.9 | 79.0 |


The two offline rows reuse the after-step-3 calls. A merged search can return up to 21 rules, so it is not strictly recall@12, and neither are multi-call rewrites in mode C. Dropping the model's scenario/category altogether already reaches 82.9 on dev, so on dev its filters add almost nothing.

| After step 3, by language | en | zh-Hans | zh-Hant |
| --- | --- | --- | --- |
| Dev | 59.9 (n=38) | 81.5 (n=55) | 81.5 (n=27) |
| Held-out | 71.4 (n=21) | 70.8 (n=18) | 63.6 (n=11) |

How the model filled the calls, before → after step 3 (dev / held-out):
- **Called find_benefits at all:** 78% / 78% → 84% / 86%.
- **Set a scenario or category:** 88% / 92% → 96% / 95%.
- **Wrote Chinese query words:** 15% / 26% → 100% / 100%.
- **Recall when it did search:** dev 87.6% → 88.7%, held-out 88.5% → 80.8%.

What the real model gets wrong:
1. **It doesn't search.** 14–16% of questions never reach `find_benefits`, even after step 3. Most credit questions go to `query_credits`, which the prompt sends "any question about credits" to. Some go to `get_card_rules` or `choose_card`. Some of those answers may still be right, but this eval can't tell, and it counts them as zero.
2. **A neighbouring scenario becomes a hard filter.** The model picks a scenario next to the rule's own:
   - Global Entry / TSA under `travel`, while the rules carry `airport`.
   - Baggage delay under `airport`, while the rule carries `travel`.
   - Grocery delivery under `dining`, while the rule carries `shopping`.
   - A-List as `membership`, while the rule is `spend-unlock`.

   Because filters are hard, the rule disappears. A filter hurt 11 of 101 searching questions on dev and 7 of 43 on held-out.
3. **English questions lost recall on dev after step 3:** 68.4% → 59.9%. With Chinese keywords the model also narrowed its filters more often. The held-out English rose (69.0% → 71.4%), so part of this is noise.

**Conclusion.**
- The contract change helped where it could: Chinese keywords went from 15% to 100%, and more questions reach `find_benefits`.
- Mode C's 99% is far from the real 70–75%. The gap is routing and over-trusting the model's filter, not vocabulary.
- Next fixes, in order:
  - **(a) Soft filters:** search with and without the model's scenario/category and merge, or treat them as a boost. Offline, on these exact model calls, that takes recall to ~83% on both sets.
  - **(b) Routing:** let credit questions that are also benefit questions call `find_benefits` too, or have `query_credits` return matching benefit rules.

Cost: 498 model calls (two runs of 239 and 255, plus a 4-call smoke test). 1.87M prompt tokens, 88% of them cached, and 60k output tokens. **About $0.15 at the assumed peak prices**, well under the $1 cap. Only the `find_benefits` arguments, tool names and token counts are kept in the report. No answers, keys or wallet data.

### Step 4: soft filters and routing (2026-11-09)

**Soft filters.** Scenario and category no longer drop rules.
- A rule inside the chosen scenario or category gets +7, and on equal scores it ranks first.
- A rule outside it competes only if its own words score at least 8 (a concept or two title words). This is judged before the credit, membership and lounge boosts, and an outside rule gets none of those boosts.
- The threshold was picked on dev: 6 lets unanswerable questions return noise (absent 43%), and 10 and up only loses recall.
- A named programme and a named partner stay strict, so a Marriott question never brings Hyatt. That is tested.

On the ideal rewrites (mode C), recall is unchanged (dev 100, held-out 98.0). Precision falls on dev from 72% to 68% and on held-out from 53% to 51%. On held-out, one unanswerable question now returns a weakly related rule ("餐厅 抵扣" finds United's in-flight dining rebate), so absent noise there is 33%, up from 0%.

On the real model's calls, soft filters are what close the gap:

| Real model, recall@12 | Dev (120) | Held-out (50) |
| --- | --- | --- |
| After step 3, hard filters | 74.6 | 69.5 |
| Same calls, re-scored with the step-4 search (offline) | 82.5 | 83.5 |
| Run A on step-4 code, find_benefits only | 82.5 | 78.5 |
| Run B on step-4 code + fee-waiver clause, find_benefits only | **84.0** | **69.5** |
| Run B, plus credits that query_credits returned (capped at 12) | **93.6** | **80.9** |
| Run B, plus dev questions labelled `alsoAnsweredBy` (reference only) | 94.5 | — |

Held-out moved 9 points between two runs of nearly the same code (78.5 vs 69.5). Run B searched only 72% of held-out questions, against 80% in run A; read held-out live numbers as ±5–10.

**Precision and forbidden hits.**
- **Same calls, hard → soft:** dev 57.5% → 56.5%, held-out 36.2% → 38.4%. Forbidden hits are unchanged: the same two questions, caused by the model's own query.
- **Run B:** precision 61.8% / 40.8%, and 62.9% / 40.2% with credits. No forbidden hits.

**Routing is mostly a scoring question.** Of the questions that never call `find_benefits`, most go to `query_credits` with the right use (hotel, airline, ride-share, dining). Their credit items map back, by card and title, to the rules the golden set expects. For a credit question that is the right answer for the user, so the eval counts those items: at most 12, with precision reported.

The model was not pushed toward `find_benefits`. The one real misroute was fee-waiver questions going to `get_card_rules(kind: fee)`, which has no waiver data. The fee tool's description and the system prompt now point waiver questions to `find_benefits` as well. In run B all three dev fee-waiver questions call both and score 100.

**Other tools.** `alsoAnsweredBy` (dev only) marks questions another tool answers as asked, by a written rule:
- points-transfer or miles-earning → `get_card_rules` transfer-relationship;
- a rebate or more points on a kind of spend → `choose_card`.

The rule was written after the first live run, so it is a scoring convention, not a blind label, and held-out carries none. A labelled question counts only when that tool returned something to answer with: transfer rules, or a card choice that is not "points-depends". The level is a reference number.

**Errors.** A model error (an invalid tool call) scores 0. Only failed requests (HTTP, timeout, connection) are left out: one in run B. The script stops after three failed requests in a row.

**Remaining misses:**
- Some questions stop after `list_cards` without a search ("人民幣賬單", "6% first-year", "波飛").
- English and Traditional Chinese held-out are low.
- Held-out stays below dev: some of that is the two new portfolios, and some is that dev guided the vocabulary.

**Cost of step 4:**
- Run A: $0.074. Run B: $0.079.
- A run during a provider timeout: $0.0095 for the calls that completed; 150 requests timed out.
- A 3-call probe: $0.0005.

**Total for all live runs: about $0.31 at assumed peak prices** (cap $1). Timed-out requests report no usage, so their cost is unknown.

## Rubric analysis (#147, 2026-11-09)

`node scripts/benefit-ranking-lab.mjs` is offline and changes nothing in `src/`. It answers whether the hand-set weights in `src/benefitSearch.js` are any good.

**Setup.**
- `evals/benefit-recall/rankers.mjs` holds a copy of the production rubric with every weight as a parameter. The lab checks that this copy returns exactly what production returns for every question and mode, so the two cannot drift silently.
- BM25 runs over the same rule text (title and programme names counted twice, plus summary and howToUse), with the same bigram/word tokens after `expandQuery`. Document frequencies come from all active benefit rules.
- "BM25 + structure" adds production's partner and programme hard filters, soft scenario/category (as shares of the best text score), and whole-card scope.
- Held-out is v2 here (106 scored).

**Rankers** (recall@12 · precision · forbidden hit · no-answer noise, %):

| | Dev A | Dev C | Held-out A | Held-out C |
| --- | --- | --- | --- | --- |
| Rubric (production) | 95.4 · 60.2 · 0.8 · 71.4 | 100.0 · 67.6 · 0 · 14.3 | 88.2 · 54.1 · 0 · 55.6 | 99.1 · 57.2 · 0 · 22.2 |
| BM25 | 85.6 · 63.1 · 4.2 · 42.9 | 89.9 · 71.5 · 5.8 · 28.6 | 81.7 · 52.8 · 4.7 · 11.1 | 91.0 · 63.3 · 4.7 · 11.1 |
| BM25 + structure | 86.2 · 67.0 · 2.5 · 42.9 | 100.0 · 68.5 · 1.7 · 14.3 | 81.7 · 59.4 · 0 · 11.1 | 99.5 · 57.1 · 0 · 11.1 |

With every portfolio's cards held at once, so the top 12 binds, recall A / C is:
- Rubric: dev 89.7 / 98.1, held-out 79.8 / 95.4.
- BM25 + structure: dev 84.4 / 97.2, held-out 78.4 / 95.0.

A few BM25 settings were tried on dev (title weight 1–3, outside share 0.3–0.7), and none changed the picture.

**What this shows:**
- **On raw questions (A) the rubric wins on recall by 6–10 points.** Its concept regexes match a rule's scenario even when no word overlaps ("吃饭" → dining rules), and BM25 has nothing like that.
- **BM25 is quieter.** It has better precision and much less no-answer noise (held-out A: 11% vs 56%), but plain BM25 also lets forbidden rules in (4–6%), because it ignores the partner filter.
- **Once the model fills filters (C), the structured BM25 and the rubric are close.** The structure does the work, not the text score.

**Sensitivity** on dev: each weight ×0.5 to ×1.5, one at a time. The spans below are points across that range:
- **Flat (10 of 12):** membership concept, title, programme, body, partner, the credit/membership/lounge boosts, filter bonus and programme-only bonus. Recall and MRR move under 1 point, both in the labelled portfolios and with all cards held. Precision moves under 1 point, and forbidden hits and noise do not change.
- **Sensitive (2):**
  - **`concept` (7):** C precision ±5 and C noise ±29. Recall moves under 1 point.
  - **`outsideMin` (8):** C precision ±12 and C noise ±29. It sets how many neighbouring-scenario rules come in.

**Tuning check.** A coordinate search over the two sensitive weights tried 20 settings on dev. The objective was recall in both wallets plus a smaller MRR term. The constraints were: precision no lower than now (−1 point), and forbidden hits and no-answer noise no higher, in both A and C. Nothing beat the current values, so there is nothing to carry to held-out.

**A score floor** (not in production) is no fix for the noise either:
- ≥ 7 cuts dev A noise from 71% to 57% but recall falls from 95 to 76.
- ≥ 8 brings noise to 29% at 70 recall.

The unanswerable questions match real words in nearby rules. The noise is not a tail of weak scores.

**Recommendation.**
1. **Keep the hand weights.** Most of them don't matter, and the two that do are already at a constrained optimum on dev. Tuning would fit noise.
2. **Don't switch to BM25 now.** It loses 6–10 points of recall on raw questions. With filters it only ties.
3. **The weak spot is no-answer noise on unfiltered questions,** not ranking. It shrinks when the model fills filters: mode C noise is 14% / 22%. The live runs show the model sets a filter on about 96% of searches.
4. **Re-run this lab after the knowledge-source-lang work lands.** Official source text will be longer and differently worded, which changes word statistics and favours BM25's length normalisation over the rubric's flat +1 per body word.
   - At that point, the candidate to test is the rubric plus a BM25 term in place of the flat title/body counts. The flat weights could then be dropped, since they don't move the result.
   - Tune only `concept` and `outsideMin`, on dev, under the same constraints, and confirm on held-out.

## Findings

1. **Query rewrite is needed.** Raw questions reach 69% recall, and a fifth of them return nothing. A good rewrite with filters reaches 99%. Most of that gain comes from the structured filters (B→C is +18 points), not from cleaner wording.
2. **Regexes alone are not enough, mostly across languages.** With clean wording but no filters (B), English is still 63%. Rule text is Chinese, and English words such as *insurance*, *waived*, *airline*, *bags*, *miles* and *grocery* have no Chinese counterpart in the concept list. The same goes for regional words: 叫車, 睇戲, 专车, 香港快运 and 亞洲萬里通. Typos are fixed completely by rewriting.
3. **C's 99% is flattering in small wallets.** A filter returns every rule in that category or scenario, and our portfolios have only 4–7 cards. With all 24 cards held, C drops to 93%: when the filter alone does not fit everything in the top 12, English query text still cannot rank the right rule.
4. **What C still misses.** `c-alist-hans` is a data gap: the Southwest A-List rule has no `programmeIds`, so `programme: Southwest` drops it. `c-delta-en` ("What Delta perks do I have?") is a search gap: even with `cardName: Delta`, a rule scores only when a query word matches it, so a whole-card question returns just the one rule with Delta in its title. Only a bare "benefits" query lists everything, and a model has no reason to know that. A taxonomy ambiguity also showed up: a flight-delay lounge is tagged `airport`, but a model may well pick `travel` for a delay question. The rewrite for `h-delay-hant` tries both.
5. **Precision is weak on unanswerable questions.** 4 of 7 absent questions return unrelated rules in mode A. Generic words such as 抵扣 and 会员, or partner names, match something.

So embedding is not the next step. The cheaper levers are (a) making the model always fill `scenarioId`/`category` and write the query in Chinese or bilingually, and (b) adding English and Cantonese aliases to the concept vocabulary or to the rules. Re-measure after each one. Consider embedding only if mode B English stays low after aliases are added. Before deciding, run `eval:agent:live` to see what the live model actually puts in `find_benefits`.

## Proposed gate

Not wired in yet. When it is, `node scripts/eval-benefit-recall.mjs --min-raw=0.65 --min-rewrite=0.95` exits non-zero below either threshold. Mode A ≥ 65% catches regressions in the raw search, with 5 points of slack. Mode C ≥ 95% catches knowledge or taxonomy changes that break the filtered path. Raise mode A as rewrites or aliases land.

## Caveats

- One annotator labelled this set. It is a development set: tuning the search on these exact questions will overstate gains, so add held-out questions before tuning.
- Mode C is a hand-written upper bound, not a model run. It may use well-known English brand names (Delta Stays, American Airlines Vacations) as general knowledge, and `cardName`/`region` narrow the cards the same way `find_benefits` does.
- Precision leaves out questions with no results, or with only acceptable results. Its denominator therefore differs by mode: A has 18% empty questions and C none.
- Multi-call rewrites take each rule's best rank across calls, so their MRR is generous.
- Absent is relative to the current knowledge base. A card may have the benefit in reality (Venture X lounges, for example) without a rule for it yet.
- The set uses the knowledge snapshot pinned by `asOf`. When rules change, the script fails loudly rather than silently scoring stale labels.
