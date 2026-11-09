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

`holdout.json` has 53 more questions written the same way: 50 scored and 3 absent. They use two portfolios the development set does not have (US business, US hotel and airline co-brands), plus two of its portfolios with new wording. Rule: **never look at held-out failures when changing the vocabulary, tool prompts or knowledge tags.** Tune on `golden.json` only, then report both sets. `npm run eval:benefit-recall` runs both. The held-out report goes to `evals/latest-benefit-recall-holdout.json`.

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

After step 2:
- **English recall** (dev / held-out): A 88.8 / 78.6, B 98.0 / 83.3.
- **Where the words came from:** the glossary and the Cantonese characters come from development-set failures. The programme aliases are the general names of every brand in `entities.json`, not picked from failures. Some of them happen to appear only in held-out questions.
- **Contamination check:** an independent review removed the aliases and characters that only held-out questions use, and held-out A stayed at 82.6%. Dropping the two-character abbreviations (加航, 美航, 新航), which matched inside longer airline names, cost 1 point.
- **Overfitting:** mode A gained 25.4 points on dev and 17.3 on held-out. Part of the remaining gap was already in the baseline (5 points), because two held-out portfolios are new. Trust the held-out gain.
- **Precision:** dev A 58% → 60%, held-out A 54% → 53%.
- **Absent questions:** more of them return something on dev (57% → 71%), because more words now match.
- **Sample size:** held-out has only 50 scored questions; per-portfolio rows have 7–19 each and are noisy.

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
