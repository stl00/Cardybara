"""Apply the dated, human-reviewed public coupon batch. No network or personal data.
Re-running is idempotent; it does NOT constitute a fresh source review.
"""
import copy
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'src/data/knowledge'
DAY='2026-10-29'
RULES=json.loads((BASE/'rules.json').read_text())
SOURCES=json.loads((BASE/'sources.json').read_text())
MANIFEST=json.loads((BASE/'manifest.json').read_text())
NEW_SOURCES=[
 ('coupon-gold-guide-20261029','Amex Gold 官方会员指南及可索引权益条款','https://www.americanexpress.com/en-us/account/get-started/gold/explore-benefits?searchresult=uber+eats+benefit'),
 ('coupon-uber-amex-20261029','Uber 官方 Amex Uber Cash 使用与到期说明','https://www.uber.com/us/en/u/amex/'),
 ('coupon-aspire-flight-20261029','Amex Aspire 官方机票抵扣条款（搜索索引可读）','https://global.americanexpress.com/card-benefits/detail/flight-credit/hilton-aspire'),
 ('coupon-aspire-resort-20261029','Amex Aspire 官方 Resort 条款（搜索索引可读）','https://global.americanexpress.com/card-benefits/terms/hilton-aspire'),
 ('coupon-csr-terms-20261029','Chase 个人 Sapphire Reserve 官方详细条款','https://www.chase.com/personal/credit-cards/offerdetails/chasesapphire'),
 ('coupon-peloton-chase-20261029','Peloton 官方 Chase 会员权益与FAQ','https://www.onepeloton.com/chase-sapphire-reserve'),
]
for id,title,url in NEW_SOURCES:
 if not any(s['id']==id for s in SOURCES):SOURCES.append(dict(id=id,title=title,url=url,checkedAt=DAY,authority='official'))

def coupon(source,section,**kw):
 c=dict(schema=1,delivery='statement-credit',capScope='card-account',enrollment='unknown',eligibleCountries=[],eligibleMerchants=[],eligibleChannels=[],excludedPurchases=[],conditionalPurchases=[],redemption=dict(mode='cumulative',couponsPerPeriod=None,perCouponAmount=None,separateOrders=None,unusedPortionForfeited=None),carryover=None,posting=dict(maximumDays=None,timingBasis='unknown',deadlineTimeZone=None),refundPolicy='退款、取消和改订后的处理仍须核对原条款；不推定退款恢复额度。',additionalCards=dict(eligible=None,sharesCap=None),minimumNights=None,review=dict(checkedAt=DAY,sourceIds=[source],section=section,access='official-page',unresolved=['个人登记、账户资格、剩余额度及实际到账仍需个人证据。']))
 c.update(kw)
 return c

def amex(section,**kw):
 c=coupon('coupon-gold-guide-20261029',section,enrollment='required',eligibleCountries=['US'],posting=dict(maximumDays=56,timingBasis='merchant-reported-date',deadlineTimeZone=None),refundPolicy='退货、退款、取消或修改交易可能导致报销不发放或被追回。',additionalCards=dict(eligible=True,sharesCap=True),**kw)
 c['review']['access']='mixed'
 return c

def chase(section,**kw):
 return coupon('coupon-csr-terms-20261029',section,posting=dict(maximumDays=28,timingBasis='merchant-reported-date',deadlineTimeZone='America/New_York'),refundPolicy='退货、取消、修改及获抵扣后90天内关户可能追回报销；不推定恢复额度。',additionalCards=dict(eligible=True,sharesCap=True),**kw)

def voucher(count,amount):
 return dict(mode='single-coupon' if count==1 else 'multiple-coupons',couponsPerPeriod=count,perCouponAmount=amount,separateOrders=True,unusedPortionForfeited=True)

BATCH=[]
def add(product,suffix,summary,c,steps,terms=None):
 BATCH.append((f'rule.{product}.{suffix}',summary,c,steps,terms or {}))
GOLD='amex-us-us-american-express-gold-card'
ASPIRE='amex-us-us-hilton-honors-aspire-card'
CSR='chase-us-sapphire-reserve'

