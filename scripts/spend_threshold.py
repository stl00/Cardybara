#!/usr/bin/env python3
"""The spend a spend-unlock benefit needs, as a batch row states it and as a rule stores it (#246).

A batch row in docs/knowledge/card-batches/ may carry

  "spendThreshold": {"amount": 30000, "currency": "USD", "period": "calendar-year"}

and, when only purchases in one category count toward it, "scope": "category".

A rule stores the bare amount in terms.spendThreshold, the shape the hand-made rules use. So the amount is
unambiguous, the currency must be the card market's and the period must be the benefit's own. A threshold on all
card purchases in a calendar year also becomes a condition on account.eligibleCalendarYearSpend. A category
threshold gets terms.spendScope and no condition, because the account's total spend says nothing about it.

The amount must appear in one of the row's issuer quotes, which curate-card-batch.py --pages checks against the
saved page, so a threshold that is not on the page fails the run.

Run as a script, it reads {"row": ..., "currency": ...} on stdin and prints the result as JSON.
"""
import json
import re
import sys

CURRENCY = {'US': 'USD', 'HK': 'HKD', 'CA': 'CAD'}
CONDITION_PERIODS = ('calendar-year', 'earned-year-plus-next')
SCOPES = ('all-purchases', 'category')


def quoted(amount, quotes):
    """True when a quote states the amount: 30,000 or 30000 or 30K."""
    forms = {f'{amount:,}', str(amount)}
    if amount % 1000 == 0:
        forms.add(f'{amount // 1000}K')
    text = ' '.join(quotes)
    return any(re.search(r'(?<![\d,.])' + re.escape(form) + r'(?![\d,]|\.\d)', text, re.I) for form in forms)


def read(row, market_currency):
    """Return (terms, conditions, errors) for a batch benefit row; all empty when it states no threshold."""
    spend = row.get('spendThreshold')
    if spend is None:
        return {}, [], []
    errors = []
    if not isinstance(spend, dict) or set(spend) - {'amount', 'currency', 'period', 'scope'}:
        return {}, [], ['spendThreshold takes amount, currency, period and an optional scope']
    amount, scope = spend.get('amount'), spend.get('scope', 'all-purchases')
    if row.get('category') != 'spend-unlock':
        errors.append('spendThreshold belongs on a spend-unlock benefit')
    if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0:
        errors.append('spendThreshold.amount must be a positive whole number')
    if spend.get('currency') != market_currency:
        errors.append(f"spendThreshold.currency must be the card market's ({market_currency})")
    if not row.get('period') or spend.get('period') != row['period']:
        errors.append("spendThreshold.period must be the benefit's own period")
    if scope not in SCOPES:
        errors.append('spendThreshold.scope must be all-purchases or category')
    if errors:
        return {}, [], errors
    quotes = [row.get('quote', '')] + (row.get('original') or {}).get('quotes', [])
    if not quoted(amount, quotes):
        return {}, [], [f'spendThreshold {amount} is not in any of the quotes']
    terms = {'spendThreshold': amount}
    conditions = []
    if scope == 'category':
        terms['spendScope'] = 'category'
    elif spend['period'] in CONDITION_PERIODS:
        conditions.append({'field': 'account.eligibleCalendarYearSpend', 'op': 'gte', 'value': amount, 'currency': market_currency, 'timeScope': 'current-or-earned-year-needs-account-proof'})
    return terms, conditions, []


if __name__ == '__main__':
    given = json.load(sys.stdin)
    terms, conditions, errors = read(given['row'], given['currency'])
    print(json.dumps({'terms': terms, 'conditions': conditions, 'errors': errors}))
