#!/usr/bin/env python3
"""Record the free night awards on four Chase hotel cards (#252), checked 2026-11-12.

Runs once and offline. The Marriott Bonvoy Boundless, World of Hyatt, IHG One Rewards Premier Select and IHG One
Rewards Business product pages on creditcards.chase.com were read signed out with WebFetch on the check date. Their
batch rows in docs/knowledge/card-batches/ (batches 4 and 5) listed the free nights as not recorded; the rows now
carry them, and this script makes the rules from those rows the way scripts/curate-card-batch.py makes a new card's
benefits. That script refuses a card that already has rules, so these are added here as first revisions.

Seven rules: an anniversary free night on each card, and the extra free night after calendar-year spend on World of
Hyatt, IHG Premier Select and IHG Business, which carries `spendThreshold` through scripts/spend_threshold.py.

The quotes were not checked against a saved copy of the pages: WebFetch returns the page as short fragments, so each
quote here is one fragment as it was returned. The pull request for #252 says so.

Needs opencc-python-reimplemented on PYTHONPATH.
"""
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n_catalog  # noqa: E402
import spend_threshold  # noqa: E402

spec = importlib.util.spec_from_file_location('curate_card_batch', Path(__file__).resolve().parent / 'curate-card-batch.py')
batch_script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch_script)

CHECKED, REVIEW_AFTER = '2026-11-12', '2027-02-10'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
tr = i18n_catalog.load(root)
# batch, product, benefit keys.
ROWS = [
    (4, 'chase-us-marriott-bonvoy-boundless-credit-card', ['anniversary-free-night']),
    (4, 'chase-us-world-of-hyatt-credit-card', ['anniversary-free-night', 'spend-free-night']),
    (5, 'chase-us-ihg-one-rewards-premier-select-credit-card', ['anniversary-free-night', 'spend-free-night']),
    (5, 'chase-us-ihg-one-rewards-business-credit-card', ['anniversary-free-night', 'spend-free-night']),
]
STANDARD_GAP = '个人登记、使用进度及完整保障细则尚未核实。'
STEPS = ['先核对卡种、当前官方条款和适用条件。', '个人资格、登记和剩余额度未核实；知识库不代办操作。']
assert STANDARD_GAP in tr['en-US'] and all(s in tr['en-US'] for s in STEPS)


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    return zh


problems, made = [], 0
for number, pid, keys in ROWS:
    card = next(c for c in load(root / f'docs/knowledge/card-batches/batch-{number:02d}.json')['cards'] if c['id'] == pid)
    source_id = f'card-{pid}'
    source = next(s for s in sources if s['id'] == source_id)
    assert source['url'] == card['url'], pid
    source['checkedAt'] = CHECKED
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    for key in keys:
        id = f'rule.{pid}.{key}'
        if any(r['id'] == id for r in rules):
            raise SystemExit('already applied')
        row = next(b for b in card['credits'] if b['key'] == key)
        quotes = [row['quote']] + row['original']['quotes']
        problems += [f'{id}: quote too long: {q}' for q in quotes if len(q.split()) > 22]
        title, summary = txt(row['zh'], row['en']), txt(row['noteZh'], row['noteEn'])
        terms = {'category': row['category'], 'period': row['period'], 'amount': None, 'currency': None, **row.get('terms', {})}
        spend_terms, conditions, errors = spend_threshold.read(row, 'USD')
        problems += [f'{id}: {e}' for e in errors]
        if (row['category'] == 'spend-unlock') != bool(spend_terms):
            problems.append(f'{id}: a spend-unlock row states its threshold, and only a spend-unlock row')
        terms.update(spend_terms)
        rules.append({
            'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'benefit',
            'productIds': [pid], 'market': market, 'category': row['category'], 'scenarioIds': [row['scenario']], 'programmeIds': row['programmeIds'],
            'content': {'title': title, 'summary': summary, 'sourceText': row['quote'], 'howToUse': [STEPS[0], summary, STEPS[1]], 'translatedFrom': 'en-US'},
            'terms': terms, 'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': conditions, 'unparsedText': summary},
            'evidence': {'sourceIds': [source_id], 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'content.sourceText', 'terms', 'validity'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
            'original': {'lang': 'en-US', 'title': row['original']['title'], 'summary': row['original']['summary'], 'howToUse': row['original']['howToUse'], 'quotes': [{'sourceId': source_id, 'text': q} for q in quotes]},
        })
        made += 1
    # The card's remaining gaps, as its batch row now lists them.
    manifest['profileMetadata'][pid]['knowledgeGaps'] = [txt(g['zh'], g['en']) for g in card.get('unknown', [])] + [STANDARD_GAP]
if problems:
    raise SystemExit('\n'.join(problems))
# A gap sentence no card lists any more leaves the catalogue with it.
listed = {g for meta in manifest['profileMetadata'].values() for g in meta.get('knowledgeGaps', [])}
for gone in ('年度免费房晚未录入。', '年度免费房晚、Tier Qualifying Night 和消费解锁的额外房晚未录入。',
             '200美元航空抵扣、周年免费房晚、Global Entry、DashPass、Instacart、United TravelBank、Elite Night Credits 和 Diamond 条件未录入。',
             'Platinum Elite、周年免费房晚、Expensify、Global Entry、DashPass、Instacart 和2027年起的 Diamond 条件未录入。'):
    assert gone not in listed, gone
    for language in tr.values():
        language.pop(gone, None)
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.chase-free-nights-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
batch_script.write_coverage()
print('rules added', made)
