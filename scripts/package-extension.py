#!/usr/bin/env python3
"""Reproducible preview artifact. Never packages the wallet's financial snapshots."""
from pathlib import Path
import hashlib, json, struct, subprocess, sys, tempfile, zipfile
root=Path(__file__).resolve().parents[1]
source=root/'extension-next'
version=json.loads((source/'manifest.json').read_text())['version']
assert version==json.loads((source/'package.json').read_text())['version']=='1.1.0'
allow=['manifest.json','package.json','background.js','engine.js','agent-core.js','bank-adapters.js','bank-tabs.js','parser-client.js','agent-runtime.js','agent-snapshot.js','protocol.js','providers.js','reader.js','guide.js','dashboard.js','popup.html','popup.js','popup.css','popup-i18n.js','privacy.html','README.md','THIRD_PARTY_NOTICES.md','licenses/nextcard-MIT.txt','icons/mark.svg']+[f'icons/{n}.png' for n in [16,32,48,128]]
node=sys.argv[1] if len(sys.argv)>1 else 'node'
for name in allow:
 assert (source/name).is_file(),f'Missing {name}'
 if name.endswith('.js'):subprocess.run([node,'--check',str(source/name)],check=True,capture_output=True)
manifest=json.loads((source/'manifest.json').read_text())
assert manifest['permissions']==['scripting','storage','alarms']
assert manifest['background']=={'service_worker':'background.js','type':'module'}
assert manifest['content_scripts'][0]['matches']==['http://127.0.0.1:8766/*']
assert not any('*://' in h or 'localhost' in h or '127.0.0.1' in h for h in manifest['host_permissions'])
for n in [16,32,48,128]:
 data=(source/f'icons/{n}.png').read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',data[16:24])==(n,n)
checks={name:hashlib.sha256((source/name).read_bytes().replace(b'index.html#overview',b'http://127.0.0.1:8766/#overview') if name=='popup.html' else (source/name).read_bytes()).hexdigest() for name in allow}
target=root/'public'/f'cardybara-extension-{version}-preview.zip'
with zipfile.ZipFile(str(target)+'.tmp','w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for name in sorted(allow):
  info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  z.writestr(info,(source/name).read_bytes().replace(b'index.html#overview',b'http://127.0.0.1:8766/#overview') if name=='popup.html' else (source/name).read_bytes())
 info=zipfile.ZipInfo('CHECKSUMS.json',(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
 z.writestr(info,json.dumps(checks,sort_keys=True,indent=2)+'\n')
Path(str(target)+'.tmp').replace(target)
# Validate the actual ZIP and import its actual worker in a mock Chrome realm.
with zipfile.ZipFile(target) as z:
 assert set(z.namelist())==set(allow+['CHECKSUMS.json'])
 for name,digest in json.loads(z.read('CHECKSUMS.json')).items():assert hashlib.sha256(z.read(name)).hexdigest()==digest
 with tempfile.TemporaryDirectory(prefix='cardybara-artifact-') as tmp:
  z.extractall(tmp)
  subprocess.run([node,str(root/'scripts/smoke-extension.mjs'),str(Path(tmp)/'background.js')],check=True)
print(json.dumps({'artifact':str(target),'version':version,'files':len(allow)+1,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'status':'preview-not-bank-verified'}))
