from pathlib import Path
from urllib.parse import urljoin,urlparse
from urllib.request import Request,urlopen
from concurrent.futures import ThreadPoolExecutor
import json,re,html,hashlib
root=Path.cwd();sources=json.load(open('/tmp/cardybara-public-catalog-extract.json'));seed=json.load(open('public/data.json'))['cards'];products=[]
def clean(s):return re.sub(r'\s+',' ',re.sub('<[^>]+>','',html.unescape(s or '')).replace('®','').replace('™','').replace('℠','')).strip()
def norm(s):return re.sub(r'[^a-z0-9\u3400-\u9fff]','',clean(s).lower())
def pid(bank,region,name):return re.sub('[^a-z0-9]+','-',bank.lower()+'-'+region.lower()+'-'+name.lower()).strip('-')
urls={r['bank']:r['url'] for r in sources}
# Product metadata only: no account ids, tails, amounts or rewards balances.
for c in seed:
 art={'file':c['art'],'verification':'legacy-asset','sourceUrl':None}
 if c['art'].endswith('-promo.jpg'):
  vert=bool(re.search(r'hsbc-(easy|premier)-promo',c['art']));art['crop']={'canvasWidth':1600,'canvasHeight':900,'x':574 if vert else 440,'y':90 if vert else 224,'width':452 if vert else 720,'height':720 if vert else 453}
 if c['art'].startswith('sc-cathay-'):art['crop']={'canvasWidth':400,'canvasHeight':400,'x':98,'y':38,'width':204,'height':324}
 products.append({'id':pid(c['bank'],c['region'],c['name']),'bank':c['bank'],'region':c['region'],'name':c['name'],'aliases':[c['name']],'currencies':[],'rewardPrograms':[],'sourceUrl':urls[c['bank']],'checkedAt':None,'verification':'needs-review','art':art})
def add(bank,region,name,source,image=None,aliases=()):
 name=clean(name);name=re.sub(r'\s+Links to product page$','',name);name=re.sub(r'\bSM\b','',name);name=clean(name)
 if not name:return
 keys={norm(name),*(norm(a) for a in aliases)};match=[p for p in products if p['bank']==bank and p['region']==region and keys.intersection(norm(a) for a in [p['name']]+p['aliases'])]
 if len(match)==1:p=match[0];p['aliases']=list(dict.fromkeys(p['aliases']+[name]+list(aliases)))
 else:
  p={'id':pid(bank,region,name),'bank':bank,'region':region,'name':name,'aliases':list(dict.fromkeys([name]+list(aliases))),'currencies':[],'rewardPrograms':[],'art':None};products.append(p)
 p.update(sourceUrl=source,checkedAt='2026-10-27',verification='issuer-listed')
 if image:p['pendingImage']=image
 return p
# Issuer product listings; variants remain distinct.
for r in sources:
 bank=r['bank'];region=r['region'];url=r['url']
 if bank=='Chase':
  for h in r['headings']:
   if not h['href'] or 'Links to product page' not in h['name']:continue
   name=clean(h['name']).replace(' Links to product page','');name=re.sub(r'\bSM\b','',name);name=clean(name)
   aliases=[]
   for prefix in ['Chase ','']:
    a=name.removeprefix(prefix).removesuffix(' Credit Card').removesuffix(' Card');aliases.append(a)
   if 'IHG One Rewards Premier Credit Card'==name:aliases+=['IHG Premier']
   imgs=[];key=norm(name.replace(' Credit Card','').replace(' Card',''))
   for i in r['images']:
    alt=clean(i['alt']);alt=re.sub(r'\([^)]*\)','',alt);a=norm(alt)
    if key in a and i['src'] and 'card-art' in i['src']:imgs.append(urljoin(url,i['src']))
   add(bank,region,name,urljoin(url,h['href']).split('?')[0],urljoin(url,h['image']) if h.get('image') else (imgs[0] if len(set(imgs))==1 else None),aliases)
 elif bank=='Amex HK':
  for i in r['images']:
   if i.get('src') and '/images/cards/' in i['src']:add(bank,region,i['alt'],url,i['src'])
 elif bank=='HSBC HK':
  for a in r['anchors']:
   href=a['href'] or '';name=a['name']
   if '/credit-cards/products/' not in href or name not in ['HSBC EveryMile Credit Card','HSBC Red Credit Card','Visa Signature Card','HSBC easy Credit Card','Premier MasterCard','HSBC Pulse Dual Currency Card','Visa Gold Card for Students','Visa Gold Card','UnionPay Dual Currency Card']:continue
   aliases=['Red Credit Card'] if name=='HSBC Red Credit Card' else []
   if name=='HSBC Pulse Dual Currency Card':aliases=['Pulse Dual Currency Diamond']
   if name=='Premier MasterCard':aliases=['Premier Credit Card']
   if name=='HSBC easy Credit Card':aliases=['easy Credit Card']
   if name=='Visa Signature Card':aliases=['HSBC Visa Signature Card']
   if name=='HSBC EveryMile Credit Card':aliases=['HSBC EveryMile Card']
   add(bank,region,name,urljoin(url,href),None,aliases)
 elif bank=='SC HK':
  for h in r['headings']:
   if h['name'] not in ['Standard Chartered Cathay Mastercard','Simply Cash Visa Card','Standard Chartered Smart Credit Card','A. Point Card']:continue
   aliases=['Cathay Mastercard'] if h['name']=='Standard Chartered Cathay Mastercard' else []
   add(bank,region,h['name'],url,None,aliases)