add(GOLD,'dining','登记后每月合计最多10美元账单报销；仅当前指定美国合作商户，主副卡共享账户额度。',amex('$120 Dining Credit',eligibleMerchants=['Grubhub（含Seamless）','Buffalo Wild Wings','Five Guys','The Cheesecake Factory','Wonder'],eligibleChannels=['美国参与商户直接店内消费','参与商户美国地点的直接线上订单'],excludedPurchases=['未在当前合作名单中的商户不能套用旧名单（如Goldbelly、Wine.com）'],conditionalPurchases=['第三方付款、电子钱包、商户收单方式可能导致交易无法识别']),['先由主卡或授权账户管理人登记，再向当前名单中的美国商户直接消费。','每月10美元是账户合计上限，不是每位附属卡各10美元；跨月交易以商户报送日期为准。','保留交易记录；可能需等8周到账，未到账不自动当成不合格。'])
add(GOLD,'resy','登记后1–6月、7–12月各最多50美元；美国交易时标注合资格的Resy/Tock商户与指定直接渠道，礼品卡不保证。',amex('$100 Resy Credit',eligibleMerchants=['付款时在Resy或Tock预订页标示合资格的美国餐饮场所'],eligibleChannels=['合资格美国商户直接付款','Resy.com / Resy App / Resy Pay','美国场所直接Tock预付预订或订金（2026-09-15起）'],excludedPurchases=['Resy餐厅管理软件','Resy品牌American Express礼品卡'],conditionalPurchases=['餐厅礼品卡、外送、餐饮外烩、活动第三方收单可能不获抵扣','登记处理可能需24小时；付款时须仍在合资格名单']),['先登记并确认生效；查询付款当天的合资格标示，不把所有可订餐厅都视为合资格。','按半年共享50美元上限记录；普通餐厅礼品卡等边界消费不作到账保证。','Tock直接预付渠道有明确2026-09-15生效日，不倒推更早消费。'])
add(GOLD,'dunkin','登记后美国Dunkin每月合计最多7美元；网上礼品卡和其他零售商的Dunkin产品不适用。',amex('$84 Dunkin Credit',eligibleMerchants=['接受Amex的美国Dunkin地点'],eligibleChannels=['直接向合资格Dunkin地点消费'],excludedPurchases=['网上购买礼品卡','其他零售商出售的Dunkin品牌产品或礼品卡'],conditionalPurchases=['外送平台、外烩或机场/加油站等店中店可能无法识别','App储值充值与实体礼品卡本次未取得明确适用确认']),['先登记，再向美国合资格Dunkin地点直接付款。','不要把网上礼品卡、第三方品牌商品，或社区充值经验记成官方保证。','按月7美元账户共享上限核对，预计到账最长8周。'])
c=coupon('coupon-uber-amex-20261029','$120 Uber Cash / How It Works',delivery='wallet-credit',capScope='primary-cardmember',enrollment='link-card',eligibleCountries=['US'],eligibleMerchants=['Uber','Uber Eats','Postmates'],eligibleChannels=['Uber账户直接添加Gold卡；使用时开启Uber Cash并选择Amex付款'],excludedPurchases=['通过Apple Pay或PayPal等第三方方式添加Gold卡不能领取此权益','美国境外使用'],conditionalPurchases=['同一张合资格Gold卡只可在一个Uber账户领取；附属卡领取资格不应推断'],carryover=False,posting=dict(maximumDays=None,timingBasis='merchant-wallet',deadlineTimeZone='Pacific/Honolulu'),refundPolicy='退款后Uber Cash的恢复及原到期日需在Uber账户核对。',additionalCards=dict(eligible=None,sharesCap=None))
c['review']['sourceIds'].append('coupon-gold-guide-20261029')
c['review']['access']='mixed'
add(GOLD,'uber','Gold主卡直接关联Uber后每月10美元Uber Cash；美国使用，开启Uber Cash并选Amex付款；月底夏威夷时间23:59到期。',c,['在Uber账户直接添加合资格Gold卡，不通过电子钱包间接添加。','使用时开启Uber Cash并选择Amex付款；这是Uber余额而不是Amex账单报销。','当月赠额不结转；截止时区为夏威夷时间，账户实际余额仍需核对。'],{'annualMaximum':120})

