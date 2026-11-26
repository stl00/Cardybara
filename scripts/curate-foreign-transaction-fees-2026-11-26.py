#!/usr/bin/env python3
"""Record the published foreign transaction fee of every Amex US and Chase card (#659).

Offline by design: the table below was read on CHECKED from public, signed-out issuer pages. Chase: the
"Foreign Transactions" line of the Pricing & Terms page each card's product page links (those pages do not
name the card, so both URLs are cited). Amex US: the "Foreign Transaction" line of the card's public Card
Member Agreement PDF. Rerunning this script is not a new check.

A card that is not in the table is unknown. Nothing is copied from a sibling card.

  python3 scripts/curate-foreign-transaction-fees-2026-11-26.py
"""
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts'))
import i18n_catalog  # noqa: E402

base = root / 'src/data/knowledge'
CHECKED, REVIEW_AFTER = '2026-11-26', '2027-02-24'

CHASE_PRICING = 'https://sites.chase.com/services/creatives/pricingandterms.html/content/dam/pricingandterms/LGC{}.html'
CHASE_SITE = 'https://creditcards.chase.com/'
# product ID suffix: (percent, pricing document number, product page path)
CHASE = {
    'sapphire-reserve': (0, 64842, 'rewards-credit-cards/sapphire/reserve'),
    'freedom-unlimited': (3, 65873, 'cash-back-credit-cards/freedom/unlimited'),
    'united-quest': (0, 65756, 'travel-credit-cards/united/united-quest'),
    'ihg-premier': (0, 65909, 'travel-credit-cards/ihg-rewards-club/premier'),
    'chase-freedom-flex-credit-card': (0, 60938, 'cash-back-credit-cards/freedom/flex'),
    'chase-freedom-rise-credit-card': (3, 65397, 'cash-back-credit-cards/freedom/rise'),
    'chase-sapphire-preferred-credit-card': (0, 65358, 'rewards-credit-cards/sapphire/preferred'),
    'slate-credit-card': (3, 63300, 'balance-transfer-credit-cards/slate'),
    'slate-edge-credit-card': (3, 64148, 'credit-building-credit-cards/edge'),
    'united-explorer-card': (0, 63218, 'travel-credit-cards/united/united-explorer'),
    'united-gateway-card': (0, 65777, 'travel-credit-cards/united/united-gateway'),
    'united-club-card': (0, 62957, 'travel-credit-cards/united/club-infinite'),
    'southwest-rapid-rewards-plus-credit-card': (0, 64433, 'travel-credit-cards/southwest/plus'),
    'southwest-rapid-rewards-priority-credit-card': (0, 64414, 'travel-credit-cards/southwest/priority'),
    'southwest-rapid-rewards-premier-credit-card': (0, 64337, 'travel-credit-cards/southwest/premier'),
    'marriott-bonvoy-boundless-credit-card': (0, 65195, 'travel-credit-cards/marriott-bonvoy/boundless'),
    'marriott-bonvoy-bountiful-credit-card': (0, 61472, 'travel-credit-cards/marriott-bonvoy/bountiful'),
    'marriott-bonvoy-bold-credit-card': (0, 65105, 'travel-credit-cards/marriott-bonvoy/bold'),
    'ihg-one-rewards-premier-select-credit-card': (0, 65907, 'travel-credit-cards/ihg-rewards-club/premier-select'),
    'ihg-one-rewards-credit-card': (0, 62162, 'travel-credit-cards/ihg-rewards-club/one-rewards'),
    'world-of-hyatt-credit-card': (0, 65549, 'travel-credit-cards/world-of-hyatt-credit-card'),
    'disney-inspire-visa-card': (0, 64083, 'rewards-credit-cards/disney/inspire'),
    'disney-premier-visa-card': (3, 63172, 'rewards-credit-cards/disney/premier'),
    'disney-visa-card': (3, 63171, 'rewards-credit-cards/disney/rewards'),
    'prime-visa': (0, 59341, 'cash-back-credit-cards/amazon-prime-rewards'),
    'amazon-visa': (0, 59309, 'cash-back-credit-cards/amazon-rewards'),
    'air-canada-aeroplan-card': (0, 65930, 'travel-credit-cards/aircanada/aeroplan'),
    'british-airways-visa-signature-credit-card': (0, 61716, 'travel-credit-cards/avios/british-airways'),
    'aer-lingus-visa-signature-credit-card': (0, 61785, 'travel-credit-cards/avios/aer-lingus'),
    'iberia-visa-signature-credit-card': (0, 61715, 'travel-credit-cards/avios/iberia'),
    'doordash-rewards-mastercard': (0, 61934, 'cash-back-credit-cards/doordash'),
    'instacart-mastercard': (0, 60680, 'cash-back-credit-cards/instacart'),
    'ink-business-unlimited-credit-card': (3, 63749, 'business-credit-cards/ink/unlimited'),
    'ink-business-cash-credit-card': (3, 63827, 'business-credit-cards/ink/cash'),
    'ink-business-preferred-credit-card': (0, 65943, 'business-credit-cards/ink/business-preferred'),
    'ink-business-premier-credit-card': (0, 63834, 'business-credit-cards/ink/premier'),
    'sapphire-reserve-for-business-credit-card': (0, 64346, 'business-credit-cards/sapphire/reserve'),
    'united-business-card': (0, 65426, 'business-credit-cards/united/united-business-card'),
    'united-club-business-card': (0, 65424, 'business-credit-cards/united/united-club-business'),
    'southwest-rapid-rewards-performance-business-credit-card': (0, 61809, 'business-credit-cards/southwest/performance-business'),
    'southwest-rapid-rewards-premier-business-credit-card': (0, 61808, 'business-credit-cards/southwest/premier-business'),
    'ihg-one-rewards-business-credit-card': (0, 65912, 'business-credit-cards/IHG/business'),
    'world-of-hyatt-business-credit-card': (0, 65087, 'business-credit-cards/world-of-hyatt/hyatt-business-card'),
}