# Further issuer-listed entries outside the owner's current wallet.
for name in ['Bank of America Unlimited Cash Rewards','Atmos Rewards Ascent Visa Signature','Royal ONE Visa Signature','Royal ONE Plus Visa Signature','Allways Rewards Visa']:
 add('BOA','US',name,urls['BOA'])
for name in ['American Express Cobalt Card','American Express Gold Rewards Card','SimplyCash Card from American Express','SimplyCash Preferred Card from American Express']:
 add('Amex CA','CA',name,'https://www.americanexpress.com/ca/en/legal/cardmember-agreements.html')
# Existing issuer assets retain their original provenance; CSR is replaced by reviewed official art.
p=next(p for p in products if p['bank']=='Chase' and 'Sapphire Reserve'==p['name']);p.pop('pendingImage',None);p['art']={'file':'chase-sapphire-reserve-official.png','verification':'issuer-asset','sourceUrl':'https://www.chase.com/content/dam/unified-assets/sapphire-cards/personal/reserve/card_sapphireRes-VI_chip_RFID.png'}
jobs=[]
for p in products:
 if p.get('pendingImage'):
  u=p.pop('pendingImage');name='catalog-'+hashlib.sha256(u.encode()).hexdigest()[:16]+'.png';jobs.append((p,u,name))
def download(j):
 p,u,name=j;target=root/'public/assets'/name
 try:
  if not target.exists():
   data=urlopen(Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=15).read()
   if len(data)>2500000 or not data.startswith(b'\x89PNG'):return False
   target.write_bytes(data)
  p['art']={'file':name,'verification':'issuer-asset','sourceUrl':u};return True
 except Exception:return False
results=list(ThreadPoolExecutor(max_workers=4).map(download,jobs))
# Deduplicate exact aliases introduced by repeated issuer navigation blocks.
seen={}
for p in products:
 key=(p['bank'],p['region'],norm(p['name']))
 if key not in seen:seen[key]=p
products=list(seen.values());ids=[p['id'] for p in products];assert len(ids)==len(set(ids))
overrides=root/'src/data/card-product-overrides.json'
if overrides.exists():
 for patch in json.loads(overrides.read_text()):
  product=next((p for p in products if p['id']==patch['id']),None)
  if product:product.update({k:v for k,v in patch.items() if k!='id'})
products.sort(key=lambda p:p['verification']!='issuer-listed')
d={'schema':1,'asOf':'2026-10-27','scope':'Product identity and artwork only; not bank-parser coverage or account rewards','products':products}
(root/'src/data/card-products.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'products':len(products),'byBank':{b:sum(p['bank']==b for p in products) for b in urls},'issuerListed':sum(p['verification']=='issuer-listed' for p in products),'withArt':sum(bool(p.get('art')) for p in products),'newArtDownloads':sum(results)},ensure_ascii=False))