c=coupon('coupon-aspire-flight-20261029','$200 Flight Credit',eligibleChannels=['航空公司直接销售的定期客运航班机票','AmexTravel.com','Amex Travel App'],excludedPurchases=['包机','私人飞机','度假套票中的航班'],conditionalPurchases=['其他第三方渠道可能不符合；不把Travel Bank储值经验当作官方机票条款'],posting=dict(maximumDays=84,timingBasis='merchant-reported-date',deadlineTimeZone=None),refundPolicy='退货、退款、取消或修改交易可能导致抵扣不发放或被追回。',additionalCards=dict(eligible=True,sharesCap=True))
c['review']['access']='official-indexed-terms'
c['review']['unresolved'].append('原始权益端点直接读取403；本批依据官方可索引条款，尚未完整核对所有支付例外。')
add(ASPIRE,'flight','每自然季合计最多50美元机票账单抵扣；航空公司或Amex直接机票渠道，包机、私人飞机、度假套票航班排除。',c,['确认是定期客运机票以及航空公司或Amex直接购票渠道。','每季50美元按账户合计；不是全年200美元可一次使用，也不等同白金卡航空杂费抵扣。','商户报送日期可能影响归季；到账最长可达12周。'])
c=coupon('coupon-aspire-resort-20261029','$400 Hilton Resort Credit',eligibleMerchants=['Hilton Aspire Resort Credit官方名单内参与度假酒店'],eligibleChannels=['直接向参与Resort付款','餐饮/水疗等杂费先挂房账，再以Aspire结算'],excludedPurchases=['非参与名单的普通Hilton酒店','SLH酒店','Advance Purchase或Non-Refundable房价'],conditionalPurchases=['餐厅/水疗直接结账，未挂房账时不保证符合'],additionalCards=dict(eligible=None,sharesCap=True))
c['review']['access']='official-indexed-terms'
c['review']['unresolved'].append('原始条款端点直接读取403；附属卡细节、到账窗口及退款处理需补充可直接读取的官方条款。')
add(ASPIRE,'resort','1–6月和7–12月各最多200美元；仅参与Hilton Resort直接合资格消费；预付不可退房价及SLH排除，店内杂费须挂房账。',c,['先核对酒店是否在Aspire Resort Credit参与名单，不能只看Hilton品牌。','核对房价不是Advance Purchase或Non-Refundable；餐饮和水疗须挂房账并用Aspire结算。','按半年200美元账户上限管理；名单和实际到账仍需核对。'])

add(CSR,'edit','自然年合计500美元，每笔最多250美元；Chase Travel的The Edit预付Pay Now至少两晚，抵扣部分不赚点。',chase('$500 Credit for stays with The Edit',enrollment='not-required',eligibleMerchants=['Chase Travel中The Edit参与酒店'],eligibleChannels=['Chase Travel预付Pay Now住宿'],excludedPurchases=['少于两晚','非The Edit预订','非预付Pay Now预订'],conditionalPurchases=['商户处理延误可能跨期；抵扣部分不赚积分'],minimumNights=2),['在Chase Travel确认The Edit、至少两晚及Pay Now预付。','2026年起按自然年500美元，每笔最多250美元，不套用半年规则。','以东部时间周期末及交易处理为准；取消或修改可能追回报销。'],{'requiresEnrollment':False})
add(CSR,'dining','每半年最多150美元；仅指定餐厅直接可识别消费；礼品卡、商品和第三方外送等不符合。',chase('$300 Annual Dining Credit',enrollment='not-required',eligibleMerchants=['Sapphire Reserve Exclusive Tables当前指定餐厅'],eligibleChannels=['直接向指定餐厅付款'],excludedPurchases=['礼品卡','商品','第三方支付处理或外送平台交易'],conditionalPurchases=['名单可能变化；商户处理延误可能跨期']),['核对当前参与名单和直接收单，不把所有OpenTable餐厅视为合资格。','每半年150美元，东部时间6月30日/12月31日23:59结束。','预订资格与报销交易条件分别核对；最迟可能4周到账。'],{'requiresEnrollment':False})
for suffix,count,amount,non_restaurant in [('doordash-general',1,15,False),('doordash-retail',2,10,True)]:
 c=coupon('coupon-csr-terms-20261029','$15 Monthly Promotion' if count==1 else 'Two $10 Monthly Promotions on Non-Restaurant Orders',delivery='checkout-discount',capScope='person',enrollment='required',eligibleCountries=['US'],eligibleMerchants=['DoorDash合资格非餐饮商户' if non_restaurant else 'DoorDash合资格订单商户'],eligibleChannels=['以该CSR激活DashPass后，在DoorDash结账选择折扣并使用同一卡付款'],excludedPurchases=['礼品卡','配送/服务等费用、税费及小费','电子钱包或第三方支付账户'],conditionalPurchases=['仅从订单商品小计抵扣；非所有商户与品牌参与'],redemption=voucher(count,amount),carryover=False,posting=dict(maximumDays=0,timingBasis='checkout',deadlineTimeZone=None),refundPolicy='券一旦兑换，即使订单退款或平台退余额，也不会返还该券。',additionalCards=dict(eligible=None,sharesCap=None))
 c['review']['unresolved'].append('条款按每人每月兑换次数限制；不能据此推断每张附属卡另有一套券。')
 summary='每月两张各10美元非餐饮券，须分两单；单券未用足作废，费用/税/小费不抵，退款不返券。' if non_restaurant else '每月一张15美元结账券，单笔使用；未用足作废，费用/税/小费不抵，退款不返券。'
 add(CSR,suffix,summary,c,['先确认该CSR的DashPass有效并以同一卡付款；结账手动选择折扣。','每张券只用一单；两张10美元券不能合成一张20美元券。' if non_restaurant else '15美元券一次使用，订单小计不足15美元的余值会失效。','当月不结转，券兑换后退款不返券；不要用总金额差额推算还剩几张券。'])
