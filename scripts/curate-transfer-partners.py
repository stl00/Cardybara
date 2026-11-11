import sys,json,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent));import i18n_catalog
sys.path.insert(0,'/tmp/cardybara-text-tools');from opencc import OpenCC
cc=OpenCC('s2twp');root=Path(__file__).resolve().parents[1];base=root/'src/data/knowledge';load=lambda f:json.loads((base/f).read_text());rules=load('rules.json');entities=load('entities.json');sources=load('sources.json');tr=i18n_catalog.load(root)
def entity(name,kind):
 id='programme.'+re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
 if not any(e['id']==id for e in entities['programmes']):entities['programmes'].append({'id':id,'name':name,'kind':kind,'aliases':[]})
 return id
def source(id,url,title):
 if not any(s['id']==id for s in sources):sources.append({'id':id,'url':url,'title':title,'checkedAt':'2026-10-27','authority':'official'})
 return id
def txt(cn,en):tr['en-US'][cn]=en;tr['zh-TW'][cn]=cc.convert(cn);return cn
usSource=source('mr-us-partners','https://global.americanexpress.com/rewards/transfer','Amex US · 已核对部分转点伙伴')
caSource=source('mr-ca-partners','https://www.americanexpress.com/ca/en/benefits/membership-benefits/travel.html','Amex Canada · 转点计划')
hkSource=source('mr-hk-partners','https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/airlines','Amex HK · 航空转点名单与限制')
choiceSource=source('hsbc-choice','https://www.hsbc.com.hk/credit-cards/rewards/your-choice/','HSBC · 最红自主奖赏登记与分类')
for r in rules:
 if r['id'].endswith('.earning-choice') and r['market']['issuer']=='HSBC HK':r['evidence']['sourceIds']=[choiceSource]
markets=[('US',['amex-us-us-american-express-gold-card','amex-us-us-morgan-stanley-platinum-card'],usSource,['Aer Lingus AerClub','Aeromexico Rewards','Air Canada Aeroplan','Air France KLM Flying Blue','ANA Mileage Club','avianca lifemiles','Cathay Asia Miles']),('HK',['amex-hk-hk-the-platinum-card','amex-hk-hk-american-express-explorer-credit-card'],hkSource,['Cathay Asia Miles','Malaysia Airlines Enrich','EVA Infinity MileageLands','Qantas Frequent Flyer','Singapore KrisFlyer','The British Airways Club']),('CA',['amex-ca-ca-platinum-card'],caSource,['Air Canada Aeroplan','Air France KLM Flying Blue','Cathay Asia Miles','The British Airways Club','Delta SkyMiles','Etihad Guest','Hilton Honors','Marriott Bonvoy'])]
from copy import deepcopy
for country,products,sid,names in markets:
 fromId=entity('Amex Membership Rewards '+country,'reward-currency')
 for product in products:
  for name in names:
   toId=entity(name,'hotel' if name in ['Hilton Honors','Marriott Bonvoy'] else 'airline');rid='rule.'+product+'.transfer-'+toId.split('.',1)[1]
   if any(r['id']==rid for r in rules):continue
   template=deepcopy(next(r for r in rules if r['kind']=='transfer-relationship'))
   template.update({'id':rid,'revisionId':rid+'@2026-10-27.1','productIds':[product],'market':{'issuer':'Amex '+country,'country':country},'programmeIds':[fromId,toId]})
   summary=txt('公开列为转点伙伴；实际兑换比例、最低转点和个人关联需登录核对，转点不赠送精英会籍。','Listed transfer partner; verify current ratios, minimums and account linkage after login; transferring does not grant elite status.')
   if country=='HK':summary=txt('香港MR转点计划须核对个人计划；页面比例注明Turbo，Qantas可能另收费，不能套用美国或加拿大比例。','Verify the individual HK MR programme; displayed ratios reference Turbo and Qantas may carry a fee; US/Canadian ratios do not apply.')
   template['content']={'title':name,'summary':summary,'howToUse':[summary]};template['terms']={'relationship':'transfer-only','fromProgrammeId':fromId,'toProgrammeId':toId,'ratio':None,'grantsEliteStatus':False,'accountLinked':None};template['conditions']['unparsedText']=summary;template['evidence']['sourceIds']=[sid];rules.append(template)
for f,d in [('rules.json',rules),('sources.json',sources),('entities.json',entities)]: (base/f).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
i18n_catalog.save(root,tr,'knowledge')
print('Rules',len(rules),'Sources',len(sources),'Entities',len(entities['programmes']))
