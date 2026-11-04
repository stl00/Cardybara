#!/usr/bin/env python3
"""Record Membership Rewards (US, HK) and Ultimate Rewards transfer terms checked on 2026-11-04.

Runs once and offline: every value below was read from the issuer page named by its source.
A field a page does not state stays null. Needs opencc-python-reimplemented on PYTHONPATH.

Rates live in the rule's top-level transferRate, not in terms.ratio. The assistant receives terms
as is and can only tell a card's rate apart through the deterministic tool planned in #72, so until
then terms.ratio stays null and its answer check keeps rejecting any stated ratio.
"""
import json
from pathlib import Path
from opencc import OpenCC

CHECKED = '2026-11-04'
REVIEW = '2027-02-02'
root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
load = lambda f: json.loads((base / f).read_text())
rules, entities, sources, manifest = load('rules.json'), load('entities.json'), load('sources.json'), load('manifest.json')
tr = json.loads((root / 'src/translations.json').read_text())
products = json.loads((root / 'src/data/card-products.json').read_text())
overrides = json.loads((root / 'src/data/card-product-overrides.json').read_text())
logos = json.loads((root / 'src/data/logos.json').read_text())
cc = OpenCC('s2twp')
if any(r['id'].startswith('rule.programme.') for r in rules):
    raise SystemExit('already applied')


def txt(zh, en):
    tr['en-US'][zh] = en
    tr['zh-TW'][zh] = cc.convert(zh)
    return zh


def source(id, url, title, title_en):
    sources.append({'id': id, 'url': url, 'title': txt(title, title_en), 'checkedAt': CHECKED, 'authority': 'official'})
    return id


S_MR_US = source('mr-us-transfer', 'https://global.americanexpress.com/rewards/transfer', 'Amex US · Membership Rewards 转点页（未登录公开内容）', 'Amex US · Membership Rewards transfer page (public, signed out)')
S_MR_HK = source('mr-hk-transfer', 'https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all', 'Amex HK · Membership Rewards 转点伙伴（Turbo 费率）', 'Amex HK · Membership Rewards transfer partners (Turbo rates)')
S_UR_GUIDE = source('ur-transfer-guide', 'https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points', 'Chase · Ultimate Rewards 转点指南', 'Chase · How to transfer Ultimate Rewards points')
S_UR_CSP = source('ur-csp-benefits', 'https://www.chase.com/sapphire-cards/personal/preferred', 'Chase · Sapphire Preferred 福利页（转点比例）', 'Chase · Sapphire Preferred benefits (transfer rates)')
S_UR_IBP = source('ur-ibp-product', 'https://creditcards.chase.com/business-credit-cards/ink/business-preferred', 'Chase · Ink Business Preferred 产品页（Hyatt 比例）', 'Chase · Ink Business Preferred product page (Hyatt rate)')
S_UR_CSP_AGREEMENT = source('ur-csp-agreement', 'https://asset.chase.com/content/dam/card/rulesregulations/en/RPA0551_0560_Web.pdf', 'Chase · Sapphire Preferred Ultimate Rewards 计划协议', 'Chase · Sapphire Preferred Ultimate Rewards program agreement')
S_UR_AGREEMENT = source('ur-csr-agreement', 'https://asset.chase.com/content/dam/card/rulesregulations/en/RPA0550_Web.pdf', 'Chase · Sapphire Reserve Ultimate Rewards 计划协议', 'Chase · Sapphire Reserve Ultimate Rewards program agreement')


def entity(id, name, kind):
    if not any(e['id'] == id for e in entities['programmes']):
        entities['programmes'].append({'id': id, 'name': name, 'kind': kind, 'aliases': []})
    return id


