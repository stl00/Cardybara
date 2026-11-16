#!/usr/bin/env python3
"""Record the protections the BofA, U.S. Bank, Wells Fargo, Bilt and Discover public product pages name (#344), checked 2026-11-16.

Runs once and offline. Source: a signed-out WebFetch of each issuer product page on 2026-11-16 (the URLs already in
sources.json). Quotes are fragments as WebFetch returned them, not checked against a saved copy; no Guide to Benefits was
read, so every rule stays `official-summary`. Per card (found / absent):
  Wells Fargo Autograph Journey: trip cancellation/interruption, lost luggage, rental (all stated secondary), roadside.
    Cell phone, travel accident and emergency assistance need #323 / are not coverage types; trip delay etc. not named.
  Bilt Blue: purchase protection, rental.  Bilt Obsidian: trip cancellation/interruption, trip delay, lost luggage,
    extended warranty, purchase protection, rental.  Bilt Palladium: the Obsidian set plus baggage delay.
    Price Drop Protection and cell phone protection are not recorded (no matching type / needs #323).
  BofA Atmos Summit, Atmos Ascent, Unlimited Cash, Customized Cash; U.S. Bank Altitude Go, Cash+; Discover it: page names
    no protection beyond fraud liability, so no rule. Nothing is copied from a sibling card.

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


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    return zh


NOTE_ZH = '官网产品页仅列出名称，金额上限、除外责任和理赔条件须查完整保障指南。'
HOW_ZH = '该条目仅为官网产品页摘要；核对完整保障指南、承保方、除外责任和所需证明后再判断。'
HOW_EN = 'This is a summary of the official product page; the Guide to Benefits controls. Check the exclusions, eligibility and claim requirements before relying on it.'
# key -> (coverage type, scenario, zh title, en title, zh, en)
T = {
 'trip-cancellation': ('trip-cancellation', 'travel', '行程取消与中断保障', 'Trip Cancellation and Interruption',
   f'产品页列出行程取消与中断（Trip Cancellation and Interruption）保障。{NOTE_ZH}', 'The product page lists trip cancellation and interruption protection. It names the benefit without limits or conditions.'),
 'trip-delay': ('trip-delay', 'travel', '旅行延误保障', 'Trip Delay',
   f'产品页列出旅行延误（Trip Delay Reimbursement）保障。{NOTE_ZH}', 'The product page lists trip delay reimbursement. It names the benefit without limits or conditions.'),
 'baggage-delay': ('baggage-delay', 'travel', '行李延误保障', 'Baggage Delay',
   f'产品页列出行李延误（Baggage Delay Insurance）保障。{NOTE_ZH}', 'The product page lists baggage delay insurance. It names the benefit without limits or conditions.'),
 'lost-luggage': ('lost-luggage', 'travel', '行李遗失或损坏保障', 'Lost or Damaged Luggage',
   f'产品页列出行李遗失或损坏保障。{NOTE_ZH}', 'The product page lists lost or damaged luggage protection. It names the benefit without limits or conditions.'),
 'rental': ('rental-car', 'ground-transport', '租车保险', 'Car Rental Coverage',
   f'产品页列出租车保险；页面未写明属于主要还是次要保障。{NOTE_ZH}', 'The product page lists car rental coverage. It does not say whether the coverage is primary or secondary.'),
 'extended-warranty': ('extended-warranty', 'shopping', '延长保修', 'Extended Warranty',
   f'产品页列出延长保修（Extended Warranty）。{NOTE_ZH}', 'The product page lists extended warranty. It names the benefit without limits or conditions.'),
 'purchase-protection': ('purchase-protection', 'shopping', '购物保障', 'Purchase Assurance',
   f'产品页列出购物保障（Purchase Assurance）。{NOTE_ZH}', 'The product page lists Purchase Assurance. It names the benefit without limits or conditions.'),
 'roadside': ('roadside', 'ground-transport', '道路救援', 'Roadside Dispatch',
   f'产品页列出道路救援（Roadside Dispatch），称需要拖车时可用。{NOTE_ZH}', 'The product page lists Roadside Dispatch, available when a tow is needed. It states no limit.'),
}
# (card, key) -> (basis, quotes)
Q = {
 ('wf-journey', 'trip-cancellation'): ('secondary', ['Trip Cancellation and Interruption Protection', 'Coverage provided by this benefit is secondary.']),
 ('wf-journey', 'lost-luggage'): ('secondary', ['Lost Baggage Reimbursement', 'Coverage provided by this benefit is secondary.']),
 ('wf-journey', 'rental'): ('secondary', ['Auto Rental Collision Damage Waiver', 'Coverage provided by this benefit is secondary.']),
 ('wf-journey', 'roadside'): (None, ['Roadside Dispatch']),
 ('bilt-blue', 'purchase-protection'): (None, ['Purchase Assurance']),
 ('bilt-blue', 'rental'): (None, ['MasterRental Coverage']),
}
for c in ('bilt-obsidian', 'bilt-palladium'):
    for k, q in [('trip-cancellation', 'Trip Cancellation and Interruption Protection'), ('trip-delay', 'Trip Delay Reimbursement'),
                 ('lost-luggage', 'Lost or Damaged Luggage Insurance'), ('extended-warranty', 'Extended Warranty'),
                 ('purchase-protection', 'Purchase Assurance'), ('rental', 'MasterRental Coverage')]:
        Q[(c, k)] = (None, [q])
Q[('bilt-palladium', 'baggage-delay')] = (None, ['Baggage Delay Insurance'])
PRODUCT = {'wf-journey': 'wells-fargo-us-autograph-journey-visa-card', 'bilt-blue': 'bilt-us-bilt-blue-card',
           'bilt-obsidian': 'bilt-us-bilt-obsidian-card', 'bilt-palladium': 'bilt-us-bilt-palladium-card'}
made = 0
for s in sources:
    if s['id'] in ['card-' + p for p in PRODUCT.values()]:
        s['checkedAt'] = CHECKED
for (card, key), (basis, quotes) in Q.items():
    pid = PRODUCT[card]
    source = 'card-' + pid
    ctype, scenario, zh_title, en_title, zh, en = T[key]
    if basis == 'secondary':
        zh = f'产品页列出{zh_title}，并称该保障为次要保障（secondary）。{NOTE_ZH}'
        en = f'The product page lists {en_title.lower()} and says the coverage is secondary. It states no limit.'
    id = f'rule.{pid}.{key}'
    if any(r['id'] == id for r in rules):
        raise SystemExit(f'already applied: {id}')
    market = next(r['market'] for r in rules if pid in r['productIds'])
    rules.append({
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None,
        'status': 'published', 'kind': 'benefit', 'productIds': [pid], 'market': market, 'category': 'protection',
        'scenarioIds': [scenario], 'programmeIds': [],
        'content': {'title': zh_title, 'summary': txt(zh, en), 'howToUse': [zh, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
        'original': {'lang': 'en-US', 'title': en_title, 'summary': en, 'howToUse': [HOW_EN],
                     'quotes': [{'sourceId': source, 'text': q} for q in quotes]},
        'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
                  'coverage': {'type': ctype, 'basis': basis, 'requiresCardPayment': None, 'exclusions': []}},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': zh},
        'evidence': {'sourceIds': [source], 'checkedAt': CHECKED, 'verification': 'official-summary',
                     'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    })
    made += 1
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.bofa-usb-wf-bilt-discover-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made)
