"""Apply reviewed public-source notes for held product identities. No account observations."""
from pathlib import Path
import sys,json,re,datetime
sys.path.insert(0,str(Path(__file__).resolve().parent));import i18n_catalog
sys.path.insert(0,'/tmp/cardybara-text-tools')
from opencc import OpenCC
cc=OpenCC('s2twp')
root=Path(__file__).resolve().parents[1];base=root/'src/data/knowledge'
load=lambda f:json.loads((base/f).read_text())
manifest=load('manifest.json');sources=load('sources.json');entities=load('entities.json');rules=load('rules.json');tr=i18n_catalog.load(root);date='2026-10-27'
def text(cn,en):
 tr['en-US'][cn]=en;tr['zh-TW'][cn]=cc.convert(cn);return cn
def source(id,url,title):
 if not any(x['id']==id for x in sources):sources.append({'id':id,'url':url,'title':title,'checkedAt':date,'authority':'official'})
 return id
def program(name,kind='partner'):
 id='programme.'+re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
 if not any(p['id']==id for p in entities['programmes']):entities['programmes'].append({'id':id,'name':name,'kind':kind,'aliases':[]})
 return id
current=None;currency=None;sid=None
products=[]
def profile(id,bank,country,cur,src,fee,additional=None,gaps=None):
 global current,currency,sid
 current=id;currency=cur;sid=src;products.append(id)
 manifest['profileMetadata'][id]={'checkedAt':date,'coverage':'core-public-rules-reviewed','market':{'issuer':bank,'country':country},'communitySourceIds':[],'changeNotes':[],'knowledgeGaps':gaps or [text('个人登记、使用进度及完整保障细则尚未核实。','Personal enrollment, usage and full insurance terms remain unverified.')],'feeNotes':None}
 add('fee-primary','fee','fee',text('主卡年费','Primary annual fee'),text('公布费用与豁免条件不等于你的实际扣费。','Published fees and waivers do not establish your actual charge.'),{'amount':fee,'currency':cur,'period':'annual-fee','cardholderRole':'primary','actualCharge':None},['card-ownership'])
 add('fee-additional','fee','fee',text('附属卡年费','Additional-card annual fee'),text('附属卡数量、等级与账单安排会影响收费；未知不填零。','Additional-card count, tier and billing affect fees; unknown is not zero.'),{'amount':additional,'currency':cur,'period':'annual-fee','cardholderRole':'additional','actualCharge':None},['card-ownership'])
def add(key,kind,cat,title,summary,terms,scenes,partner=None,src=None,start=None,end=None,enrollBy=None,verification='official-summary'):
 id='rule.'+current+'.'+key
 if any(r['id']==id for r in rules):return
 ids=[program(partner)] if partner else []
 conditions=[]
 if terms.get('requiresEnrollment'):conditions.append({'field':'account.enrolled','op':'eq','value':True})
 if terms.get('spendThreshold') and terms.get('period') in ['calendar-year','earned-year-plus-next']:conditions.append({'field':'account.eligibleCalendarYearSpend','op':'gte','value':terms['spendThreshold'],'currency':currency,'timeScope':'current-or-earned-year-needs-account-proof'})
 rules.append({'id':id,'revision':1,'revisionId':id+'@2026-10-27.1','supersedes':None,'status':'published','kind':kind,'productIds':[current],'market':manifest['profileMetadata'][current]['market'],'category':cat,'scenarioIds':scenes,'programmeIds':ids,'content':{'title':title,'summary':summary,'howToUse':[text('先核对卡种、地区及当前官方条款。','Check the card product, market and current official terms first.'),summary,text('再核对个人资格、登记和剩余额度；知识库不代办操作。','Then verify personal eligibility, enrollment and remaining limits; the library does not perform actions.')]},'terms':terms,'validity':{'effectiveFrom':start,'effectiveThrough':end,'enrollBy':enrollBy},'conditions':{'coverage':'partial','all':conditions,'unparsedText':summary},'evidence':{'sourceIds':src or [sid],'checkedAt':date,'verification':verification,'supports':['content.summary','terms','validity'],'fullTermsReviewed':False},'review':{'checkedAt':date,'reviewAfter':'2026-11-26' if cat=='promo' else '2027-01-25','state':'reviewed-summary'},'personalState':'not-in-public-knowledge'})
def B(key,cat,title,en,condition,conditionEn,period='ongoing',amount=None,partner=None,scenes=None,**kw):
 meta={k:kw.pop(k) for k in ['src','start','end','enrollBy','verification'] if k in kw}
 terms={'category':cat,'period':period,'amount':amount,'currency':currency if amount is not None else None,**kw}
 if partner:terms['partner']=partner
 add(key,'benefit',cat,text(title,en),text(condition,conditionEn),terms,scenes or ['card-ownership'],partner,**meta)
def E(key,label,en,value,unit,condition,conditionEn,**kw):
 add('earning-'+key,'earning-rate','earning',text(label,en),text(condition,conditionEn),{'spendCategory':label,'multiplier':value,'unit':unit,**kw},['reward-redemption'])
def note(cn,en,src=None):
 manifest['profileMetadata'][current]['changeNotes'].append({'effectiveFrom':date,'text':text(cn,en),'sourceIds':src or [sid]})
# US American Express
s=source('gold-us','https://www.americanexpress.com/en-us/credit-cards/credit-intel/gold-card-rewards-points/','Amex US Gold · 费用与核心权益')
source('gold-us-earn','https://www.americanexpress.com/en-us/account/get-started/gold/earn-rewards','Amex US Gold · 赚点规则')
profile('amex-us-us-american-express-gold-card','Amex US','US','USD',s,325)
B('dining','credit','每月餐饮抵扣','Monthly dining credit','需登记；每月最多10美元，仅当期指定美国商户；不把全年120当单次额度。','Enroll; up to $10 monthly at current eligible US merchants; the $120 annual maximum is not a per-order limit.','calendar-month',10,scenes=['dining'],requiresEnrollment=True,annualMaximum=120)
B('uber','promo','Uber Cash','Uber Cash','关联Gold至Uber账户，每月10美元；美国使用及合资格Amex付款条件适用，月底不结转。','Add Gold to Uber for $10 monthly; US use and eligible Amex payment conditions apply; no monthly rollover.','calendar-month',10,'Uber',scenes=['ground-transport','dining'])
B('resy','credit','Resy 餐饮抵扣','Resy dining credit','需登记；美国参与Resy餐厅直接消费，每半年最多50美元。','Enroll; eligible direct US Resy restaurant spending, up to $50 per half-year.','calendar-half-year',50,'Resy',scenes=['dining'],requiresEnrollment=True,annualMaximum=100)
B('dunkin','credit','Dunkin 抵扣','Dunkin credit','需登记；美国Dunkin合资格消费每月最多7美元。','Enroll; eligible US Dunkin purchases up to $7 monthly.','calendar-month',7,'Dunkin',scenes=['dining'],requiresEnrollment=True,annualMaximum=84)
for key,cn,en,v,cap in [('restaurant','餐厅','Restaurants',4,50000),('supermarket','美国超市','US supermarkets',4,25000)]:
 add('earning-'+key,'earning-rate','earning',text(cn,en),text('分类自然年上限后回到基础倍率；商户类别排除项适用。','After the calendar-year category cap, the base rate applies; merchant exclusions apply.'),{'spendCategory':cn,'multiplier':v,'unit':'points-per-USD','annualSpendCap':cap,'capCurrency':'USD'},['dining' if key=='restaurant' else 'shopping'],src=['gold-us-earn'])
