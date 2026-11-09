# Wallet agent development evals

Run `npm run check:agent` for the offline agent gate (unit contracts + evals).

Run `npm run eval:agent` for deterministic retrieval, calculation, context and grounding checks. Run `npm run eval:agent:live` to exercise the actual configured DeepSeek model **via the official OpenAI Node SDK**. The live run makes cloud API calls using `.env.local`; it sends synthetic public product fixtures and development questions, not the user's wallet snapshot or ledger. Keys and chat text are not saved in reports.

Reports: `latest-offline.json`, `latest-live.json`. A failing rubric exits nonzero. These are development fixtures, not a held-out test set, and a small live run is not an overall accuracy estimate.

## Metrics and coverage

- Retrieval: expected-record hit@12 and reciprocal rank, active date and held-product checks. Shared natural-language cases compare the old regex+ID-order baseline with the new multilingual lexical ranker. This is **not** exhaustive benefit recall.
- Calculation: exact expected cash/point amounts, currency boundaries, no raw-point cash winner and required clarification.
- Context: bounded recent complete turns, last validated comparison fields, no replay of stale historical tool evidence.
- Grounding: detect unsupported source URLs, numeric literals, false action/enrollment claims, and selected unknown-to-unused mistakes. These are heuristic guards, **not a semantic proof** that every statement follows from the evidence. They do not prove correct attribution of every value to its card. User-stated amounts can be repeated when asking clarification without being treated as reward evidence.
- Live: expected tool selection, exact scenario fields, missing-field clarification, read-only tool scope and completed answers. The runtime's bounded checker/repair loop also runs. No LLM-as-judge score is presented as fact.

## Architecture changes

`openai` is a **server-only transport SDK** configured for `https://api.deepseek.com`, with no automatic retries, a 45s timeout, cancellation and redirects disallowed. It does not automatically supply conversation memory or a database. `src/agentContext.js` handles recent turns and strictly validated memory (`lastPurchase`, `trip`, `topics`); only the page session retains this state. Old tool payloads are discarded before the next user turn, so mutable wallet facts must be read afresh.

Retrieval is structured filters + multilingual lexical ranking (no embedding/vector index). `find_benefits` accepts optional card, scenario, category and programme filters, returns relevance metadata, total matches, truncation, active-date assessment and official sources. Unknown terms can return zero matches rather than arbitrary first records.

Answer checking runs before displaying a final reply. On a failed check, the model gets one correction attempt with no new tools; a second failure returns an error instead of presenting the unchecked answer. The loop remains bounded to four tool rounds plus a final synthesis and at most one repair.

## Rollout boundary

This side-conversation change is source-level and evaluated independently of the main task. Validation builds use `/tmp/cardybara-sdk-eval-build`; they do not overwrite `dist`, the installed Chrome extension, bank data or the main 8766 process. Activate through the main task's next coordinated frontend build and backend restart. The frontend tolerates a previous proxy rejecting the new memory field by retrying that request once without it; SDK transport and typed scenario memory become fully active after the coordinated backend restart.

## Verified development run · 2026-10-28

- Regression tests: 169 passed.
- Deterministic development evals: 25/25 passed.
- Retrieval shared-query expected-record hit@12: 4/13 before, 13/13 after; this set guided development and is not held out.
- Live SDK smoke evals: 6/6 passed. A numeric-check false positive on clarification was fixed and that case re-run successfully (1/1), without requiring an extra repair call. Reports retain tool names, timings, sizes and check outcomes, not model transcripts or credentials.
- Frontend production build validated in an isolated `/tmp` output; the main running service and installed extension were not restarted or replaced from this side conversation.


## Main-thread integration · 2026-10-28

The earlier side-conversation rollout boundary above describes its staging step. The main thread has now built the production frontend, synchronized it into the existing local standalone extension without changing its manifest, background collector or bank snapshot, and restarted the loopback 8766 service to load the SDK backend. Combined regression suite: 174 passed; offline agent gate: 25/25. Configured secret values were checked against frontend artifacts without exposing them. Browser activation results are tracked in `docs/AGENT_SDK_ROLLOUT.json`. This does not establish bank refresh coverage, a reloaded bank background runtime, or hosted deployment.

## Independent advisor session · 2026-10-29

