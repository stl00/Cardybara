#!/usr/bin/env python3
"""Record the protections Amex US public product pages name (#306), checked 2026-11-15.

Runs once and offline. Each page was read signed out with WebFetch on the check date. Most Amex US product pages return
only a title or navigation (the benefit sections are cut off or rendered client side), and the per-benefit pages on
global.americanexpress.com return only navigation, so those cards get no rules. Two pages name protections as headings:
  - The Platinum Card: Car Rental Loss and Damage Insurance, Trip Delay Insurance, Trip Cancellation and Interruption Insurance.
  - American Express Gold Card: Trip Delay Insurance, Car Rental Loss and Damage Insurance (and a "Baggage Insurance Plan",
    which has no coverage type here, so it is not recorded).
The headings carry no limits, trigger, primary/secondary basis, card-payment condition or underwriter in the readable part
of either page, so every field beyond the type stays null and every rule says the limits are not stated. Nothing is inferred
from a Guide to Benefits PDF (which does not say which cards it applies to) or from another card.

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

CHECKED, REVIEW_AFTER = '2026-11-15', '2027-02-13'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
tr = i18n_catalog.load(root)


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    # OpenCC mis-segments 列出租车 as 列計程車 (taxi); force the right zh-TW text.
    tr['zh-TW'][zh] = tr['zh-TW'][zh].replace('官網產品頁列計程車', '官網產品頁列出租車')
    return zh


GOLD_SOURCE = 'card-amex-us-us-american-express-gold-card'
if not any(s['id'] == GOLD_SOURCE for s in sources):
    sources.append({'id': GOLD_SOURCE, 'url': 'https://www.americanexpress.com/us/credit-cards/card/gold-card/',
                    'title': txt('American Express · American Express Gold Card 官方产品页', 'American Express · American Express Gold Card official product page'),
                    'checkedAt': CHECKED, 'authority': 'official'})

NOTE_ZH = '官网产品页只列出该保障名称，可读部分没有写赔付额、触发条件、主要或次要保障、付款要求和承保方；具体条件须查完整保障指南。'
HOW_ZH = '该条目仅说明官网产品页列出此保障；核对完整保障指南、承保方、除外责任和所需证明后再判断。'
HOW_EN = 'This only records that the official product page lists the coverage; the Guide to Benefits controls. Check the limits, eligibility, exclusions and claim requirements before relying on it.'
TYPES = {  # key -> (coverage type, scenario, zh title, en title, zh summary, en summary, quote)
    'trip-delay': ('trip-delay', 'travel', '旅行延误保障', 'Trip Delay Insurance',
                   f'官网产品页列出旅行延误保险（Trip Delay Insurance）。{NOTE_ZH}',
                   'The official product page lists Trip Delay Insurance. The readable part of the page does not state the delay threshold, limit, conditions or underwriter.',
                   'Trip Delay Insurance'),
    'trip-cancel': ('trip-cancellation', 'travel', '旅行取消／中断保障', 'Trip Cancellation and Interruption Insurance',
                    f'官网产品页列出旅行取消与中断保险（Trip Cancellation and Interruption Insurance）。{NOTE_ZH}',
                    'The official product page lists Trip Cancellation and Interruption Insurance. The readable part of the page does not state the limits, conditions or underwriter.',
                    'Trip Cancellation and Interruption Insurance'),
    'rental': ('rental-car', 'ground-transport', '租车损坏保障', 'Car Rental Loss and Damage Insurance',
               f'官网产品页列出租车损失与损坏保险（Car Rental Loss and Damage Insurance）。{NOTE_ZH}',
               'The official product page lists Car Rental Loss and Damage Insurance. The readable part of the page does not state whether it is primary or secondary, the limit, the card-payment condition or the underwriter.',
               'Car Rental Loss and Damage Insurance'),
}
CARDS = {
    'amex-us-us-the-platinum-card': ('card-amex-us-us-the-platinum-card', ['trip-delay', 'trip-cancel', 'rental']),
    'amex-us-us-american-express-gold-card': (GOLD_SOURCE, ['trip-delay', 'rental']),
}
made = 0
for pid, (source_id, keys) in CARDS.items():
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    for key in keys:
        ctype, scenario, zh_title, en_title, zh, en, quote = TYPES[key]
        id = f'rule.{pid}.{key}'
        if any(r['id'] == id for r in rules):
            raise SystemExit(f'already applied: {id}')
        rules.append({
            'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'benefit',
            'productIds': [pid], 'market': market, 'category': 'protection', 'scenarioIds': [scenario], 'programmeIds': [],
            'content': {'title': zh_title, 'summary': txt(zh, en), 'howToUse': [zh, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
            'original': {'lang': 'en-US', 'title': en_title, 'summary': en, 'howToUse': [HOW_EN],
                         'quotes': [{'sourceId': source_id, 'text': quote}]},
            'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
                      'coverage': {'type': ctype, 'basis': None, 'requiresCardPayment': None, 'exclusions': []}},
            'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': zh},
            'evidence': {'sourceIds': [source_id], 'checkedAt': CHECKED, 'verification': 'official-summary',
                         'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
        })
        made += 1
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.amex-us-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made)
