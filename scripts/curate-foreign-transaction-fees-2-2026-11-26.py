#!/usr/bin/env python3
"""Record the published foreign transaction fee of the remaining issuers (#660).

Offline by design: the table below was read on CHECKED from public, signed-out issuer pages and documents.
Rerunning this script is not a new check. A card that is not in the table is unknown; nothing is copied from a
sibling card. The one issuer-wide entry is Capital One, whose own page speaks for all its US-issued cards.

The free-text "no foreign transaction fee" benefits of covered cards are withdrawn in favour of the fee rule.

  python3 scripts/curate-foreign-transaction-fees-2-2026-11-26.py
"""
import copy
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'scripts'))
import i18n_catalog  # noqa: E402

base = root / 'src/data/knowledge'
CHECKED, REVIEW_AFTER = '2026-11-26', '2027-02-24'

# Source kinds: (zh-CN, en-US, zh-TW) description of the cited page.
PRODUCT = ('产品页', 'product page', '產品頁')
TERMS = ('费率条款页', 'rates and terms page', '費率條款頁')
DISCLOSURE = ('费率披露文件（产品页链接）', 'rate and fee disclosure (linked from the product page)', '費率披露文件（產品頁連結）')
AGREEMENT = ('持卡协议', 'card agreement', '持卡協議')
KFS = ('资料概要（Key Facts Statement）', 'Key Facts Statement', '資料概要（Key Facts Statement）')

rows = []  # (product ID, rate, quote, [(url, source kind)], English basis, zh-CN summary, zh-TW summary)


def add(pid, rate, words, cited, basis=None):
    if rate == 0:
        english = 'No foreign transaction fee.'
        zh = '发卡行公布不收境外交易手续费；商户、ATM 或汇率换算方的费用不在内。'
        tw = '發卡行公布不收境外交易手續費；商戶、ATM 或匯率換算方的費用不在內。'
    else:
        english, zh, tw = basis
    rows.append((pid, rate, words, cited, english, zh, tw))


# Capital One: one issuer-wide statement.
CAPITAL_ONE = 'https://www.capitalone.com/help-center/credit-cards/understanding-credit-card-fees/'
CAPITAL_ONE_QUOTE = 'None of Capital One’s US-issued credit cards include this type of fee.'

# Wells Fargo
WF = 'https://www.wellsfargo.com/'
WF_3 = ('3% of each transaction converted to U.S. dollars.',
        '发卡行公布每笔收取换算成美元后金额的 3%。', '發卡行公布每筆收取換算成美元後金額的 3%。')
WF_PAGES = {
    'active-cash-card': (3, WF + 'credit-cards/active-cash/terms/', TERMS),
    'autograph-card': (0, WF + 'credit-cards/autograph-visa/terms/?product_code=CC&subproduct_code=AU&sub_channel=WEB&vendor_code=WF', TERMS),
    'autograph-journey-visa-card': (0, WF + 'credit-cards/autograph-journey-visa/terms/?product_code=CC&subproduct_code=MT&sub_channel=WEB&vendor_code=WF', TERMS),
    'reflect-card': (3, WF + 'credit-cards/reflect-visa/terms/?product_code=CC&subproduct_code=VV&sub_channel=WEB&vendor_code=WF', TERMS),
    'one-key-card': (0, WF + 'credit-cards/documents/one-key-agreement/?FPID=21231AIXP10000&subproduct_code=OW', AGREEMENT),
    'choice-privileges-mastercard': (0, WF + 'credit-cards/documents/choice-agreement/', AGREEMENT),
    'choice-privileges-select-mastercard': (0, WF + 'credit-cards/documents/choice-select-agreement/', AGREEMENT),
    'signify-business-cash-card': (3, WF + 'biz/business-credit/credit-cards/signify-business-cash-credit-card-terms-conditions/', TERMS),
}
for key, (rate, url, kind) in WF_PAGES.items():
    add(f'wells-fargo-us-{key}', rate, 'Foreign Currency Conversion/Foreign Transaction: ' + (WF_3[0] if rate else 'None'), [(url, kind)], WF_3)

