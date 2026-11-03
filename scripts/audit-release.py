#!/usr/bin/env python3
"""Fail closed on private filenames, obvious credentials and personal workspace paths."""
from pathlib import Path
import subprocess,re,json,zipfile,hashlib,sys,posixpath,os
from html.parser import HTMLParser
from urllib.parse import urlsplit
r=Path(__file__).resolve().parents[1]
patterns=[rb'gh[pousr]_[A-Za-z0-9]{25,}',rb'github_pat_[A-Za-z0-9_]{30,}',rb'sk-[A-Za-z0-9_-]{24,}',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
def inspect(name,b):
 if any(re.search(p,b) for p in patterns):raise SystemExit('Credential-like value: '+name)
 if re.search(rb'/' + rb'Users/[A-Za-z0-9_.-]+/',b):raise SystemExit('Personal workspace/extension identifier: '+name)
paths=subprocess.check_output(['git','ls-files','-z'],cwd=r).decode().split('\0');paths=[p for p in paths if p]
if not paths:raise SystemExit('Source must be staged or committed before audit')
for n in paths:
 if n=='public/data.json' or n.startswith(('dist/','release/','.openai/')) or n.endswith(('.zip','.bundle','.png.log')) or (Path(n).name.startswith('.env') and n!='.env.example'):raise SystemExit('Private/generated path tracked: '+n)
 inspect(n,(r/n).read_bytes())
# Audit historical filenames too; a clean tip cannot erase leaked history.
exists=subprocess.run(['git','rev-parse','--verify','HEAD'],cwd=r,capture_output=True).returncode==0
history=subprocess.check_output(['git','log','--all','--format=','--name-only'],cwd=r).decode().splitlines() if exists else []
if any(n in ['public/data.json','.env.local','dist/data.json'] for n in history):raise SystemExit('Private wallet history present')
# Wallet notes and run logs must not reach shipped text. Tests use synthetic values and are exempt from this shape check.
note=re.compile(r'(?:尾号|尾號|ending)\s*\d{4,5}\b|(?:欠款|最低还款|最低還款|可用额度|可用額度)[^"\n]{0,12}(?:HKD|HK\$|CAD|USD|US\$|\$)\s?\d')
for n in paths:
 if n.startswith(('tests/','evals/')) or n=='scripts/audit-release.py' or not n.endswith(('.json','.md','.js','.jsx','.mjs','.html','.py')):continue
 if note.search((r/n).read_bytes().decode('utf8','ignore')):raise SystemExit('Personal card note: '+n)
# Optional owner-only values, one per line, in a file outside the repository. Never echo a value.
needles=os.environ.get('CARDYBARA_PRIVATE_NEEDLES')
if needles:
 values=[x.strip() for x in Path(needles).read_text().splitlines() if x.strip()]
 private=re.compile(r'(?<![\d.])(?:'+'|'.join(map(re.escape,values))+r')(?!\d)') if values else None
 for n in paths:
  if private and not n.endswith(('.png','.jpg','.jpeg','.webp','.ico','.pdf','.woff2','.svg')) and n!='package-lock.json' and private.search((r/n).read_bytes().decode('utf8','ignore')):raise SystemExit('Owner private value in: '+n)
if '--package' in sys.argv:
 cfg=json.loads((r/'release.json').read_text());p=r/'release'/('cardybara-'+cfg['label']+'.zip')
 with zipfile.ZipFile(p) as z:
  names=z.namelist();assert 'manifest.json' in names and 'index.html' in names
  m=json.loads(z.read('manifest.json'));assert m['manifest_version']==3 and m['version']==cfg['version'];assert not m.get('content_scripts');assert not any(x.startswith('http:') for x in m['host_permissions'])
  d=json.loads(z.read('data.json'));assert d['cards']==[] and d['rewards']==[];assert d==json.loads((r/'public/data.example.json').read_text()),'Local and packaged empty-wallet seeds differ'
  for n in names:
   assert not n.startswith('/') and '..' not in Path(n).parts and not n.endswith(('.zip','.map','.env'))
   inspect(n,z.read(n))
  for n,h in json.loads(z.read('CHECKSUMS.json')).items():assert hashlib.sha256(z.read(n)).hexdigest()==h
  html=z.read('index.html').decode();assert not re.search(r'<script[^>]+src=[\"\']https?://',html)
  class References(HTMLParser):
   def handle_starttag(self,tag,attrs):
    for k,v in attrs:
     if k not in ['src','href'] or not v:continue
     u=urlsplit(v)
     if u.scheme or u.netloc or not u.path:continue
     target=posixpath.normpath(u.path.lstrip('/') if u.path.startswith('/') else posixpath.join(posixpath.dirname(self.name),u.path))
     assert target in names,'Missing packaged reference: '+self.name+' -> '+target
  for n in names:
   if n.endswith('.html'):
    parser=References();parser.name=n;parser.feed(z.read(n).decode())
   if n.startswith('assets/') and n.endswith('.js'):
    assert b'cardybara-extension-standalone.zip' not in z.read(n),'Obsolete installer link in wallet'
  for n in [m['background']['service_worker'],m['action']['default_popup'],*m['icons'].values()]:assert n in names,'Missing manifest entry: '+n
 print('PASS: standalone alpha manifest, empty seed, private-data scan and checksums')
print('PASS: source and historical filename audit')