AMEX_CMA = 'https://www.americanexpress.com/content/dam/amex/en-us/company/legal/cardmember-agreements/public-site-2026-{}-pdf-cmas/{}-{}.pdf'
# product ID suffix: (percent, folder, file name). The agreement is the 09/30/2026 one unless AMEX_AS_OF says otherwise.
AMEX = {
    'american-express-gold-card': (0, 'cps-charge', 'american-express-gold-card'),
    'morgan-stanley-platinum-card': (0, 'cps-charge', 'morgan-stanley-platinum'),
    'blue-cash-everyday': (2.7, 'cps-lending', 'blue-cash-everyday'),
    'hilton-honors-aspire-card': (0, 'cps-lending', 'hilton-honors-american-express-aspire-card'),
    'the-platinum-card': (0, 'cps-charge', 'platinum-card'),
    'business-platinum-card': (0, 'sbs-small-business', 'business-platinum'),
    'business-gold-card': (0, 'sbs-small-business', 'business-gold'),
    'blue-business-plus-credit-card': (2.7, 'sbs-small-business', 'blue-business-plus-cc'),
    'delta-skymiles-gold-card': (0, 'cps-lending', 'delta-skymiles-gold'),
    'delta-skymiles-platinum-card': (0, 'cps-lending', 'delta-skymiles-platinum'),
    'delta-skymiles-reserve-card': (0, 'cps-lending', 'delta-reserve'),
    'marriott-bonvoy-brilliant-card': (0, 'cps-lending', 'bonvoy-brilliant-amex-card'),
    'marriott-bonvoy-bevy-card': (0, 'cps-lending', 'bonvoy-bevy-amex-card'),
    'hilton-honors-business-card': (0, 'sbs-small-business', 'hilton-honors-american-express-business-card'),
    'delta-skymiles-platinum-business-card': (0, 'sbs-small-business', 'delta-skymiles-platinum-business'),
    'delta-skymiles-gold-business-card': (0, 'sbs-small-business', 'delta-skymiles-gold-business'),
    'blue-cash-preferred-card': (2.7, 'cps-lending', 'blue-cash-preferred'),
    'green-card': (0, 'cps-charge', 'american-express-green-card'),
    'hilton-honors-card': (0, 'cps-lending', 'hilton-honors-american-express-card'),
    'hilton-honors-surpass-card': (0, 'cps-lending', 'hilton-honors-american-express-surpass-card'),
    'delta-skymiles-blue-card': (0, 'cps-lending', 'delta-skymiles-blue'),
    'blue-business-cash-card': (2.7, 'sbs-small-business', 'blue-business-cash'),
    'marriott-bonvoy-business-card': (0, 'sbs-small-business', 'bonvoy-business-amex-card'),
    'delta-skymiles-reserve-business-card': (0, 'sbs-small-business', 'delta-skymiles-reserve-business'),
    'business-green-rewards-card': (2.7, 'sbs-small-business', 'business-green-rewards'),
    'graphite-business-cash-unlimited-card': (0, 'sbs-small-business', 'graphite-business-cash-unlimited'),
    'schwab-platinum-card': (0, 'cps-charge', 'schwab-platinum'),
}
# No 09/30/2026 file was found for the Green Card; this is the newest one that was.
AMEX_AS_OF = {'green-card': ('q2', '06-30-2026')}
AMEX_QUOTES = {'delta-skymiles-reserve-business-card': 'Foreign Transaction None'}


def quote(bank, key, rate):
    if bank == 'Chase':
        return 'Foreign Transactions: ' + ('3% of the amount of each transaction in U.S. dollars.' if rate else 'None')
    if rate:
        return 'Foreign Transaction: 2.7% of the converted U.S. dollar amount.'
    return AMEX_QUOTES.get(key, 'Foreign Transaction: None.')


