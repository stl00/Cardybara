#!/usr/bin/env python3
"""Record trip and purchase protections for Chase personal cards (#304), checked 2026-11-15.

Runs once and offline. Each card's public product page on creditcards.chase.com was read signed out with WebFetch on the
check date, and only the protections that page states are recorded; a protection the page does not state stays absent.
Pages that showed only a "Travel & purchase coverage" heading with no text (United Explorer, United Quest, IHG One
Rewards Premier, Iberia, Disney Inspire, Prime Visa, Amazon Visa) get no rules. Lost luggage reimbursement is stated on
several pages but has no coverage type yet, so it is not recorded here.

The quotes were not checked against a saved copy of the pages: WebFetch returns short fragments, so each quote is one
fragment as it was returned. The guides to benefits were not read, so every rule is `official-summary`.

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

CARDS = {  # product id suffix -> protections the page states (see below)
    'united-gateway-card': ['trip-cancel:1500:6000', 'purchase:500:ny', 'warranty:four', 'rental:secondary:theft'],
    'united-club-card': ['trip-cancel:10000:20000', 'trip-delay', 'baggage-delay:3', 'purchase:10000:ny', 'warranty:four', 'return', 'rental:club'],
    'southwest-rapid-rewards-plus-credit-card': ['baggage-delay:3', 'purchase:500:ny', 'warranty:four'],
    'southwest-rapid-rewards-priority-credit-card': ['baggage-delay:3', 'purchase:500:ny', 'warranty:four'],
    'southwest-rapid-rewards-premier-credit-card': ['baggage-delay:3', 'purchase:500:ny', 'warranty:four'],
    'marriott-bonvoy-bold-credit-card': ['trip-delay', 'baggage-delay:5', 'purchase:500:ny'],
    'marriott-bonvoy-boundless-credit-card': ['trip-delay', 'baggage-delay:5', 'purchase:500'],
    'marriott-bonvoy-bountiful-credit-card': ['trip-delay', 'baggage-delay:5', 'purchase:500'],
    'ihg-one-rewards-credit-card': ['trip-cancel:5000:10000', 'baggage-delay:3', 'purchase:500:ny'],
    'world-of-hyatt-credit-card': ['trip-cancel:5000:10000', 'baggage-delay:5', 'purchase:500:ny', 'rental:secondary:theft'],
    'british-airways-visa-signature-credit-card': ['baggage-delay:3', 'purchase:500:ny', 'warranty:four'],
    'aer-lingus-visa-signature-credit-card': ['baggage-delay:3', 'purchase:500', 'warranty:four'],
    'air-canada-aeroplan-card': ['trip-cancel:1500:6000', 'trip-delay', 'baggage-delay:3', 'purchase:500:ny', 'rental:secondary', 'roadside'],
    'disney-visa-card': ['baggage-delay:3', 'purchase:500', 'warranty:four'],
    'disney-premier-visa-card': ['baggage-delay:3', 'purchase:500:ny', 'warranty'],
    'chase-freedom-flex-credit-card': ['trip-cancel:1500:6000', 'purchase:500', 'warranty', 'rental:secondary'],
    'chase-freedom-rise-credit-card': ['trip-cancel:1500:6000', 'purchase:500', 'warranty:four'],
}
NOT_STATED_ONLY = ['united-explorer-card', 'united-quest', 'ihg-premier', 'iberia-visa-signature-credit-card', 'disney-inspire-visa-card', 'prime-visa', 'amazon-visa']

NOTE_ZH = '保障摘要；付款、事故、地域和理赔条件须查完整保障指南。'
HOW_ZH = '该条目仅为保障摘要；核对完整保障指南、除外责任和所需证明后再判断。'
HOW_EN = 'This is a summary of the coverage; the Guide to Benefits controls. Check eligibility, exclusions and claim requirements before relying on it.'
assert NOTE_ZH in tr['en-US']

LIMITED = {'trip-cancellation': 'travel', 'trip-delay': 'travel', 'baggage-delay': 'travel', 'purchase-protection': 'shopping',
           'extended-warranty': 'shopping', 'return-protection': 'shopping', 'rental-car': 'ground-transport', 'roadside': 'ground-transport'}
TITLES = {  # coverage type -> (zh title, en title), the same wording the Sapphire rules use
    'trip-cancellation': ('旅行取消／中断保障', 'Trip Cancellation and Interruption Insurance'),
    'trip-delay': ('旅行延误保障', 'Trip Delay Reimbursement'),
    'baggage-delay': ('行李延误保障', 'Baggage Delay Insurance'),
    'purchase-protection': ('购物保护', 'Purchase Protection'),
    'extended-warranty': ('延长保修', 'Extended Warranty'),
    'return-protection': ('退货保护', 'Return Protection'),
    'rental-car': ('租车损坏保障', 'Auto Rental Coverage'),
    'roadside': ('道路救援', 'Roadside Assistance'),
}
TRIP_Q = 'if your trip is canceled or cut short by sickness, severe weather or other covered situations'
DECLINE_Q = "Decline the rental company's collision insurance and charge the entire rental cost to your card."
SECONDARY_Q = 'In the U.S., coverage is secondary to your personal insurance.'
THEFT_Q = 'Coverage provides reimbursement for theft and collision damage for most rental vehicles.'
NY_PURCHASE_Q = 'coverage period is 90 days from the date of purchase'
FOUR_Q = 'on eligible warranties of three years or less, up to four years from the date of purchase'
WARRANTY_Q = "Extends the time period of the manufacturer's U.S. warranty by an additional year"
NY_RENTAL_Q = 'inside the United States coverage is secondary to your personal automobile insurance'
usd = lambda n: f'${int(n):,}'


def make(spec_text):
    """Return (coverage type, key, scenario, zh summary, en summary, quotes, coverage terms) for one protection."""
    name, *args = spec_text.split(':')
    cov = {'basis': None, 'requiresCardPayment': None, 'exclusions': []}
    if name == 'trip-cancel':
        per, trip = usd(args[0]), usd(args[1])
        return ('trip-cancellation', 'trip-cancel',
                f'旅行因疾病、恶劣天气等承保情形取消或中断时可获报销，每位受保旅客最高 {per}、每次旅行最高 {trip}。{NOTE_ZH}',
                f'Reimbursement when a trip is canceled or cut short by a covered situation, up to {per} per covered traveler and {trip} per trip.',
                [TRIP_Q, f'you can be reimbursed up to {per} per covered traveler and {trip} per trip'], cov)
    if name == 'trip-delay':
        return ('trip-delay', 'trip-delay',
                f'公共承运人行程延误超过 12 小时或需要过夜时，报销未获补偿的餐饮、住宿等费用，每位受保旅客最高 $500。{NOTE_ZH}',
                'Covers unreimbursed expenses such as meals and lodging when common carrier travel is delayed more than 12 hours or requires an overnight stay, up to $500 per covered traveler.',
                ['If your common carrier travel is delayed more than 12 hours or requires an overnight stay',
                 'unreimbursed expenses, such as meals and lodging, up to $500 per covered traveler'], cov)
    if name == 'baggage-delay':
        days = args[0]
        return ('baggage-delay', 'baggage-delay',
                f'行李延误超过 6 小时，可报销必需品的购买费用，每天最高 $100，最多 {days} 天。{NOTE_ZH}',
                f'Reimburses essential purchases when baggage is delayed over 6 hours, up to $100 a day for up to {days} days.',
                [f'Reimburses you up to $100 a day for up to {days} days for essential purchases', 'when baggage is delayed over 6 hours.'], cov)
    if name == 'purchase':
        limit, ny = usd(args[0]), 'ny' in args
        quotes = [f'Covers your eligible new purchases for 120 days from the date of purchase against damage or theft up to {limit} per item.']
        zh = f'新购的合资格商品自购买日起 120 天内因损坏或被盗可获赔，每件最高 {limit}。'
        en = f'Covers eligible new purchases against damage or theft for 120 days from the date of purchase, up to {limit} per item.'
        if ny:
            quotes.append(NY_PURCHASE_Q)
            zh += '纽约州居民的保障期为 90 天。'
            en += ' For New York residents the coverage period is 90 days.'
        return ('purchase-protection', 'purchase', zh + NOTE_ZH, en, quotes, cov)
    if name == 'warranty':
        four = 'four' in args
        quotes = [WARRANTY_Q] + ([FOUR_Q] if four else [])
        zh = '在制造商美国保修期的基础上再延长一年。' + ('适用于三年以内的合资格保修，自购买日起最长四年。' if four else '')
        en = "Extends the manufacturer's U.S. warranty by an additional year." + (' Applies to eligible warranties of three years or less, up to four years from the date of purchase.' if four else '')
        return ('extended-warranty', 'warranty', zh + NOTE_ZH, en, quotes, cov)
    if name == 'return':
        return ('return-protection', 'return',
                f'商店不接受的合资格商品，购买后 90 天内可获报销，每件最高 $500，每 12 个月最高 $1,000。{NOTE_ZH}',
                "Reimbursement for eligible items the store won't accept within 90 days of purchase, up to $500 per item and $1,000 per 12-month period.",
                ["You can be reimbursed for eligible items that the store won't accept within 90 days of purchase", 'up to $500 per item, $1,000 per 12-month period'], cov)
    if name == 'roadside':
        return ('roadside', 'roadside',
                f'遇到道路紧急情况时，致电服务商派遣所需的救援。官网摘要没写费用和次数。{NOTE_ZH}',
                'Call the service provider to dispatch help in a roadside emergency. The summary does not state fees or limits.',
                ['If you have a roadside emergency, call the service provider to dispatch the help you need.'], cov)
    if name == 'rental' and args[0] == 'club':
        cov = {'basis': 'primary', 'requiresCardPayment': None, 'exclusions': [NY_RENTAL_Q]}
        return ('rental-car', 'rental',
                f'本卡为主要保障，被盗和碰撞损失最高赔付 $60,000，适用于多数 MSRP 不超过 $125,000 的租赁车辆；纽约州居民在美国境内为个人汽车保险的次要保障。官网摘要此处没写付款要求。{NOTE_ZH}',
                'Primary coverage reimbursing theft and collision damage up to $60,000 on most rental vehicles with an MSRP of $125,000 or less; for New York residents inside the United States it is secondary to personal automobile insurance. The summary does not state a payment requirement here.',
                ['Coverage is primary and provides reimbursement up to $60,000 for theft and collision damage',
                 'for most rental vehicles with an MSRP of $125,000 or less', NY_RENTAL_Q + '.'], cov)
    if name == 'rental':
        theft = 'theft' in args
        cov = {'basis': 'secondary', 'basisScope': 'In the U.S.', 'requiresCardPayment': True, 'exclusions': []}
        return ('rental-car', 'rental',
                '拒绝租车公司的碰撞险并用本卡支付全部租金时提供租车保障' + ('，报销多数租赁车辆的被盗和碰撞损失' if theft else '') + f'；在美国境内是个人保险的次要保障。{NOTE_ZH}',
                "Rental car coverage when you decline the rental company's collision insurance and charge the entire rental to the card" + (', reimbursing theft and collision damage on most rental vehicles' if theft else '') + '; in the U.S. it is secondary to personal insurance.',
                [DECLINE_Q] + ([THEFT_Q] if theft else []) + [SECONDARY_Q], cov)
    raise SystemExit(f'unknown spec {spec_text}')


def txt(zh, en):
    tr['en-US'].setdefault(zh, en)
    tr['zh-TW'].setdefault(zh, batch_script.traditional(zh))
    return zh


problems, made = [], 0
for suffix, specs in CARDS.items():
    pid = f'chase-us-{suffix}'
    source_id = f'card-{pid}'
    assert any(s['id'] == source_id for s in sources), source_id  # the page's existing source; its checkedAt stays
    market = next(r['market'] for r in rules if r['id'] == f'rule.{pid}.fee-primary')
    for spec_text in specs:
        ctype, key, zh, en, quotes, coverage = make(spec_text)
        id = f'rule.{pid}.{key}'
        if any(r['id'] == id for r in rules):
            raise SystemExit(f'already applied: {id}')
        problems += [f'{id}: quote too long: {q}' for q in quotes if len(q.split()) > 22]
        zh_title, en_title = TITLES[ctype]
        rules.append({
            'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'benefit',
            'productIds': [pid], 'market': market, 'category': 'protection', 'scenarioIds': [LIMITED[ctype]], 'programmeIds': [],
            'content': {'title': zh_title, 'summary': txt(zh, en), 'howToUse': [zh, txt(HOW_ZH, HOW_EN)], 'translatedFrom': 'en-US'},
            'original': {'lang': 'en-US', 'title': en_title, 'summary': en, 'howToUse': [HOW_EN],
                         'quotes': [{'sourceId': source_id, 'text': q} for q in quotes]},
            'terms': {'category': 'protection', 'period': 'event-based', 'amount': None, 'currency': None,
                      'coverage': {'type': ctype, **coverage}},
            'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': zh},
            'evidence': {'sourceIds': [source_id], 'checkedAt': CHECKED, 'verification': 'official-summary',
                         'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
        })
        made += 1
if problems:
    raise SystemExit('\n'.join(problems))
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.chase-protections-1'
manifest['asOf'] = CHECKED
write(base / 'rules.json', rules)
write(base / 'manifest.json', manifest)
i18n_catalog.save(root, tr, 'knowledge')
print('rules added', made, 'cards', len(CARDS), 'pages with no stated protection', len(NOT_STATED_ONLY))
