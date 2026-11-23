import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bankAppLinks,bankLink} from '../src/bankAppLinks.js';

const snap=h=>JSON.parse(fs.readFileSync(new URL(`./fixtures/aasa/${h}.json`,import.meta.url),'utf8'));
// Apple pattern: * any run, ? one character.
const glob=(pat,s)=>new RegExp('^'+pat.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$').test(s);
// First matching entry wins; an `exclude` match means the link does not open the app.
function opensApp(details,u){
 const path=u.pathname,params=u.searchParams;
 for(const d of details){
  if(d.paths?.some(p=>glob(p,path)))return true;
  for(const c of d.components||[]){
   if(c['/']&&!glob(c['/'],path))continue;
   if(c['?']&&!Object.entries(c['?']).every(([k,v])=>[].concat(v).some(x=>params.has(k)&&glob(x,params.get(k)))))continue;
   if(c['#'])continue;
   return !c.exclude;
  }
 }
 return false;
}
const urlsFor={Chase:'https://secure.chase.com/web/auth/?treatment=chase','Citi US':'https://www.citi.com/'};

for(const [bank,{url,aasa}] of Object.entries(bankAppLinks)){
 test(`${bank} app link matches its AASA snapshot`,()=>{
  const u=new URL(url);
  assert.equal(u.protocol,'https:');
  assert.equal(u.host,aasa,'link host is the AASA host');
  const details=snap(aasa).applinks.details;
  assert.ok(opensApp(details,u),`${url} is not listed in ${aasa} AASA`);
 });
}
test('matcher rejects a path the snapshot does not list',()=>{
 assert.equal(opensApp(snap('secure.chase.com').applinks.details,new URL('https://secure.chase.com/web/auth/dashboard')),false);
 assert.equal(opensApp(snap('www.citi.com').applinks.details,new URL('https://www.citi.com/login')),false);
});
test('touch devices get the app link, others and unlisted banks keep the website',()=>{
 assert.equal(bankLink('Chase',urlsFor,true),bankAppLinks.Chase.url);
 assert.equal(bankLink('Chase',urlsFor,false),urlsFor.Chase);
 assert.equal(bankLink('BOA',{BOA:'https://www.bankofamerica.com/'},true),'https://www.bankofamerica.com/');
});
