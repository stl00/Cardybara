#!/usr/bin/env python3
"""Record the spend threshold on five more batch-made spend-unlock rules (#250), checked 2026-11-12.

Runs once and offline, the way scripts/curate-spend-thresholds-2026-11-12.py did for #246. The Capital One Spark
Cash Plus page and the Chase United Explorer, Marriott Bonvoy Bountiful, United Business and United Club Business
pages were read signed out with WebFetch on the check date. Each still states the amount and period the rule's
summary already gives, so the rules get a new revision whose terms carry `spendThreshold`, read from the batch rows
through scripts/spend_threshold.py.

All five count every purchase on the card. The four calendar-year ones also get the condition on the account's
calendar-year spend. The Spark Cash Plus refund runs on the membership year, which the account's calendar-year
spend does not prove, so it gets the threshold and no condition.

Nine American Express rules are left as they are: on the check date their product pages returned only the page
title signed out, so their amounts could not be read again. They are named in the pull request for #250.

A new revision means a usage amount someone saved against revision 1 of these rules is no longer shown.
"""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spend_threshold  # noqa: E402

CHECKED = '2026-11-12'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
# batch, product, benefit key.
ROWS = [
    (2, 'capital-one-us-spark-cash-plus-card', 'fee-refund'),
    (4, 'chase-us-united-explorer-card', 'travel-credit'),
    (6, 'chase-us-marriott-bonvoy-bountiful-credit-card', 'free-night'),
    (9, 'chase-us-united-business-card', 'economy-plus'),
    (9, 'chase-us-united-club-business-card', 'economy-plus'),
]
patches = {}
for number, pid, key in ROWS:
    batch = load(root / f'docs/knowledge/card-batches/batch-{number:02d}.json')
    row = next(b for c in batch['cards'] if c['id'] == pid for b in c['credits'] if b['key'] == key)
    terms, conditions, errors = spend_threshold.read(row, 'USD')
    if errors or not terms:
        raise SystemExit(f'{pid}.{key}: {errors or "no spendThreshold in the batch row"}')
    patches[f'rule.{pid}.{key}'] = (terms, conditions)
if any(r['terms'].get('spendThreshold') for r in rules if r['id'] in patches):
    raise SystemExit('already applied')

out, changed = [], 0
for rule in rules:
    out.append(rule)
    if rule['id'] not in patches:
        continue
    assert rule['revision'] == 1 and rule['evidence']['sourceIds'] == [f"card-{rule['productIds'][0]}"], rule['revisionId']
    terms, conditions = patches[rule['id']]
    new = copy.deepcopy(rule)
    new.update(revision=2, revisionId=f"{rule['id']}@{CHECKED}.2", supersedes=rule['revisionId'])
    new['terms'].update(terms)
    new['conditions']['all'] = conditions
    new['evidence']['checkedAt'] = CHECKED
    new['review']['checkedAt'] = CHECKED
    out.append(new)
    changed += 1
assert changed == len(ROWS), changed
for s in sources:
    if s['id'] in {f'card-{pid}' for _, pid, _ in ROWS}:
        s['checkedAt'] = CHECKED
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.spend-thresholds-2'
manifest['asOf'] = CHECKED
write(base / 'rules.json', out)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
print('revisions added', changed)
