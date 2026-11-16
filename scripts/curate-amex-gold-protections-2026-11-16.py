#!/usr/bin/env python3
"""Record the protection terms the Amex US Gold Card public product page states (#326, rest of #306), checked 2026-11-16.

Runs once and offline, after scripts/curate-amex-us-protections-2026-11-15.py. On 2026-11-15 the Gold page returned only
protection headings; on 2026-11-16 a signed-out WebFetch of https://www.americanexpress.com/us/credit-cards/gold-card/
returned the text under three headings, so this adds a revision 2 of the Gold trip-delay and rental rules and a new
lost-luggage rule for the "Baggage Insurance Plan" (lost, damaged or stolen baggage; an existing coverage type fits it).
Quotes are fragments as WebFetch returned them, not checked against a saved copy; the Guide to Benefits was not read, so
every rule stays `official-summary`. The card-payment condition is described in the summary but left null in `terms`,
because the validator only accepts "pay ... card" wording in a quote.
Not changed: The Platinum Card page still returned only headings on 2026-11-16, and the other Amex US pages in #326 still
returned only a title or navigation, so they get no rules (kept unknown, not guessed).

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
PID, SOURCE = 'amex-us-us-american-express-gold-card', 'card-amex-us-us-american-express-gold-card'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
write = lambda p, d: p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
rules, sources, manifest = (load(base / f) for f in ('rules.json', 'sources.json', 'manifest.json'))
tr = i18n_catalog.load(root)


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    return zh


NOTE_ZH = '保障摘要；除外责任、地域和理赔条件须查完整保障指南。'
HOW_ZH = '该条目仅为官网产品页摘要；核对完整保障指南、承保方、除外责任和所需证明后再判断。'
HOW_EN = 'This is a summary of the official product page; the Guide to Benefits controls. Check the exclusions, eligibility and claim requirements before relying on it.'
RENTAL_EXCL = 'Coverage is not available for vehicles rented in Australia, Italy, and New Zealand.'
SPECS = {  # key -> (type, scenario, basis, exclusions, zh title, en title, zh, en, quotes)
    'trip-delay': ('trip-delay', 'travel', None, [], '旅行延误保障', 'Trip Delay Insurance',
                   f'往返行程全额用符合资格的卡支付、因承保原因延误超过 12 小时时，可报销同一张卡支付的部分额外费用，每次旅行最高 $300，每张符合资格的卡每连续 12 个月最多 2 次理赔；承保方为 New Hampshire Insurance Company（AIG 旗下）。{NOTE_ZH}',
                   'When a round-trip is paid for entirely with the Eligible Card and a covered reason delays the trip more than 12 hours, it can reimburse certain additional expenses bought on the same card, up to $300 per trip, with at most 2 claims per Eligible Card per 12 consecutive months. Underwritten by New Hampshire Insurance Company, an AIG Company.',
                   ['If a round-trip is paid for entirely with your Eligible Card and a covered reason delays your trip more than 12 hours,',
                    'up to $300 per trip, maximum 2 claims per Eligible Card per 12 consecutive month period.',
                    'Coverage is provided by New Hampshire Insurance Company, an AIG Company.']),
    'rental': ('rental-car', 'ground-transport', 'secondary', [RENTAL_EXCL], '租车损坏保障', 'Car Rental Loss and Damage Insurance',
               f'用符合资格的卡预订并支付全部租金、并在租车柜台拒绝 CDW 时，可保障承保地区内租赁车辆的损坏或被盗；属次要保障，不含责任险；澳大利亚、意大利和新西兰租的车不在保障内。{NOTE_ZH}',
               'When you use the Eligible Card to reserve and pay for the entire rental and decline the collision damage waiver at the counter, it covers damage to or theft of a rental vehicle in a covered territory. It is secondary coverage and does not include liability. Vehicles rented in Australia, Italy and New Zealand are not covered.',
               ['When you use your Eligible Card to reserve and pay for the Entire Rental and decline the collision damage waiver (CDW)',
                'This product provides secondary coverage and does not include liability coverage.', RENTAL_EXCL]),
    'lost-luggage': ('lost-luggage', 'travel', None, [], '行李遗失赔偿', 'Baggage Insurance Plan',
                     f'用符合资格的卡支付全部公共交通（飞机、火车、轮船、巴士）车票后，随身或托运行李遗失、损坏或被盗可获赔，随身行李最高 $1,250、托运行李最高 $500，在承运人赔付之外补充；纽约州另有每次旅行全体受保人合计 $10,000 的上限。{NOTE_ZH}',
                     'When the entire fare of a common carrier ticket (plane, train, ship or bus) is bought on an Eligible Card, lost, damaged or stolen baggage is covered up to $1,250 for carry-on and $500 for checked baggage, in excess of what the carrier provides. In New York there is a $10,000 aggregate limit for all covered persons per trip.',
                     ['when you purchase the Entire Fare for a Common Carrier Vehicle ticket',
                      'up to $1,250 for carry-on Baggage and up to $500 for checked Baggage.',
                      'there is a $10,000 aggregate maximum limit for all Covered Persons per Covered Trip.']),
}
for s in sources:
    if s['id'] == SOURCE:
        s['checkedAt'] = CHECKED
made = 0
for key, (ctype, scenario, basis, excl, zh_title, en_title, zh, en, quotes) in SPECS.items():
    id = f'rule.{PID}.{key}'
    prev = sorted((r for r in rules if r['id'] == id), key=lambda r: r['revision'])
    if prev and prev[-1]['evidence']['checkedAt'] >= CHECKED:
        raise SystemExit(f'already applied: {id}')
    rev = prev[-1]['revision'] + 1 if prev else 1
    market = next(r['market'] for r in rules if r['id'] == f'rule.{PID}.fee-primary')
    rules.append({
        'id': id, 'revision': rev, 'revisionId': f'{id}@{CHECKED}.{rev}', 'supersedes': prev[-1]['revisionId'] if prev else None,
        'status': 'published', 'kind': 'benefit', 'productIds': [PID], 'market': market, 'category': 'protection',
        'scenarioIds': [scenario], 'programmeIds': [],
        'content': {'title': zh_title, 'summary': txt(zh, en), 'howToUse': [zh, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
        'original': {'lang': 'en-US', 'title': en_title, 'summary': en, 'howToUse': [HOW_EN],
                     'quotes': [{'sourceId': SOURCE, 'text': q} for q in quotes]},
        'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
                  'coverage': {'type': ctype, 'basis': basis, 'requiresCardPayment': None, 'exclusions': excl}},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': zh},
        'evidence': {'sourceIds': [SOURCE], 'checkedAt': CHECKED, 'verification': 'official-summary',
                     'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    })
    made += 1
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.amex-gold-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made)
