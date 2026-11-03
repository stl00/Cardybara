#!/usr/bin/env python3
"""Scan for the owner's private values, listed one per line in a file outside the repository.

Every message names a file or commit only. Never print a value, a match or the line around it.
"""
from pathlib import Path
import os,re,subprocess,sys,zipfile
SKIP=('.png','.jpg','.jpeg','.webp','.ico','.pdf','.woff2','.svg')
SKIP_NAMES=('package-lock.json',)
# A number this short occurs everywhere (fees, versions, sizes), so it counts only where a card tail is written.
SHORT_DIGITS=5
TAIL=r'(?:(?:ending|ends?)(?:\s+(?:in|with))?[\s:#]*|尾[号號][\s:：#]*|末[四五]位[\s:：#]*|[xX*•·]{2,}[\s-]*)'
def git(*args,**kw):return subprocess.run(['git',*args],capture_output=True,**kw)
def configured_path():
 path=os.environ.get('CARDYBARA_PRIVATE_NEEDLES')
 if path:return path
 found=git('config','--type=path','--get','cardybara.privateNeedles')
 return found.stdout.decode().strip() if found.returncode==0 else ''
def repo_roots():
 roots=[]
 top=git('rev-parse','--show-toplevel')
 if top.returncode==0:roots.append(Path(top.stdout.decode().strip()).resolve())
 common=git('rev-parse','--path-format=absolute','--git-common-dir')
 if common.returncode==0:roots.append(Path(common.stdout.decode().strip()).resolve().parent)
 return roots
def load_values(path):
 """Fails closed: a scan with nothing to look for must not read as a clean result."""
 file=Path(path).expanduser()
 if not file.is_file():raise SystemExit('Private values file not found. See docs/DEBUGGING.md.')
 resolved=file.resolve()
 if any(root==resolved or root in resolved.parents for root in repo_roots()):raise SystemExit('Private values file must be outside the repository.')
 values=[x.strip() for x in file.read_text(encoding='utf8').splitlines() if x.strip()]
 if not values:raise SystemExit('Private values file is empty.')
 return values
def matcher(values):
 parts=[]
 for value in sorted(set(values),key=len,reverse=True):
  digits=sum(c.isdigit() for c in value)
  escaped=re.escape(value)
  if re.fullmatch(r'[\d.,]+',value):
   parts.append((TAIL if digits<SHORT_DIGITS else r'(?<![\d.,])')+escaped+r'(?!\d)')
  else:
   parts.append(r'(?<![A-Za-z0-9])'+escaped+r'(?![A-Za-z0-9])')
 return re.compile('|'.join(parts),re.IGNORECASE)
def scannable(name):return not name.endswith(SKIP) and Path(name).name not in SKIP_NAMES
def hit(private,data):return bool(private.search(data.decode('utf8','ignore')))
def scan_zip(private,path):
 with zipfile.ZipFile(path) as z:
  for name in z.namelist():
   if scannable(name) and hit(private,z.read(name)):raise SystemExit(f'Owner private value in: {Path(path).name}:{name}')
def pushed_ranges(lines):
 zero=re.compile(r'^0+$')
 for line in lines:
  fields=line.split()
  if len(fields)!=4 or zero.match(fields[1]):continue
  local,remote=fields[1],fields[3]
  known=not zero.match(remote) and git('cat-file','-e',remote+'^{commit}').returncode==0
  yield [f'{remote}..{local}'] if known else [local,'--not','--remotes']
def scan_commits(private,revs):
 """Every commit going out, because a value removed by a later commit still leaks through history."""
 for commit in git('rev-list',*revs,check=True).stdout.decode().split():
  short=commit[:12]
  if hit(private,git('log','-1','--format=%an%n%ae%n%B',commit,check=True).stdout):raise SystemExit(f'Owner private value in commit details: {short}')
  raw=git('diff-tree','--root','-r','-m','--no-commit-id','--no-renames','-z',commit,check=True).stdout.decode('utf8','surrogateescape').split('\0')
  for meta,name in zip(raw[0::2],raw[1::2]):
   blob=meta.split()[3]
   if private.search(name):raise SystemExit(f'Owner private value in a file name: {short}')
   if set(blob)=={'0'} or not scannable(name):continue
   if hit(private,git('cat-file','blob',blob,check=True).stdout):raise SystemExit(f'Owner private value in: {name} ({short})')
def pre_push():
 path=configured_path()
 if not path:raise SystemExit('Pre-push scan is on but has no values file. See docs/DEBUGGING.md.')
 private=matcher(load_values(path))
 for revs in pushed_ranges(sys.stdin):scan_commits(private,revs)
 top=git('rev-parse','--show-toplevel',check=True).stdout.decode().strip()
 for package in sorted((Path(top)/'release').glob('*.zip')):scan_zip(private,package)
 print('PASS: owner private value scan')
if __name__=='__main__':
 if sys.argv[1:]!=['pre-push']:raise SystemExit('Usage: private_scan.py pre-push')
 pre_push()
