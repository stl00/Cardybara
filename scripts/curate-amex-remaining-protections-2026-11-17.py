#!/usr/bin/env python3
"""Record the protections named on the public offer terms pages of more Amex US cards (#439, rest of #326), checked 2026-11-17.

Runs once and offline. Source per card: the public "Terms, Conditions & Disclosures" page American Express links from the card's
apply page (no sign-in), read with signed-out WebFetch. Only sections whose text WebFetch returned are recorded (each card's key
list below). The pages name the underwriter and, for trip cover, say it is secondary, but give no limits, so `amount` stays null and
every rule is `official-summary` with `fullTermsReviewed` false. Quotes are fragments as WebFetch returned them.
Not recorded: Cell Phone Protection (no coverage type, see #323) and Premium Car Rental Protection (a paid add-on).
Some pages are the additional-card (supplementary) variant of the card's terms page; they cover the same card.

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
P = 'https://www.americanexpress.com/us/credit-cards/card-application/apply/'
ALL = list(SPECS)
NO_TRIP = ['lost-luggage', 'rental', 'purchase-protection', 'extended-warranty']
# pid -> (source title, url, keys read on that page). Keys not listed were not on the page text and are not recorded.
CARDS = {
 'amex-us-us-the-platinum-card': ('Amex · Platinum Card 官方申请条款页（保障条款）', P + 'supplementary/terms/platinum-card/38171-9-0',
   ['lost-luggage', 'purchase-protection', 'extended-warranty', 'return-protection']),
 'amex-us-us-delta-skymiles-reserve-card': ('Amex · Delta SkyMiles Reserve 官方申请条款页（保障条款）', P + 'prospect/terms/delta-skymiles-reserve-american-express-card/25330-10-0', ALL),
 'amex-us-us-delta-skymiles-platinum-card': ('Amex · Delta SkyMiles Platinum 官方申请条款页（保障条款）', P + 'member/terms/delta-skymiles-platinum-american-express-card/36182-11-0/', ['trip-delay'] + NO_TRIP),
 'amex-us-us-delta-skymiles-gold-card': ('Amex · Delta SkyMiles Gold 官方申请条款页（保障条款）', P + 'prospect/terms/delta-skymiles-gold-american-express-card/28310-10-0', NO_TRIP),
 'amex-us-us-hilton-honors-aspire-card': ('Amex · Hilton Honors Aspire 官方申请条款页（保障条款）', P + 'prospect/terms/hilton-honors-aspire-credit-card/26129-10-0', ALL),
 'amex-us-us-hilton-honors-surpass-card': ('Amex · Hilton Honors Surpass 官方申请条款页（保障条款）', P + 'prospect/terms/hilton-honors-surpass-credit-card/26129-10-0', NO_TRIP),
 'amex-us-us-hilton-honors-card': ('Amex · Hilton Honors 官方申请条款页（保障条款）', P + 'supplementary/terms/hilton-honors-credit-card/36182-9-0', ['rental', 'purchase-protection', 'extended-warranty']),
 'amex-us-us-marriott-bonvoy-brilliant-card': ('Amex · Marriott Bonvoy Brilliant 官方申请条款页（保障条款）', P + 'supplementary/terms/marriott-bonvoy-brilliant-card/36182-9-0', ALL),
 'amex-us-us-marriott-bonvoy-bevy-card': ('Amex · Marriott Bonvoy Bevy 官方申请条款页（保障条款）', P + 'supplementary/terms/marriott-bonvoy-bevy-card/36182-9-0', ['trip-delay'] + NO_TRIP),
 'amex-us-us-blue-cash-everyday': ('Amex · Blue Cash Everyday 官方申请条款页（保障条款）', P + 'supplementary/terms/blue-cash-everyday-credit-card/36182-9-0', ['rental', 'purchase-protection']),
}
made = 0
for pid, (title, url, keys) in CARDS.items():
    sid = f'card-{pid}-terms'
    if any(s['id'] == sid for s in sources):
        raise SystemExit(f'already applied: {sid}')
    sources.append({'id': sid, 'url': url, 'title': title, 'checkedAt': CHECKED, 'authority': 'official'})
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    for key in keys:
        ctype, scenario, basis, zh_title, en_title, zh, en, quotes = SPECS[key]
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
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.amex-us-remaining-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made)
