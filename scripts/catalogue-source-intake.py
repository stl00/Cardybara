from html.parser import HTMLParser
from urllib.request import Request,urlopen
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,re
class Node:
 def __init__(self,tag='',attrs=(),parent=None):self.tag=tag;self.attrs=dict(attrs);self.parent=parent;self.children=[]
 def text(self):return ' '.join(c.text() if isinstance(c,Node) else c for c in self.children if not isinstance(c,Node) or c.tag not in ['script','style'])
 def find(self,tag):return [c for c in self.children if isinstance(c,Node) and c.tag==tag]+[n for c in self.children if isinstance(c,Node) for n in c.find(tag)]
class Parse(HTMLParser):
 def __init__(self):super().__init__();self.root=Node();self.cur=self.root
 def handle_starttag(self,t,a):
  n=Node(t,a,self.cur);self.cur.children.append(n)
  if t not in ['img','meta','input','link','br','hr','source','area','wbr','embed','param']:self.cur=n
 def handle_endtag(self,t):
  n=self.cur
  while n.parent and n.tag!=t:n=n.parent
  if n.parent:self.cur=n.parent
 def handle_data(self,s):self.cur.children.append(s)
sources=[('Chase','US','https://creditcards.chase.com/all-credit-cards'),('BOA','US','https://www.bankofamerica.com/credit-cards/'),('HSBC HK','HK','https://www.hsbc.com.hk/credit-cards/'),('SC HK','HK','https://www.sc.com/hk/credit-cards/'),('Amex HK','HK','https://www.americanexpress.com/hk/en/credit-cards/all-cards/'),('Amex CA','CA','https://www.americanexpress.com/en-ca/credit-cards/all-cards/'),('Amex US','US','https://www.americanexpress.com/us/credit-cards/')]
def run(src):
 bank,region,url=src
 try:
  raw=urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=18).read().decode();p=Parse();p.feed(raw);heads=[]
  for n in p.root.find('h2'):
   name=re.sub(r'\s+',' ',n.text()).strip();a=n.find('a');entry={'name':name,'href':a[0].attrs.get('href') if a else None};ancestor=n.parent
   for depth in range(6):
    if not ancestor or len(ancestor.find('h2'))>1:break
    art=[i.attrs.get('src') for i in ancestor.find('img') if '/card-art/' in (i.attrs.get('src') or '')]
    if art:entry['image']=art[0];break
    ancestor=ancestor.parent
   heads.append(entry)
  imgs=[{'alt':n.attrs.get('alt',''),'src':n.attrs.get('src') or n.attrs.get('data-src')} for n in p.root.find('img')]
  return {'bank':bank,'region':region,'url':url,'headings':heads,'images':imgs,'anchors':[{'name':re.sub(r'\s+',' ',n.text()).strip(),'href':n.attrs.get('href')} for n in p.root.find('a') if n.attrs.get('href')]}
 except Exception as e:return {'bank':bank,'region':region,'url':url,'error':type(e).__name__}
rows=list(ThreadPoolExecutor(max_workers=7).map(run,sources));Path('/tmp/cardybara-public-catalog-extract.json').write_text(json.dumps(rows));
for r in rows:
 print(r['bank'],r.get('error',''), 'headings',len(r.get('headings',[])),'images',len(r.get('images',[])))
 for h in r.get('headings',[]):
  if h['name'] and (h['href'] or re.search(r'card|visa|mastercard|reward',h['name'],re.I)):print(' ',h['name'][:110],h['href'])
 if r['bank']=='Amex HK':print(' IMAGES',[(i['alt'],i['src']) for i in r.get('images',[]) if re.search(r'card',i['alt'],re.I)][:20])