E('flights','直订或Amex机票','Direct / Amex flights',3,'points-per-USD','航空公司直订或合资格Amex渠道；其他渠道不自动认定。','Direct airline or eligible Amex channel; other channels are not automatically eligible.')
# Morgan Stanley variant: never silently substitute ordinary Platinum.
s=source('ms-us','https://global.americanexpress.com/card-benefits/view-all/morgan-stanley-platinum-card','Amex · Morgan Stanley Platinum 专属权益')
msFee=source('ms-fee','https://www.americanexpress.com/content/dam/amex/en-us/company/legal/cardmember-agreements/public-site-adhoc-2025-09-18/morgan-stanley-platinum-09-18-2025.pdf','Amex · Morgan Stanley Platinum 2025-09-18协议')
msAu=source('ms-au','https://www.americanexpress.com/en-us/benefits/additional-card/additional-platinum-card/terms-and-conditions/','Amex · Morgan Stanley 附属卡收费')
msCash=source('ms-cashplus','https://www.morganstanley.com/wealth-disclosures/cashplusaccountdisclosurestatement.pdf','Morgan Stanley · CashPlus 条件')
profile('amex-us-us-morgan-stanley-platinum-card','Amex US','US','USD',s,895,0)
for r in rules:
 if current in r['productIds'] and r['kind']=='fee':r['evidence']['sourceIds']=[msFee if r['terms']['cardholderRole']=='primary' else msAu]
