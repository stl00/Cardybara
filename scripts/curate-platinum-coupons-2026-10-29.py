"""Dated official Morgan Stanley Platinum coupon review, not a live scraper."""
import copy
import json
import runpy
from pathlib import Path

g=runpy.run_path(str(Path(__file__).with_name('curate-coupon-knowledge-2026-10-29.py')))
BASE=g['BASE'];RULES=g['RULES'];SOURCES=g['SOURCES'];MANIFEST=g['MANIFEST'];DAY=g['DAY']
coupon=g['coupon'];add=g['add'];BATCH=g['BATCH'];MS='amex-us-us-morgan-stanley-platinum-card'
source='coupon-ms-print-20261029'
if not any(s['id']==source for s in SOURCES):SOURCES.append(dict(id=source,title='Amex Morgan Stanley Platinum 官方申请印刷版权益条款',url='https://www.americanexpress.com/us/credit-cards/card-application/apply/partner/print/personal-card/msb/morgan-stanley-platinum-card/ep-msb-mcs-58?print=false',checkedAt=DAY,authority='official'))

if not any(s['id']=='coupon-ms-product-20261029' for s in SOURCES):SOURCES.append(dict(id='coupon-ms-product-20261029',title='Amex Morgan Stanley Platinum 官方产品权益说明',url='https://apply.americanexpress.com/amex-morgan-stanley%20-credit-cards/?page_url=38',checkedAt=DAY,authority='official'))

def ms(section,**kw):
 return coupon(source,section,posting=dict(maximumDays=56,timingBasis='merchant-reported-date',deadlineTimeZone=None),additionalCards=dict(eligible=True,sharesCap=True),refundPolicy='退款、取消、退货或修改合资格交易可能导致抵扣不发放或被追回。',**kw)