# Bank of America: the disclosure the product page links; (rate, campaign ID, offer code, product page).
BOA_DOC = 'https://secure.bankofamerica.com/apply-now-services/credit-cards/rest/get-disclosures/v1/usa/show-in-browser?cId={}&poCd={}&locale=en_US&isMobile=true'
BOA_SITE = 'https://www.bankofamerica.com/credit-cards/products/'
BOA_BUSINESS = 'https://business.bankofamerica.com/en/credit-cards/business-advantage-'
BOA_3 = ('3% of the U.S. dollar amount of each transaction made in a foreign currency.',
         '发卡行公布外币交易每笔收取美元金额的 3%。', '發卡行公布外幣交易每筆收取美元金額的 3%。')
BOA = {
    'bank-of-america-unlimited-cash-rewards': (3, 4082058, '6E', BOA_SITE + 'unlimited-cash-back-credit-card/'),
    'atmos-rewards-ascent-visa-signature': (0, 4081418, 'PV', BOA_SITE + 'alaska-airlines-credit-card/'),
    'royal-one-visa-signature': (0, 4081180, 'E3', BOA_SITE + 'royal-one-credit-card/'),
    'royal-one-plus-visa-signature': (0, 4081136, '7F', BOA_SITE + 'royal-one-plus-credit-card/'),
    'customized-cash-rewards-visa-signature': (3, 4079537, '8H', BOA_SITE + 'cash-back-credit-card/'),
    'bank-of-america-travel-rewards-credit-card': (0, 4079333, '75', BOA_SITE + 'travel-rewards-credit-card/'),
    'bank-of-america-premium-rewards-credit-card': (0, 4079485, 'UN', BOA_SITE + 'premium-rewards-credit-card/'),
    'bank-of-america-premium-rewards-elite-credit-card': (0, 4079322, 'R9', BOA_SITE + 'premium-rewards-elite-credit-card/'),
    'bankamericard-credit-card': (3, 4079406, '5Y', BOA_SITE + 'bankamericard-credit-card/'),
    'susan-g-komen-customized-cash-rewards-credit-card': (3, 4079144, 'WH', BOA_SITE + 'susan-komen-credit-card/'),
    'air-france-klm-visa-signature-credit-card': (0, 4079102, '8S', BOA_SITE + 'air-france-credit-card/'),
    'norwegian-cruise-line-world-mastercard': (0, 4079074, '9Y', BOA_SITE + 'norwegian-cruise-lines-credit-card/'),
    'business-advantage-unlimited-cash-rewards-mastercard': (3, 4078727, '7B', BOA_BUSINESS + 'unlimited-cash-rewards'),
    'business-advantage-customized-cash-rewards-mastercard': (3, 4076847, 'NX', BOA_BUSINESS + 'customized-cash-rewards'),
    'business-advantage-travel-rewards-world-mastercard': (0, 4078683, '4X', BOA_BUSINESS + 'travel-rewards'),
}
for key, (rate, campaign, offer, page) in BOA.items():
    label = 'International Transaction ' if key.startswith('business-') else 'Foreign Transaction '
    words = label + (('3% of the U.S. dollar amount of each transaction made in a foreign currency.') if rate else 'None')
    add(f'boa-us-{key}', rate, words, [(BOA_DOC.format(campaign, offer), DISCLOSURE), (page, PRODUCT)], BOA_3)
# The Summit disclosure came back empty; its product page states the fee.
add('boa-us-atmos-rewards-summit-visa-infinite', 0, '$395 annual fee† and no foreign transaction fees†',
    [(BOA_SITE + 'alaska-airlines-infinite-credit-card/', PRODUCT)])

# Citi: only the product pages whose pricing details or FAQ show the value.
CITI = 'https://www.citi.com/credit-cards/'
CITI_PAGES = {
    'citi-strata-premier-card': ('citi-strata-premier-credit-card', 'Fee for foreign purchases - None.'),
    'citi-strata-elite-card': ('citi-strata-elite-credit-card', 'Fee for foreign purchases - None.'),
    'citi-aadvantage-platinum-select-card': ('citi-aadvantage-platinum-select-world-elite-mastercard', 'there are no foreign transaction fees.'),
    'citi-aadvantage-executive-card': ('citi-aadvantage-executive-world-legend-mastercard', 'Fee for Foreign Purchases - None.'),
    'costco-anywhere-visa-card-by-citi': ('costco-anywhere-visa-card', 'Fee for foreign purchases — None.'),
    'costco-anywhere-visa-business-card-by-citi': ('costco-anywhere-visa-business-card', 'Fee for foreign purchases — None.'),
    'citi-aadvantage-globe-card': ('citi-aadvantage-globe-mastercard', 'Fee for Foreign Purchases - None.'),
    'citi-aadvantage-business-card': ('citi-aadvantage-business-credit-card', 'Fee for Foreign Purchases — None.'),
    'at-t-points-plus-card-from-citi': ('citi-att-pointsplus-credit-card', 'Fee for foreign transactions – None.'),
}
for key, (path, words) in CITI_PAGES.items():
    add(f'citi-us-{key}', 0, words, [(CITI + path, PRODUCT)])