note('首张附属白金卡标准年费为0，之后每张195美元；旧账户以通知为准。','The first additional Platinum is $0; later cards are $195 each under current terms; legacy accounts depend on notices.',[msAu])
B('lodging','credit','住宿预订抵扣','Lodging credit','每半年最多300美元；仅合资格Amex预付住宿，具体酒店、平台和最低晚数按最新条款。','Up to $300 per half-year on eligible prepaid Amex lodging; check properties, channels and minimum nights.','calendar-half-year',300,scenes=['hotel-stay'],annualMaximum=600)
B('resy','credit','Resy 餐饮抵扣','Resy dining credit','需登记；美国合资格Resy消费每季最多100美元。','Enroll; eligible US Resy purchases up to $100 quarterly.','calendar-quarter',100,'Resy',scenes=['dining'],requiresEnrollment=True,annualMaximum=400)
B('lululemon','credit','lululemon 抵扣','lululemon credit','需登记；美国合资格门店或官网，每季75美元，outlet等排除条件适用。','Enroll; eligible US stores or website, $75 quarterly; outlet and other exclusions apply.','calendar-quarter',75,'lululemon',scenes=['shopping'],requiresEnrollment=True,annualMaximum=300)
B('oura','credit','Oura Ring 抵扣','Oura Ring credit','需登记；每自然年最多200美元，须向ouraring.com购买合资格戒指。','Enroll; up to $200 per calendar year for an eligible ring from ouraring.com.','calendar-year',200,'Oura',scenes=['shopping'],requiresEnrollment=True)
B('clear','credit','CLEAR+ 会员抵扣','CLEAR+ credit','支付合资格CLEAR+会费，自然年上限219美元；自动续费条件适用。','Eligible CLEAR+ membership fee, $219 per calendar year; auto-renewal terms apply.','calendar-year',219,'CLEAR+',scenes=['airport'])
B('uber','promo','Uber Cash','Uber Cash','关联卡后全年最多200美元；月份分配及美国使用条件以会员页为准。','Link the card for up to $200 annually; monthly allocation and US use terms apply.','calendar-year',200,'Uber',scenes=['ground-transport'])
B('lounge','lounge','Global Lounge Collection','Global Lounge Collection','不同休息室的登记、携客和航班条件各异；Priority Pass需登记。','Enrollment, guest and flight rules vary by lounge; Priority Pass requires enrollment.',partner='Priority Pass',scenes=['airport'],requiresEnrollment=True)
B('walmart','credit','Walmart+ 月费抵扣','Walmart+ monthly membership credit','合资格月费最高12.95美元另加适用税费；Plus Ups不适用。','Eligible monthly membership up to $12.95 plus applicable tax; Plus Ups excluded.','calendar-month',12.95,'Walmart+',scenes=['shopping'])
B('cashplus','credit','CashPlus Engagement Bonus','CashPlus engagement bonus','合资格Platinum CashPlus客户可获895美元；须满足账户条件及续卡时间，不是无条件返年费。','Eligible Platinum CashPlus clients may receive $895; account and renewal conditions apply, not an unconditional fee refund.','account-anniversary',895,'Morgan Stanley CashPlus',src=[msCash])
# Blue Cash Everyday
s=source('bce-us','https://www.americanexpress.com/us/credit-cards/card/blue-cash-everyday/','Amex · Blue Cash Everyday')
bceTerms=source('bce-terms','https://global.americanexpress.com/card-benefits/terms/blue-cash-everyday','Amex · BCE 抵扣条款')
profile('amex-us-us-blue-cash-everyday','Amex US','US','USD',s,0)
for key,cn,en in [('supermarket','美国超市','US supermarkets'),('online','美国网上零售','US online retail'),('gas','美国加油站','US gas stations')]:E(key,cn,en,3,'cashback-percent','各类别每自然年前6000美元返3%，之后1%；各有商户类别排除项。','3% on each category’s first $6,000 per calendar year, then 1%; merchant exclusions apply.',annualSpendCap=6000,capCurrency='USD',afterCapPercent=1)
B('disney','credit','Disney Streaming 抵扣','Disney streaming credit','需登记；合资格Disney订阅每月最多7美元，付款渠道及订阅条件适用。','Enroll; eligible Disney subscriptions up to $7 monthly; subscription and payment-channel terms apply.','calendar-month',7,'Disney',scenes=['entertainment'],src=[bceTerms],requiresEnrollment=True,annualMaximum=84)
B('home-chef','credit','Home Chef 抵扣','Home Chef credit','指定Home Chef订餐链接，合资格订阅每月最多15美元；账户登记及订单限制须核对。','Use the specified Home Chef link for eligible subscriptions, up to $15 monthly; verify enrollment and order restrictions.','calendar-month',15,'Home Chef',scenes=['dining'],src=[bceTerms],annualMaximum=180)
# Aspire
s=source('aspire-us','https://www.americanexpress.com/us/credit-cards/card/hilton-honors-aspire/','Amex · Hilton Aspire')
asTerms=source('aspire-terms','https://global.americanexpress.com/card-benefits/terms/hilton-aspire','Amex · Aspire 详细条款')
profile('amex-us-us-hilton-honors-aspire-card','Amex US','US','USD',s,550)
B('diamond','membership','Hilton Diamond 会籍','Hilton Diamond status','持有合资格卡可享Diamond；需正确关联Hilton账号，房型升级等按品牌及房态。','Eligible card grants Diamond; link the correct Hilton account; upgrades depend on brand and availability.',partner='Hilton Honors',scenes=['hotel-stay'],tier='Diamond')
B('resort','credit','Hilton Resort 抵扣','Hilton resort credit','每半年200美元，仅参与Resort直接消费；不可用于全部Hilton，预付不可退房价及SLH排除。','Up to $200 per half-year at participating resorts directly; not every Hilton qualifies; advance/nonrefundable rates and SLH excluded.','calendar-half-year',200,'Hilton Honors',scenes=['hotel-stay'],src=[asTerms],annualMaximum=400)
B('flight','credit','机票抵扣','Flight credit','每季最多50美元；航空公司直订或合资格Amex机票渠道。','Up to $50 per quarter on direct airline or eligible Amex flight purchases.','calendar-quarter',50,scenes=['travel'],annualMaximum=200)
B('free-night','hotel-service','年度免房晚','Annual free night reward','每持卡年一张；标准房、排除酒店和券到期日适用，不视为现金余额。','One per cardmembership year; standard-room availability, excluded properties and certificate expiry apply; not cash.','account-anniversary',partner='Hilton Honors',scenes=['hotel-stay'],quantity=1)
B('extra-night-30k','spend-unlock','消费解锁免房晚','Spend-unlocked free night','自然年消费达30000美元得一张，累计60000美元再得一张；退货及排除消费扣除。','One after $30,000 annual spending and another at cumulative $60,000; returns and excluded purchases do not count.','calendar-year',partner='Hilton Honors',scenes=['hotel-stay'],spendThreshold=30000,secondThreshold=60000,src=[asTerms])
B('property','hotel-service','Waldorf／Conrad 住宿待遇','Waldorf / Conrad property benefit','指定Aspire优惠价及预订渠道，至少两晚，合资格酒店消费最多100美元；先比较房价。','Specified Aspire rate and channel, two-night minimum, up to $100 eligible property credit; compare the rate first.','per-stay',100,'Hilton Honors',scenes=['hotel-stay'])
for key,cn,en,v in [('hilton','Hilton直订','Hilton direct',14),('travel','指定机票及租车','Selected flights and rentals',7),('dining','美国餐厅','US restaurants',7),('other','其他合资格消费','Other eligible spending',3)]:E(key,cn,en,v,'points-per-USD','仅合资格消费；Hilton基础积分和会籍加成不混作信用卡倍率。','Eligible purchases only; Hilton base and status points are separate from card earning.')
# Unidentified corporate variant — research included, product-specific entitlement not fabricated.
s=source('corporate-us','https://www.americanexpress.com/en-us/business/corporate/benefits/index.shtml','Amex · Corporate 各等级权益')
profile('amex-us-us-corporate-card','Amex US','US','USD',s,None,gaps=[text('Corporate Card等级及雇主方案未确认；不能套用Corporate Green、Gold或Platinum。','Corporate tier and employer plan are unconfirmed; do not substitute Corporate Green, Gold or Platinum.')])
manifest['profileMetadata'][current]['coverage']='variant-unconfirmed'
B('variant','membership','公司卡等级与奖励资格','Corporate tier and reward eligibility','需先确认等级及雇主方案；MR登记、费用和可保留积分由方案决定，不能承诺个人白金福利。','Confirm the tier and employer plan first; MR enrollment, fees and point ownership depend on that plan; no personal Platinum benefits are assumed.')
# HK Amex Platinum
s=source('platinum-hk','https://www.americanexpress.com/hk/en/credit-cards/platinum-card/','Amex HK · The Platinum Card')
hkEarn=source('platinum-hk-earn','https://www.americanexpress.com/hk/en/benefits/the-platinum-card/3xmembership-rewards-points.html','Amex HK · 白金基本积分')
hkAcc=source('platinum-hk-accelerator','https://www.americanexpress.com/en-hk/benefits/offers/shopping/platinum-membership-rewards-accelerator/index.html','Amex HK · 白金积分加速条款')
profile('amex-hk-hk-the-platinum-card','Amex HK','HK','HKD',s,9500,0)
note('含两张免年费附属卡；白金签账卡与同等级信用卡的账户形态仍需核对。','Two supplementary cards included; verify whether the actual account is the charge or credit form.')
for key,cn,en,partner,tier in [('hilton','Hilton Gold 会籍','Hilton Gold status','Hilton Honors','Gold'),('marriott','Marriott Gold 会籍','Marriott Gold status','Marriott Bonvoy','Gold Elite'),('radisson','Radisson Premium 会籍','Radisson Premium status','Radisson Rewards','Premium')]:B(key,'membership',cn,en,'需登记及关联计划账户；个人有效期和酒店待遇按计划条款。','Enroll and link the programme account; personal validity and hotel benefits follow programme terms.',partner=partner,scenes=['hotel-stay'],requiresEnrollment=True,tier=tier)
B('accor','membership','Accor 会籍登记','Accor elite enrollment','官网列Accor Elite Status；具体等级和登记资格需核对专属页面，不推断为最高等级。','Official page lists Accor Elite Status; check the dedicated page for tier and enrollment; do not infer top-tier status.',partner='ALL Accor',scenes=['hotel-stay'],requiresEnrollment=True,tier=None)
B('lounge','lounge','Global Lounge Collection','Global Lounge Collection','参与休息室、登记、携客和航班条件各异，不能与美版次数直接通用。','Participating lounges, enrollment, guest and flight conditions vary; US allowances do not automatically apply.',scenes=['airport'])
B('fhr','hotel-service','Fine Hotels + Resorts','Fine Hotels + Resorts','经指定Amex渠道预订，早餐、退房和酒店消费待遇按酒店及订单条款；不当作现金回赠。','Book through the designated Amex channel; breakfast, checkout and property perks follow booking terms; not cash back.','per-stay',partner='Fine Hotels + Resorts',scenes=['hotel-stay'])
B('thc','hotel-service','The Hotel Collection','The Hotel Collection','参与酒店至少连续两晚；酒店消费额度最高100美元，升级视房态及条款。','Two consecutive nights at participating hotels; property credit up to US$100, upgrades subject to availability.','per-stay',partner='The Hotel Collection',scenes=['hotel-stay'])
B('vacation','credit','Platinum Vacation Credits','Platinum Vacation Credits','官网公布最高4500港币；拆分额度、指定酒店和预订条件尚需逐项核对，不显示成可用现金。','Published up to HK$4,500; component limits, hotels and booking conditions need further checks; not available cash.','ongoing',4500,scenes=['hotel-stay'])
B('dining','promo','白金餐饮优惠','Platinum dining offers','指定餐厅折扣和买一送一有商户、日期及预订限制；不是所有餐饮通用返现。','Selected dining discounts and two-for-one offers have merchant, date and booking restrictions; not universal dining cash back.',scenes=['dining'])
E('base','港币基本积分','HKD base points',1,'points-per-HKD','每港币1元赚1积分；以合资格白金计划为准。','One point per HK$1 under the eligible Platinum programme.')
E('foreign','外币基本积分','Foreign-currency base points',3,'points-per-HKD','外币按等值港币计；若商户先换成港币，不算外币消费。','Per HKD equivalent in foreign currency; merchant conversion to HKD does not qualify as foreign spend.')
for r in rules:
 if current in r['productIds'] and r['kind']=='earning-rate':r['evidence']['sourceIds']=[hkEarn]
