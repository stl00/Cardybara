#!/usr/bin/env python3
"""Barclays US records that a card batch cannot carry (#681).

Two things, both read on CHECKED from public, signed-out issuer pages:
- cards Barclays names on its own pages but whose product facts could not be read: catalogue names only;
- the foreign transaction fee each batch-22 product page states.
Offline by design; rerunning is not a new check. Run after curate-card-batch.py on batch-22.

  python3 scripts/curate-barclays-2026-11-27.py
"""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts'))
import i18n_catalog  # noqa: E402

base = root / 'src/data/knowledge'
CHECKED, REVIEW_AFTER = '2026-11-27', '2027-02-25'
SITE = 'https://cards.barclaycardus.com/banking/'
CONTACT = SITE + 'contact-us/'
VIP = SITE + 'about-us/newsroom/barclays-and-priceline-introduce-the-priceline-vip-rewards-visa-card/'

# (name, aliases, reward programme, source page). The contact page lists the cards Barclays services; it does not
# say which of them still take applications.
NAMES_ONLY = [
    ('AAdvantage Aviator Red World Elite Mastercard', ['AAdvantage Aviator Red', 'AAdvantage Aviator Red Mastercard', 'Aviator Red'], 'American Airlines AAdvantage', CONTACT),
    ('AAdvantage Aviator World Elite Business Mastercard', ['AAdvantage Aviator Business', 'AAdvantage Aviator Business Mastercard'], 'American Airlines AAdvantage', CONTACT),
    ('Hawaiian Airlines World Elite Mastercard', ['Hawaiian Airlines Mastercard', 'Hawaiian Airlines'], None, CONTACT),
    ('Hawaiian Airlines World Elite Business Mastercard', ['Hawaiian Airlines Business Mastercard', 'Hawaiian Airlines Business'], None, CONTACT),
    ('Frontier Airlines Business Mastercard', ['Frontier Business Mastercard'], None, CONTACT),
    ('Holland America Line Rewards Visa Card', ['Holland America Line Visa Card', 'Holland America Line Rewards', 'Holland America'], None, CONTACT),
    ('Princess Cruises Rewards Visa Card', ['Princess Cruises Visa', 'Princess Rewards Visa Card', 'Princess Cruises'], None, CONTACT),
    ('Priceline Rewards Visa Card', ['Priceline Rewards', 'Priceline Rewards Visa'], None, CONTACT),
    ('Priceline VIP Rewards Visa Card', ['Priceline VIP Rewards', 'Priceline VIP Rewards Visa'], None, VIP),
]

# batch-22 card slug -> (rate, issuer wording). A card whose page did not state the fee is not here.
NONE_WORDS, ZERO_PERCENT, THREE = 'No foreign transaction fees on international purchases.', 'Foreign transaction fee: 0%.', 'Foreign transaction fee: 3%.'
FEES = {slug: (0, ZERO_PERCENT) for slug in (
    'jetblue-card', 'jetblue-plus-card', 'jetblue-premier-card', 'wyndham-rewards-earner-card', 'emirates-skywards-rewards-world-elite-mastercard',
    'miles-more-world-elite-mastercard', 'frontier-airlines-world-mastercard', 'upromise-world-mastercard', 'capital-vacations-world-mastercard')}
FEES.update({slug: (0, NONE_WORDS) for slug in (
    'jetblue-business-card', 'wyndham-rewards-earner-plus-card', 'wyndham-rewards-earner-premier-card', 'wyndham-rewards-earner-business-card',
    'aarp-travel-rewards-mastercard', 'carnival-rewards-mastercard', 'rci-elite-rewards-world-mastercard')})
FEES['emirates-skywards-premium-world-elite-mastercard'] = (0, 'No foreign transaction fees')
FEES['breeze-easy-visa-credit-card'] = (0, 'No foreign transaction fees.')
FEES.update({slug: (3, THREE) for slug in ('aarp-essential-rewards-mastercard', 'gm-rewards-mastercard', 'gm-business-mastercard', 'barnes-noble-mastercard', 'xbox-mastercard')})


