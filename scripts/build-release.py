#!/usr/bin/env python3
"""Deterministic, empty-wallet standalone alpha; never includes local account data."""
from pathlib import Path
import json,zipfile,hashlib,subprocess,re,tempfile
import os
r=Path(__file__).resolve().parents[1];cfg=json.loads((r/'release.json').read_text());files={}
# The wallet bundle took its bank scope from Vite; a build that kept every bank for development must never be packaged.
if os.environ.get('CARDYBARA_ALL_BANKS')=='1':raise SystemExit('CARDYBARA_ALL_BANKS=1 is for local development; unset it to build a release')
# Same text as scripts/build-scope.mjs scopeSource(): release.json's "banks", or null for every active bank.
scope=cfg.get('banks') if isinstance(cfg.get('banks'),list) else None
scope_source=('export const BUILD_BANKS='+json.dumps(scope,separators=(',',':'),ensure_ascii=False)+';\nexport const BUILD_SCOPE='+json.dumps('cardybara-scope:'+(','.join(scope) if scope else 'all'),ensure_ascii=False)+';\n').encode()
channel=cfg.get('channel','alpha')
for p in (r/'extension-next').rglob('*'):
 if p.is_file() and not any(x.startswith('.') for x in p.relative_to(r/'extension-next').parts) and p.suffix in ['.js','.json','.html','.css','.svg','.png','.txt','.md'] and p.name!='CHECKSUMS.json':
  files[str(p.relative_to(r/'extension-next'))]=p.read_bytes()
files['build-scope.js']=scope_source
for name in ['index.html','cardybara.svg']:files[name]=(r/'dist'/name).read_bytes()
for folder in ['assets','brand']:
 for p in (r/'dist'/folder).rglob('*'):
  if p.is_file() and 'archive' not in p.parts and p.suffix in ['.js','.css','.svg','.png','.jpg','.jpeg','.webp','.ico','.json']:files[str(p.relative_to(r/'dist'))]=p.read_bytes()
m=json.loads(files['manifest.json']);m.update(name='Cardybara · 卡疲扒拉 '+channel.capitalize(),version=cfg['version'],version_name=cfg['label'],description=('Local card wallet with read-only bank collection. Friends beta: reads '+' and '.join(scope)+'. The assistant needs an invite code.') if channel=='beta' and scope else 'Local card wallet with read-only bank collection. Alpha: empty-wallet setup and read-only bank collection; coverage varies. Optional AI requires setup.')
m['host_permissions']=[x for x in m['host_permissions'] if not x.startswith('http://127.0.0.1')];m.pop('content_scripts',None);m['action']['default_title']='Open Cardybara';files['manifest.json']=(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode()
blank=json.loads((r/'public/data.example.json').read_text());files['data.json']=json.dumps(blank,ensure_ascii=False).encode()
files['README.md']=(r/'README.md').read_bytes();files['RELEASE-NOTES.txt']=(r/cfg.get('notes','docs/RELEASE.md')).read_bytes();files['CHECKSUMS.json']=json.dumps({n:hashlib.sha256(b).hexdigest() for n,b in sorted(files.items())},indent=2).encode()
with tempfile.TemporaryDirectory(prefix='cardybara-release-smoke-') as tmp:
 for n,b in files.items():
  p=Path(tmp)/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 subprocess.run(['node',str(r/'scripts/smoke-extension.mjs'),str(Path(tmp)/'background.js'),'http://127.0.0.1:8766'],check=True)
o=r/'release';o.mkdir(exist_ok=True);target=o/('cardybara-'+cfg['label']+'.zip')
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
 for n,b in sorted(files.items()):
  i=zipfile.ZipInfo(n,date_time=(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,b)
(o/'SHA256SUMS').write_text(hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n')
print(json.dumps({'artifact':str(target),'files':len(files),'personalDataIncluded':False,'storeSubmissionReady':False}))
