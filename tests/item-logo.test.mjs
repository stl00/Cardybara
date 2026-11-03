import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {logoRegistry as registry,logoPresentation} from '../src/logoRegistry.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const catalog=JSON.parse(read('src/translations.json')),component=read('src/ItemLogo.jsx'),css=read('src/style.css');
test('logo, then category icon, then nothing',()=>{
 const view={brandId:'x',name:'X',logo:'brand/logos/x.svg',category:'dining'};
 assert.deepEqual(logoPresentation(view),{kind:'logo',src:'brand/logos/x.svg',label:'{0} 标志',labelParams:['X']});
 assert.equal(logoPresentation(view,{broken:true}).kind,'icon');
 assert.equal(logoPresentation({...view,logo:null}).label,registry.categories.dining.label);
 assert.equal(logoPresentation({...view,logo:null,category:null}),null);
 assert.equal(logoPresentation({brandId:'x',name:'X',logo:'brand/logos/x.svg',category:null},{broken:true}),null);
 assert.equal(logoPresentation(null),null);
});
test('every category icon exists in the component and has a label in all languages',()=>{
 for(const [id,{icon,label}] of Object.entries(registry.categories)){
  assert.match(component,new RegExp(`const icons=\\{[^}]*\\b${icon}\\b`),id);
  for(const language of ['en-US','zh-TW'])assert.ok(catalog[language][label],`${language}: ${label}`);
 }
 for(const language of ['en-US','zh-TW'])assert.ok(catalog[language]['{0} 标志'],language);
});
test('the component stays local, labelled and theme-neutral',()=>{
 assert.doesNotMatch(component,/https?:\/\/|fetch\(/);
 assert.match(component,/role="img" aria-label=\{label\}/);
 assert.match(component,/alt="" onError=/);
 const rule=css.split('\n').filter(l=>l.startsWith('.item-logo')).join('\n');
 assert.match(rule,/\.item-logo\.is-icon\{color:inherit/,'icons follow the surrounding text colour');
 assert.match(rule,/flex:0 0 var\(--item-logo-size/,'fixed size never shifts layout');
});
