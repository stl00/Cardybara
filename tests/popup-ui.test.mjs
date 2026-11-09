import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {POPUP_WORDS,SKIP_REASONS,STATUS_TONES,RESULT_STATES,bankRow,retryBank,decideBanks,planBanks,markAttempted,setEnabled,defaultSettings,afterRun} from '../extension-dev/schedule-core.js';
import {RELEASE_WORDS,LANGUAGES,popupLanguage,bankName} from '../extension-next/popup-i18n.js';

const keys=(o,prefix='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?keys(v,prefix+k+'.'):[prefix+k]).sort();
const time=at=>'T'+at;

test('both popups have every string in all three wallet languages',()=>{
 for(const words of [POPUP_WORDS,RELEASE_WORDS]){
  assert.deepEqual(Object.keys(words).sort(),[...LANGUAGES].sort());
  const reference=keys(words['zh-CN']);
  for(const lang of LANGUAGES){assert.deepEqual(keys(words[lang]),reference,lang);for(const k of reference)assert.ok(k.split('.').reduce((o,p)=>o[p],words[lang]).trim(),lang+' '+k);}
 }
 for(const reason of SKIP_REASONS)assert.ok(STATUS_TONES[reason],'tone for '+reason);
 for(const lang of LANGUAGES)for(const tone of new Set(Object.values(STATUS_TONES)))assert.ok(POPUP_WORDS[lang]['tone_'+tone],lang+' '+tone);
});

test('a bank row says each thing once',()=>{
 for(const lang of LANGUAGES){
  const words=POPUP_WORDS[lang],details=SKIP_REASONS.map(r=>words[r]);
  assert.equal(new Set(details).size,details.length,lang+': two reasons share a sentence');
  for(const reason of SKIP_REASONS)for(const state of [undefined,...RESULT_STATES]){
   const settings={...setEnabled(defaultSettings(),true),skips:{BOA:reason},banks:{BOA:{lastAttemptAt:1000,...(state?{state,finishedAt:2000}:{})}}};
   const row=bankRow(settings,'BOA',words,time),parts=[row.tag,row.detail,row.last].filter(Boolean);
   assert.equal(new Set(parts).size,parts.length,`${lang} ${reason} ${state}`);
   const bare=row.last.replace('T2000','').trim();
   if(bare){assert.ok(!row.detail.includes(bare),`${lang} ${reason} ${state}: ${row.detail} / ${row.last}`);assert.ok(!bare.includes(row.detail));}
   assert.ok(!row.detail.includes('{0}'),`${lang} ${reason}`);
  }
 }
 const waiting=bankRow({...setEnabled(defaultSettings(),true,360),skips:{BOA:'not_due'},banks:{BOA:{state:'ok',lastAttemptAt:1000}}},'BOA',POPUP_WORDS['en-US'],time);
 assert.equal(waiting.detail,'Next read from T'+(1000+360*60000),'waiting says when');assert.equal(waiting.tone,'wait');
 assert.equal(bankRow({skips:{BOA:'stopped'},banks:{}},'BOA',POPUP_WORDS['zh-CN'],time).action,'retry');
 for(const reason of ['no_tab','signed_out','other_region'])assert.equal(bankRow({skips:{BOA:reason},banks:{}},'BOA',POPUP_WORDS['zh-CN'],time).action,'open');
 for(const reason of ['ready','not_due','off','check_failed'])assert.equal(bankRow({skips:{BOA:reason},banks:{}},'BOA',POPUP_WORDS['zh-CN'],time).action,null);
});

test('Retry clears one stopped bank and keeps every limit',()=>{
 const now=1e12,found=banks=>Object.fromEntries(banks.map(b=>[b,'found']));
 const base={...setEnabled(defaultSettings(),true,1440),banks:{BOA:{state:'stopped',reason:'no_data',lastAttemptAt:now-30*60000,finishedAt:now-29*60000},Chase:{state:'stopped',reason:'load_error',lastAttemptAt:now-2*3600000},'Citi US':{state:'ok',lastAttemptAt:now-10*60000},'Amex US':{state:'stopped'},'Amex HK':{state:'stopped'}}};
 const after=retryBank(base,'BOA');
 assert.deepEqual(after.banks.BOA,{lastAttemptAt:now-30*60000,retried:true});
 for(const bank of ['Chase','Citi US','Amex US','Amex HK'])assert.deepEqual(after.banks[bank],base.banks[bank],bank+' untouched');
 assert.equal(retryBank(base,'Citi US'),base,'a bank that is not stopped is left alone');
 const input=(settings,at=now)=>({settings,activeBanks:['BOA','Chase','Citi US','Amex US','Amex HK'],withCards:[],tabs:found(['BOA','Chase','Citi US','Amex US','Amex HK']),idle:'idle',now:at});
 const why=decideBanks(input(after));
 assert.equal(why.BOA,'not_due','within the hour it still waits');assert.equal(why.Chase,'stopped');assert.equal(why['Citi US'],'not_due');
 assert.equal(decideBanks(input(after,now+31*60000)).BOA,'ready','after the hour it reads, not after the 24 h interval');
 const both=retryBank(retryBank(base,'Amex US'),'Amex HK');
 assert.deepEqual(planBanks(input(both)).filter(b=>b.startsWith('Amex')),['Amex US'],'Amex still reads one region at a time');
 const read=markAttempted(after,['BOA'],now+31*60000);assert.equal(read.banks.BOA.retried,undefined,'a read ends the retry');
 assert.equal(afterRun(read,{jobs:[{bank:'BOA',status:'load_error'}]},now).banks.BOA.state,'stopped','a new failure stops it again');
});

test('the popups follow the wallet language, then the browser',()=>{
 assert.equal(popupLanguage('zh-TW','en-US'),'zh-TW');assert.equal(popupLanguage('en-US','zh-CN'),'en-US');
 assert.equal(popupLanguage(null,'zh-HK'),'zh-TW');assert.equal(popupLanguage(null,'zh-Hans-CN'),'zh-CN');assert.equal(popupLanguage(null,'en-GB'),'en-US');assert.equal(popupLanguage('xx','fr'),'zh-CN');
 assert.equal(bankName('HSBC HK','zh-CN'),'香港汇丰');assert.equal(bankName('Chase','en-US'),'Chase');
});

test('popup markup holds no hard-coded copy and loads no framework',()=>{
 for(const file of ['extension-next/popup.html','extension-dev/dev-popup.html','extension-next/popup.js','extension-dev/dev-popup.js']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.ok(!/from ['"](?:react|antd)/.test(source),file);
  if(file.endsWith('.js'))assert.ok(!/[一-鿿]/.test(source),file+' has inline Chinese copy');
 }
 // The packagers rewrite this exact link.
 assert.ok(readFileSync(new URL('../extension-next/popup.html',import.meta.url),'utf8').includes('href="index.html#overview"'));
});