def main():
    read = lambda path: json.loads(path.read_text())
    write = lambda path, data: path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    rules, sources, manifest = read(base / 'rules.json'), read(base / 'sources.json'), read(base / 'manifest.json')
    catalogue, overrides = read(root / 'src/data/card-products.json'), read(root / 'src/data/card-product-overrides.json')
    tr = i18n_catalog.load(root)

    def txt(zh, en, tw):
        tr['en-US'].setdefault(zh, en)
        tr['zh-TW'].setdefault(zh, tw)
        return zh

    for name, aliases, programme, url in NAMES_ONLY:
        pid = 'barclays-us-' + re.sub('[^a-z0-9]+', '-', name.lower()).strip('-')
        if any(p['id'] == pid for p in catalogue['products']):
            raise SystemExit(f'{pid} already exists')
        product = {'id': pid, 'bank': 'Barclays', 'region': 'US', 'name': name, 'aliases': [name, *aliases], 'currencies': [],
                   'rewardPrograms': [programme] if programme else [], 'art': None, 'sourceUrl': url, 'checkedAt': CHECKED,
                   'verification': 'issuer-listed', 'collection': 'not-supported'}
        catalogue['products'].append(product)
        overrides.append(dict(product))

    products = {p['id']: p for p in catalogue['products']}
    title = txt('境外交易手续费', 'Foreign transaction fee', '境外交易手續費')
    step = txt('刷卡前以当前官方费率条款为准。', 'Check the current official pricing terms before you pay.', '刷卡前以目前官方費率條款為準。')
    for slug, (rate, words) in FEES.items():
        pid = f'barclays-us-{slug}'
        product, rule_id = products[pid], f'rule.{pid}.foreign-transaction-fee'
        if any(r['id'] == rule_id for r in rules):
            raise SystemExit(f'{rule_id} already exists; change it with a new revision')
        sid = f'ftf-{pid}'
        sources.append({'id': sid, 'url': product['sourceUrl'], 'authority': 'official', 'checkedAt': CHECKED,
                        'title': txt(f"Barclays · {product['name']} 产品页", f"Barclays · {product['name']} product page", f"Barclays · {product['name']} 產品頁")})
        if rate == 0:
            english = 'No foreign transaction fee.'
            zh = '发卡行公布不收境外交易手续费；商户、ATM 或汇率换算方的费用不在内。'
            tw = '發卡行公布不收境外交易手續費；商戶、ATM 或匯率換算方的費用不在內。'
        else:
            english = f'{rate}% foreign transaction fee.'
            zh, tw = f'发卡行公布境外交易手续费为 {rate}%。', f'發卡行公布境外交易手續費為 {rate}%。'
        summary = txt(zh, english, tw)
        rules.append({
            'id': rule_id, 'revision': 1, 'revisionId': f'{rule_id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'fee',
            'productIds': [pid], 'market': {'country': 'US', 'issuer': 'Barclays'}, 'category': 'fee', 'scenarioIds': ['card-ownership'], 'programmeIds': [],
            'content': {'title': title, 'summary': summary, 'sourceText': words, 'howToUse': [step, summary], 'translatedFrom': 'en-US'},
            'original': {'lang': 'en-US', 'title': 'Foreign transaction fee', 'summary': english, 'howToUse': ['Check the current official pricing terms before you pay.', english], 'quotes': [{'sourceId': sid, 'text': words}]},
            'terms': {'period': 'foreign-transaction', 'rate': rate, 'amount': None},
            'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
            'evidence': {'sourceIds': [sid], 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'content.sourceText', 'terms'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
        })

    manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.barclays'
    manifest['asOf'] = CHECKED
    write(base / 'rules.json', rules)
    write(base / 'sources.json', sources)
    write(base / 'manifest.json', manifest)
    write(root / 'src/data/card-products.json', catalogue)
    write(root / 'src/data/card-product-overrides.json', overrides)
    i18n_catalog.save(root, tr, 'knowledge')
    print('names', len(NAMES_ONLY), 'fees', len(FEES))


if __name__ == '__main__':
    main()