B('accelerator','promo','最高9倍积分加速','Up to 9X accelerator','需登记；外币、指定旅游和指定日常商户各有每季首15000港币范围，活动期以条款为准。','Enroll; foreign currency, selected travel and selected everyday merchants each have a first-HK$15,000 quarterly scope; check promotion dates.','calendar-quarter',scenes=['reward-redemption'],requiresEnrollment=True,src=[hkAcc])
# Canadian Platinum
s=source('platinum-ca','https://www.americanexpress.com/en-ca/charge-cards/the-platinum-card/','Amex Canada · Platinum')
caTravel=source('platinum-ca-travel','https://www.americanexpress.com/en-ca/benefits/travel/the-platinum-card/','Amex Canada · 白金旅行与2027变更')
caBenefits=source('platinum-ca-benefits','https://www.americanexpress.com/en-ca/benefits/the-platinum-card/','Amex Canada · 白金餐饮福利')
caEarn=source('platinum-ca-earn','https://www.americanexpress.com/ca/en/benefits/membership-benefits/index.html','Amex Canada · 基本赚点')
profile('amex-ca-ca-platinum-card','Amex CA','CA','CAD',s,799,250)
B('travel','credit','年度旅行额度','Annual travel credit','每账户周年200加元；指定Amex渠道单笔至少200加元，取消后不能当然重用，不结转。','C$200 per card anniversary year, single eligible Amex booking of at least C$200; cancellation does not automatically restore it; no carryover.','account-anniversary',200,scenes=['travel'],src=[caTravel])
B('dining','credit','年度餐饮抵扣','Annual dining credit','精选加拿大餐厅单笔至少200加元；登记及当年使用规则须核对，不适用于全球所有餐厅。','Selected Canadian restaurants, at least C$200 spending; check enrollment and annual use rules; not worldwide dining.','calendar-year',200,scenes=['dining'],requiresEnrollment=True,src=[caBenefits])
B('nexus','credit','NEXUS 申请费抵扣','NEXUS fee credit','每四年最多100加元；须核对上次已用日期，非每年发放。','Up to C$100 every four years; verify the last use date; not an annual credit.','rolling-four-years',100,scenes=['airport'],src=[caTravel])
for key,cn,en,partner,tier in [('hilton','Hilton Gold 会籍','Hilton Gold status','Hilton Honors','Gold'),('marriott','Marriott Gold 会籍','Marriott Gold status','Marriott Bonvoy','Gold Elite')]:B(key,'membership',cn,en,'需登记并关联对应会员账户；第三方订房可能不适用酒店会员待遇。','Enroll and link the membership account; third-party bookings may not receive loyalty benefits.',partner=partner,scenes=['hotel-stay'],tier=tier,requiresEnrollment=True,src=[caTravel])
B('lounge','lounge','2026 休息室准入','2026 lounge access','按现行加拿大白金休息室条款；2027起Plaza Premium和Priority Pass改为限次数及消费解锁。','Current Canadian Platinum lounge rules apply; Plaza Premium and Priority Pass change to allowances and spend unlock in 2027.','fixed-date',scenes=['airport'],end='2026-12-31',src=[caTravel])
B('lounge-2027','lounge','2027 休息室次数及解锁','2027 lounge allowances and unlock','主卡Plaza Premium与Priority Pass各6次，附属白金各2次；合资格年消费20000加元可解锁，年份及生效条件适用。','Basic card gets six visits each to Plaza Premium and Priority Pass; supplementary Platinum two each; C$20,000 qualifying annual spend unlocks unlimited access, subject to year and activation rules.','calendar-year',scenes=['airport'],start='2027-01-01',src=[caTravel])
B('fhr','hotel-service','Fine Hotels + Resorts','Fine Hotels + Resorts','指定渠道及参与酒店的早餐和延迟退房等待遇；实际订单条件另核对。','Breakfast, checkout and other benefits at participating properties via the designated channel; verify booking terms.','per-stay',partner='Fine Hotels + Resorts',scenes=['hotel-stay'],src=[caBenefits])
for key,cn,en,v in [('dining','加拿大餐饮','Canadian dining',2),('travel','合资格旅行','Eligible travel',2),('other','其他合资格消费','Other eligible spending',1)]:
 E(key,cn,en,v,'points-per-CAD','加拿大版本独立赚点规则，不套用美国或香港计划。','Canadian earning rules are separate from US and Hong Kong programmes.')
