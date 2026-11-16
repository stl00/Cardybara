#!/usr/bin/env python3
"""Record the protections the Capital One and Citi US public product pages name (#343), checked 2026-11-16.

Runs once and offline. Source: a signed-out WebFetch of each issuer product page on 2026-11-16 (the URLs already in
sources.json for each card). Quotes are fragments as WebFetch returned them, not checked against a saved copy; no Guide
to Benefits was read, so every rule stays `official-summary`. Pages state names and, mostly, no limits, so `amount` is null.
Per card (found / absent):
  Venture X: only cell phone protection (needs #323), no rule.  Venture X Business: extended warranty.
  Venture: rental (basis not stated), extended warranty; travel accident insurance needs #323.
  Savor: extended warranty; travel accident insurance needs #323.  Spark Cash Plus: extended warranty, roadside.
  Strata Elite: trip cancellation, trip delay, lost luggage, rental (MasterRental), extended warranty, purchase protection.
  Strata Premier: trip cancellation, trip delay, lost luggage, rental.  AAdvantage Executive: same four.
  Double Cash: extended warranty (secondary).  Custom Cash and AAdvantage Platinum Select: page names none, no rule.
Nothing is copied from a sibling card.

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
# key -> (coverage type, scenario, basis, zh title, en title, zh, en, quotes)
T = {
 'trip-cancellation': ('trip-cancellation', 'travel', None, '行程取消与中断保障', 'Trip Cancellation and Interruption',
   f'产品页列出行程取消与中断（Trip Cancellation / Interruption）保障。{NOTE_ZH}', 'The product page lists trip cancellation and trip interruption protection. It names the benefit without limits or conditions.'),
 'trip-delay': ('trip-delay', 'travel', None, '旅行延误保障', 'Trip Delay',
   f'产品页列出旅行延误（Trip Delay）保障。{NOTE_ZH}', 'The product page lists trip delay protection. It names the benefit without limits or conditions.'),
 'lost-luggage': ('lost-luggage', 'travel', None, '行李遗失或损坏保障', 'Lost or Damaged Luggage',
   f'产品页列出行李遗失或损坏（Lost / Damaged Luggage）保障。{NOTE_ZH}', 'The product page lists lost or damaged luggage protection. It names the benefit without limits or conditions.'),
 'rental': ('rental-car', 'ground-transport', None, '租车保险', 'Car Rental Coverage',
   f'产品页列出租车保险；页面未写明属于主要还是次要保障。{NOTE_ZH}', 'The product page lists car rental coverage. It does not say whether the coverage is primary or secondary.'),
 'extended-warranty': ('extended-warranty', 'shopping', None, '延长保修', 'Extended Warranty',
   f'产品页称符合资格的商品用该卡购买可获额外保修。{NOTE_ZH}', 'The product page says eligible items bought with the card get additional warranty protection. It states no limit.'),
 'purchase-protection': ('purchase-protection', 'shopping', None, '购物保障', 'Purchase Assurance Plus',
   f'产品页列出 Purchase Assurance Plus 购物保障名称。{NOTE_ZH}', 'The product page names Purchase Assurance Plus. It states no limit or conditions.'),
 'roadside': ('roadside', 'ground-transport', None, '道路救援', 'Auto-related emergency services',
   f'产品页称商业卡提供汽车相关紧急情况的协助服务（如搭电、换胎、拖车）。{NOTE_ZH}', 'The product page says the business cards offer services to help during auto-related emergencies, with jump-starting, tire changing and towing as examples. It states no limit.'),
}
Q = {
 ('strata-elite', 'trip-cancellation'): ['Enhanced Trip Cancellation and Trip Interruption Protection'],
 ('strata-elite', 'trip-delay'): ['Help stay protected with travel insurances, including Trip Delay Protection,'],
 ('strata-elite', 'lost-luggage'): ['Lost or Damaged Luggage'],
 ('strata-elite', 'rental'): ['MasterRental Coverage (Car Rental)'],
 ('strata-elite', 'extended-warranty'): ['Extended Warranty and Purchase Assurance Plus'],
 ('strata-elite', 'purchase-protection'): ['Extended Warranty and Purchase Assurance Plus'],
 ('strata-premier', 'trip-cancellation'): ['Trip Cancellation and Trip Interruption (Common Carrier)'],
 ('strata-premier', 'trip-delay'): ['Trip Delay'],
 ('strata-premier', 'lost-luggage'): ['Lost or Damaged Luggage'],
 ('strata-premier', 'rental'): ['MasterRental Coverage (Car Rental)'],
 ('aadvantage-executive', 'trip-cancellation'): ['Help stay protected with travel insurances, including Trip Cancellation & Interruption Protection'],
 ('aadvantage-executive', 'trip-delay'): ['Travel Protection Benefits: Trip Delay Protection, Trip Cancellation & Interruption Protection,'],
 ('aadvantage-executive', 'lost-luggage'): ['Worldwide Car Rental Insurance and Lost Baggage Protection'],
 ('aadvantage-executive', 'rental'): ['Worldwide Car Rental Insurance and Lost Baggage Protection'],
 ('venture', 'rental'): ['Rent an eligible vehicle with your credit card and you can be covered for damage due to collision or theft.'],
 ('venture', 'extended-warranty'): ["You'll get additional warranty protection at no charge on eligible items that are purchased with your credit card."],
 ('savor', 'extended-warranty'): ["You'll get additional warranty protection at no charge on eligible items that are purchased with your credit card."],
 ('venture-x-business', 'extended-warranty'): ['Get free additional warranty and protection on eligible items you purchase with your card.'],
 ('spark-cash-plus', 'extended-warranty'): ['Get free additional warranty and protection on eligible items that you purchase with your card.'],
 ('spark-cash-plus', 'roadside'): ['Our business cards offer services to help you during auto-related emergencies'],
 ('double-cash', 'extended-warranty'): ['Policy provides secondary coverage only.'],
}
PRODUCT = {'strata-elite': 'citi-us-citi-strata-elite-card', 'strata-premier': 'citi-us-citi-strata-premier-card',
           'aadvantage-executive': 'citi-us-citi-aadvantage-executive-card', 'double-cash': 'citi-us-citi-double-cash-card',
           'venture': 'capital-one-us-venture-rewards-credit-card', 'savor': 'capital-one-us-savor-credit-card',
           'venture-x-business': 'capital-one-us-venture-x-business-card', 'spark-cash-plus': 'capital-one-us-spark-cash-plus-card'}
done = set()
for s in sources:
    for pid in PRODUCT.values():
        if s['id'] == 'card-' + pid:
            s['checkedAt'] = CHECKED
made = 0
for (card, key), quotes in Q.items():
    pid = PRODUCT[card]
    source = 'card-' + pid
    ctype, scenario, basis, zh_title, en_title, zh, en = T[key]
    if card == 'double-cash':
        basis, zh, en = 'secondary', f'产品页称延长保修为次要保障（secondary coverage only）。{NOTE_ZH}', 'The product page says the extended warranty policy provides secondary coverage only. It states no limit.'
    id = f'rule.{pid}.{key}'
    if any(r['id'] == id for r in rules):
        raise SystemExit(f'already applied: {id}')
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
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
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.capone-citi-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made)
