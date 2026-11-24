#!/usr/bin/env python3
"""Record the Business Platinum car rental protection from Amex's public Description of Coverage PDF (#441), checked 2026-11-23.

Runs once and offline. The PDF is linked from americanexpress.com, public and signed out; WebFetch saved it and the first
section (the "U.S. Business Platinum Card member" plan) was read as text. Only that section is recorded (rental-car, excess,
no limits in `terms`; limits are in the summary). Later sections of the PDF are for the personal Platinum Card (Puerto Rico,
USVI) and are not used.
Still not readable on 2026-11-23 (terms pages: "Header overflow", "page not active", navigation only; no other public
policy PDF found), so left unknown: Business Gold, Blue Business Plus/Cash, Business Green Rewards, Graphite, Delta Gold/Platinum/
Reserve Business, Hilton Business, Marriott Business. Business Platinum purchase protection, extended warranty and others: the
PDF covers car rental only, so not recorded.

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

CHECKED, REVIEW_AFTER = '2026-11-23', '2027-02-21'
PID = 'amex-us-us-business-platinum-card'
SID = f'card-{PID}-car-rental-doc'
URL = 'https://www.americanexpress.com/content/dam/amex/us/credit-cards/features-benefits/policies/pdf/CRLDI-DOC-OSBN-PLAT.pdf'
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


ZH = ('官网公开的租车损失与损坏保险说明（Description of Coverage）写明：用 Business Platinum 卡支付租车、本人为主租人时，保障租赁车辆的损坏或被盗；'
      '属超额（excess）保险，仅限在美国及其属地租的车，连续租期不超过 30 天；原价 $75,000 及以上的豪车不在保障内；'
      '本人和乘客的随身物品各最高 $1,000、全部乘员合计 $2,000；承保方为 AMEX Assurance Company。该说明不是保单本身，具体条件以保单为准。')
EN = ('The official public Description of Coverage says Car Rental Loss and Damage Insurance covers damage to or theft of a rental auto when the Business Platinum Card is used '
      'and the cardmember is the primary renter. It is excess insurance, only for autos rented in the U.S. and its territories, for no more than 30 consecutive days; '
      'cars with an original MSRP of $75,000 or more are not covered; personal property is covered up to $1,000 for the cardmember and for passengers, $2,000 in total; '
      'underwritten by AMEX Assurance Company. The document is not the policy itself.')
HOW_ZH = '该条目基于官网公开的保障说明文件，未逐条核对全部除外责任；核对完整保单、除外责任和所需证明后再判断。'
HOW_EN = 'This is based on the official public Description of Coverage; not every exclusion was reviewed. Check the policy, the exclusions and the claim requirements before relying on it.'
QUOTES = [
    'This coverage is excess insurance.',
    'Car Rental Loss and Damage Insurance is an excess insurance plan and is only available for Rental Autos rented in the U.S., its territories and possessions.',
    'In no event shall coverage be provided when the Cardmember rents a Rental Auto beyond 30 consecutive days from the same Rental Company',
    "expensive cars, which means cars with an original manufacturer's suggested retail price of $75,000 or more when new",
    'Cardmember property and Passenger property are each covered for up to $1,000 while the total coverage for all occupants is $2,000.',
    'This coverage is underwritten by AMEX Assurance Company',
]
if any(s['id'] == SID for s in sources):
    raise SystemExit(f'already applied: {SID}')
sources.append({'id': SID, 'url': URL, 'title': 'Amex · Business Platinum 租车损失与损坏保险说明（官方 PDF）', 'checkedAt': CHECKED, 'authority': 'official'})
id = f'rule.{PID}.rental'
if any(r['id'] == id for r in rules):
    raise SystemExit(f'already applied: {id}')
market = next(r['market'] for r in rules if r['id'] == f'rule.{PID}.fee-primary')
rules.append({
    'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None,
    'status': 'published', 'kind': 'benefit', 'productIds': [PID], 'market': market, 'category': 'protection',
    'scenarioIds': ['ground-transport'], 'programmeIds': [],
    'content': {'title': '租车损坏保障', 'summary': txt(ZH, EN), 'howToUse': [ZH, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
    'original': {'lang': 'en-US', 'title': 'Car Rental Loss and Damage Insurance', 'summary': EN, 'howToUse': [HOW_EN],
                 'quotes': [{'sourceId': SID, 'text': q} for q in QUOTES]},
    'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
              'coverage': {'type': 'rental-car', 'basis': None, 'requiresCardPayment': None, 'exclusions': []}},
    'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
    'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': ZH},
    'evidence': {'sourceIds': [SID], 'checkedAt': CHECKED, 'verification': 'official-summary',
                 'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
    'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
    'personalState': 'not-in-public-knowledge',
})
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.amex-business-platinum-rental-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', 1)
