import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {logoRegistry as registry,logoPresentation,resolveItem} from '../src/logoRegistry.js';
const root=new URL('..',import.meta.url).pathname;
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
test('the component stays local and theme-neutral',()=>{
 assert.doesNotMatch(component,/https?:\/\/|fetch\(/);
 const rule=css.split('\n').filter(l=>l.startsWith('.item-logo')).join('\n');
 assert.match(rule,/\.item-logo\.is-icon\{color:inherit/,'icons follow the surrounding text colour');
});
test('resolution cascades to an explicit category and rejects inherited keys',()=>{
 assert.equal(resolveItem({text:'zzz',category:'dining'}).category,'dining');
 assert.equal(resolveItem({ruleId:'nope',category:'hotel'}).category,'hotel');
 assert.equal(resolveItem({programme:'nope',category:'hotel'}).category,'hotel');
 assert.equal(resolveItem({ruleId:'rule.chase-us-united-quest.rideshare',category:'hotel'}).category,'ride-share');
 assert.equal(resolveItem().category,null);
 assert.equal(logoPresentation(resolveItem({category:'constructor'})),null);
 assert.equal(logoPresentation({logo:'brand/logos/x.svg',name:null,category:null}),null,'never expose a raw label slot');
});
// Renders the real component, so a broken import, icon map or label fails here.
test('the component renders labelled markup in every language',async()=>{
 const {outputFiles:[bundle]}=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import ItemLogo from './src/ItemLogo.jsx';import {activateLanguage} from './src/i18n-core.js';export const render=(props,language)=>{activateLanguage(language);return renderToStaticMarkup(React.createElement(ItemLogo,props));};`,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent',external:['react','react-dom','react-dom/server']});
 const module={exports:{}};new Function('module','exports','require',bundle.text)(module,module.exports,createRequire(new URL('../package.json',import.meta.url)));
 const {render}=module.exports,rule='rule.chase-us-united-quest.rideshare';
 assert.match(render({ruleId:rule},'zh-CN'),/role="img" aria-label="网约车"/);
 assert.match(render({ruleId:rule},'en-US'),/aria-label="Ride-share"/);
 assert.match(render({ruleId:rule},'zh-TW'),/aria-label="網約車"/);
 assert.match(render({ruleId:rule,size:20},'en-US'),/--item-logo-size:20px/);
 for(const category of Object.keys(registry.categories))assert.match(render({category},'en-US'),/<svg/,category);
 assert.match(render({view:{brandId:'x',name:'X',logo:'brand/logos/x.svg',category:'dining'}},'en-US'),/aria-label="X logo".*<img src="\/brand\/logos\/x\.svg" alt=""/);
 assert.equal(render({},'en-US'),'');
 assert.equal(render({text:'Tuber Farm'},'en-US'),'');
});
