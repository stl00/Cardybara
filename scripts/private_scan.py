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
TAIL=r'(?:\b(?:ending|ends?)(?:\s+(?:in|with))?[\s:#]*|\blast[\s_-]?(?:4|5|four|five)["\'\s:=]*|尾[号號][\s:：#]*|末[四五]位[\s:：#]*|[xX*•·●]{2,}[\s-]*|\.{3}\s*)'
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
class Private:
 def __init__(self,pattern,literal):self.pattern,self.literal=pattern,literal
 def search(self,text):return self.pattern.search(text)
 def label(self,name):
  """A file name is safe to print only if it holds no listed value, in any context."""
  return '(name withheld)' if self.literal.search(name) else name
def matcher(values):
 parts=[]
 for value in sorted(set(values),key=len,reverse=True):
  digits=sum(c.isdigit() for c in value)
  escaped=re.escape(value)
  if re.fullmatch(r'[\d.,]+',value):
   parts.append((TAIL if digits<SHORT_DIGITS else r'(?<![\d.])')+escaped+r'(?!\d)')
  else:
   parts.append(r'(?<![A-Za-z0-9])'+escaped+r'(?![A-Za-z0-9])')
 return Private(re.compile('|'.join(parts),re.IGNORECASE),re.compile('|'.join(map(re.escape,values)),re.IGNORECASE))
def scannable(name):return not name.endswith(SKIP) and Path(name).name not in SKIP_NAMES
def hit(private,data):return bool(private.search(data.decode('utf8','ignore')))
def scan_zip(private,path):
 with zipfile.ZipFile(path) as z:
  for name in z.namelist():
   if scannable(name) and hit(private,z.read(name)):raise SystemExit(f'Owner private value in: {private.label(Path(path).name)}:{private.label(name)}')
def scan_refs(private,lines,remote_name):
 zero=re.compile(r'^0+$')
 for line in lines:
  fields=line.split()
  if len(fields)!=4 or zero.match(fields[1]):continue
  local_ref,local,remote_ref,remote=fields
  if private.search(local_ref) or private.search(remote_ref):raise SystemExit('Owner private value in a ref name being pushed.')
  if git('cat-file','-t',local,check=True).stdout.strip()==b'tag' and hit(private,git('cat-file','-p',local,check=True).stdout):raise SystemExit(f'Owner private value in tag: {local[:12]}')
  known=not zero.match(remote) and git('cat-file','-e',remote+'^{commit}').returncode==0
  # Only this remote's refs prove a commit is already there; another remote may be private. A URL matches no ref, so everything is scanned.
  scan_commits(private,[f'{remote}..{local}'] if known else [local,'--not',f'--remotes={remote_name}'])
def scan_commits(private,revs):
 """Every commit going out, because a value removed by a later commit still leaks through history."""
 for commit in git('rev-list',*revs,check=True).stdout.decode().split():
  short=commit[:12]
  if hit(private,git('log','-1','--format=%an%n%ae%n%cn%n%ce%n%B',commit,check=True).stdout):raise SystemExit(f'Owner private value in commit details: {short}')
  raw=git('diff-tree','--root','-r','-m','--no-commit-id','--no-renames','-z',commit,check=True).stdout.decode('utf8','surrogateescape').split('\0')
  for meta,name in zip(raw[0::2],raw[1::2]):
   mode,blob=meta.split()[1],meta.split()[3]
   if private.search(name):raise SystemExit(f'Owner private value in a file name: {short}')
   if set(blob)=={'0'} or mode=='160000' or not scannable(name):continue
   if hit(private,git('cat-file','blob',blob,check=True).stdout):raise SystemExit(f'Owner private value in: {private.label(name)} ({short})')
def pre_push(remote_name):
 path=configured_path()
 if not path:raise SystemExit('Pre-push scan is on but has no values file. See docs/DEBUGGING.md.')
 private=matcher(load_values(path))
 scan_refs(private,sys.stdin,remote_name)
 top=git('rev-parse','--show-toplevel',check=True).stdout.decode().strip()
 for package in sorted((Path(top)/'release').glob('*.zip')):scan_zip(private,package)
 print('PASS: owner private value scan')
if __name__=='__main__':
 if len(sys.argv)!=3 or sys.argv[1]!='pre-push':raise SystemExit('Usage: private_scan.py pre-push REMOTE')
 pre_push(sys.argv[2])