for id, name, kind, category in [
    ('programme.emirates-skywards', 'Emirates Skywards', 'airline', 'airline'),
    ('programme.qatar-privilege-club', 'Qatar Airways Privilege Club', 'airline', 'airline'),
    ('programme.choice-privileges', 'Choice Privileges', 'hotel', 'hotel'),
    ('programme.leaders-club', 'The Leading Hotels of the World Leaders Club', 'hotel', 'hotel'),
]:
    entity(id, name, kind)
    # A new brand gets no mark until the owner approves it; the category icon shows instead.
    logos['brands'].append({'id': id.split('.', 1)[1], 'name': name, 'category': category, 'programmeIds': [id], 'titleTokens': [], 'textTokens': [], 'termsUrl': None, 'finding': 'Not checked; no mark is shipped.', 'checkedAt': CHECKED, 'status': 'unapproved', 'approval': None, 'terms': 'unverified', 'logo': None, 'source': None})

MR_US, MR_HK, UR = 'programme.amex-membership-rewards-us', 'programme.amex-membership-rewards-hk', 'programme.chase-ultimate-rewards'
hours = lambda n: {'value': n, 'unit': 'hours', 'qualifier': 'estimated'}
days = lambda n, unit='days', q='up-to': {'value': n, 'unit': unit, 'qualifier': q}
EXCISE = {'kind': 'excise-tax-offset', 'perPoint': 0.0006, 'maximum': 99, 'currency': 'USD'}
# partner, points, partner units, increment, maximum, time, fees
US_ROWS = [
    ('programme.aer-lingus-aerclub', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.aeromexico-rewards', 1000, 1600, 1000, 999000, hours(48), []),
    ('programme.air-canada-aeroplan', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.air-france-klm-flying-blue', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.ana-mileage-club', 1000, 1000, 1000, 999000, days(4, 'days', 'estimated'), []),
    ('programme.avianca-lifemiles', 1000, 1000, 1000, 750000, hours(72), []),
    ('programme.cathay-asia-miles', 1000, 800, 1000, 999000, hours(48), []),
    ('programme.choice-privileges', 1000, 1000, 1000, 9999000, hours(48), []),
    ('programme.delta-skymiles', 1000, 1000, 1000, 999000, hours(48), [EXCISE]),
    ('programme.emirates-skywards', 1000, 800, 1000, 999000, hours(48), []),
    ('programme.hilton-honors', 1000, 2000, 1000, 3000000, hours(24), []),
    ('programme.iberia-club', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.jetblue-trueblue', 250, 200, 250, 999750, hours(48), [EXCISE]),
    ('programme.marriott-bonvoy', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.qantas-frequent-flyer', 500, 500, 500, 999500, hours(48), []),
    ('programme.qatar-privilege-club', 1000, 1000, 1000, 750000, hours(48), []),
    ('programme.singapore-airlines-krisflyer', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.the-british-airways-club', 1000, 1000, 1000, 999000, hours(48), []),
    ('programme.leaders-club', 1000, 250, 1000, 999000, hours(72), []),
    ('programme.virgin-atlantic-flying-club', 1000, 1000, 1000, 999000, hours(48), []),
]
QANTAS_HK = {'kind': 'administration', 'amount': 300, 'currency': 'HKD', 'exempt': ['Centurion', 'Corporate']}
# partner, points, partner units, minimum, increment, time, fees, footnote unexplained on page
HK_ROWS = [
    ('programme.cathay-asia-miles', 18000, 1000, 18000, 9000, hours(48), [], False),
    ('programme.malaysia-airlines-enrich', 18000, 1000, 18000, 9000, days(10), [], True),
    ('programme.eva-infinity-mileagelands', 18000, 1000, 18000, 9000, days(10), [], False),
    ('programme.qantas-frequent-flyer', 18000, 1000, 18000, 9000, hours(48), [QANTAS_HK], False),
    ('programme.singapore-krisflyer', 18000, 1000, 18000, 9000, days(15), [], True),
    ('programme.the-british-airways-club', 18000, 1000, 18000, 9000, hours(48), [], True),
    ('programme.virgin-atlantic-flying-club', 18000, 1000, 18000, 9000, hours(48), [], False),
    ('programme.all-accor', 25, 1, 25000, 12500, hours(48), [], False),
    ('programme.hilton-honors', 64, 10, 8000, 8000, hours(48), [], False),
    ('programme.marriott-bonvoy', 9, 1, 9000, 9000, hours(48), [], False),
]
UR_PARTNERS = ['programme.aer-lingus-aerclub', 'programme.the-british-airways-club', 'programme.air-france-klm-flying-blue', 'programme.iberia-club', 'programme.jetblue-trueblue', 'programme.singapore-airlines-krisflyer', 'programme.southwest-rapid-rewards', 'programme.united-mileageplus', 'programme.virgin-atlantic-flying-club', 'programme.air-canada-aeroplan', 'programme.ihg-one-rewards', 'programme.marriott-bonvoy', 'programme.wyndham-rewards']
# The Chase guide names these three cards. Sapphire Reserve for Business names no partner on its page.
CSR, CSP, IBP = 'chase-us-sapphire-reserve', 'chase-us-chase-sapphire-preferred-credit-card', 'chase-us-ink-business-preferred-credit-card'
UR_PRODUCTS = [CSR, CSP, IBP]
MR_US_PRODUCTS = ['amex-us-us-american-express-gold-card', 'amex-us-us-morgan-stanley-platinum-card']
MR_HK_PRODUCTS = ['amex-hk-hk-the-platinum-card', 'amex-hk-hk-american-express-explorer-credit-card']

CHECK_STEPS = [
    txt('转点前在银行转点页核对当前比例、最低数量和费用。', 'Check the current rate, minimum and fees on the issuer transfer page before transferring.'),
    txt('转点通常不可撤销，由你自己决定和确认；知识库不代办，也不代表你的账号已关联。', 'Transfers are usually final and are yours to decide and confirm; this library performs nothing and does not show that your accounts are linked.'),
]
SUMMARY_US = txt('Amex US 转点页公布的比例、最低数量、增量和预计时间；不授予精英会籍。', 'Rate, minimum, increment and estimated time as published on the Amex US transfer page; grants no elite status.')
SUMMARY_US_FEE = txt('Amex US 转点页公布的比例、最低数量、增量和预计时间；转入美国航司计划须付消费税抵销费（每点0.0006美元，上限99美元）。', 'Rate, minimum, increment and estimated time as published by Amex US. Transfers into a U.S. airline program carry an excise tax offset fee of $0.0006 per point, up to $99.')
SUMMARY_HK = txt('Amex HK 只公开 Turbo 计划费率；未登记 Turbo 的费率未公开，须登录查看。999,000 与 9,999,000 两个单笔上限在页面上并存，未采用。', 'Amex HK publishes Turbo Program rates only; other rates require login. The page shows both 999,000 and 9,999,000 as the per-transaction maximum, so neither is used.')
SUMMARY_HK_NOTE = txt('Amex HK 只公开 Turbo 计划费率；未登记 Turbo 的费率未公开。该计划单位带星号，但页面没有对应脚注。', 'Amex HK publishes Turbo Program rates only. The partner unit carries an asterisk with no matching footnote on the page.')
SUMMARY_HK_QANTAS = txt('Amex HK 只公开 Turbo 计划费率；每次转点收取300港元行政费，Centurion及Corporate持卡人除外。', 'Amex HK publishes Turbo Program rates only; a HK$300 administration fee applies per transfer, except for Centurion and Corporate Cardmembers.')
SUMMARY_UR = txt('Chase 没有逐项列明本伙伴比例，因此不计算里程；增量1,000点，多数下一营业日到账，最长7个营业日；可能收取转点费，Chase 会在转点前告知。', 'Chase does not state this partner individually, so no result is computed. Increments of 1,000 points; most process by the next business day, up to 7 business days. A point transfer fee may be charged, and Chase says it will tell you first.')
# Rule text reaches the assistant, so it names no rate: a number here would ground a claim about any card.
SUMMARY_HYATT = txt('Sapphire Preferred 与 Ink Business Preferred 页面公布了 World of Hyatt 的转点比例，2026年10月1日起生效；具体比例见积分页。', 'The Sapphire Preferred and Ink Business Preferred pages publish a World of Hyatt transfer rate, effective October 1, 2026; the points page shows it.')
SUMMARY_HYATT_OTHER = txt('本卡页面没有公布 World of Hyatt 比例；其他卡公布的比例不套用到本卡，须登录转点页核对。', 'This card\'s pages do not state a World of Hyatt rate; a rate published for other cards is not applied here. Check the signed-in transfer page.')


def rule(id, from_id, to_id, product_ids, issuer, country, summary, terms, source_ids, effective_from=None):
    partner = next(e for e in entities['programmes'] if e['id'] == to_id)
    tr['en-US'].setdefault(partner['name'], partner['name'])
    tr['zh-TW'].setdefault(partner['name'], partner['name'])
    terms = dict(terms)
    rate = {'rate': terms.pop('ratio'), 'condition': terms.pop('ratioCondition', None), 'statement': terms.pop('ratioStatement', None)}
    return {
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published',
        'kind': 'transfer-relationship', 'productIds': product_ids, 'market': {'country': country, 'issuer': issuer},
        'category': 'transfer', 'scenarioIds': ['reward-redemption'], 'programmeIds': [from_id, to_id],
        'content': {'title': partner['name'], 'summary': summary, 'howToUse': CHECK_STEPS},
        'terms': {'relationship': 'transfer-only', 'fromProgrammeId': from_id, 'toProgrammeId': to_id, 'ratio': None, **terms, 'grantsEliteStatus': False, 'accountLinked': None},
        'transferRate': rate,
        'validity': {'effectiveFrom': effective_from, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
        'evidence': {'sourceIds': source_ids, 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    }


def slug(id):
    return id.split('.', 1)[1]


new = []
for to, points, units, inc, maximum, time, fees in US_ROWS:
    new.append(rule(f'rule.programme.{slug(MR_US)}.transfer-{slug(to)}', MR_US, to, MR_US_PRODUCTS, 'Amex US', 'US', SUMMARY_US_FEE if fees else SUMMARY_US,
                    {'ratio': {'from': points, 'to': units}, 'ratioCondition': None, 'minimumPoints': points, 'incrementPoints': inc, 'maximumPoints': maximum, 'estimatedTime': time, 'fees': fees, 'final': True, 'appliesTo': 'linked-products'}, [S_MR_US]))
for to, points, units, minimum, inc, time, fees, note in HK_ROWS:
    new.append(rule(f'rule.programme.{slug(MR_HK)}.transfer-{slug(to)}', MR_HK, to, MR_HK_PRODUCTS, 'Amex HK', 'HK', SUMMARY_HK_QANTAS if fees else SUMMARY_HK_NOTE if note else SUMMARY_HK,
                    {'ratio': {'from': points, 'to': units}, 'ratioCondition': 'turbo-program', 'minimumPoints': minimum, 'incrementPoints': inc, 'maximumPoints': None, 'estimatedTime': time, 'fees': fees, 'final': True, 'appliesTo': 'linked-products'}, [S_MR_HK]))
UR_COMMON = {'ratioCondition': None, 'minimumPoints': None, 'incrementPoints': 1000, 'maximumPoints': None, 'estimatedTime': days(7, 'business-days'), 'fees': None, 'feeStatement': 'may-be-charged', 'final': True}
# Stated on the Sapphire Preferred page only; the Ink Business Preferred page says to log in instead.
MOST = {'ratio': {'from': 1, 'to': 1}, 'scope': 'most-partners', 'statedForProductIds': [CSP], 'sourceId': S_UR_CSP}
for to in UR_PARTNERS:
    new.append(rule(f'rule.programme.{slug(UR)}.transfer-{slug(to)}', UR, to, UR_PRODUCTS, 'Chase', 'US', SUMMARY_UR, {'ratio': None, 'ratioStatement': MOST, **UR_COMMON, 'appliesTo': 'linked-products'}, [S_UR_GUIDE, S_UR_CSP, S_UR_AGREEMENT, S_UR_CSP_AGREEMENT]))
HYATT = 'programme.world-of-hyatt'
new.append(rule(f'rule.programme.{slug(UR)}.transfer-{slug(HYATT)}', UR, HYATT, [CSP, IBP], 'Chase', 'US', SUMMARY_HYATT, {'ratio': {'from': 4, 'to': 3}, **UR_COMMON}, [S_UR_CSP, S_UR_IBP, S_UR_GUIDE], effective_from='2026-10-01'))
new.append(rule(f'rule.programme.{slug(UR)}.transfer-{slug(HYATT)}-unstated', UR, HYATT, [CSR], 'Chase', 'US', SUMMARY_HYATT_OTHER, {'ratio': None, **UR_COMMON}, [S_UR_GUIDE, S_UR_AGREEMENT]))

# One rule per programme and partner replaces the per-card copies, which stay in history.
withdrawn = []
for old in rules:
    if old['kind'] != 'transfer-relationship' or old['terms']['fromProgrammeId'] not in (MR_US, MR_HK, UR):
        continue
    next_id = next((r['id'] for r in new if r['terms']['fromProgrammeId'] == old['terms']['fromProgrammeId'] and r['terms']['toProgrammeId'] == old['terms']['toProgrammeId'] and set(old['productIds']) <= set(r['productIds'])), None)
    if not next_id:
        raise SystemExit(f'partner dropped from the official list, decide explicitly: {old["id"]}')
    row = json.loads(json.dumps(old))
    row.update(revision=2, revisionId=f'{old["id"]}@{CHECKED}.2', supersedes=old['revisionId'], status='withdrawn')
    row['terms']['replacedByRuleId'] = next_id
    row['evidence']['checkedAt'] = CHECKED
    row['review'].update(checkedAt=CHECKED, reviewAfter=REVIEW)
    withdrawn.append(row)
rules.extend(withdrawn)
rules.extend(new)

# Which cards reach which programme comes from the issuer pages above, not from card names.
for pid, programme_id, programme, url in [
    *[(p, MR_US, None, None) for p in MR_US_PRODUCTS], *[(p, MR_HK, None, None) for p in MR_HK_PRODUCTS], (CSR, UR, None, None),
    (CSP, UR, 'Ultimate Rewards', 'https://www.chase.com/sapphire-cards/personal/preferred'),
    (IBP, UR, 'Ultimate Rewards', 'https://creditcards.chase.com/business-credit-cards/ink/business-preferred'),
]:
    patch = {'id': pid, 'transferProgrammeId': programme_id}
    if programme:
        patch.update(rewardPrograms=[programme], rewardSource={'url': url, 'checkedAt': CHECKED})
    next(p for p in products['products'] if p['id'] == pid).update({k: v for k, v in patch.items() if k != 'id'})
    overrides.append(patch)

for zh, en, tw in [
    ('仅 Turbo 计划费率', 'Turbo Program rate only', '僅 Turbo 計畫費率'),
    ('官方未逐项列明；以登录后的转点页为准', 'Not stated per partner; check the signed-in transfer page', '官方未逐項列明；以登入後的轉點頁為準'),
    ('未核对；以登录后的转点页为准', 'Not checked; see the signed-in transfer page', '未核對；以登入後的轉點頁為準'),
    ('比例来自发卡行公开页面；没有列明或尚未核对的留空。个人账号关联未核实，不会执行转点。', 'Rates come from public issuer pages; anything not stated or not yet checked stays blank. Account links are unverified and no transfers are performed.', '比例來自發卡行公開頁面；沒有列明或尚未核對的留空。個人帳號關聯未核實，不會執行轉點。'),
]:
    tr['en-US'][zh] = en
    tr['zh-TW'][zh] = tw

manifest['asOf'] = CHECKED
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.transfers-1'
for f, d in [('rules.json', rules), ('entities.json', entities), ('sources.json', sources), ('manifest.json', manifest)]:
    (base / f).write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
for path, d in [('src/translations.json', tr), ('src/data/card-products.json', products), ('src/data/card-product-overrides.json', overrides)]:
    (root / path).write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
(root / 'src/data/logos.json').write_text(json.dumps(logos, ensure_ascii=False, indent=1) + '\n')
names = {e['id']: e['name'] for e in entities['programmes']}
urls = {x['id']: x['url'] for x in sources}
labels = {MR_US: 'MR US', MR_HK: 'MR HK', UR: 'UR'}
fmt = lambda v: f'{v:,}' if v else '—'
doc = [
    '# 转点数据核对（MR US / MR HK / UR）', '',
    '核对日期 2026-11-04，只读公开页面，未登录。比例、门槛和时间照发卡行原样记录，页面没写的留空（—）。转点奖励活动不在范围内。Amex CA 已归档，未核对。', '',
    '## 口径', '',
    '- **MR US**：页面列出的 20 个伙伴全部有比例、最低数量、增量、上限和预计时间。页面只写“转入美国航司计划”收消费税抵销费，这里按 Delta、JetBlue 记录，属于据此判断。',
    '- **MR HK**：只公开 Turbo 计划费率，未登记 Turbo 的费率须登录查看，未记录。页面同时写了 999,000 和 9,999,000 两个单笔上限，无法判断，上限留空。Emirates Skywards 页面写明暂停，不收录。Enrich、KrisFlyer、British Airways 的单位带星号但页面没有脚注。',
    '- **UR 比例**：Sapphire Preferred 页面只说“多数伙伴 1:1”，没有逐项列明；Ink Business Preferred 页面让用户登录查看。因此 13 个伙伴的比例留空，不计算里程。旧新闻稿中的 1:1 属于过去的声明，不当作当前比例。',
    '- **World of Hyatt**：Sapphire Preferred 和 Ink Business Preferred 页面写明 2026-10-01 起 4:3。Sapphire Reserve 的页面没有写，比例留空，不套用其他卡。',
    '- **UR 费用和门槛**：协议写明可能收取转点费，并会在转点前告知，所以费用记为“可能收取”，不是没有。最低数量未写，只写了 1,000 点增量。',
    '- **Sapphire Reserve for Business**：产品页只写“1:1 转到主要酒店和航空计划”，没有列出伙伴，Chase 指南也没有提到这张卡，所以暂不关联伙伴。', '',
    '转点通常不可撤销：两家官方都写明转点后不能退回。伙伴关系不代表已关联账号，也不授予精英会籍。', '',
    '比例记录在 `transferRate`，`terms.ratio` 保持为空：assistant 目前分不清每张卡的比例，要等 #72 的确定性工具接入后才使用这些比例。', '',
    '## 明细', '',
    '| 计划 | 伙伴 | 比例（点→单位） | 最低 | 增量 | 单笔上限 | 预计时间 | 费用 | 来源 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
]
for x in new:
    t, rate = x['terms'], x['transferRate']
    ratio = rate['rate']
    shown = f"{ratio['from']:,} → {ratio['to']:,}" + (' (Turbo)' if rate['condition'] else '') if ratio else '未逐项列明'
    who = ' (Sapphire Reserve)' if x['id'].endswith('-unstated') else ' (Sapphire Preferred / Ink Business Preferred)' if t['toProgrammeId'] == HYATT else ''
    fee = '可能收取' if t.get('feeStatement') else '; '.join(f['kind'] for f in t['fees']) or '—'
    time = t['estimatedTime']
    doc.append(f"| {labels[t['fromProgrammeId']]} | {names[t['toProgrammeId']]}{who} | {shown} | {fmt(t['minimumPoints'])} | {fmt(t['incrementPoints'])} | {fmt(t['maximumPoints'])} | {time['qualifier']} {time['value']} {time['unit']} | {fee} | {urls[x['evidence']['sourceIds'][0]]} |")
(root / 'docs/knowledge/TRANSFER_COVERAGE.md').write_text('\n'.join(doc) + '\n')
print('new rules', len(new), 'withdrawn', len(withdrawn), 'rules', len(rules), 'sources', len(sources))
