#!/usr/bin/env python3
"""Record Bilt Rewards transfer partners, its pooling rule and its default point value (#231), checked 2026-11-11.

Runs once and offline, after the batch-10 cards are curated: every value below was read from the public page
named by its source (Bilt's help center transfer article, the Bilt Rewards terms, the Bilt Card 2.0 overview,
Frequent Miler's RRV page and The Points Guy's monthly valuations). A field a page does not state stays null.
Needs opencc-python-reimplemented on PYTHONPATH.

Rates live in the rule's top-level transferRate, not in terms.ratio, as for Membership Rewards and Ultimate Rewards.
"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n_catalog  # noqa: E402
from opencc import OpenCC

CHECKED = '2026-11-11'
REVIEW = '2027-02-09'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda f: json.loads((base / f).read_text())
rules, entities, sources = load('rules.json'), load('entities.json'), load('sources.json')
pooling = load('points-pooling.json')
logos = json.loads((root / 'src/data/logos.json').read_text())
valuations = json.loads((root / 'src/data/point-valuations.json').read_text())
tr = i18n_catalog.load(root)
cc = OpenCC('s2twp')
BILT = 'programme.bilt-rewards'
PRODUCTS = ['bilt-us-bilt-blue-card', 'bilt-us-bilt-obsidian-card', 'bilt-us-bilt-palladium-card']
if any(r['id'].startswith(f'rule.{BILT}.') for r in rules):
    raise SystemExit('already applied')
if not any(e['id'] == BILT for e in entities['programmes']):
    raise SystemExit('curate docs/knowledge/card-batches/batch-10.json first')


def txt(zh, en):
    tr['en-US'][zh] = en
    tr['zh-TW'][zh] = cc.convert(zh).replace('合作伙伴', '合作夥伴')
    return zh


def source(id, url, title, title_en):
    sources.append({'id': id, 'url': url, 'title': txt(title, title_en), 'checkedAt': CHECKED, 'authority': 'official'})
    return id


S_PARTNERS = source('bilt-transfer-partners', 'https://support.biltrewards.com/hc/en-us/articles/19086448638989-Bilt-s-Transfer-Partners', 'Bilt 帮助中心 · 转点伙伴', 'Bilt Help Center · Bilt\'s Transfer Partners')
S_TERMS = source('bilt-rewards-terms', 'https://www.bilt.com/terms', 'Bilt · Bilt Rewards 条款', 'Bilt · Bilt Rewards Terms & Conditions')
S_OVERVIEW = source('bilt-card-2-overview', 'https://support.biltrewards.com/hc/en-us/articles/42897766682381-Bilt-Card-2-0-Program-Overview', 'Bilt 帮助中心 · Bilt Card 2.0 计划概览', 'Bilt Help Center · Bilt Card 2.0 Program Overview')

# Partners Bilt lists that the library does not know yet. Amtrak is rail, so its kind is rail.
for id, name, kind, category in [
    ('programme.virgin-red', 'Virgin Red', 'airline', 'airline'),
    ('programme.turkish-miles-smiles', 'Turkish Airlines Miles&Smiles', 'airline', 'airline'),
    ('programme.tap-miles-go', 'TAP Miles&Go', 'airline', 'airline'),
    ('programme.jal-mileage-bank', 'Japan Airlines Mileage Bank', 'airline', 'airline'),
    ('programme.i-prefer', 'I Prefer Hotel Rewards', 'hotel', 'hotel'),
    ('programme.amtrak-guest-rewards', 'Amtrak Guest Rewards', 'rail', 'reward'),
]:
    if any(e['id'] == id for e in entities['programmes']):
        continue
    entities['programmes'].append({'id': id, 'name': name, 'kind': kind, 'aliases': []})
    # A new brand gets no mark until the owner approves it; the category icon shows instead.
    logos['brands'].append({'id': id.split('.', 1)[1], 'name': name, 'category': category, 'programmeIds': [id], 'titleTokens': [], 'textTokens': [], 'termsUrl': None, 'finding': 'Not checked; no mark is shipped.', 'checkedAt': CHECKED, 'status': 'unapproved', 'approval': None, 'terms': 'unverified', 'logo': None, 'source': None})

# Atmos Rewards is Alaska and Hawaiian Airlines' loyalty programme; Bilt lists it under airlines, so it is one.
next(e for e in entities['programmes'] if e['id'] == 'programme.atmos-rewards')['kind'] = 'airline'

hours = lambda n: {'value': n, 'unit': 'hours', 'qualifier': 'up-to'}
# partner, Bilt points, partner units, time. Bilt's help center article, updated 2026-10-20.
ROWS = [
    ('programme.atmos-rewards', 1, 1), ('programme.avianca-lifemiles', 1, 1), ('programme.united-mileageplus', 1, 1),
    ('programme.jetblue-trueblue', 1, 1), ('programme.air-france-klm-flying-blue', 1, 1), ('programme.virgin-red', 1, 1),
    ('programme.virgin-atlantic-flying-club', 1, 1), ('programme.emirates-skywards', 1, 1), ('programme.the-british-airways-club', 1, 1),
    ('programme.cathay-asia-miles', 1, 1), ('programme.turkish-miles-smiles', 1, 1), ('programme.aer-lingus-aerclub', 1, 1),
    ('programme.iberia-club', 1, 1), ('programme.air-canada-aeroplan', 1, 1), ('programme.tap-miles-go', 1, 1),
    ('programme.southwest-rapid-rewards', 1, 1), ('programme.jal-mileage-bank', 1, 1), ('programme.qatar-privilege-club', 1, 1),
    ('programme.etihad-guest', 1, 1),
    ('programme.hilton-honors', 1, 1), ('programme.marriott-bonvoy', 1, 1), ('programme.world-of-hyatt', 1, 1),
    ('programme.ihg-one-rewards', 1, 1), ('programme.all-accor', 3, 2), ('programme.wyndham-rewards', 1, 1),
    ('programme.i-prefer', 1, 2), ('programme.amtrak-guest-rewards', 2, 1),
]
CHECK_STEPS = [
    txt('转点前在 Bilt App 或网站核对当前比例、最低数量和你的会员等级。', 'Check the current rate, minimum and your Bilt status in the Bilt app or website before transferring.'),
    txt('转点不可撤销，由你自己决定和确认；知识库不代办，也不代表你的账号已关联。', 'Transfers cannot be reversed and are yours to decide and confirm; this library performs nothing and does not show that your accounts are linked.'),
]
SUMMARY = txt('Bilt 帮助中心公布的比例；Blue 等级会员最低转2,000点，Silver 及以上最低1,000点，每次按1,000点递增；多数即时到账，最长48小时。不授予精英会籍。', 'Rate as published in Bilt\'s help center. Minimum 2,000 points for Blue Status members and 1,000 for Silver, Gold or Platinum, in 1,000-point increments; most transfers are immediate, up to 48 hours. Grants no elite status.')
SUMMARY_SW = txt('Bilt 帮助中心公布的比例；Blue 等级会员最低转2,000点，Silver 及以上最低1,000点，每次按1,000点递增；Southwest 最长72小时到账。不授予精英会籍。', 'Rate as published in Bilt\'s help center. Minimum 2,000 points for Blue Status members and 1,000 for Silver, Gold or Platinum, in 1,000-point increments; Southwest transfers take up to 72 hours. Grants no elite status.')


def rule(to, points, units):
    partner = next(e for e in entities['programmes'] if e['id'] == to)
    tr['en-US'].setdefault(partner['name'], partner['name'])
    tr['zh-TW'].setdefault(partner['name'], partner['name'])
    id = f'rule.{BILT}.transfer-{to.split(".", 1)[1]}'
    summary = SUMMARY_SW if to == 'programme.southwest-rapid-rewards' else SUMMARY
    return {
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published',
        'kind': 'transfer-relationship', 'productIds': PRODUCTS, 'market': {'country': 'US', 'issuer': 'Bilt'},
        'category': 'transfer', 'scenarioIds': ['reward-redemption'], 'programmeIds': [BILT, to],
        'content': {'title': partner['name'], 'summary': summary, 'howToUse': CHECK_STEPS},
        # The minimum depends on the member's Bilt status, which the wallet does not know, so only the increment is
        # used in the maths; minimumByStatus keeps both published minimums for display.
        'terms': {'relationship': 'transfer-only', 'fromProgrammeId': BILT, 'toProgrammeId': to, 'ratio': None,
                  'minimumPoints': None, 'minimumByStatus': {'blue': 2000, 'silver-and-above': 1000}, 'incrementPoints': 1000, 'maximumPoints': None,
                  'estimatedTime': hours(72 if to == 'programme.southwest-rapid-rewards' else 48), 'fees': None, 'final': True, 'appliesTo': 'linked-products',
                  'grantsEliteStatus': False, 'accountLinked': None},
        'transferRate': {'rate': {'from': points, 'to': units}, 'condition': None, 'statement': None},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
        'evidence': {'sourceIds': [S_PARTNERS], 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    }


rules.extend(rule(*row) for row in ROWS)

pooling['rules'].append({
    'id': 'pooling.bilt-rewards-us', 'programmeId': BILT, 'bank': 'Bilt', 'region': 'US', 'reading': 'bilt rewards', 'label': 'Bilt Rewards',
    'pooling': 'shared', 'ownerOverride': False, 'checkedAt': CHECKED, 'earningProductIds': [],
    'summary': txt('Bilt Rewards：每人只能有一个 Bilt Rewards 账户，卡、房租和合作商户赚的积分都进这个账户，余额只计一次。', 'Bilt Rewards: each person may hold only one Bilt Rewards account. Points from the card, housing payments and partner merchants all go into it, so the balance is counted once.'),
    'summaryEn': 'Bilt Rewards: each person may hold only one Bilt Rewards account. Points from the card, housing payments and partner merchants all go into it, so the balance is counted once.',
    'caveats': [{'id': 'one-card-per-member', 'summary': txt('每位会员同一时间只能持有一张 Bilt 卡；换卡后积分仍在同一个账户。', 'Each member can hold only one Bilt Card at a time; points stay in the same account after changing cards.'),
                 'summaryEn': 'Each member can hold only one Bilt Card at a time; points stay in the same account after changing cards.', 'sourceIds': [S_OVERVIEW]}],
    'sourceIds': [S_TERMS, S_OVERVIEW],
})

valuations['programmes'].insert(4, {
    'id': 'bilt-rewards', 'name': 'Bilt Rewards', 'knowledgeProgrammeId': BILT, 'region': 'US', 'currency': 'USD', 'unit': 'point', 'cents': 1.55,
    'programmeNames': ['bilt rewards', 'bilt points', 'bilt'], 'cardNames': ['bilt'],
    'source': {'name': 'Frequent Miler RRV', 'url': 'https://frequentmiler.com/reasonable-redemption-values-rrvs/', 'value': 1.55},
    'otherSources': [{'name': 'The Points Guy', 'url': 'https://thepointsguy.com/guide/monthly-valuations/', 'value': 2.2, 'pageDate': '2026-11-02'}],
    'note': 'Lower of the two directly fetched sources (FM RRV 1.55, page modified 2026-10-08; TPG 2.2). TPG discloses that its founder is a Bilt advisor and investor.',
})


def write(path, data, indent=2):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + '\n')


write(base / 'rules.json', rules)
write(base / 'sources.json', sources)
write(base / 'entities.json', entities)
write(base / 'points-pooling.json', pooling)
write(root / 'src/data/point-valuations.json', valuations, indent=1)
write(root / 'src/data/logos.json', logos, indent=1)
i18n_catalog.save(root, tr, 'knowledge')
print('transfer rules', len(ROWS))