add(MS,'airline-fee','每自然年200美元航空杂费：先选一家合资格航司；机票、升舱、买分、转分费、礼品卡和奖励机票排除。',ms('$200 Airline Fee Credit',enrollment='required',eligibleMerchants=['已选择的一家当期合资格航空公司'],eligibleChannels=['由所选航司直接收取、与机票费用分开识别的合资格杂费'],excludedPurchases=['机票','升舱','购买里程','转移里程手续费','礼品卡','免税商品','奖励机票','非所选航司收费（含联盟伙伴或第三方Wi-Fi）'],conditionalPurchases=['先选航司再消费；更换航司通常仅每年1月一次','航司须提交可识别杂费的交易资料']),['先确认个人已选航司，再区分机票与杂费，不套用Aspire机票抵扣规则。','账户自然年共享200美元；未选航司前的费用不符合。','合资格杂费通常最多等8周，退款或取消可能追回。'])
add(MS,'digital','登记后每月合计25美元，限美国参与伙伴的合资格直接订阅；不是所有流媒体、礼品卡或App商店代收。',ms('$300 Digital Entertainment Credit',enrollment='required',eligibleCountries=['US'],eligibleMerchants=['Disney+','ESPN streaming','Hulu','The New York Times','Paramount+','Peacock','The Wall Street Journal','YouTube TV / Music / Premium'],eligibleChannels=['当期伙伴官网直接订阅；各伙伴子服务和加购规则分别适用'],excludedPurchases=['第三方零售预付或礼品卡','第三方代收或有线电视捆绑订阅','广告服务','Peacock加购订阅','WSJ Wine、WSJ活动或商品'],conditionalPurchases=['NYT仅合资格新闻、Cooking、Games、Wirecutter和All Access等；不同伙伴覆盖不相同','订阅会自动续费，取消银行卡不等于取消订阅']),['先登记，再核对具体服务与直接收款方；不要只看品牌名。','所有参与伙伴与主副卡合计共享每月25美元。','本项是账单报销；不要把它当作平台内可直接使用的余额。'])
c=ms('$600 Lodging Credit (also known as $600 Hotel Credit)',eligibleMerchants=['Fine Hotels + Resorts','The Hotel Collection','Airbnb Luxe'],eligibleChannels=['Amex Travel网站或App预付Pay Now','FHR/THC可通过合资格卡背电话预付渠道'],excludedPurchases=['酒店现场另收的房费或杂费','保险费、利息、取消费、物业费等附加费用','非Amex Travel预订','非参与项目的酒店或Airbnb房源'],conditionalPurchases=['THC和Airbnb Luxe需连续两晚；FHR的两晚要求从2027-01-01才生效','Airbnb Luxe需关联Airbnb与Amex账户；不是任意Airbnb房源','Companion Platinum仅能用于THC及Airbnb Luxe，不能据此使用FHR；卡片角色须确认'])
c['posting']=dict(maximumDays=90,timingBasis='merchant-reported-date',deadlineTimeZone='America/Chicago')
add(MS,'lodging','每半年最多300美元住宿报销，限Amex Travel预付的FHR、THC或Airbnb Luxe；THC/Luxe须两晚；FHR两晚要求2027年起生效。',c,['先确认合资格卡角色与预付渠道，不把普通酒店直订或任意Airbnb当作符合。','THC、Airbnb Luxe至少连续两晚；2026年的FHR不提前套用2027年新规。','半年截止以美国中部时间为准，处理须在周期内；报销最长可能90天。'])
add(MS,'lululemon','登记后每季75美元；美国lululemon直接门店、官网或App；礼品卡、outlet、Like New及境外寄送排除。',ms('$300 lululemon Credit',enrollment='required',eligibleCountries=['US'],eligibleMerchants=['美国lululemon合资格门店','lululemon.com美国网站','lululemon App'],eligibleChannels=['向lululemon直接付款且寄送符合美国地区要求'],excludedPurchases=['礼品卡','outlet','Like New','lululemon Studio','warehouse、event、showroom或批发交易','寄送美国境外'],conditionalPurchases=['第三方付款或商户资料不可识别时不保证报销']),['先登记；核对门店、网站地区、寄送地区和商品类型。','每季75美元主副卡共享，不是每卡一份。','礼品卡不能因为是官网出售就当作符合。'])
add(MS,'oura','登记后每自然年200美元，仅美国ouraring.com直接购买合资格Oura Ring；会员、配件、礼品卡及第三方零售排除。',ms('$200 Oura Ring Credit',enrollment='required',eligibleCountries=['US'],eligibleMerchants=['ouraring.com美国网站'],eligibleChannels=['官方美国网站直接购买Oura Ring并寄送合资格美国地址'],excludedPurchases=['Oura会员订阅','充电器和其他硬件配件','延长保修','礼品卡','第三方零售或中间平台','寄送美国领地或境外']),['先登记，确认订单为合资格戒指并直接由官方美国网站收款。','会员费、充电器及第三方商店不按此项报销。','按自然年账户共享200美元，退款可能追回。'])
c=copy.deepcopy(next(c for id,summary,c,steps,extra in BATCH if id.endswith('gold-card.resy')))
c['review'].update(sourceIds=[source],section='$400 Resy Credit',access='official-page')
add(MS,'resy','登记后每自然季100美元，限美国当时标注合资格的Resy/Tock场所与指定直接渠道；主副卡共享，礼品卡不保证。',c,['先登记并确认生效，再核对付款当天的Resy/Tock合资格标示。','每季100美元，不套用Gold的每半年50美元周期。','餐厅礼品卡、外送和第三方活动收单不保证到账。'])
c=coupon(source,'$200 Uber Cash',delivery='wallet-credit',capScope='primary-cardmember',enrollment='link-card',eligibleCountries=['US'],eligibleMerchants=['Uber','Uber Eats','Postmates'],eligibleChannels=['直接将合资格白金卡添加到Uber账户；使用时开启Uber Cash并选Amex付款'],excludedPurchases=['电子钱包或第三方间接绑卡','美国境外','家庭profile','既往交易'],conditionalPurchases=['仅主卡领取白金Uber Cash；不能因附属卡可触发其他报销就推断可另领'],carryover=False,posting=dict(maximumDays=None,timingBasis='merchant-wallet',deadlineTimeZone='Pacific/Honolulu'),additionalCards=dict(eligible=False,sharesCap=None),refundPolicy='退款后的Uber Cash处理与到期日需在Uber账户核对，不视为账单退款。')
add(MS,'uber','主卡关联Uber后1–11月各15美元、12月35美元Uber Cash；美国使用，月底夏威夷时间到期；不是账单报销。',c,['直接添加合资格白金主卡，使用时开启Uber Cash并选择Amex付款。','12月有额外20美元；不是全年每月均35美元。','月底不结转，普通白金附属卡不另领此福利；与Uber One报销分开。'])
add(MS,'uber-one','每自然年最多120美元Uber One会员账单报销，可月付或年付；必须由卡实际支付，Uber Cash或优惠覆盖部分不报销。',ms('$120 Uber One Credit',enrollment='not-required',eligibleCountries=['US'],eligibleMerchants=['Uber One'],eligibleChannels=['将合资格白金卡直接设为Uber One会员付款卡；关闭Uber Cash支付会员费'],excludedPurchases=['免费试用期间未实际扣费','由Uber Cash、Uber One credits或其他优惠支付的部分','通过Apple Pay或PayPal等第三方绑卡'],conditionalPurchases=['美国会员与账户适用，Northern Mariana、American Samoa、Guam和US Virgin Islands排除','会员自动续费；移除银行卡不会自动取消会员']),['确认是Uber One会员费并关闭Uber Cash，让合资格银行卡实际扣费。','月付或年付均可，主副卡合计自然年120美元。','不要与每月赠送的Uber Cash混为同一种福利。'])
add(MS,'walmart','每月仅首笔处理的Walmart+月费报销，最高12.95美元另加适用税；年费、Plus Ups及Business+不符合。',ms('Walmart+ Monthly Membership Credit',eligibleMerchants=['Walmart+'],eligibleChannels=['直接向Walmart支付自动续费的月度Walmart+会员'],excludedPurchases=['年付Walmart+会员','Plus Ups（如InHome）','Walmart Business+'],conditionalPurchases=['每账户每月仅首笔处理的合资格会员费；不能每张附属卡各报一份','12.95美元为基数，另有适用税费；不能当作所有情形的绝对报销封顶']),['核对会员为月付，并使用主卡或附属卡付款。','年付不自动拆成月度报销；升级服务与Business+不适用。','不把12.95美元加税的规则显示成固定12.95美元绝对上限。'])
add(MS,'clear','每自然年合计最高219美元CLEAR+年会员费；自动续费，适用税费和额外费用不在本次公布覆盖内。',ms('$219 CLEAR+ Credit',eligibleMerchants=['CLEAR+'],eligibleChannels=['合资格卡直接支付CLEAR+年会员费'],excludedPurchases=['适用税费和额外费用（按产品页说明）'],conditionalPurchases=['必须完成CLEAR会员申请及批准；银行不控制批准','CLEAR退款后已获账单抵扣会被追回']),['确认实际年会员费及CLEAR批准，不把申请本身当作已获会员。','主副卡合计自然年219美元；本项会自动续费。','退款会影响已获抵扣；预计最长8周到账。'])