USB = 'Enjoy no foreign transaction fees when making purchases outside the United States.'
add('us-bank-us-altitude-connect-visa-signature-card', 0, USB, [('https://www.usbank.com/credit-cards/altitude-connect-visa-signature-credit-card.html', PRODUCT)])
add('us-bank-us-business-altitude-connect-visa-signature-card', 0, USB, [('https://www.usbank.com/business-banking/business-credit-cards/business-altitude-connect-credit-card.html', PRODUCT)])

BILT = 'https://legal.cardless.com/schumer/bilt/rates_and_fees.pdf'
for key in ('blue', 'obsidian', 'palladium'):
    add(f'bilt-us-bilt-{key}-card', 0, 'Foreign Transaction None',
        [(BILT, ('费率披露文件（bilt.com 卡片页链接）', 'rates and fees disclosure (linked from bilt.com/card)', '費率披露文件（bilt.com 卡片頁連結）')), ('https://www.bilt.com/card', PRODUCT)])

# Hong Kong
HSBC_KFS = 'https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/credit-cards/key-fact-statement.pdf'
HSBC = ('1.95% of every card transaction in a currency other than Hong Kong dollars; Hong Kong dollar transactions made outside Hong Kong or with merchants not registered there carry a separate 1% charge on Visa and Mastercard cards.',
        '发卡行公布非港元签账每笔收取 1.95%；在香港以外或与非香港登记商户以港元签账，Visa 及 Mastercard 另收 1%。',
        '發卡行公布非港元簽賬每筆收取 1.95%；在香港以外或與非香港登記商戶以港元簽賬，Visa 及 Mastercard 另收 1%。')
for key in ('red-credit-card', 'premier-credit-card', 'visa-gold-card', 'easy-credit-card', 'hsbc-visa-signature-card', 'hsbc-everymile-card', 'visa-gold-card-for-students'):
    add(f'hsbc-hk-hk-{key}', 1.95, '1.95% of every card transaction which is effected in currencies other than Hong Kong dollars (for HK dollar personal credit cards)', [(HSBC_KFS, KFS)], HSBC)
UNIONPAY_QUOTE = ('1% of every card transaction which is effected in currencies other than Renminbi and Hong Kong dollars and Macau Pataca (for HSBC Pulse UnionPay Dual Currency Diamond Credit Card), '
                  'or in currencies other than Hong Kong dollars and Renminbi (for UnionPay Dual Currency Credit Card)')
add('hsbc-hk-hk-pulse-dual-currency-diamond', 1, UNIONPAY_QUOTE, [(HSBC_KFS, KFS)],
    ('1% of every card transaction in a currency other than renminbi, Hong Kong dollars or Macau pataca.', '发卡行公布人民币、港元及澳门元以外的签账每笔收取 1%。', '發卡行公布人民幣、港元及澳門元以外的簽賬每筆收取 1%。'))
add('hsbc-hk-hk-unionpay-dual-currency-card', 1, UNIONPAY_QUOTE, [(HSBC_KFS, KFS)],
    ('1% of every card transaction in a currency other than Hong Kong dollars or renminbi.', '发卡行公布港元及人民币以外的签账每笔收取 1%。', '發卡行公布港元及人民幣以外的簽賬每筆收取 1%。'))

SC = 'https://av.sc.com/hk/content/docs/'
SC_195 = ('1.95% of foreign currency transactions; Hong Kong dollar transactions made outside Hong Kong or with merchants not registered there carry a separate 1% charge.',
          '发卡行公布外币签账收取 1.95%；在香港以外或与非香港登记商户以港元签账另收 1%。', '發卡行公布外幣簽賬收取 1.95%；在香港以外或與非香港登記商戶以港元簽賬另收 1%。')
