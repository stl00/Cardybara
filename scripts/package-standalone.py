#!/usr/bin/env python3
"""Self-contained React wallet + MV3 collector. User snapshots/keys are never shipped."""
from pathlib import Path
import json,zipfile,hashlib,subprocess,sys
root=Path(__file__).resolve().parents[1];node=sys.argv[1] if len(sys.argv)>1 else 'node'
source=root/'extension-next';dist=root/'dist';assert (dist/'index.html').is_file(),'Run npm run build first'
files={}
for p in source.rglob('*'):
 if p.is_file():
  name=str(p.relative_to(source))
  if name.startswith('.') or name=='CHECKSUMS.json':continue
  files[name]=p.read_bytes()
  if p.suffix=='.js':subprocess.run([node,'--check',str(p)],check=True,capture_output=True)
for name in ['index.html','cardybara.svg']:
 files[name]=(dist/name).read_bytes()
for folder in ['assets','brand']:
 for p in (dist/folder).rglob('*'):
  if p.is_file() and p.suffix.lower() in ['.js','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.json'] and 'archive' not in p.relative_to(dist).parts:files[str(p.relative_to(dist))]=p.read_bytes()
blank={'asOf':'','cards':[],'rewards':[],'transactions':[],'offers':[],'benefits':[],'connections':[],'spendingGoals':[]}
# The extension always knows supported banks; cards are imported by the owner.
from datetime import date
blank['connections']=[{'bank':b,'note':'尚未导入卡片记录。'} for b in ['Amex US','Amex HK','Amex CA','Chase','BOA','HSBC HK','SC HK']]
files['data.json']=(json.dumps(blank,ensure_ascii=False)+'\n').encode()
m=json.loads(files['manifest.json']);m['name']='Cardybara 卡疲扒拉 · 独立钱包预览';m['version']='1.2.0';m['action']['default_title']='打开 Cardybara';m['chrome_url_overrides']={}
m.pop('chrome_url_overrides',None);files['manifest.json']=(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode()
files['CHECKSUMS.json']=(json.dumps({n:hashlib.sha256(b).hexdigest() for n,b in sorted(files.items())},indent=2)+'\n').encode()
target=root/'public/cardybara-extension-standalone.zip'
with zipfile.ZipFile(str(target)+'.tmp','w',zipfile.ZIP_DEFLATED) as z:
 for n,b in sorted(files.items()):z.writestr(n,b)
Path(str(target)+'.tmp').replace(target)
with zipfile.ZipFile(target) as z:
 assert json.loads(z.read('data.json'))['cards']==[]
 assert not any('snapshot' in n or n.endswith('.zip') or n.endswith('.map') for n in z.namelist() if n!='agent-snapshot.js')
 assert 'agent-runtime.js' in z.namelist() and 'index.html' in z.namelist()
 for n,h in json.loads(z.read('CHECKSUMS.json')).items():assert hashlib.sha256(z.read(n)).hexdigest()==h
print(json.dumps({'artifact':str(target),'files':len(files),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'personalDataIncluded':False,'installed':False}))