# CLEAR tax/fee exclusion is supported by the product page as well as the print terms.
next(c for id,summary,c,steps,extra in BATCH if id==f'rule.{MS}.clear')['review']['sourceIds'].append('coupon-ms-product-20261029')

# Future revision is retained but not selected before its actual effective date.
g['apply_batch']()
futureId=f'rule.{MS}.lodging'
current=max((r for r in RULES if r['id']==futureId and not r['validity']['effectiveFrom']),key=lambda r:r['revision'])
future=copy.deepcopy(current)
future.update(revision=current['revision']+1,revisionId=futureId+'@2026-10-29.'+str(current['revision']+1),supersedes=current['revisionId'])
future['validity']['effectiveFrom']='2027-01-01'
future['terms']['coupon']['minimumNights']=2
future['terms']['coupon']['conditionalPurchases'][0]='2027-01-01起FHR、THC及Airbnb Luxe均须连续两晚；具体卡角色及渠道仍须符合。'
future['content']['summary']='每半年最多300美元住宿报销；2027-01-01起FHR、THC及Airbnb Luxe均须连续两晚并由Amex Travel合资格渠道预付。'
future['content']['howToUse'][1]='2027-01-01起FHR、THC及Airbnb Luxe都必须至少连续两晚。'
future['conditions']['unparsedText']='；'.join([future['content']['summary'],*future['terms']['coupon']['excludedPurchases'],*future['terms']['coupon']['conditionalPurchases']])
future_added=not any(r['revisionId']==future['revisionId'] for r in RULES)
if future_added:RULES.append(future)
MANIFEST['snapshotId']='cardybara-public-knowledge-2026-10-29.coupon-2'
for name,value in [('rules.json',RULES),('sources.json',SOURCES),('manifest.json',MANIFEST)]:
 (BASE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'activeDetailedCoupons':22,'futureRevisionsAdded':int(future_added),'rules':len(RULES),'sources':len(SOURCES)}))
