#!/usr/bin/env python3
"""Record the protections named on the public offer terms pages of the Schwab and Morgan Stanley Platinum cards (#326, rest of #306), checked 2026-11-17.

Runs once and offline. Source for each card: the public "Terms, Conditions & Disclosures" print page American Express links
from the card's apply page (no sign-in). A signed-out WebFetch returned sections for Trip Cancellation and Interruption
Insurance, Trip Delay Insurance, Baggage Insurance Plan, Car Rental Loss and Damage Insurance, Purchase Protection,
Extended Warranty, Return Protection and Cell Phone Protection. These pages name the underwriter and, for trip cover, say it is
secondary, but give no limits, so `amount` stays null and every rule is `official-summary` with `fullTermsReviewed` false.
Quotes are fragments as WebFetch returned them, not checked against a saved copy.
Not recorded: Cell Phone Protection (no coverage type exists for it, see #323), and Premium Car Rental Protection (a paid add-on,
not an included benefit). Return Protection has no underwriter or limit on the page.

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

CHECKED, REVIEW_AFTER = '2026-11-17', '2027-02-15'
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


NOTE_ZH = '官网条款页未写赔付额、触发条件和除外责任；具体条件须查完整保障指南。'
HOW_ZH = '该条目仅为官网公开条款页摘要；核对完整保障指南、承保方、除外责任和所需证明后再判断。'
HOW_EN = 'This is a summary of the official public terms page; the Guide to Benefits controls. Check the exclusions, eligibility and claim requirements before relying on it.'
NHIC = 'Coverage is provided by New Hampshire Insurance Company, an AIG Company, at no-additional-cost to the Card Member.'
SEC = 'This benefit provides secondary coverage.'
AEA = lambda name: f'{name} is underwritten by AMEX Assurance Company.'
# key -> (type, scenario, basis, zh title, en title, zh, en, quotes)
SPECS = {
 'trip-cancel': ('trip-cancellation', 'travel', 'secondary', '行程取消与中断保障', 'Trip Cancellation and Interruption Insurance',
   f'条款页列出行程取消与中断保险（Trip Cancellation and Interruption Insurance），称属次要保障，承保方为 New Hampshire Insurance Company（AIG 旗下）。{NOTE_ZH}',
   'The terms page lists Trip Cancellation and Interruption Insurance, says it is secondary coverage, and names New Hampshire Insurance Company, an AIG Company, as the provider. It states no limit.',
   [NHIC, SEC]),
 'trip-delay': ('trip-delay', 'travel', 'secondary', '旅行延误保障', 'Trip Delay Insurance',
   f'条款页列出旅行延误保险（Trip Delay Insurance），称属次要保障，承保方为 New Hampshire Insurance Company（AIG 旗下）。{NOTE_ZH}',
   'The terms page lists Trip Delay Insurance, says it is secondary coverage, and names New Hampshire Insurance Company, an AIG Company, as the provider. It states no limit.',
   [NHIC, SEC]),
 'lost-luggage': ('lost-luggage', 'travel', None, '行李保险计划', 'Baggage Insurance Plan',
   f'条款页列出行李保险计划（Baggage Insurance Plan），承保方为 AMEX Assurance Company。{NOTE_ZH}',
   'The terms page lists the Baggage Insurance Plan and names AMEX Assurance Company as the underwriter. It states no limit.',
   [AEA('Baggage Insurance Plan'), 'Subject to additional terms, conditions and exclusions.']),
 'rental': ('rental-car', 'ground-transport', None, '租车损坏保障', 'Car Rental Loss and Damage Insurance',
   f'条款页列出租车损失与损坏保险（Car Rental Loss and Damage Insurance），承保方为 AMEX Assurance Company；页面未写明属于主要还是次要保障。{NOTE_ZH}',
   'The terms page lists Car Rental Loss and Damage Insurance and names AMEX Assurance Company as the underwriter. It does not say whether the coverage is primary or secondary.',
   [AEA('Car Rental Loss and Damage Insurance'), 'Subject to additional terms, conditions and exclusions.']),
 'purchase-protection': ('purchase-protection', 'shopping', None, '购物保障', 'Purchase Protection',
   f'条款页列出购物保障（Purchase Protection），承保方为 AMEX Assurance Company。{NOTE_ZH}',
   'The terms page lists Purchase Protection and names AMEX Assurance Company as the underwriter. It states no limit.',
   [AEA('Purchase Protection'), 'Subject to additional terms, conditions and exclusions.']),
 'extended-warranty': ('extended-warranty', 'shopping', None, '延长保修', 'Extended Warranty',
   f'条款页列出延长保修（Extended Warranty），承保方为 AMEX Assurance Company。{NOTE_ZH}',
   'The terms page lists Extended Warranty and names AMEX Assurance Company as the underwriter. It states no limit.',
   [AEA('Extended Warranty'), 'Subject to additional terms, conditions and exclusions.']),
 'return-protection': ('return-protection', 'shopping', None, '退货保障', 'Return Protection',
   f'条款页列出退货保障（Return Protection），称受额外条款、条件和除外责任约束；页面未写明承保方。{NOTE_ZH}',
   'The terms page lists Return Protection and says it is subject to additional terms, conditions and exclusions. It names no underwriter and states no limit.',
   ['Return Protection is subject to additional important terms, conditions and exclusions.']),
}
CARDS = {
 'amex-us-us-schwab-platinum-card': ('card-amex-us-us-schwab-platinum-card-terms', 'Amex · Schwab Platinum 官方申请条款页（保障条款）',
   'https://www.americanexpress.com/us/credit-cards/card-application/apply/partner/print/personal-card/csb/charles-schwab-platinum-card/ep-ADAP?print=false'),
 'amex-us-us-morgan-stanley-platinum-card': ('card-amex-us-us-morgan-stanley-platinum-card', 'Amex · Morgan Stanley Platinum 官方申请条款页（保障条款）',
   'https://www.americanexpress.com/us/credit-cards/card-application/apply/partner/print/personal-card/msb/morgan-stanley-platinum-card/ep-msb-mcs-26?print=false'),
}
made = 0
for pid, (sid, title, url) in CARDS.items():
    if any(s['id'] == sid for s in sources):
        raise SystemExit(f'already applied: {sid}')
    sources.append({'id': sid, 'url': url, 'title': title, 'checkedAt': CHECKED, 'authority': 'official'})
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    for key, (ctype, scenario, basis, zh_title, en_title, zh, en, quotes) in SPECS.items():
        id = f'rule.{pid}.{key}'
        if any(r['id'] == id for r in rules):
            raise SystemExit(f'already applied: {id}')
        rules.append({
            'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None,
            'status': 'published', 'kind': 'benefit', 'productIds': [pid], 'market': market, 'category': 'protection',
            'scenarioIds': [scenario], 'programmeIds': [],
            'content': {'title': zh_title, 'summary': txt(zh, en), 'howToUse': [zh, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
            'original': {'lang': 'en-US', 'title': en_title, 'summary': en, 'howToUse': [HOW_EN],
                         'quotes': [{'sourceId': sid, 'text': q} for q in quotes]},
            'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
                      'coverage': {'type': ctype, 'basis': basis, 'requiresCardPayment': None, 'exclusions': []}},
            'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': zh},
            'evidence': {'sourceIds': [sid], 'checkedAt': CHECKED, 'verification': 'official-summary',
                         'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
        })
        made += 1
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.amex-schwab-ms-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made)
