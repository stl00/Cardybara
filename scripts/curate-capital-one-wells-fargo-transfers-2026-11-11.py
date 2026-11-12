#!/usr/bin/env python3
"""Record Capital One Miles transfer partners and what Wells Fargo publishes about points transfer (#182), checked 2026-11-11.

Runs once and offline. Every value was read signed out with WebFetch from the pages named below.

Capital One: its article "Capital One transfer partners" lists 19 airline and 4 hotel partners with a ratio for each,
says "you must have at least 1,000 Capital One rewards miles" to transfer, and says miles cannot be transferred back.
It states no increment, maximum, timing or fee, so those stay null. The Venture, Venture X and Venture X Business
product pages each say miles transfer to "15+" loyalty programmes or partners, so the routes are linked to those three.
The article writes some partners by company name (Copa, EVA Air, JetBlue); each is recorded as that company's own
programme. A ratio written 2:1.5 is stored as 4:3, the same rate in whole numbers.

Wells Fargo: the Autograph Journey product page says "Transfer your points directly to select travel loyalty programs,
in any amount" and that transfers are final; its terms summary says one point equals one partner unit "unless we state
otherwise". No signed-out Wells Fargo page names a partner (wellsfargo.com/rewardsterms redirects to a rewards site that
returned no content), so no partner is recorded and the card gets no transfer link. Third-party lists are not used.
"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n_catalog  # noqa: E402

CHECKED = '2026-11-11'
REVIEW = '2027-02-09'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda p: json.loads(p.read_text())
rules, entities, sources, manifest = (load(base / f) for f in ('rules.json', 'entities.json', 'sources.json', 'manifest.json'))
products, overrides = load(root / 'src/data/card-products.json'), load(root / 'src/data/card-product-overrides.json')
logos = load(root / 'src/data/logos.json')
tr = i18n_catalog.load(root)
C1 = 'programme.capital-one-miles'
VENTURE, VENTURE_X, VENTURE_X_BIZ = 'capital-one-us-venture-rewards-credit-card', 'capital-one-us-venture-x-rewards-credit-card', 'capital-one-us-venture-x-business-card'
PRODUCTS = [VENTURE, VENTURE_X, VENTURE_X_BIZ]
JOURNEY = 'wells-fargo-us-autograph-journey-visa-card'
if any(r['id'].startswith(f'rule.{C1}.') for r in rules):
    raise SystemExit('already applied')


def txt(zh, en, tw):
    tr['en-US'][zh] = en
    tr['zh-TW'][zh] = tw
    return zh


S_PARTNERS = 'capital-one-miles-transfer'
sources.append({'id': S_PARTNERS, 'url': 'https://www.capitalone.com/learn-grow/money-management/venture-miles-transfer-partnerships/',
                'title': txt('Capital One · 转点伙伴说明', 'Capital One · Capital One transfer partners', 'Capital One · 轉點夥伴說明'),
                'checkedAt': CHECKED, 'authority': 'official'})
PRODUCT_SOURCES = [f'card-{p}' for p in PRODUCTS]
for s in sources:
    if s['id'] in PRODUCT_SOURCES + [f'card-{JOURNEY}']:
        s['checkedAt'] = CHECKED
assert all(any(s['id'] == x for s in sources) for x in PRODUCT_SOURCES)

# Partners the library does not know yet. A new brand gets no mark until the owner approves it.
for id, name in [('programme.finnair-plus', 'Finnair Plus'), ('programme.copa-connectmiles', 'Copa Airlines ConnectMiles')]:
    assert not any(e['id'] == id for e in entities['programmes'])
    entities['programmes'].append({'id': id, 'name': name, 'kind': 'airline', 'aliases': []})
    logos['brands'].append({'id': id.split('.', 1)[1], 'name': name, 'category': 'airline', 'programmeIds': [id], 'titleTokens': [], 'textTokens': [], 'termsUrl': None,
                            'finding': 'Not checked; no mark is shipped.', 'checkedAt': CHECKED, 'status': 'unapproved', 'approval': None, 'terms': 'unverified', 'logo': None, 'source': None})

# partner, Capital One miles, partner units. In the order the article lists them.
ROWS = [
    ('programme.aeromexico-rewards', 1, 1), ('programme.air-canada-aeroplan', 1, 1), ('programme.avianca-lifemiles', 1, 1),
    ('programme.the-british-airways-club', 1, 1), ('programme.cathay-asia-miles', 1, 1), ('programme.etihad-guest', 1, 1),
    ('programme.finnair-plus', 1, 1), ('programme.air-france-klm-flying-blue', 1, 1), ('programme.qantas-frequent-flyer', 1, 1),
    ('programme.qatar-privilege-club', 1, 1), ('programme.singapore-airlines-krisflyer', 1, 1), ('programme.tap-miles-go', 1, 1),
    ('programme.turkish-miles-smiles', 1, 1), ('programme.virgin-red', 1, 1),
    # Written 2:1.5 on the page.
    ('programme.copa-connectmiles', 4, 3), ('programme.emirates-skywards', 4, 3), ('programme.eva-infinity-mileagelands', 4, 3), ('programme.jal-mileage-bank', 4, 3),
    ('programme.jetblue-trueblue', 5, 3),
    ('programme.choice-privileges', 1, 1), ('programme.wyndham-rewards', 1, 1), ('programme.i-prefer', 1, 2), ('programme.all-accor', 2, 1),
]
assert len({r[0] for r in ROWS}) == 23
SUMMARY = txt('Capital One 官方转点文章公布的比例；账户至少要有1,000英里才能转，转出后不能转回。增量、到账时间和费用页面没有写。不授予精英会籍。',
              "Rate as published in Capital One's transfer partner article. You need at least 1,000 miles to transfer, and miles cannot be transferred back. The page does not state the increment, timing or fees. Grants no elite status.",
              'Capital One 官方轉點文章公布的比例；帳戶至少要有1,000英里才能轉，轉出後不能轉回。增量、到帳時間和費用頁面沒有寫。不授予精英會籍。')
SUMMARY_CHOICE = txt('Capital One 官方转点文章公布的比例；只能转入美国的 Choice Privileges 会员账户。账户至少要有1,000英里才能转，转出后不能转回。增量、到账时间和费用页面没有写。不授予精英会籍。',
                     "Rate as published in Capital One's transfer partner article. Miles transfer only to U.S.-based Choice Privileges accounts. You need at least 1,000 miles to transfer, and miles cannot be transferred back. The page does not state the increment, timing or fees. Grants no elite status.",
                     'Capital One 官方轉點文章公布的比例；只能轉入美國的 Choice Privileges 會員帳戶。帳戶至少要有1,000英里才能轉，轉出後不能轉回。增量、到帳時間和費用頁面沒有寫。不授予精英會籍。')
# Existing wording shared with the Ultimate Rewards and ThankYou rules.
CHECK_STEPS = ['转点前在银行转点页核对当前比例、最低数量和费用。', '转点通常不可撤销，由你自己决定和确认；知识库不代办，也不代表你的账号已关联。']
assert all(s in tr['en-US'] and s in tr['zh-TW'] for s in CHECK_STEPS)


def rule(to, miles, units):
    partner = next(e for e in entities['programmes'] if e['id'] == to)
    tr['en-US'].setdefault(partner['name'], partner['name'])
    tr['zh-TW'].setdefault(partner['name'], partner['name'])
    id = f'rule.{C1}.transfer-{to.split(".", 1)[1]}'
    summary = SUMMARY_CHOICE if to == 'programme.choice-privileges' else SUMMARY
    return {
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published',
        'kind': 'transfer-relationship', 'productIds': PRODUCTS, 'market': {'country': 'US', 'issuer': 'Capital One'},
        'category': 'transfer', 'scenarioIds': ['reward-redemption'], 'programmeIds': [C1, to],
        'content': {'title': partner['name'], 'summary': summary, 'howToUse': CHECK_STEPS},
        # The article states the 1,000-mile floor and that transfers are final; increment, maximum, timing and fees are not published.
        'terms': {'relationship': 'transfer-only', 'fromProgrammeId': C1, 'toProgrammeId': to, 'ratio': None,
                  'minimumPoints': 1000, 'incrementPoints': None, 'maximumPoints': None, 'estimatedTime': None, 'fees': None,
                  'final': True, 'appliesTo': 'linked-products', 'grantsEliteStatus': False, 'accountLinked': None},
        'transferRate': {'rate': {'from': miles, 'to': units}, 'condition': None, 'statement': None},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
        'evidence': {'sourceIds': [S_PARTNERS, *PRODUCT_SOURCES], 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    }


rules.extend(rule(*row) for row in ROWS)

C1_OLD = '转点伙伴和比例尚未核对。'
C1_EN = "Capital One's pages do not state the transfer increment, timing or fees; partners and rates are recorded from its transfer partner article."
C1_GAP = txt('转点增量、到账时间和费用 Capital One 官方页面没有写；伙伴和比例已按官方转点文章记录。', C1_EN,
             '轉點增量、到帳時間和費用 Capital One 官方頁面沒有寫；夥伴和比例已按官方轉點文章記錄。')
WF_OLD = '转点伙伴和比例尚未核对；页面写明可以转到部分旅行计划。'
WF_EN = ("Wells Fargo's signed-out pages name no transfer partner, so none is recorded. They say points transfer to select travel loyalty programmes in any amount, "
         'that transfers are final, and that one point equals one partner unit unless stated otherwise.')
WF_GAP = txt('Wells Fargo 未登录的官方页面没有列出转点伙伴，因此不记录伙伴；页面只写可转到部分旅行会员计划、数量不限、转后不可撤销，条款写默认1点换1单位（另有说明除外）。', WF_EN,
             'Wells Fargo 未登入的官方頁面沒有列出轉點夥伴，因此不記錄夥伴；頁面只寫可轉到部分旅行會員計劃、數量不限、轉後不可撤銷，條款寫預設1點換1單位（另有說明除外）。')


def replace_gap(pid, old, new, new_en, batch_file):
    gaps = manifest['profileMetadata'][pid]['knowledgeGaps']
    gaps[gaps.index(old)] = new
    path = root / 'docs/knowledge/card-batches' / batch_file
    batch = load(path)
    unknown = next(c for c in batch['cards'] if c['id'] == pid)['unknown']
    next(u for u in unknown if u['zh'] == old).update(zh=new, en=new_en)
    path.write_text(json.dumps(batch, ensure_ascii=False, indent=2) + '\n')


for pid in PRODUCTS:
    next(p for p in products['products'] if p['id'] == pid)['transferProgrammeId'] = C1
    next(p for p in overrides if p['id'] == pid)['transferProgrammeId'] = C1
    replace_gap(pid, C1_OLD, C1_GAP, C1_EN, 'batch-02.json')
replace_gap(JOURNEY, WF_OLD, WF_GAP, WF_EN, 'batch-05.json')
for old in (C1_OLD, WF_OLD):
    assert not any(old in m.get('knowledgeGaps', []) for m in manifest['profileMetadata'].values()), old
    for language in tr.values():
        language.pop(old, None)
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.capital-one-1'


def write(path, data, indent=2):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + '\n')


for f, d in [('rules.json', rules), ('sources.json', sources), ('entities.json', entities), ('manifest.json', manifest)]:
    write(base / f, d)
write(root / 'src/data/card-products.json', products)
write(root / 'src/data/card-product-overrides.json', overrides)
write(root / 'src/data/logos.json', logos, indent=1)
i18n_catalog.save(root, tr, 'knowledge')
coverage = root / 'docs/knowledge/US_CARD_COVERAGE.md'
text = coverage.read_text()
assert text.count(C1_OLD) == 3 and text.count(WF_OLD) == 1
coverage.write_text(text.replace(WF_OLD, WF_GAP).replace(C1_OLD, C1_GAP))
print('transfer rules', len(ROWS))
