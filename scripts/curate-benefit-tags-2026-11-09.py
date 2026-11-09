#!/usr/bin/env python3
"""Fix programme and scenario tags on benefit rules (#131, step 1).

Tags are retrieval metadata, not facts: no amount, condition, date or source changes. They are
corrected in place on every revision of a rule rather than in a new revision, because a new
revisionId would orphan the manual credit marks people have already saved against the current one.

The listed rules were found by auditing every published benefit rule against these principles, not by
looking at individual eval questions:
1. A rule whose title or summary names an airline or partner programme carries that programme.
2. A benefit that is only about flying (airline fees and credits, checked bags, in-flight purchases,
   flight-delay lounges, airline-booked companion and award perks) carries both `travel` and
   `airport`, because a question about a flight may use either scenario.
3. A rule tagged with the wrong scenario takes the one its sibling rules on other cards use.
Idempotent: running it twice changes nothing the second time.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'src/data/knowledge/rules.json'
rules = json.loads(path.read_text(encoding='utf-8'))

PROGRAMMES = {
    'programme.southwest-rapid-rewards': [
        'chase-us-southwest-rapid-rewards-performance-business-credit-card.a-list-tqp',
        'chase-us-southwest-rapid-rewards-premier-business-credit-card.a-list-tqp',
        'chase-us-southwest-rapid-rewards-premier-credit-card.a-list-tqp',
        'chase-us-southwest-rapid-rewards-priority-credit-card.a-list-tqp',
        'chase-us-southwest-rapid-rewards-performance-business-credit-card.inflight',
        'chase-us-southwest-rapid-rewards-plus-credit-card.inflight',
        'chase-us-southwest-rapid-rewards-premier-business-credit-card.inflight',
        'chase-us-southwest-rapid-rewards-premier-credit-card.inflight',
        'chase-us-southwest-rapid-rewards-priority-credit-card.inflight',
    ],
    'programme.delta-skymiles': [
        'amex-us-us-delta-skymiles-gold-business-card.delta-stays',
        'amex-us-us-delta-skymiles-platinum-business-card.delta-stays',
        'amex-us-us-delta-skymiles-reserve-card.delta-stays',
        'amex-us-us-delta-skymiles-gold-business-card.inflight',
        'amex-us-us-delta-skymiles-gold-card.inflight',
        'amex-us-us-delta-skymiles-platinum-card.inflight',
    ],
    'programme.united-mileageplus': [
        'chase-us-united-explorer-card.inflight',
        'chase-us-united-gateway-card.inflight',
    ],
    'programme.aadvantage': [
        'citi-us-citi-aadvantage-executive-card.aa-vacations',
        'citi-us-citi-aadvantage-executive-card.admirals-club',
        'citi-us-citi-aadvantage-executive-card.inflight',
    ],
    'programme.the-edit': ['chase-us-sapphire-reserve.edit'],
    'programme.priority-pass': ['amex-ca-ca-platinum-card.lounge', 'amex-ca-ca-platinum-card.lounge-2027'],
    'programme.plaza-premium': ['amex-ca-ca-platinum-card.lounge', 'amex-ca-ca-platinum-card.lounge-2027'],
    'programme.hsbc-rewardcash': ['hsbc-hk-hk-hsbc-visa-signature-card.extra-rc', 'hsbc-hk-hk-hsbc-everymile-card.pay-with-rc'],
}

FLIGHT_ONLY = [
    'amex-us-us-the-platinum-card.airline-fee',
    'amex-us-us-business-platinum-card.airline-fee',
    'amex-us-us-morgan-stanley-platinum-card.airline-fee',
    'amex-us-us-hilton-honors-aspire-card.flight',
    'chase-us-ihg-premier.airline-new',
    'chase-us-ihg-one-rewards-business-credit-card.airline-credit',
    'chase-us-marriott-bonvoy-boundless-credit-card.airline-credit',
    'wells-fargo-us-autograph-journey-visa-card.airline-credit',
    'chase-us-air-canada-aeroplan-card.air-canada-credit',
    'amex-us-us-delta-skymiles-gold-card.delta-flight',
    'amex-us-us-delta-skymiles-gold-business-card.delta-flight',
    'chase-us-united-explorer-card.travel-credit',
    'chase-us-united-quest.travelbank',
    'chase-us-ihg-premier.travelbank',
    'chase-us-united-quest.award-discount',
    'chase-us-united-quest.bags',
    'chase-us-united-club-card.bags',
    'chase-us-united-explorer-card.first-bag',
    'citi-us-citi-aadvantage-platinum-select-card.checked-bag',
    'boa-us-atmos-rewards-summit-visa-infinite.companion',
    'boa-us-atmos-rewards-summit-visa-infinite.partner-fees',
    'chase-us-sapphire-reserve.southwest-credit',
    'hsbc-hk-hk-premier-credit-card.delay-lounge',
    'hsbc-hk-hk-red-credit-card.hkexpress',
    'amex-us-us-delta-skymiles-gold-business-card.inflight',
    'amex-us-us-delta-skymiles-gold-card.inflight',
    'amex-us-us-delta-skymiles-platinum-card.inflight',
    'chase-us-southwest-rapid-rewards-performance-business-credit-card.inflight',
    'chase-us-southwest-rapid-rewards-plus-credit-card.inflight',
    'chase-us-southwest-rapid-rewards-premier-business-credit-card.inflight',
    'chase-us-southwest-rapid-rewards-premier-credit-card.inflight',
    'chase-us-southwest-rapid-rewards-priority-credit-card.inflight',
    'chase-us-united-explorer-card.inflight',
    'chase-us-united-gateway-card.inflight',
    'citi-us-citi-aadvantage-executive-card.inflight',
]

# Scenario replaced or extended to match the same benefit on sibling cards.
SCENARIOS = {
    # Airline fee credit was filed under dining; The Platinum Card and Business Platinum use airport.
    'amex-us-us-morgan-stanley-platinum-card.airline-fee': ['travel', 'airport'],
    # Digital entertainment credit was filed under dining; The Platinum Card uses entertainment.
    'amex-us-us-morgan-stanley-platinum-card.digital': ['entertainment'],
    # Uber One and Uber Cash cover rides and Uber Eats orders (the summaries say rides or orders).
    'amex-us-us-morgan-stanley-platinum-card.uber-one': ['ground-transport', 'dining'],
    'amex-us-us-the-platinum-card.uber-one': ['ground-transport', 'dining'],
    'amex-us-us-morgan-stanley-platinum-card.uber': ['ground-transport', 'dining'],
    'amex-us-us-the-platinum-card.uber-cash': ['ground-transport', 'dining'],
}

ids = {r['id'] for r in rules}
wanted = set(FLIGHT_ONLY) | set(SCENARIOS) | {i for v in PROGRAMMES.values() for i in v}
missing = sorted(i for i in wanted if 'rule.' + i not in ids)
if missing:
    raise SystemExit('unknown rules: ' + ', '.join(missing))

changed = set()
for r in rules:
    key = r['id'].removeprefix('rule.')
    before = (list(r['programmeIds']), list(r['scenarioIds']))
    for programme, keys in PROGRAMMES.items():
        if key in keys and programme not in r['programmeIds']:
            r['programmeIds'].append(programme)
    if key in SCENARIOS:
        r['scenarioIds'] = list(SCENARIOS[key])
    if key in FLIGHT_ONLY:
        r['scenarioIds'] = ['travel', 'airport'] + [s for s in r['scenarioIds'] if s not in ('travel', 'airport')]
    if (r['programmeIds'], r['scenarioIds']) != before:
        changed.add(r['id'])

path.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(changed)} rules retagged')
