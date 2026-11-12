#!/usr/bin/env python3
"""Record Citi ThankYou transfer partners as Citi publishes them (#181), checked 2026-11-11.

Runs once and offline. Source: the signed-out Citi Strata Premier and Citi Strata Elite product pages. Both say
"Points transfer to American Airlines, JetBlue, Virgin Atlantic, Cathay, Eva Air, Choice Hotels, The Leading Hotels
of the World® and others" and "The minimum transfer is only 1,000 points." Neither states a rate, an increment, a
maximum, timing or fees, so those stay null and conversion maths stays blocked. The partners behind "and others" are
not recorded. The Citi Double Cash page does not mention point transfers, so that card gets no transfer link.
thankyou.com's partner list returned no content to a signed-out reader and was not used.

The pages name airlines and hotel groups, not loyalty programmes; each is recorded as that company's own programme.
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
batch_path = root / 'docs/knowledge/card-batches/batch-02.json'
batch = load(batch_path)
tr = i18n_catalog.load(root)
TY = 'programme.citi-thankyou'
PREMIER, ELITE = 'citi-us-citi-strata-premier-card', 'citi-us-citi-strata-elite-card'
PRODUCTS = [PREMIER, ELITE]
SOURCES = [f'card-{p}' for p in PRODUCTS]
if any(r['id'].startswith(f'rule.{TY}.') for r in rules):
    raise SystemExit('already applied')
assert all(any(s['id'] == x for s in sources) for x in SOURCES)


def txt(zh, en, tw):
    tr['en-US'][zh] = en
    tr['zh-TW'][zh] = tw
    return zh


SUMMARY = txt('Citi 产品页列出本伙伴，但没有写比例，因此不计算里程；最低转1,000点。增量、到账时间和费用页面没有写。不授予精英会籍。',
              "Citi's product page names this partner but states no rate, so no miles are computed. The minimum transfer is 1,000 points. The page does not state the increment, timing or fees. Grants no elite status.",
              'Citi 產品頁列出本夥伴，但沒有寫比例，因此不計算里程；最低轉1,000點。增量、到帳時間和費用頁面沒有寫。不授予精英會籍。')
OLD_GAP = 'ThankYou 转点伙伴和比例尚未核对。'
GAP_EN = 'The product page does not state ThankYou transfer rates, increments or timing; it names some partners and a 1,000-point minimum.'
GAP = txt('ThankYou 转点比例、增量和到账时间官方产品页没有写；只列出部分伙伴和最低1,000点。', GAP_EN,
          'ThankYou 轉點比例、增量和到帳時間官方產品頁沒有寫；只列出部分夥伴和最低1,000點。')
# Existing wording shared with the Ultimate Rewards rules.
CHECK_STEPS = ['转点前在银行转点页核对当前比例、最低数量和费用。', '转点通常不可撤销，由你自己决定和确认；知识库不代办，也不代表你的账号已关联。']
assert all(s in tr['en-US'] and s in tr['zh-TW'] for s in CHECK_STEPS)
# In the order the pages name them.
PARTNERS = ['programme.aadvantage', 'programme.jetblue-trueblue', 'programme.virgin-atlantic-flying-club', 'programme.cathay-asia-miles',
            'programme.eva-infinity-mileagelands', 'programme.choice-privileges', 'programme.leaders-club']


def rule(to):
    partner = next(e for e in entities['programmes'] if e['id'] == to)
    id = f'rule.{TY}.transfer-{to.split(".", 1)[1]}'
    return {
        'id': id, 'revision': 1, 'revisionId': f'{id}@{CHECKED}.1', 'supersedes': None, 'status': 'published',
        'kind': 'transfer-relationship', 'productIds': PRODUCTS, 'market': {'country': 'US', 'issuer': 'Citi US'},
        'category': 'transfer', 'scenarioIds': ['reward-redemption'], 'programmeIds': [TY, to],
        'content': {'title': partner['name'], 'summary': SUMMARY, 'howToUse': CHECK_STEPS},
        # Only the partner and the minimum are published. final is null because the pages do not say a transfer is irreversible.
        'terms': {'relationship': 'transfer-only', 'fromProgrammeId': TY, 'toProgrammeId': to, 'ratio': None,
                  'minimumPoints': 1000, 'incrementPoints': None, 'maximumPoints': None, 'estimatedTime': None, 'fees': None,
                  'final': None, 'appliesTo': 'linked-products', 'grantsEliteStatus': False, 'accountLinked': None},
        'transferRate': {'rate': None, 'condition': None, 'statement': None},
        'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
        'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': SUMMARY},
        'evidence': {'sourceIds': SOURCES, 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'terms', 'validity'], 'fullTermsReviewed': False},
        'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW, 'state': 'reviewed-summary'},
        'personalState': 'not-in-public-knowledge',
    }


rules.extend(rule(to) for to in PARTNERS)
for s in sources:
    if s['id'] in SOURCES:
        s['checkedAt'] = CHECKED
for pid in PRODUCTS:
    next(p for p in products['products'] if p['id'] == pid)['transferProgrammeId'] = TY
    next(p for p in overrides if p['id'] == pid)['transferProgrammeId'] = TY
    gaps = manifest['profileMetadata'][pid]['knowledgeGaps']
    gaps[gaps.index(OLD_GAP)] = GAP
    unknown = next(c for c in batch['cards'] if c['id'] == pid)['unknown']
    next(u for u in unknown if u['zh'] == OLD_GAP).update(zh=GAP, en=GAP_EN)
for language in tr.values():
    language.pop(OLD_GAP, None)
manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.thankyou-1'


def write(path, data, indent=2):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + '\n')


for f, d in [('rules.json', rules), ('sources.json', sources), ('manifest.json', manifest)]:
    write(base / f, d)
write(root / 'src/data/card-products.json', products)
write(root / 'src/data/card-product-overrides.json', overrides)
write(batch_path, batch)
i18n_catalog.save(root, tr, 'knowledge')
coverage = root / 'docs/knowledge/US_CARD_COVERAGE.md'
text = coverage.read_text()
assert text.count(OLD_GAP) == 2
coverage.write_text(text.replace(OLD_GAP, GAP))
print('transfer rules', len(PARTNERS))