for r in rules:
 if current in r['productIds'] and r['kind']=='earning-rate':r['evidence']['sourceIds']=[caEarn]
# Chase non-CSR cards
s=source('freedom-us','https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited','Chase · Freedom Unlimited')
profile('chase-us-freedom-unlimited','Chase','US','USD',s,0)
for key,cn,en,v in [('travel','Chase Travel','Chase Travel',5),('dining','餐饮','Dining',3),('drugstore','药店','Drugstores',3),('other','其他消费','Other purchases',1.5)]:E(key,cn,en,v,'cashback-percent','常规返现率，不含个人迎新加成；分类和排除项以奖励协议为准。','Standard cash-back rate excluding personal welcome boosts; categories and exclusions follow the rewards agreement.')
B('redemption','membership','UR 返现与转点资格','UR cash back and transfer eligibility','可作为UR返现使用；本卡单独不自动拥有CSR的航空酒店转点资格，组合卡需按账户规则。','UR cash back is available; this card alone does not inherit CSR airline/hotel transfer privileges; combinations follow account rules.',scenes=['reward-redemption'])
# Quest
s=source('quest-us','https://creditcards.chase.com/travel-credit-cards/united/united-quest','Chase · United Quest')
questPerks=source('quest-perks','https://www.chase.com/personal/credit-cards/united/united-quest-card','Chase · Quest 持卡福利')
profile('chase-us-united-quest','Chase','US','USD',s,350)
B('travelbank','credit','年度 United TravelBank','Annual United TravelBank','开户及周年200美元存入MileagePlus TravelBank，不是账单返现；航班和到期条件适用。','$200 at opening and anniversary in MileagePlus TravelBank, not a statement credit; eligible-flight and expiry conditions apply.','account-anniversary',200,'United MileagePlus',scenes=['travel'])
B('award-discount','promo','周年里程机票折扣','Anniversary award-flight discount','首周年起每年一张10000里程折扣；合资格美联航奖励机票及券有效期适用。','One 10,000-mile discount from the first anniversary; eligible United awards and certificate expiry apply.','account-anniversary',partner='United MileagePlus',scenes=['travel'],awardPoints=10000)
B('bags','promo','首两件托运行李','First two checked bags','主卡及同预订一位同行，须符合购票用卡、MileagePlus关联和United执飞要求；不是所有航司通用。','Primary cardholder plus one same-reservation companion, subject to card-payment, MileagePlus and United-operated-flight conditions.','per-trip',partner='United MileagePlus',scenes=['travel'],src=[questPerks])
B('rideshare','credit','网约车抵扣','Rideshare credit','每年需登记；1至11月各8美元、12月12美元，合计100美元，不显示成每月100。','Annual enrollment; $8 each January–November and $12 in December, $100 total, not $100 monthly.','calendar-month',scenes=['ground-transport'],requiresEnrollment=True,annualMaximum=100,monthlyAmounts=[8]*11+[12],src=[questPerks])
B('nexus','credit','出入境申请费抵扣','Entry-program fee credit','Global Entry、TSA PreCheck或NEXUS每四年最多120美元，核对上次使用。','Global Entry, TSA PreCheck or NEXUS up to $120 every four years; check last use.','rolling-four-years',120,scenes=['airport'],src=[questPerks])
B('renowned','credit','Renowned Hotels 抵扣','Renowned Hotels credit','账户周年年内指定平台预付住宿最多150美元；不是任意酒店消费。','Up to $150 per anniversary year for prepaid accommodation through the specified platform; not any hotel spending.','account-anniversary',150,'Renowned Hotels and Resorts',scenes=['hotel-stay'],src=[questPerks])
B('pqp','spend-unlock','消费赚取 PQP','PQP from spending','每20美元合资格消费得1 PQP，年上限18000；PQP不同于可兑换里程，也不直接授予会籍。','One PQP per $20 eligible spend, capped at 18,000 annually; PQP differ from redeemable miles and do not directly grant status.','calendar-year',partner='United MileagePlus',scenes=['travel'],src=[questPerks])
E('united','United刷卡部分','United card-earned portion',4,'points-per-USD','航司宣传总10倍含MileagePlus飞行部分，不把全部算成信用卡赚取。','Advertised total 10X includes MileagePlus flight earning; do not count it all as card points.')
E('other','其他消费','Other purchases',1,'points-per-USD','其他合资格消费；旅行、餐饮、流媒体和指定酒店另有分类倍率。','Other eligible purchases; travel, dining, streaming and selected hotels have separate category rates.')
# IHG transition needs both legacy and new-public facts, not overwrite the holder's benefit.
s=source('ihg-current','https://creditcards.chase.com/travel-credit-cards/ihg-rewards-club/premier','Chase · IHG Premier 新版公开产品')
ihgNews=source('ihg-2026-change','https://media.chase.com/news/ihg-premier-select-card-portfolio-updates','Chase · 2026-10-01 IHG改版与老账户过渡')
ihgOld=source('ihg-holder','https://www.chase.com/personal/credit-cards/ihg/premier/premier-perks','Chase · IHG Premier 既有持卡福利')
profile('chase-us-ihg-premier','Chase','US','USD',s,150,gaps=[text('2026年10月改版；老账户福利按个人通知生效，年费2027调整，未确认你的切换日。','October 2026 refresh: existing benefits follow individual notices and annual fees adjust in 2027; your transition date is unverified.')])
note('新版公布年费150美元；老账户2027年调整，当前实际年费不得直接覆盖。','Newly published annual fee is $150; existing fees adjust in 2027, so do not overwrite the holder’s current charge.',[ihgNews])
B('anniversary-new','hotel-service','新版周年免房晚','New anniversary free night','新版券上限50000积分，可加点；老账户切换时间按通知，不将旧40000券自动升级。','New certificate cap is 50,000 points with top-up; holder transition follows notices; old 40,000 certificates are not automatically upgraded.','account-anniversary',partner='IHG One Rewards',scenes=['hotel-stay'],awardPoints=50000,applicability='new-public-version-holder-transition-unverified')
B('status-new','membership','新版 Gold 会籍','New Gold status','新版公开产品为Gold；旧持卡人会籍变化按通知，不推断个人白金已经失效。','New public product lists Gold; holder transition follows notices; do not infer that personal Platinum already expired.',partner='IHG One Rewards',scenes=['hotel-stay'],tier='Gold Elite',applicability='new-public-version-holder-transition-unverified')
B('fourth-night','hotel-service','积分住宿第四晚免积分','Fourth reward night free','合资格连续四晚积分预订；现金住宿、房券和非参与预订不自动适用。','Eligible consecutive four-night points bookings; cash stays, certificates and other bookings are not automatically eligible.','per-stay',partner='IHG One Rewards',scenes=['hotel-stay'])
B('food-new','credit','新版餐饮奖励','New food and beverage rewards','新版全年最高100美元，实际发放和酒店兑换方式以新版细则及账户过渡为准。','New annual maximum $100; issuance, hotel redemption and holder transition follow current terms.','calendar-year',100,'IHG One Rewards',scenes=['hotel-stay','dining'],applicability='new-public-version-holder-transition-unverified',src=[ihgNews])
B('airline-new','credit','新版机票抵扣','New airline credit','新版合资格机票年上限100美元；老账户生效日未确认。','New eligible-flight annual maximum $100; holder effective date is unverified.','calendar-year',100,scenes=['travel'],applicability='new-public-version-holder-transition-unverified',src=[ihgNews])
B('travelbank','promo','United TravelBank','United TravelBank','登记并关联MileagePlus，全年最高50美元；发放批次和有效期另核对。','Register and link MileagePlus, up to $50 annually; verify installments and expiry.','calendar-year',50,'United MileagePlus',scenes=['travel'],requiresEnrollment=True,src=[ihgOld])
E('other','新版其他消费','New-version other purchases',3,'points-per-USD','新版公开基础倍率；不推断老账户已切换，酒店总倍率不全是刷卡积分。','New public base rate; holder transition unverified, and total hotel earning is not all card-earned points.')
# BOA
s=source('atmos-us','https://newsroom.bankofamerica.com/content/newsroom/press-releases/2025/08/alaska-airlines-and-bank-of-america-present-a-new-premium-credit.html','BOA · Atmos Summit 官方发布')
atmosFee=source('atmos-fee','https://www.bankofamerica.com/credit-cards/travel-credit-cards/','BOA · 旅行卡费用')
profile('boa-us-atmos-rewards-summit-visa-infinite','BOA','US','USD',s,395)
for r in rules:
 if current in r['productIds'] and r['kind']=='fee':r['evidence']['sourceIds']=[atmosFee]
