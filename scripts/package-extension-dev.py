#!/usr/bin/env python3
"""Local-only integration build. Not the production/Chrome Web Store package."""
from pathlib import Path
import hashlib,json,subprocess,sys,tempfile,zipfile
root=Path(__file__).resolve().parents[1];node=sys.argv[1] if len(sys.argv)>1 else 'node'
source=root/'public/cardybara-extension-1.1.0-preview.zip';target=root/'public/cardybara-extension-1.1.0-local-dev.zip'
origin='http://127.0.0.1:8766';local='http://127.0.0.1:8766'
with zipfile.ZipFile(source) as z:data={n:z.read(n) for n in z.namelist() if n!='CHECKSUMS.json'}
for n in ['providers.js','dashboard.js','popup.html']:
 data[n]=data[n].decode().replace(origin,local).encode()
m=json.loads(data['manifest.json']);m['name']='Cardybara 卡疲扒拉 · 本地联调版';m['host_permissions']=[h for h in m['host_permissions'] if not h.startswith(origin)]+['http://127.0.0.1/*'];m['content_scripts'][0]['matches']=['http://127.0.0.1/*'];data['manifest.json']=(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode()
notice='本包仅用于本地联调；数据接收页面仅为 http://127.0.0.1:8766。Chrome host pattern 覆盖 127.0.0.1 各端口，但桥接和 sender 校验严格限制 :8766。新增本机网站、storage 和 alarms 权限须安装时审核。生产包不包含本机域名。\n'
data['README.md']=notice.encode()+data['README.md'];data['privacy.html']=data['privacy.html'].decode().replace('<h1>', '<p>'+notice+'</p><h1>',1).replace('除既有私人 Dashboard 外不授权其他网站，也不授权 localhost。','此开发包只授权上述本机 Dashboard 作为数据接收方，不向其他 Dashboard 传输。').encode()
checks={n:hashlib.sha256(b).hexdigest() for n,b in data.items()};data['CHECKSUMS.json']=(json.dumps(checks,sort_keys=True,indent=2)+'\n').encode()
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for n,b in sorted(data.items()):
  info=zipfile.ZipInfo(n,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,b)
with zipfile.ZipFile(target) as z:
 for n,digest in json.loads(z.read('CHECKSUMS.json')).items():assert hashlib.sha256(z.read(n)).hexdigest()==digest
 with tempfile.TemporaryDirectory(prefix='cardybara-dev-artifact-') as tmp:
  z.extractall(tmp);subprocess.run([node,str(root/'scripts/smoke-extension.mjs'),str(Path(tmp)/'background.js'),local],check=True)
print(json.dumps({'artifact':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'recipient':local,'status':'local-integration-only'}))
