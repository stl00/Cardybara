#!/usr/bin/env python3
"""Record Lost Luggage Reimbursement for Chase personal cards (#316), checked 2026-11-16.

Runs once and offline, after the #304 batch. Each card's public product page on creditcards.chase.com was read signed out
with WebFetch on the check date; only a page that states Lost Luggage Reimbursement gets a rule. IHG One Rewards showed only
a "Travel & purchase coverage" heading with no text on this date, so it gets nothing, like the pages #304 listed (United
Explorer, United Quest, IHG One Rewards Premier, Iberia, Disney Inspire, Prime Visa, Amazon Visa).
Quotes are fragments as WebFetch returned them, not checked against a saved copy. Guides to benefits were not read, so
every rule is `official-summary`.

Needs opencc-python-reimplemented on PYTHONPATH.
"""
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n_catalog  # noqa: E402

spec = importlib.util.spec_from_file_location('curate_card_batch', Path(__file__).resolve().parent / 'curate-card-batch.py')
batch_script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch_script)

CHECKED, REVIEW_AFTER = '2026-11-16', '2027-02-14'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
tr = i18n_catalog.load(root)

CARDS = [  # product id suffix; all pages state the same text
    'southwest-rapid-rewards-plus-credit-card', 'southwest-rapid-rewards-priority-credit-card',
    'southwest-rapid-rewards-premier-credit-card', 'marriott-bonvoy-bold-credit-card',
    'marriott-bonvoy-boundless-credit-card', 'marriott-bonvoy-bountiful-credit-card',
    'world-of-hyatt-credit-card', 'united-club-card', 'british-airways-visa-signature-credit-card',
    'aer-lingus-visa-signature-credit-card',
]
NOT_STATED = ['ihg-one-rewards-credit-card']

NOTE_ZH = '保障摘要；付款、事故、地域和理赔条件须查完整保障指南。'
HOW_ZH = '该条目仅为保障摘要；核对完整保障指南、除外责任和所需证明后再判断。'
HOW_EN = 'This is a summary of the coverage; the Guide to Benefits controls. Check eligibility, exclusions and claim requirements before relying on it.'
assert NOTE_ZH in tr['en-US']
ZH = f'受保旅行中托运或随身行李遗失、损坏或被盗时，可获报销维修或更换费用，每位受保旅客最高 $3,000。纽约州居民另限每件行李 $2,000、每次旅行全体受保旅客合计 $10,000。{NOTE_ZH}'
EN = 'Reimburses the cost to repair or replace checked or carry-on baggage that is lost, damaged or stolen during a covered trip, up to $3,000 per covered traveler. For New York residents it is also limited to $2,000 per bag and $10,000 for all covered travelers per trip.'
QUOTES = ['Provides reimbursement up to $3,000 per covered traveler',
          'for the cost to repair or replace checked or carry-on baggage',
          'that is lost, damaged or stolen during a covered trip.',
          'additionally limited to $2,000 per bag and $10,000 for all covered travelers per trip.']


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    return zh


made = 0
for suffix in CARDS:
    pid = f'chase-us-{suffix}'
    source_id = f'card-{pid}'
    assert any(s['id'] == source_id for s in sources), source_id
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    id = f'rule.{pid}.lost-luggage'
    if any(r['id'] == id for r in rules):
        raise SystemExit(f'already applied: {id}')
    rules.append({
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'benefit',
        'productIds': [pid], 'market': market, 'category': 'protection', 'scenarioIds': ['travel'], 'programmeIds': [],
        'content': {'title': '行李遗失赔偿', 'summary': txt(ZH, EN), 'howToUse': [ZH, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
        'original': {'lang': 'en-US', 'title': 'Lost Luggage Reimbursement', 'summary': EN, 'howToUse': [HOW_EN],
                     'quotes': [{'sourceId': source_id, 'text': q} for q in QUOTES]},
        'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
                  'coverage': {'type': 'lost-luggage', 'basis': None, 'requiresCardPayment': None, 'exclusions': []}},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': ZH},
        'evidence': {'sourceIds': [source_id], 'checkedAt': CHECKED, 'verification': 'official-summary',
                     'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    })
    made += 1
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.chase-lost-luggage-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made, 'pages with no stated protection', len(NOT_STATED))