B('companion','promo','周年 Global Companion Award','Anniversary Global Companion Award','周年25000积分同行奖励需同一行程及积分预订；不是现金机票，税费仍须付。','Annual 25,000-point companion award requires same-itinerary points booking; not a cash ticket, and taxes remain payable.','account-anniversary',partner='Atmos Rewards',scenes=['travel'],awardPoints=25000,src=[atmosFee])
B('lounge','lounge','Alaska Lounge 通行券','Alaska Lounge passes','每年8张；发放批次、有效期、航班和携客要求以计划细则为准。','Eight annually; issuance, expiry, flight and guest conditions follow programme terms.','calendar-year',partner='Alaska Lounge',scenes=['airport'],quantity=8)
B('status-points','spend-unlock','Atmos 会籍积分','Atmos status points','每2美元合资格消费得1会籍积分；周年另10000，不能当作可兑换积分余额。','One status point per $2 eligible spend plus 10,000 at anniversary; not a redeemable-point balance.','account-anniversary',partner='Atmos Rewards',scenes=['travel'])
B('partner-fees','promo','伙伴奖励预订费豁免','Partner award booking-fee waiver','合资格伙伴奖励机票的预订费豁免；航司附加费和政府税费仍适用。','Eligible partner-award booking fees waived; carrier surcharges and government taxes still apply.',partner='Atmos Rewards',scenes=['travel'])
E('bonus','餐饮、外币及指定航司','Dining, foreign spend and eligible airlines',3,'points-per-USD','指定Alaska及Hawaiian消费、餐饮和外币交易；商户及币种定义适用。','Eligible Alaska/Hawaiian, dining and foreign purchases; merchant and currency definitions apply.')
s=source('boa-cash-us','https://www.bankofamerica.com/credit-cards/products/cash-back-credit-card/','BOA · Customized Cash Rewards')
profile('boa-us-customized-cash-rewards-visa-signature','BOA','US','USD',s,0)
for key,cn,en,v in [('choice','自选类别','Choice category',3),('grocery','超市及批发俱乐部','Grocery / wholesale clubs',2),('other','其他消费','Other purchases',1)]:E(key,cn,en,v,'cashback-percent','3%及2%类别共享每季2500美元消费上限，超出1%；新户首年6%不自动适用于旧卡。','3% and 2% categories share a $2,500 quarterly spending cap, then 1%; new-account 6% does not automatically apply to existing cards.',sharedQuarterlySpendCap=2500,capCurrency='USD')
B('choice-category','membership','每月自选返现类别','Monthly choice category','可每自然月更换一次类别；本工具不修改你的选择。','Choice category can change once per calendar month; this tool does not change it.','calendar-month',scenes=['shopping'])
B('first-year','promo','新申请首年类别加成','New-account first-year category bonus','官网6%只属特定新开户首年优惠，需个人offer证据；旧卡和转产品不得自动套用。','Advertised 6% is a qualifying new-account first-year offer; personal offer proof required; not automatically for existing or converted cards.','activation-based',scenes=['shopping'])
# HSBC: all fees from current tariff, card-specific earning separate.
hsFee=source('hsbc-fees-20260801','https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/ways-to-bank/bank-tariff/20260801-guide.pdf','HSBC · 2026-08-01生效收费表')
rc=program('HSBC RewardCash','reward-currency')
for key,fee,au,path in [('red',0,0,'red'),('pulse',1800,900,'unionpay-dual-currency-diamond'),('premier',0,0,'premier-mastercard'),('visa-gold',600,300,'visa-gold'),('easy',1800,900,'visa-platinum'),('signature',2000,1000,'visa-signature'),('everymile',2000,None,'everymile')]:
 id={'red':'hsbc-hk-hk-red-credit-card','pulse':'hsbc-hk-hk-pulse-dual-currency-diamond','premier':'hsbc-hk-hk-premier-credit-card','visa-gold':'hsbc-hk-hk-visa-gold-card','easy':'hsbc-hk-hk-easy-credit-card','signature':'hsbc-hk-hk-hsbc-visa-signature-card','everymile':'hsbc-hk-hk-hsbc-everymile-card'}[key]
 s=source('hsbc-'+key,'https://www.hsbc.com.hk/credit-cards/products/'+path+'/','HSBC HK · '+key)
 profile(id,'HSBC HK','HK','HKD',s,fee,au)
 for r in rules:
  if current in r['productIds'] and r['kind']=='fee':r['evidence']['sourceIds']=[hsFee]
 if key in ['red','premier']:note('标准年费永久豁免；显示0代表公开豁免，不代表已读取个人扣费。','Standard annual fee permanently waived; zero describes the published waiver, not an account charge.',[hsFee])
 else:B('fee-waiver','credit','年费豁免资格','Annual-fee waiver eligibility','标准收费与迎新豁免或达标豁免分开；不因目前没扣费就推断永久免年费。','Separate standard fees from introductory or qualifying waivers; no current charge does not prove a perpetual waiver.',scenes=['card-ownership'],src=[hsFee])
 if key=='red':
  E('online','网上消费 RewardCash','Online RewardCash',4,'cashback-percent','每自然月首10000港币网上消费4%，超出0.4%；排除交易按条款。','4% on the first HK$10,000 eligible online spending monthly, then 0.4%; exclusions apply.',monthlySpendCap=10000,afterCapPercent=.4)
  E('selected','指定商户 RewardCash','Selected-merchant RewardCash',8,'cashback-percent','每自然月指定商户首1250港币8%，超出0.4%；必须核对商户名单。','8% on first HK$1,250 monthly at listed merchants, then 0.4%; verify merchant list.',monthlySpendCap=1250,afterCapPercent=.4)
  B('hkexpress','promo','HK Express 机上饮品','HK Express onboard drink','实体卡购买至少30港币机上食品可享指定饮品；航班及活动细则适用。','Physical-card purchase of at least HK$30 onboard food may receive a listed drink; flight and promotion terms apply.',scenes=['travel'])
 elif key=='pulse':
  B('dual-currency','membership','港币／人民币双币账单','HKD / RMB subaccounts','港币和人民币分账处理；同卡不同币种不重复计算成两张卡。','HKD and RMB billed in separate subaccounts; do not count one card as two products.')
  B('fx','promo','指定币种交易费豁免','Selected-currency transaction-fee waiver','人民币及澳门币交易有指定外币手续费豁免；不等于所有外币免费。','Specified RMB and MOP transaction fees waived; not all foreign currencies are fee-free.',scenes=['travel'])
  B('mobile','promo','内地澳门流动支付奖赏','Mainland / Macau mobile-payment rewards','二维码或流动支付有额外RC活动，最高宣传4.4%含其他计划；登记、上限和期限待核对。','QR/mobile-payment RC promotions may advertise up to 4.4% including other programmes; verify enrollment, caps and dates.',scenes=['shopping'],requiresEnrollment=True)
 elif key=='everymile':
  E('selected','指定日常及旅行','Selected everyday / travel',2,'HKD-per-mile','官网换算每2港币1里数，仅指定商户；底层赚取RC后经Reward+兑换。','Advertised HK$2 per mile only at selected merchants; underlying RC redeem via Reward+.')
  E('general','其他本地及海外','Other local / overseas',5,'HKD-per-mile','官网换算每5港币1里数；不同计划实际兑换比例仍需确认。','Advertised HK$5 per mile; verify actual partner conversion ratios.')
  B('lounge','lounge','贵宾室或餐饮兑换次数','Lounge / airport dining visits','活动期最多6次；每次使用后60日内需合资格消费4000港币；不是无条件6次。','Up to six during the promotion; each visit requires HK$4,000 eligible spending within 60 days afterward; not unconditional.','promotion-period',scenes=['airport'],quantity=6)
  B('pay-with-rc','promo','旅行消费 Pay with RC','Travel Pay with RC','指定旅行商户每1奖赏钱可抵1.25港币，需Reward+及合资格交易；不是所有RC或商户通用。','Selected travel merchants may redeem RC1 for HK$1.25 via Reward+; eligible transactions only, not all RC or merchants.',scenes=['reward-redemption'])
  B('travel-insurance','protection','多次旅程保险摘要','Multi-trip insurance summary','官网列本人及同行家属保障；承保范围、付款和索赔条件须查AXA保单。','Published cover for cardholder and accompanying family; verify AXA policy, payment and claims conditions.','event-based',scenes=['travel'],verification='summary-only')
  B('rewardplus','membership','EveryMile 独立奖赏钱路径','EveryMile-specific RewardCash route','兑换经Reward+；与普通卡的RC合并及转入限制必须分开判断。','Redeem through Reward+; pooling and incoming-transfer limits differ from ordinary RC.',partner='HSBC RewardCash',scenes=['reward-redemption'],src=['hsbc-terms'])
 else:
  E('choice','最红自主奖赏','Rewards of Your Choice',2.4,'cashback-percent','宣传最高2.4%须登记及选择类别；不作为所有消费的无条件基础返现。','Advertised up to 2.4% requires enrollment and selected categories; not an unconditional base rate.')
  if key=='signature':B('extra-rc','promo','额外1.2%奖赏钱','Extra 1.2% RewardCash','最红自主奖赏计划内各类别额外3倍，即1.2%；与类别分配及上限一并核对。','Extra 3X / 1.2% within Rewards of Your Choice categories; verify category allocation and caps.',scenes=['reward-redemption'])
  if key=='easy':
   B('moneyback','membership','MoneyBack 关联及积分','MoneyBack linkage and points','需在MoneyBack关联卡；普通会员与VIP倍率不同，MoneyBack积分不与RC混算。','Link the card in MoneyBack; standard/VIP rates differ; MoneyBack points stay separate from RC.',partner='MoneyBack',scenes=['shopping'],requiresEnrollment=True)
   B('member-day','promo','MoneyBack 会员日优惠','MoneyBack member-day offers','指定商户、日期及消费门槛，最高8%折扣；不是每天所有消费8%。','Selected merchants, dates and thresholds; up to 8% discount, not 8% on every purchase.',partner='MoneyBack',scenes=['shopping'])
  if key=='premier':
   B('dining','promo','精选餐饮买一送一','Selected dining two-for-one','指定餐厅及菜单，预订和日期限制适用；不是现金抵扣。','Selected restaurants and menus, booking/date limits apply; not a cash credit.',scenes=['dining'])
   B('delay-lounge','lounge','航班延误休息室','Flight-delay lounge benefit','指定Flight Delay Pass及超过120分钟延误条件，须查登记和机场覆盖；不是日常无限贵宾室。','Specified Flight Delay Pass with delay over 120 minutes; verify enrollment and airports; not unlimited everyday lounge access.',scenes=['airport'])
