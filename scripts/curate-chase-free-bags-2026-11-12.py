#!/usr/bin/env python3
"""Record the free first checked bag on six Chase airline cards (#253), checked 2026-11-12.

Runs once and offline. The Southwest Rapid Rewards Plus, Priority, Premier, Premier Business and Performance Business
pages and the Air Canada Aeroplan page on creditcards.chase.com were read signed out with WebFetch on the check date.
Their batch rows in docs/knowledge/card-batches/ (batches 4 and 5) listed the free checked bag as not recorded; the rows
now carry it, and this script makes the rules from those rows the way scripts/curate-chase-free-nights-2026-11-12.py
does. United Explorer already had its `first-bag` rule (2026-11-04) and is not touched.

The quotes were not checked against a saved copy of the pages: WebFetch returns the page as short fragments, so each
quote here is one fragment as it was returned. The pull request for #253 says so.

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

CHECKED, REVIEW_AFTER = '2026-11-12', '2027-02-10'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
tr = i18n_catalog.load(root)
ROWS = [
    (4, 'chase-us-southwest-rapid-rewards-plus-credit-card'),
    (4, 'chase-us-southwest-rapid-rewards-priority-credit-card'),
    (4, 'chase-us-southwest-rapid-rewards-premier-credit-card'),
    (5, 'chase-us-southwest-rapid-rewards-premier-business-credit-card'),
    (5, 'chase-us-southwest-rapid-rewards-performance-business-credit-card'),
    (4, 'chase-us-air-canada-aeroplan-card'),
]
KEY = 'first-bag'
STANDARD_GAP = '个人登记、使用进度及完整保障细则尚未核实。'
STEPS = ['先核对卡种、当前官方条款和适用条件。', '个人资格、登记和剩余额度未核实；知识库不代办操作。']
assert STANDARD_GAP in tr['en-US'] and all(s in tr['en-US'] for s in STEPS)


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    return zh


problems, made, old_gaps = [], 0, set()
for number, pid in ROWS:
    card = next(c for c in load(root / f'docs/knowledge/card-batches/batch-{number:02d}.json')['cards'] if c['id'] == pid)
    source_id = f'card-{pid}'
    source = next(s for s in sources if s['id'] == source_id)
    assert source['url'] == card['url'], pid
    source['checkedAt'] = CHECKED
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    id = f'rule.{pid}.{KEY}'
    if any(r['id'] == id for r in rules):
        raise SystemExit('already applied')
    row = next(b for b in card['credits'] if b['key'] == KEY)
    quotes = [row['quote']] + row['original']['quotes']
    problems += [f'{id}: quote too long: {q}' for q in quotes if len(q.split()) > 22]
    title, summary = txt(row['zh'], row['en']), txt(row['noteZh'], row['noteEn'])
    rules.append({
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'benefit',
        'productIds': [pid], 'market': market, 'category': row['category'], 'scenarioIds': ['travel', row['scenario']], 'programmeIds': row['programmeIds'],
        'content': {'title': title, 'summary': summary, 'sourceText': row['quote'], 'howToUse': [STEPS[0], summary, STEPS[1]], 'translatedFrom': 'en-US'},
        'terms': {'category': row['category'], 'period': row['period'], 'amount': None, 'currency': None},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
        'evidence': {'sourceIds': [source_id], 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'content.sourceText', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
        'original': {'lang': 'en-US', 'title': row['original']['title'], 'summary': row['original']['summary'], 'howToUse': row['original']['howToUse'], 'quotes': [{'sourceId': source_id, 'text': q} for q in quotes]},
    })
    made += 1
    old_gaps |= {g for g in manifest['profileMetadata'][pid]['knowledgeGaps'] if g != STANDARD_GAP}
    manifest['profileMetadata'][pid]['knowledgeGaps'] = [txt(g['zh'], g['en']) for g in card.get('unknown', [])] + [STANDARD_GAP]
if problems:
    raise SystemExit('\n'.join(problems))
# A gap sentence no card lists any more leaves the catalogue with it.
listed = {g for meta in manifest['profileMetadata'].values() for g in meta.get('knowledgeGaps', [])}
for gone in old_gaps - listed:
    for language in tr.values():
        language.pop(gone, None)
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.chase-free-bags-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
batch_script.write_coverage()
print('rules added', made)