def main():
    read = lambda path: json.loads(path.read_text())
    write = lambda path, data: path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    rules, sources, manifest = read(base / 'rules.json'), read(base / 'sources.json'), read(base / 'manifest.json')
    products = {p['id']: p for p in read(root / 'src/data/card-products.json')['products']}
    tr = i18n_catalog.load(root)

    def txt(zh, en, tw):
        tr['en-US'].setdefault(zh, en)
        tr['zh-TW'].setdefault(zh, tw)
        return zh

    title = txt('境外交易手续费', 'Foreign transaction fee', '境外交易手續費')
    summaries = {
        0: ('发卡行公布不收境外交易手续费；商户、ATM 或汇率换算方的费用不在内。', 'The issuer states no foreign transaction fee; charges by a merchant, ATM or currency converter are not covered.', '發卡行公布不收境外交易手續費；商戶、ATM 或匯率換算方的費用不在內。'),
        2.7: ('发卡行公布每笔收取换算成美元后金额的 2.7%。', 'The issuer states 2.7% of each transaction’s converted U.S. dollar amount.', '發卡行公布每筆收取換算成美元後金額的 2.7%。'),
        3: ('发卡行公布每笔收取美元金额的 3%。', 'The issuer states 3% of the U.S. dollar amount of each transaction.', '發卡行公布每筆收取美元金額的 3%。'),
    }
    step_zh = txt('刷卡前以当前官方费率条款为准。', 'Check the current official pricing terms before you pay.', '刷卡前以目前官方費率條款為準。')
    english = {0: 'No foreign transaction fee.', 2.7: '2.7% of the converted U.S. dollar amount of each transaction.', 3: '3% of the amount of each transaction in U.S. dollars.'}

    rows = [('Chase', f'chase-us-{key}', key, row) for key, row in CHASE.items()] + [('Amex US', f'amex-us-us-{key}', key, row) for key, row in AMEX.items()]
    for bank, pid, key, row in rows:
        product, rule_id = products[pid], f'rule.{pid}.foreign-transaction-fee'
        assert product['bank'] == bank, pid
        if any(r['id'] == rule_id for r in rules):
            raise SystemExit(f'{rule_id} already exists; change it with a new revision')
        rate, source_id = row[0], f'ftf-{pid}'
        if bank == 'Chase':
            cited = [(source_id, CHASE_PRICING.format(row[1]), 'Pricing & Terms 费率页', 'Pricing & Terms page', 'Pricing & Terms 費率頁'),
                     (source_id + '-product', CHASE_SITE + row[2], '产品页（链接到该卡费率页）', "product page (links the card's pricing page)", '產品頁（連結到該卡費率頁）')]
        else:
            quarter, day = AMEX_AS_OF.get(key, ('q3', '09-30-2026'))
            month, date, year = day.split('-')
            as_of = f'{year}-{month}-{date}'
            cited = [(source_id, AMEX_CMA.format(quarter, f'{row[1]}/{row[2]}', day), f'持卡协议费率表（{as_of} 版）', f'Card Member Agreement rates and fees table (as of {as_of})', f'持卡協議費率表（{as_of} 版）')]
        for sid, url, zh, en, tw in cited:
            name = f'{bank} · {product["name"]} '
            sources.append({'id': sid, 'url': url, 'title': txt(name + zh, name + en, name + tw), 'checkedAt': CHECKED, 'authority': 'official'})
        zh, en, tw = summaries[rate]
        summary = txt(zh, en, tw)
        words = quote(bank, key, rate)
        rules.append({
            'id': rule_id, 'revision': 1, 'revisionId': f'{rule_id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'fee',
            'productIds': [pid], 'market': {'country': 'US', 'issuer': bank}, 'category': 'fee', 'scenarioIds': ['card-ownership'], 'programmeIds': [],
            'content': {'title': title, 'summary': summary, 'sourceText': words, 'howToUse': [step_zh, summary], 'translatedFrom': 'en-US'},
            'original': {'lang': 'en-US', 'title': 'Foreign transaction fee', 'summary': english[rate], 'howToUse': ['Check the current official pricing terms before you pay.', english[rate]], 'quotes': [{'sourceId': source_id, 'text': words}]},
            # A percent of the transaction; no fixed amount and no cardholder role, so annual-fee readers skip it.
            'terms': {'period': 'foreign-transaction', 'rate': rate, 'amount': None},
            'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
            'evidence': {'sourceIds': [c[0] for c in cited], 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'content.sourceText', 'terms'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
        })

    manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.foreign-transaction-fees'
    manifest['asOf'] = CHECKED
    write(base / 'rules.json', rules)
    write(base / 'sources.json', sources)
    write(base / 'manifest.json', manifest)
    i18n_catalog.save(root, tr, 'knowledge')
    print('rules added', len(rows))


if __name__ == '__main__':
    main()