# Explorer
s=source('explorer-hk','https://www.americanexpress.com/hk/en/credit-cards/explorer-credit-card/','Amex HK · Explorer')
exMr=source('explorer-mr','https://www.americanexpress.com/content/dam/amex/hk/benefits/pdf/FN_Explorer_MR_CH.pdf','Amex HK · Explorer 基本积分条款')
exBonus=source('explorer-bonus','https://www.americanexpress.com/en-hk/rewards/membership-rewards/about-program','Amex HK · 2026本地积分活动')
profile('amex-hk-hk-american-express-explorer-credit-card','Amex HK','HK','HKD',s,2200,0)
B('waiver','spend-unlock','次年年费豁免','Next-year annual-fee waiver','年度合资格消费150000港币可豁免下年基本卡年费及首两张附属卡年费。','HK$150,000 annual eligible spending waives next-year basic fee and the first two supplementary cards.','account-anniversary',scenes=['card-ownership'],spendThreshold=150000)
B('lounge','lounge','Plaza Premium 年度次数','Plaza Premium annual allowance','主卡及附属卡合计每自然年最多12次；登记、合资格卡及入场条款适用。','Basic and supplementary cards share up to 12 calendar-year visits; enrollment, eligible-card and admission terms apply.','calendar-year',partner='Plaza Premium',scenes=['airport'],quantity=12,sharing='account-shared')
B('local-bonus','promo','本地消费6倍积分','6X local spending promotion','2026年7月2日至12月31日需登记；本地合资格交易最高每港币1元6积分，其他排除项适用。','Enroll for July 2–December 31, 2026; up to six points per HK$1 on eligible local spending; exclusions apply.','fixed-date',scenes=['reward-redemption'],requiresEnrollment=True,start='2026-07-02',end='2026-12-31',src=[exBonus])
B('movies','promo','百老汇院线优惠','Broadway cinema discount','指定正价电影票9折；票种及渠道排除项须核对，不把折扣当回赠。','10% off eligible regular-price tickets; verify ticket/channel exclusions; a discount is not cash back.',scenes=['entertainment'])
B('travel-insurance','protection','海外旅行保险摘要','Overseas travel insurance summary','须以卡支付全数海外旅费；意外、延误及除外责任查完整保单。','Full overseas fare must be paid with the card; consult the policy for accident, delay and exclusions.','event-based',scenes=['travel'],verification='summary-only')
E('base','基本积分','Base points',3,'points-per-HKD','合资格消费每港币1元3积分；里数兑换比率与MR积分倍率分开。','Three points per eligible HK$1; airline conversion ratios are separate from MR earning.')
for r in rules:
 if current in r['productIds'] and r['kind']=='earning-rate':r['evidence']['sourceIds']=[exMr]
