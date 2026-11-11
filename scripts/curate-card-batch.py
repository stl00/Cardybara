#!/usr/bin/env python3
"""Turn a reviewed batch in docs/knowledge/card-batches/ into catalogue and knowledge records.

Offline by design. Each fact in a batch carries a short quote from the issuer page. With
--pages DIR every quote must appear in DIR/<page>.txt (signed-out page text saved by hand), so a
number that is not on the page fails the run. Without --pages no quote is checked.

Needs opencc-python-reimplemented on PYTHONPATH.

  python3 scripts/curate-card-batch.py docs/knowledge/card-batches/batch-01.json --pages /path/to/pages
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path
from opencc import OpenCC
sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n_catalog  # noqa: E402

root = Path(__file__).resolve().parents[1]
base = root / 'src/data/knowledge'
cc = OpenCC('s2twp')


def traditional(zh):
    # OpenCC's mistakes on words this catalogue uses often.
    text = cc.convert(zh)
    for wrong, right in (('托執行李', '托運行李'), ('髮卡', '發卡'), ('后', '後'), ('記憶體', '內存'), ('瀏覽器里', '瀏覽器裡'), ('合作伙伴', '合作夥伴')):
        text = text.replace(wrong, right)
    return text


def read(path):
    return json.loads(path.read_text())


def write(path, data, indent=2):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + '\n')


def clean(text):
    return re.sub(r'\s+', ' ', re.sub(r'[®™℠†‡*¤♦︎‌]', '', text)).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('batch')
    parser.add_argument('--pages')
    args = parser.parse_args()
    batch = read(Path(args.batch))
    checked = batch['checkedAt']
    review_after = batch['reviewAfter']
    rules, sources, manifest = read(base / 'rules.json'), read(base / 'sources.json'), read(base / 'manifest.json')
    entities, taxonomy = read(base / 'entities.json'), read(base / 'taxonomy.json')
    logos = read(root / 'src/data/logos.json')
    asset_rows = []
    for programme in batch.get('programmes', []):
        if not any(e['id'] == programme['id'] for e in entities['programmes']):
            entities['programmes'].append({**programme, 'aliases': []})
            # A new brand gets no mark until the owner approves it; the category icon shows instead.
            logos['brands'].append({'id': programme['id'].split('.', 1)[1], 'name': programme['name'], 'category': 'airline' if programme['kind'] == 'airline' else 'reward', 'programmeIds': [programme['id']], 'titleTokens': [], 'textTokens': [], 'termsUrl': None, 'finding': 'Not checked; no mark is shipped.', 'checkedAt': checked, 'status': 'unapproved', 'approval': None, 'terms': 'unverified', 'logo': None, 'source': None})
            asset_rows.append(f"| {programme['name']} | unverified | null | null | not located | Not checked; no mark is shipped. |")
    products = read(root / 'src/data/card-products.json')
    overrides = read(root / 'src/data/card-product-overrides.json')
    tr = i18n_catalog.load(root)

    def txt(zh, en):
        # An existing translation stays: other screens already show it for this Chinese text.
        tr['en-US'].setdefault(zh, en)
        tr['zh-TW'].setdefault(zh, traditional(zh))
        return zh

    steps = [
        txt('先核对卡种、当前官方条款和适用条件。', 'Check the card, the current official terms and any conditions first.'),
        txt('个人资格、登记和剩余额度未核实；知识库不代办操作。', 'Personal eligibility, enrollment and remaining amounts are unverified; this library performs nothing.'),
    ]
    missing = []

    def check(card, quote, embedded=False, source=None):
        if len(quote.split()) > 22:
            missing.append(f"{card['id']}: quote too long, keep it short: {quote}")
        if not args.pages:
            return
        # Embedded page data can describe other cards on the same page, so a fact taken from it must
        # be marked, which sends a reviewer to the block it came from. Visible text is the default.
        page = Path(args.pages) / f"{card['extraSources'][source]['page'] if source else card['page']}.txt"
        raw = page.with_suffix('.html')
        visible = clean(page.read_text())
        if clean(quote) in visible:
            return
        data = clean(html.unescape(re.sub(r'<[^>]{0,300}>', ' ', raw.read_text(errors='ignore')))) if raw.exists() else ''
        if clean(quote) not in data:
            missing.append(f"{card['id']}: {quote}")
        elif not embedded:
            missing.append(f"{card['id']}: only in embedded page data, mark it embedded: {quote}")

    for card in batch['cards']:
        pid = card['id']
        if any(r['id'].startswith(f'rule.{pid}.') for r in rules):
            raise SystemExit(f'{pid} already has rules; change them with a new revision')
        product = next((p for p in products['products'] if p['id'] == pid), None)
        if not product:
            if 'new' not in card:
                raise SystemExit(f'{pid}: not in the catalogue and no product details given')
            new = card['new']
            product = {'id': pid, 'bank': new['bank'], 'region': new['region'], 'name': new['name'], 'aliases': [new['name']], 'currencies': [], 'rewardPrograms': [], 'art': None}
            products['products'].append(product)
        patch = {'id': pid, 'sourceUrl': card['url'], 'checkedAt': checked, 'verification': 'issuer-listed'}
        if card.get('aliases'):
            patch['aliases'] = list(dict.fromkeys(product['aliases'] + card['aliases']))
        if card.get('collection'):
            patch['collection'] = card['collection']
        link = card.get('transfer')
        if link:
            check(card, link['quote'], link.get('embedded', False), link.get('source'))
            patch.update(rewardPrograms=[link['name']], rewardSource={'url': card['url'], 'checkedAt': checked})
            # linkOnly names the programme a card earns; its partners are not verified yet.
            if not link.get('linkOnly'):
                patch['transferProgrammeId'] = link['programmeId']
        product.update({k: v for k, v in patch.items() if k != 'id'})
        overrides.append({**patch, **({k: product[k] for k in ('bank', 'region', 'name', 'currencies', 'art') if 'new' in card})})

        source_id = f'card-{pid}'
        kind_zh, kind_en = (card['sourceTitle']['zh'], card['sourceTitle']['en']) if card.get('sourceTitle') else ('官方产品页', 'official product page')
        sources.append({'id': source_id, 'url': card['url'], 'title': txt(f"{card['issuer']} · {product['name']} {kind_zh}", f"{card['issuer']} · {product['name']} {kind_en}"), 'checkedAt': checked, 'authority': 'official'})
        # A fact the product page does not show (a fee rendered only in the browser) may cite another issuer page.
        for key, extra in card.get('extraSources', {}).items():
            sources.append({'id': f'{source_id}-{key}', 'url': extra['url'], 'title': txt(extra['zh'], extra['en']), 'checkedAt': checked, 'authority': 'official'})
        market = {'country': product['region'], 'issuer': product['bank']}
        gaps = [txt(g['zh'], g['en']) for g in card.get('unknown', [])] + [txt('个人登记、使用进度及完整保障细则尚未核实。', 'Personal enrollment, usage and full insurance terms remain unverified.')]
        manifest['profileProductIds'].append(pid)
        manifest['profileMetadata'][pid] = {'checkedAt': checked, 'coverage': 'issuer-page-summary', 'market': market, 'communitySourceIds': [], 'changeNotes': [], 'knowledgeGaps': gaps, 'feeNotes': None}

        def rule(key, kind, category, scenes, programme_ids, title, summary, quote, terms, validity=None, embedded=False, original=None, source=None):
            check(card, quote, embedded, source)
            cited = f'{source_id}-{source}' if source else source_id
            id = f'rule.{pid}.{key}'
            valid = {'effectiveFrom': None, 'effectiveThrough': None, 'enrollBy': None, **(validity or {})}
            rules.append({
                'id': id, 'revision': 1, 'revisionId': f'{id}@{checked}.1', 'supersedes': None, 'status': 'published', 'kind': kind,
                'productIds': [pid], 'market': market, 'category': category, 'scenarioIds': scenes, 'programmeIds': programme_ids,
                'content': {'title': title, 'summary': summary, 'sourceText': quote, 'howToUse': [steps[0], summary, steps[1]]},
                'terms': terms, 'validity': valid,
                'conditions': {'coverage': 'partial', 'all': [], 'unparsedText': summary},
                'evidence': {'sourceIds': [cited], 'checkedAt': checked, 'verification': 'official-summary', 'supports': ['content.summary', 'content.sourceText', 'terms', 'validity'], 'fullTermsReviewed': False},
                'review': {'checkedAt': checked, 'reviewAfter': review_after, 'state': 'reviewed-summary'},
                'personalState': 'not-in-public-knowledge',
            })
            if original:
                # The issuer's own wording (#148): the zh-CN text above is its translation.
                quotes = [quote] + original.get('quotes', [])
                for extra in original.get('quotes', []):
                    check(card, extra, embedded, source)
                rules[-1]['content']['translatedFrom'] = 'en-US'
                rules[-1]['original'] = {'lang': 'en-US', 'title': original['title'], 'summary': original['summary'], 'howToUse': original['howToUse'], 'quotes': [{'sourceId': cited, 'text': q} for q in quotes]}
            elif kind == 'benefit' and batch['batch'] >= 6:
                missing.append(f'{id}: a benefit needs its original wording')

        fee_title = {'primary': txt('主卡年费', 'Primary annual fee'), 'additional': txt('附属卡年费', 'Additional card annual fee')}
        fee_summary = txt('公布标准年费，不代表个人已收取或已获豁免。', 'Published standard fee; it does not show a personal charge or waiver.')
        for role, fee in [('primary', card.get('fee')), ('additional', card.get('additionalFee'))]:
            if fee:
                rule(f'fee-{role}', 'fee', 'fee', ['card-ownership'], [], fee_title[role], fee_summary, fee['quote'], {'amount': fee['amount'], 'currency': fee['currency'], 'period': 'annual-fee', 'billingCycle': 'issuer-account-terms', 'cardholderRole': role, 'actualCharge': None}, embedded=fee.get('embedded', False), source=fee.get('source'))
        programme_ids = [link['programmeId']] if link else []
        for index, row in enumerate(card.get('earning', [])):
            label = txt(row['zh'], row['en'])
            logos['earningLabels'].setdefault(label, row['category'])
            if row['unit'] not in taxonomy['rateUnits']:
                taxonomy['rateUnits'].append(row['unit'])
            summary = txt(row.get('noteZh') or '公布赚取比例；类别范围和限额以条款为准。', row.get('noteEn') or 'Published earning rate; category scope and caps follow the terms.')
            terms = {'multiplier': row['multiplier'], 'unit': row['unit'], 'spendCategory': label, 'spendCap': row.get('cap'), 'creditedSpendMayNotEarn': None}
            if row.get('afterCap') is not None:
                # The rate past the cap, when the page states it; otherwise the card's base rate applies.
                terms['afterCapPercent'] = row['afterCap']
            rule(f'earning-{index}', 'earning-rate', 'earning', ['reward-redemption'], programme_ids, label, summary, row['quote'], terms, row.get('validity'), row.get('embedded', False), source=row.get('source'))
        for row in card.get('credits', []):
            title, summary = txt(row['zh'], row['en']), txt(row['noteZh'], row['noteEn'])
            terms = {'category': row.get('category', 'credit'), 'period': row.get('period'), 'amount': row.get('amount'), 'currency': row.get('currency', 'USD' if row.get('amount') is not None else None)}
            if 'enrollment' in row:
                terms['requiresEnrollment'] = row['enrollment']
            terms.update(row.get('terms', {}))
            rule(row['key'], 'benefit', row.get('category', 'credit'), row.get('scenarios') or [row['scenario']], row.get('programmeIds', []), title, summary, row['quote'], terms, row.get('validity'), row.get('embedded', False), row.get('original'), row.get('source'))

    for key, value in tr['zh-TW'].items():
        tr['zh-TW'][key] = value.replace('托執行李', '托運行李').replace('髮卡', '發卡').replace('美元后', '美元後')
    if missing:
        raise SystemExit('Quotes not found on the saved issuer pages:\n' + '\n'.join(missing))
    manifest['snapshotId'] = f"cardybara-public-knowledge-{checked}.cards-{batch['batch']}"
    manifest['asOf'] = checked
    write(base / 'rules.json', rules)
    write(base / 'sources.json', sources)
    write(base / 'manifest.json', manifest)
    write(base / 'entities.json', entities)
    write(base / 'taxonomy.json', taxonomy)
    write(root / 'src/data/card-products.json', products)
    write(root / 'src/data/card-product-overrides.json', overrides)
    i18n_catalog.save(root, tr, 'knowledge')
    write(root / 'src/data/logos.json', logos, indent=1)
    if asset_rows:
        assets = root / 'public/ASSET-SOURCES.md'
        anchor = '| The Leading Hotels of the World Leaders Club |'
        lines = assets.read_text().split('\n')
        at = next(i for i, line in enumerate(lines) if line.startswith(anchor))
        assets.write_text('\n'.join(lines[:at + 1] + asset_rows + lines[at + 1:]))
    write_coverage()
    print('cards', len(batch['cards']), 'rules', len(rules), 'sources', len(sources))


FEE = {'USD': '$'}


def write_coverage():
    selection = read(root / 'docs/knowledge/card-batches/selection.json')
    batches = [read(p) for p in sorted((root / 'docs/knowledge/card-batches').glob('batch-*.json'))]
    done = {c['id']: (b['batch'], c) for b in batches for c in b['cards']}
    products = {p['id']: p for p in read(root / 'src/data/card-products.json')['products']}
    out = ['# 美国常见卡片覆盖表', '', selection['method'], '', '“读取”指插件能否自动读取账户数据；这里的资料只是公开产品信息，不代表该银行已能采集或已验收。卡面暂不新增，发卡行图片的使用条款未确认。', '',
           '| 批次 | 卡片 | 年费 | 赚取规则 | 福利 | 转点计划 | 读取 | 未知或跳过 | 官方来源 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for row in selection['cards']:
        entry = done.get(row['id'])
        if not entry:
            out.append(f"| — | {row['name']} | — | — | — | — | — | {row.get('skip') or '待处理'} | — |")
            continue
        number, card = entry
        fee = card.get('fee')
        fee_text = f"{FEE.get(fee['currency'], '')}{fee['amount']}" if fee else '未知'
        unknown = '；'.join(u['zh'] for u in card.get('unknown', [])) or '—'
        out.append(f"| {number} | {row['name']} | {fee_text} | {len(card.get('earning', []))} | {len(card.get('credits', []))} | {' · '.join(products[row['id']]['rewardPrograms']) or '—'} | {'暂不支持' if card.get('collection') == 'not-supported' else '已支持的银行，未验收'} | {unknown} | {card['url']} |")
    (root / 'docs/knowledge/US_CARD_COVERAGE.md').write_text('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