The current gate has 13 focused tests and 28 offline development cases. Added coverage requires both named hotel programmes, preserves public benefit instructions/terms/validity, isolates same-name products by issuance region, rejects empty normalized card filters and duplicate model tool IDs, and checks unsupported numbers even without tools. Live fixtures now also check both programme names in the comparison answer and exact HK product/region arguments for enrollment instructions.

`CARDYBARA_MODEL_CONFIG=/absolute/path/to/existing/.env.local node scripts/eval-agent.mjs --live` can reuse a local configuration without copying it into an independent clone, the same variable the local server reads. It replaced an `--env-file=` argument, which newer Node versions claim for themselves. Never log the configuration or include its contents in reports. The final smoke run passed 8/8; this is not held-out accuracy. See docs/SESSION_HANDOFF.md for commit, integration boundary and known gaps.

## Fee/transfer and actual multi-turn evals · 2026-10-29

Current gate: 18 focused tests and 32 offline cases. `get_card_rules` exposes existing canonical fee and transfer records; tests cover currency/role/region, unknown actual fees, unknown ratios/linkage, no elite-status grants, truncation and private-field exclusion. Unknown transfer ratios cannot be grounded by incidental revision numbers.

Live cases can declare `setupQuestions`; the harness runs them through the same real model/session loop, retains the resulting dialogue, and evaluates tool selection/arguments on the final follow-up. CA-to-HK annual fee and transfer-to-fee product reference now exercise real conversation history, rather than injected comparison memory alone. The full expanded smoke run passed 12/12. After the final ratio guard, its affected case passed a separate 1/1 rerun. Reports remain metadata-only and ignored. This is a development smoke set, not held-out semantic accuracy.

## Credit query · 2026-11

`query_credits` replaced `list_credits`: code resolves the date phrase (`src/tripDates.js`), overlaps cycles, reads manual marks and joins terms (`src/creditQuery.js`), and returns groups: `markedUnused`, `unknownStatus`, `markedUsed`, `noFixedCycle`, `cycleUnknown`, `outsideDates`, plus a `needsEnrollmentOrChannel` index. The index is not an exclusive group because almost every hotel credit has a channel restriction, which would empty the unknown group. The wallet day reaches the model every turn, and memory gains a validated `trip`.

`src/creditClaims.js` adds grounding for unknown stated as unused, a claim of non-use with no status evidence, assumed dates left out and dropped items. These are heuristics on wording, not a semantic proof: a model misreading a term, or inventing a stacking rule, passes them. If a credit answer still fails after its one repair, `src/creditAnswer.js` writes the answer from the tool's groups rather than refusing; live evals count that as a failure through `modelAnswered`, so it stays visible. Account anniversaries stay unknown: the fee ledger records fee cycles and charges, which is not evidence of the benefit year.

## Card choice · 2026-11

`choose_card` replaced `compare_cards` and its per-card category bindings. `src/data/earning-categories.json` classifies every earning rule's spend category into uses, channel, merchants, country and conditions; a test fails if a rule is unclassified, and no product id appears in `src/cardDecision.js`. Cash is compared only with cash. Points are shown as points with a break-even value per point, and are priced only with a value the user stated. A credit counts toward the choice only when it is marked unused and the merchant is on its list; otherwise it appears under what could change the result. Foreign transaction fees are not recorded, so they are unknown. Grounding adds checks that the chosen card comes first, that nothing is called a global best, and that points are not priced without the user's value; the code-written fallback covers choices too.

## Multi-turn references · 2026-11 (#132)

`npm run eval:multiturn` replays 55 dialogues (`evals/multiturn/dialogues.mjs`; 27 Simplified, 12 Traditional, 16 English) through the real `runAgentTurn` with a scripted model: real tools, real memory, real context trimming. For the last question it captures exactly the `chatRequest` the model would receive and asks whether the entity the question refers to is still there. Kinds: pronoun (这张/it), ordinal (第二个, from a list the assistant gave), ellipsis (那 Amex 呢), topic switch and return, a card from more than six turns back, and the same product name in another region. Each dialogue also carries the tool and key arguments the last turn should produce.

Two offline levels, both deterministic:

- **resolvable**: the referent is identifiable from what the model receives — a name or a common short name or translation of the card (with the nearest region mark when the name exists in several regions), the item, and for ordinals the list in the order the person saw it.
- **tool-ready**: the same, but only in a form a tool argument can use as it stands — a name that selects the card as `cardName`, and for an item a wording that, used as the expected call's query (or transfer programme), returns that record. Without it the model has to call `list_cards` again, guess a substring, or reword before searching.