# Cathay standard only; never import Priority Banking perks into this product.
s=source('cathay-hk','https://www.sc.com/hk/credit-cards/cathay/','渣打 · Cathay 各版本费用与待遇')
cxEarn=source('cathay-earn','https://www.sc.com/hk/credit-cards/cathay/selected-categories-spending-rewards/','渣打 · Cathay 分类里数')
profile('sc-hk-hk-cathay-mastercard','SC HK','HK','HKD',s,2000,gaps=[text('按普通Cathay Mastercard整理；未证明为Priority Banking或Priority Private，不能套用其贵宾室及优先待遇。','Modelled as standard Cathay Mastercard; Priority Banking/Private status is unproven, so their lounge and priority perks are not applied.')])
B('fee-waiver','credit','年费豁免资格','Annual-fee waiver eligibility','普通版首年豁免，之后2000港币；特定理财或出粮客户可获后续豁免，须核对资格。','Standard card first year waived, then HK$2,000; qualifying banking/payroll relationships may waive later fees.')
B('variant','membership','普通版与优先理财版分开','Standard and Priority variants differ','普通版不自动附赠Priority Banking四张商务休息室券；需确认实际卡产品。','The standard card does not automatically receive Priority Banking’s four business-lounge passes; confirm the actual product.',scenes=['airport'])
B('miles','membership','Asia Miles 账户关联','Asia Miles account linkage','信用卡赚取Asia Miles；会员账户关联不等于赠送Cathay精英等级。','The card earns Asia Miles; linking the account does not grant Cathay elite status.',partner='Cathay Asia Miles',scenes=['reward-redemption'])
for key,cn,en,v in [('foreign','海外消费','Overseas spending',4),('dining-hotels','餐饮及酒店','Dining and hotels',4),('local','其他港币消费','Other HKD spending',6)]:
 E(key,cn,en,v,'HKD-per-mile','按普通版当前分类页；分类加速可能受活动期限制，须核对相应期次条款。','Current standard-card category page; accelerated categories may have promotion periods, so verify the applicable terms.')
for r in rules:
 if current in r['productIds'] and r['kind']=='earning-rate':r['evidence']['sourceIds']=[cxEarn]
# Include CSR without rebuilding or duplicating previously reviewed records.
csr='chase-us-sapphire-reserve';manifest['profileProductIds']=[csr]+products
assert len(manifest['profileProductIds'])==22 and len(set(manifest['profileProductIds']))==22
manifest['snapshotId']='cardybara-public-knowledge-2026-10-27.2';manifest['asOf']=date
manifest['schemaVersion']='1.1.0'
for filename,data in [('manifest.json',manifest),('sources.json',sources),('entities.json',entities),('rules.json',rules)]: (base/filename).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
i18n_catalog.save(root,tr,'knowledge')
print(json.dumps({'profiles':22,'rules':len(rules),'sources':len(sources),'entities':len(entities['programmes'])}))
