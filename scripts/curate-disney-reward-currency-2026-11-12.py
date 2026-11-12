#!/usr/bin/env python3
"""Name the reward currency of the Chase Disney cards (#245), checked 2026-11-12.

Runs once and offline. The three Disney Visa product pages were read signed out with WebFetch on the check date.
Each says the card earns a percent "in Disney Rewards Dollars" and that these are used toward Disney purchases in the
U.S. (the Premier and Inspire pages add a statement credit toward airline tickets bought with the card). None offers
them as cash back, so the earning rules, stored as `cashback-percent`, get a new revision whose terms carry
`rewardCurrency` with `cash: false`. The decision engine then names the currency and never ranks it as cash.

Nothing else in the rules changes: rates, labels and summaries are copied from revision 1.
"""
import copy
import json
from pathlib import Path

CHECKED = '2026-11-12'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
NAME = 'Disney Rewards Dollars'
PARKS = 'Use toward Disney Theme Park Tickets, Resort stays, shopping, dining, Disney Cruise Line sailings and more in the U.S.'
# product, the page's sentence naming the currency, the page's sentence on what it is used for.
CARDS = {
    'chase-us-disney-visa-card': ('Earn 1% in Disney Rewards Dollars on all card purchases with no limits to the amount you can earn.',
                                  'Redeem toward most anything Disney at most Disney U.S. locations.'),
    'chase-us-disney-premier-visa-card': ('You will earn 1% in Disney Rewards Dollars for each $1 spent on all other Qualifying Purchases.', PARKS),
    'chase-us-disney-inspire-visa-card': ('There are no limits to the number of Disney Rewards Dollars you can earn.', PARKS),
}
if any(r['terms'].get('rewardCurrency') for r in rules if r['kind'] == 'earning-rate' and r['productIds'][0] in CARDS):
    raise SystemExit('already applied')

out, changed = [], 0
for rule in rules:
    out.append(rule)
    pid = rule['productIds'][0] if rule['productIds'] else None
    if rule['kind'] != 'earning-rate' or pid not in CARDS:
        continue
    assert rule['revision'] == 1 and rule['terms']['unit'] == 'cashback-percent', rule['revisionId']
    earned, used = CARDS[pid]
    new = copy.deepcopy(rule)
    new.update(revision=2, revisionId=f"{rule['id']}@{CHECKED}.2", supersedes=rule['revisionId'])
    new['terms']['rewardCurrency'] = {'name': NAME, 'cash': False, 'sourceText': earned, 'redemptionText': used}
    new['evidence']['checkedAt'] = CHECKED
    new['review']['checkedAt'] = CHECKED
    out.append(new)
    changed += 1
assert changed == 9, changed
for s in sources:
    if s['id'] in {f'card-{p}' for p in CARDS}:
        s['checkedAt'] = CHECKED
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.disney-currency-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', out)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
print('revisions added', changed)
