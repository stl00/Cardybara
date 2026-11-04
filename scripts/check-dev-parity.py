#!/usr/bin/env python3
"""The dev extension must run the same code the release package ships: every packaged file byte for byte,
except the short list below. Its only additions are the local schedule, diagnostics and self-reload."""
from pathlib import Path
import json,subprocess,sys,tempfile,zipfile,os
r=Path(__file__).resolve().parents[1]
# Package-only documents and generated files, and the manifest, which is compared by its own rule below.
PACKAGE_ONLY={'README.md','RELEASE-NOTES.txt','CHECKSUMS.json','manifest.json'}
# The content script only serves a localhost wallet, which the dev build refuses by design.
DEV_DROPS={'dashboard.js'}
DEV_ONLY={'background-dev.js','schedule-core.js','dev-popup.html','dev-popup.js','dev-build-info.js','build-stamp.json','dev-structure-report.js'}
args=dict(a.split('=',1) for a in sys.argv[1:] if '=' in a)
cfg=json.loads((r/'release.json').read_text())
package=Path(args.get('--package-file',r/'release'/('cardybara-'+cfg['label']+'.zip')))
def compare(dev):
 with zipfile.ZipFile(package) as z:
  names=set(z.namelist());problems=[]
  for n in sorted(names-PACKAGE_ONLY-DEV_DROPS):
   f=dev/n
   if not f.is_file():problems.append('missing from the dev build: '+n)
   # The same empty wallet, serialized by a different tool.
   elif n=='data.json':
    if json.loads(f.read_bytes())!=json.loads(z.read(n)):problems.append('differs from the release package: data.json')
   elif f.read_bytes()!=z.read(n):problems.append('differs from the release package: '+n)
  m=json.loads(z.read('manifest.json'))
 d=json.loads((dev/'manifest.json').read_text())
 if set(d['permissions'])-{'idle'}!=set(m['permissions']):problems.append('permissions differ beyond idle')
 if set(h for h in d['host_permissions'] if not h.startswith('http:'))!=set(m['host_permissions']):problems.append('bank hosts differ')
 if d.get('optional_permissions')!=m.get('optional_permissions'):problems.append('optional permissions differ')
 if d.get('content_scripts') or m.get('content_scripts'):problems.append('a content script is present')
 # Anything else at the top level of the dev build has to be on the short list, so nothing extra can read a bank.
 for f in dev.iterdir():
  if f.is_file() and f.name not in names and f.name not in DEV_ONLY:problems.append('unexpected dev file: '+f.name)
 return problems
if '--dev-dir' in args:problems=compare(Path(args['--dev-dir']))
else:
 with tempfile.TemporaryDirectory(prefix='cardybara-parity-') as tmp:
  subprocess.run(['node',str(r/'scripts/build-dev-extension.mjs'),'--reuse-wallet'],cwd=r,check=True,capture_output=True,env={**os.environ,'CARDYBARA_DEV_EXTENSION_DIR':str(Path(tmp)/'ext')})
  problems=compare(Path(tmp)/'ext')
if problems:raise SystemExit('Dev build differs from the release package:\n'+'\n'.join(problems))
print('PASS: dev build runs the release package code byte for byte')