add(CSR,'stubhub','登记后每半年最多150美元，活动至2027-12-31；StubHub或viagogo直接购票；礼品卡及StubHub International排除。',chase('$300 Annual StubHub Credit through 12/31/27',enrollment='required',eligibleMerchants=['StubHub','viagogo'],eligibleChannels=['stubhub.com / StubHub App','viagogo.com / viagogo App'],excludedPurchases=['礼品卡','StubHub International（含stubhub.co.uk跳转交易）'],conditionalPurchases=['英国活动跳转的国际站不能套用美国StubHub资格']),['先在Chase账户激活，再通过官方支持的网站或App直接购票。','每半年150美元且不要求最低购买额；东部时间周期末截止。','退款、取消及部分关户情形可能追回抵扣；活动到期日不是个人剩余额度。'])
c=coupon('coupon-csr-terms-20261029','Up to $120 Annual Peloton Membership Credit through 12/31/27',enrollment='required',eligibleCountries=['US'],eligibleMerchants=['Peloton'],eligibleChannels=['直接向Peloton支付合资格月度会员'],excludedPurchases=['Apple App Store或Google Play等第三方订阅','美国境外购买'],conditionalPurchases=['All-Access、Rental、App+、App One、Strength+等当期合资格月度会员；不把器材积分优惠当会员报销'],posting=dict(maximumDays=56,timingBasis='unknown',deadlineTimeZone=None),additionalCards=dict(eligible=True,sharesCap=True))
c['review']['sourceIds'].append('coupon-peloton-chase-20261029')
c['review']['unresolved'].append('Peloton页面FAQ含2025-06-23新持卡人措辞，与其引述Chase条款范围未完全一致；个人旧卡适用需核对权益页。')
add(CSR,'peloton','Chase激活后，美国向Peloton直接支付的合资格月度会员每月最多10美元；第三方App商店不适用，活动至2027-12-31。',c,['先在Chase激活，直接向Peloton支付合资格月度会员，不能通过App商店代收。','账户每月共享10美元；器材10倍积分与会员报销分开，不把年付会员自动按月摊抵。','最迟可能8周到账；旧账户个人资格仍需核对。'])

def apply_batch():
 for id,summary,c,steps,extra in BATCH:
  previous=max((r for r in RULES if r['id']==id and (not r['validity']['effectiveFrom'] or r['validity']['effectiveFrom']<=DAY)),key=lambda r:r['revision'])
  if previous['evidence']['checkedAt']==DAY and previous['terms'].get('coupon')==c and previous['content']['summary']==summary and previous['content']['howToUse']==steps and all(previous['terms'].get(k)==v for k,v in extra.items()):continue
  if previous['evidence']['checkedAt']>=DAY:raise RuntimeError('Conflicting dated revision: '+id)
  r=copy.deepcopy(previous)
  r.update(revision=previous['revision']+1,revisionId=id+'@'+DAY+'.'+str(previous['revision']+1),supersedes=previous['revisionId'])
  r['content'].update(summary=summary,howToUse=steps)
  r['terms'].update(extra,coupon=c)
  r['conditions']['unparsedText']='；'.join([summary,*c['excludedPurchases'],*c['conditionalPurchases'],c['refundPolicy']])
  r['evidence'].update(sourceIds=c['review']['sourceIds'],checkedAt=DAY,supports=['content.summary','content.howToUse','terms','terms.coupon','conditions.unparsedText','validity'])
  r['review'].update(checkedAt=DAY,reviewAfter='2026-11-28')
  RULES.append(r)
 MANIFEST.update(schemaVersion='1.2.0',asOf=DAY)
 if not MANIFEST['snapshotId'].startswith('cardybara-public-knowledge-2026-10-29.coupon-'):MANIFEST['snapshotId']='cardybara-public-knowledge-2026-10-29.coupon-1'
 for name,value in [('rules.json',RULES),('sources.json',SOURCES),('manifest.json',MANIFEST)]:
  (BASE/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'datedCouponRevisions':len(BATCH),'rules':len(RULES),'sources':len(SOURCES)}))

if __name__=="__main__":apply_batch()