add('sc-hk-hk-cathay-mastercard', 1.95, 'a 1% reimbursement charge+ will be imposed by Mastercard plus 0.95% imposed by the Bank (1.95% in total).', [(SC + 'hk-cc-cathaycard-kfs.pdf', KFS)], SC_195)
add('sc-hk-hk-a-point-card', 1.95, 'a 1% reimbursement charge+ will be imposed by Visa International plus 0.95% imposed by the Bank (1.95% in total).',
    [(SC + 'hk-cc-apointcard-kfs.pdf', KFS), ('https://www.sc.com/hk/credit-cards/apointcard/', PRODUCT)], SC_195)
add('sc-hk-hk-standard-chartered-smart-credit-card', 0, 'Fees relating to Foreign Currency Transactions/Foreign Currency (Currencies other than Hong Kong Dollars) Transactions incurred in or outside of Hong Kong: Waived.',
    [(SC + 'hk-cc-smartcard-kfs.pdf', KFS), ('https://www.sc.com/hk/credit-cards/smart/', PRODUCT)])

AMEX_HK = 'https://www.americanexpress.com/content/dam/amex/hk/en/staticassets/pdf/cardmember-agreement-and-fees-and-charges/'
AMEX_HK_2 = ('2% of every transaction in a currency other than Hong Kong dollars.', '发卡行公布非港元交易每笔收取 2%。', '發卡行公布非港元交易每筆收取 2%。')
AMEX_HK_RETAIL = ('2% of every retail purchase in a currency other than Hong Kong dollars.', '发卡行公布非港元零售签账每笔收取 2%。', '發卡行公布非港元零售簽賬每筆收取 2%。')
ALL_WORDS = '2% of every transaction effected in a currency other than Hong Kong dollar'
RETAIL_WORDS = '2% of every transaction for Retail Purchase effected in a currency other than Hong Kong dollar'
for key, doc, words, basis in (
    ('the-platinum-card', 'Plat_R_FnC.pdf', ALL_WORDS, AMEX_HK_2),
    ('american-express-peninsula-platinum-card', 'Plat_R_FnC.pdf', ALL_WORDS, AMEX_HK_2),
    ('american-express-card', 'RCP_FnC.pdf', ALL_WORDS, AMEX_HK_2),
    ('american-express-gold-card', 'RCP_FnC.pdf', ALL_WORDS, AMEX_HK_2),
    ('american-express-peninsula-gold-card', 'RCP_FnC.pdf', ALL_WORDS, AMEX_HK_2),
    ('american-express-credit-card', 'GRCC_FnC.pdf', RETAIL_WORDS, AMEX_HK_RETAIL),
    ('american-express-gold-credit-card', 'GRCC_FnC.pdf', RETAIL_WORDS, AMEX_HK_RETAIL),
    ('american-express-platinum-credit-card', 'PGRCC_fees_charges.pdf', RETAIL_WORDS, AMEX_HK_RETAIL),
    ('blue-cash-credit-card-from-american-express', 'BlueCash_KFS_FnC_EN.pdf', RETAIL_WORDS, AMEX_HK_RETAIL),
    ('american-express-essential-credit-card', 'Essential_KFS_FnC_ENG.pdf', RETAIL_WORDS, AMEX_HK_RETAIL),
):
    add(f'amex-hk-hk-{key}', 2, words, [(AMEX_HK + doc, KFS)], basis)
add('amex-hk-hk-american-express-explorer-credit-card', 2, 'increased by a single conversion commission of 2%', [(AMEX_HK + 'Explorer_CMA_ENG.pdf', AGREEMENT)], AMEX_HK_2)