Baseline on `main` (`ac3de19`):

| | n | resolvable | tool-ready |
|---|---|---|---|
| all | 55 | 45 (82%) | 24 (44%) |
| pronoun | 10 | 10 | 5 |
| ordinal | 12 | 12 | 7 |
| ellipsis | 8 | 8 | 7 |
| topic return | 7 | 7 | 3 |
| long range (> 6 turns) | 10 | 0 | 0 |
| same name, other region | 8 | 8 | 2 |
| zh-Hans / zh-Hant / en | 27 / 12 / 16 | 85% / 75% / 81% | 44% / 25% / 56% |

Reading it: within six turns the referent is almost always somewhere in the chat text, because the person's own words and the answer stay. Past six turns it is gone: tool arguments and results are dropped and memory holds only `lastPurchase` and `trip`. Within six turns the precise form is often gone too: answers say 香港美國運通白金卡 or 运通金卡 while the tool needs `The Platinum Card` + `HK` or `Gold Card`, and an English "annual free night" finds nothing where `年度免房晚` does. Card names, not item titles, are most of the gap (20 of 21).

`check:agent` runs it with `--min=0.8` on the resolvable rate — a regression floor, not a quality target; a label that does not match the tools, or a scripted answer that fails grounding, fails the run whatever the rate.

Limits: earlier answers are scripted, written to read like the assistant's (user's language, names paraphrased or translated), so how often names survive is a property of this set. Offline "resolvable" means present, not that a model resolves it.

`npm run eval:multiturn:live` runs the same dialogues against the configured model and checks the tool and key arguments of the last turn (a `cardName` passes if it selects the same held cards; a free-text `query` only has to be present). It makes API calls and has not been run; ask the owner first. `--live --dry-run` exercises that path with a scripted model and no network.
### Conversation state and topic index (#132, part 2)

What code carries between turns is now one typed state object (`src/conversationState.js`) with three channels: `lastPurchase`, `trip` and the new `topics`. Each tool result updates it through a pure reducer per channel (`reduceToolResult(state, event, context)` returns a new state and never modifies its input); `validateState` (still exported as `validateMemory`) checks the whole object every time it is used or sent; every change is recorded in the turn's trace as `{type:'state', tool, changes:[{channel, before, after}]}`, summarised so amounts and point values do not appear.

`topics` holds `items` (up to 12, in the order the last tool turn returned them: a knowledge rule id and/or a catalogue product id) and `cards` (up to 6 product ids the chat focused on: a card named in tool arguments, the chosen card, or the only card a tool returned; most recent first). Only ids that exist in the shipped knowledge and catalogue pass validation; names, regions, titles and transfer programmes are rendered from the catalogue when the prompt is built, so no text from a chat, a model or a bank page reaches the system message through it. It is labelled untrusted context. SYSTEM adds one sentence: resolve each reference to a concrete card with its region, programme or listed item before filling tool arguments, and ask if it still fits more than one. No extra model call.

| | n | before resolvable | after | before tool-ready | after |
|---|---|---|---|---|---|
| all | 55 | 45 (82%) | 52 (95%) | 24 (44%) | 52 (95%) |
| pronoun | 10 | 10 | 10 | 5 | 10 |
| ordinal | 12 | 12 | 12 | 7 | 12 |
| ellipsis | 8 | 8 | 8 | 7 | 8 |
| topic return | 7 | 7 | 7 | 3 | 7 |
| long range | 10 | 0 | 7 | 0 | 7 |
| same name | 8 | 8 | 8 | 2 | 8 |

Still unresolved: "the second one from the very first list" seven turns back (3 cases). The index keeps only the last tool turn's items, by design; the card survives in `cards`, so the model can re-search it or ask. The gate is now `--min=0.9`. These numbers say the referent reaches the model in usable form; whether the model then uses it is the live layer, not yet run.

## Benefit retrieval recall · 2026-11

`npm run eval:benefit-recall` scores `searchBenefitKnowledge` against a hand-labelled golden set of 129 questions in three languages, in three modes: raw question, rewritten query, and rewritten query plus filters. It is a report, not a gate. Method, baseline and findings are in `evals/benefit-recall/README.md`.
