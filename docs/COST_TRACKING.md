# Card ownership cost tracking

Local release: 2026-10-28. No bank refresh or hosted deployment is implied.

## Portfolio totals

Currencies remain separate; there is no implicit FX rate. Debt sums positive signed balances. Negative account balances are reported as separate credits, not deducted from other cards’ debt. Secondary-currency balances are counted in their own currency. Bank capture dates and missing account counts remain visible.

Limits use an explicit bank creditLimit or manually confirmed limit, never balance + available credit. Shared limits are grouped by bank, currency and user-chosen group. A consistent shared group is counted once; conflicting totals are excluded and flagged. No-preset-limit accounts are separate from missing or zero limits. Public annual fees are a gross reference, not actual costs, and variant-unconfirmed records are excluded.

## Per-card fee cycles

The new cardybara-account-ledger IndexedDB stores schema-1 append-only events. Fee identity is card ID + cycle start. Values include explicit inclusive start/end dates, currency, listed cycle fee, actual bank charge, received refund, waiver status and note. Missing charge/refund remain unknown. Net cost is charge minus refund; waiver status is metadata, never an additional deduction. Anniversary dates are user-entered. Leap-year default end dates are deterministic and editable. Overlapping active cycles are rejected atomically. Corrections preserve older events; archive and restore use tombstones. These dates do not automatically redefine calendar-year benefit reset rules.

Account settings separately store manual limits, shared group and no-preset status. Bank collection cannot overwrite this ledger. Cross-tab changes use BroadcastChannel; schemas and imports are validated. Re-imports are idempotent by event ID; conflicts fail. Backups include costLedger in addition to existing personalBenefits. Importing the whole wallet uses separate transactions across its existing stores, not an all-store atomic transaction; repeated import is safe and records are not destructively replaced.

## Credits

Existing schema-1 benefit events remain readable and exportable. An optional validated usage snapshot now adds cumulative used amount, user-assessed value (nullable), currency, public limit/title snapshot, and a user-selected allocation date. Partial is a new explicit status. Blank value is unknown; explicit zero is a real zero valuation. Cumulative edits replace a period’s observation rather than adding again. Marking full usage from a partial observation opens the amount editor to retain and reconfirm value. Quick marks alone do not imply monetary realization.

Past calendar periods are accessible by month. Reset identities remain card + rule + period dates, and rule revision checks remain intact. Actual value is attributed to a card’s recorded fee cycle using the chosen allocation date; a cumulative period observation is allocated wholly to this date. It is not an itemized transaction ledger and does not infer usage dates or split one observation across anniversaries. Historical snapshots remain available in the exported event history.

The displayed Credit value less net annual fee is explicitly a partial comparison, not full profitability: spending rewards, point valuations, offers, opportunity costs and other benefits are not included. No cost ledger data is sent to the agent/model by this change.

## Verification

Five new automated tests cover leap dates/unknown fees, gross debt and distinct currencies, conflicting shared limits, partial Credit valuation/period attribution, atomic fee writes/overlap rejection/tombstones/import deduplication, and invalid usage write rejection. Full regression: 174 passed.

An isolated 127.0.0.1:8767 browser wallet was used for synthetic QA only: charge 50 and refund 10 produced net fee 40; cumulative use 5 and personal value 3 produced cycle difference -37; a confirmed limit 12345 reached the portfolio summary. Reload preserved all three. No synthetic records were written to the main 8766 wallet.
