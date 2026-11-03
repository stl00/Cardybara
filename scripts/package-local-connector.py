#!/usr/bin/env python3
"""Reviewable local-first product connector; no installation and no user snapshots."""
from pathlib import Path
import json,zipfile,hashlib,subprocess,tempfile
root=Path(__file__).resolve().parents[1];source=root/'extension-next';local='http://127.0.0.1:8766'
files={str(p.relative_to(source)):p.read_bytes() for p in source.rglob('*') if p.is_file() and not any(x.startswith('.') for x in p.relative_to(source).parts)}
for name in ['providers.js','dashboard.js']:
 files[name]=files[name].decode().replace('<150000','<2200000').encode()
m=json.loads(files['manifest.json']);m['version']='1.2.1';m['name']='Cardybara · 本地钱包连接器';m['description']='由普通本地钱包发起银行只读刷新；登录仍在银行官网完成。';m['host_permissions']=sorted(set(m['host_permissions'])|{'http://127.0.0.1/*'});m['content_scripts'][0]['matches']=['http://127.0.0.1/*'];files['manifest.json']=(json.dumps(m,ensure_ascii=False,indent=2)+'\n').encode()
# Keep the existing standalone UI as a fallback; the popup's main entrance is now the ordinary local wallet.
files['popup.html']=files['popup.html'].decode().replace('href="index.html#overview"',f'href="{local}/#overview"').encode()
files['index.html']=(root/'dist/index.html').read_bytes();files['cardybara.svg']=(root/'dist/cardybara.svg').read_bytes()
for folder in ['assets','brand']:
 for p in (root/'dist'/folder).rglob('*'):
  if p.is_file() and 'archive' not in p.parts:files[str(p.relative_to(root/'dist'))]=p.read_bytes()
files['data.json']=json.dumps({'asOf':'','cards':[],'rewards':[],'transactions':[],'offers':[],'benefits':[],'connections':[],'spendingGoals':[]}).encode()
files['README-LOCAL.txt']='本候选包未安装。仅普通本地钱包 http://127.0.0.1:8766 可接收采集结果；银行网页只读。Chrome host pattern 含 127.0.0.1 各端口，但 sender 和页面桥接严格限于 :8766，拒绝其他端口、远程站和子框架。新增本地接收页权限，银行范围不变；不访问密码、Cookie 或验证码。无用户快照、无密钥、无新调试或存储读取接口。更新前请审阅权限，备份钱包并保留原扩展目录。离线测试不是银行验收。'.encode()
files['CHECKSUMS.json']=json.dumps({n:hashlib.sha256(v).hexdigest() for n,v in files.items()},indent=2).encode()
for n in files:
 assert not n.startswith('.') and not n.endswith('.map') and 'env.local' not in n
with tempfile.TemporaryDirectory(prefix='cardybara-local-candidate-') as tmp:
 for n,b in files.items():
  p=Path(tmp)/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 subprocess.run(['node',str(root/'scripts/smoke-extension.mjs'),str(Path(tmp)/'background.js'),local],check=True)
target=root/'public/cardybara-local-connector-candidate.zip'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
 for n,b in sorted(files.items()):z.writestr(n,b)
with zipfile.ZipFile(target) as z:
 assert json.loads(z.read('data.json'))['cards']==[]
 for n,h in json.loads(z.read('CHECKSUMS.json')).items():assert hashlib.sha256(z.read(n)).hexdigest()==h
print(json.dumps({'artifact':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'installed':False,'bankVerified':False,'recipient':local}))
