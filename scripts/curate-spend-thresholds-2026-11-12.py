#!/usr/bin/env python3
"""Record the spend threshold on four batch-made spend-unlock rules (#246), checked 2026-11-12.

Runs once and offline. The British Airways, Aer Lingus and Disney Inspire product pages on creditcards.chase.com
were read signed out with WebFetch on the check date. Each still states the amount and period the rule's summary
already gives, so the rules get a new revision whose terms carry `spendThreshold`, read from the batch rows through
scripts/spend_threshold.py, the same code curate-card-batch.py now uses for new batches.

The two Disney thresholds count only Disney purchases of one kind, so they carry `spendScope: category` and no
condition on the account's total spend. Nothing else in the rules changes.

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
    (9, 'chase-us-british-airways-visa-signature-credit-card', 'travel-together'),
    (9, 'chase-us-aer-lingus-visa-signature-credit-card', 'companion-ticket'),
    (11, 'chase-us-disney-inspire-visa-card', 'resort-stays'),
    (11, 'chase-us-disney-inspire-visa-card', 'park-tickets'),
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
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.spend-thresholds-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', out)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
print('revisions added', changed)