add('amex-ca-ca-american-express-cobalt-card', 2.5, 'a 2.5% foreign currency conversion commission applies',
    [('https://www.americanexpress.com/en-ca/credit-cards/cobalt-card/', PRODUCT)],
    ('2.5% foreign currency conversion commission.', '发卡行公布收取 2.5% 的外币兑换佣金。', '發卡行公布收取 2.5% 的外幣兌換佣金。'))


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

    for p in products.values():
        if p['bank'] == 'Capital One':
            add(p['id'], 0, CAPITAL_ONE_QUOTE, [(CAPITAL_ONE, ('帮助中心费用说明（适用于其全部美国发行信用卡）', 'help center fee page (covers all its US-issued cards)', '說明中心費用頁（適用於其全部美國發行信用卡）'))])

    title = txt('境外交易手续费', 'Foreign transaction fee', '境外交易手續費')
    step_zh = txt('刷卡前以当前官方费率条款为准。', 'Check the current official pricing terms before you pay.', '刷卡前以目前官方費率條款為準。')
    source_ids = {}

    def source(pid, product, url, kind):
        # One source per document; a document shared by several cards is named after the issuer.
        if url not in source_ids:
            shared = sum(any(u == url for u, _ in row[3]) for row in rows) > 1
            slug = url.split('?')[0].rstrip('/').split('/')[-1].split('.')[0].lower().replace('_', '-')
            sid = f'ftf-{product["bank"].lower().replace(" ", "-").replace(".", "")}-{slug}' if shared else f'ftf-{pid}'
            while any(s['id'] == sid for s in sources):
                sid += '-b'
            name = product['bank'] + ' · ' + ('' if shared else product['name'] + ' ')
            zh, en, tw = kind
            if shared:
                zh, en, tw = (f'{t}（{slug}）' for t in (zh, en, tw)) if url != CAPITAL_ONE else (zh, en, tw)
            sources.append({'id': sid, 'url': url, 'title': txt(name + zh, name + en, name + tw), 'checkedAt': CHECKED, 'authority': 'official'})
            source_ids[url] = sid
        return source_ids[url]

    added = {}
    for pid, rate, words, cited, english, zh, tw in rows:
        product, rule_id = products[pid], f'rule.{pid}.foreign-transaction-fee'
        if any(r['id'] == rule_id for r in rules):
            raise SystemExit(f'{rule_id} already exists; change it with a new revision')
        ids = [source(pid, product, url, kind) for url, kind in cited]
        region = product['region']
        lang = f'en-{region}'
        summary = txt(zh, english, tw)
        rules.append({
            'id': rule_id, 'revision': 1, 'revisionId': f'{rule_id}@{CHECKED}.1', 'supersedes': None, 'status': 'published', 'kind': 'fee',
            'productIds': [pid], 'market': {'country': region, 'issuer': product['bank']}, 'category': 'fee', 'scenarioIds': ['card-ownership'], 'programmeIds': [],
            'content': {'title': title, 'summary': summary, 'sourceText': words, 'howToUse': [step_zh, summary], 'translatedFrom': lang},
            'original': {'lang': lang, 'title': 'Foreign transaction fee', 'summary': english, 'howToUse': ['Check the current official pricing terms before you pay.', english], 'quotes': [{'sourceId': ids[0], 'text': words}]},
            'terms': {'period': 'foreign-transaction', 'rate': rate, 'amount': None},
            'validity': {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None},
            'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
            'evidence': {'sourceIds': ids, 'checkedAt': CHECKED, 'verification': 'official-summary', 'supports': ['content.summary', 'content.sourceText', 'terms'], 'fullTermsReviewed': False},
            'review': {'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER, 'state': 'reviewed-summary'},
            'personalState': 'not-in-public-knowledge',
        })
        added[pid] = rules[-1]

    # Replace the free-text mentions: the older revision stays visible to earlier knowledge dates.
    latest = {}
    for r in rules:
        if r['id'].endswith('.no-foreign-fee') and r['revision'] >= latest.get(r['id'], r)['revision']:
            latest[r['id']] = r
    withdrawn = 0
    for old in latest.values():
        fee = added.get(old['productIds'][0])
        if old['status'] != 'published' or not fee:
            continue
        row = copy.deepcopy(old)
        n = old['revision'] + 1
        row.update(revision=n, revisionId=f'{old["id"]}@{CHECKED}.{n}', supersedes=old['revisionId'], status='withdrawn')
        row['terms'] = {**old['terms'], 'replacedByRuleId': fee['id']}
        row['evidence'] = {**old['evidence'], 'checkedAt': CHECKED, 'sourceIds': list(dict.fromkeys(old['evidence']['sourceIds'] + fee['evidence']['sourceIds']))}
        row['review'] = {**old['review'], 'checkedAt': CHECKED, 'reviewAfter': REVIEW_AFTER}
        rules.append(row)
        withdrawn += 1

    manifest['snapshotId'] = f'cardybara-public-knowledge-{CHECKED}.foreign-transaction-fees-2'
    manifest['asOf'] = CHECKED
    write(base / 'rules.json', rules)
    write(base / 'sources.json', sources)
    write(base / 'manifest.json', manifest)
    i18n_catalog.save(root, tr, 'knowledge')
    print('rules added', len(added), 'withdrawn', withdrawn)


if __name__ == '__main__':
    main()
