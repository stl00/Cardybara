// #664: speech recognition is only reached through the dictation helper, which asks for consent before the cloud service
// (#655). Sender's own speech input sets no language, stays off the device and asks nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {transformSync} from 'esbuild';
import {translations} from '../src/i18n/index.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const HELPER='src/platform/speech.js';
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]);
const sources=walk(join(root,'src')).filter(file=>/\.[cm]?[jt]sx?$/.test(file))
 .map(file=>[relative(root,file).split('\\').join('/'),readFileSync(file,'utf8')]);

// esbuild drops the comments, so only code and strings are matched.
const code=(file,source)=>transformSync(source,{loader:/tsx?$/.test(file)?'tsx':'jsx',jsx:'preserve',charset:'utf8'}).code;
function violations(file,source){
 const text=code(file,source),found=[];
 // Any mention, not only `new`: an alias would construct it just the same.
 if(file!==HELPER&&/\b(webkit)?SpeechRecognition\b/.test(text))found.push(`${file}: use the speech recognizer through ${HELPER}`);
 // SpeechButton starts Sender's recognizer even without allowSpeech.
 if(/\b(allowSpeech|SpeechButton|useSpeech)\b/.test(text))found.push(`${file}: Sender's built-in speech input is not allowed`);
 return found;
}

test('no src/ file reaches speech recognition outside the dictation helper',()=>{
 assert.ok(sources.some(([file])=>file===HELPER),'the helper moved; update HELPER');
 assert.deepEqual(sources.flatMap(([file,source])=>violations(file,source)),[]);
});

test('the guard fails on Sender speech input and on a recognizer elsewhere',()=>{
 const [file,chat]=sources.find(([name])=>name==='src/ChatAdvisor.jsx');
 assert.ok(chat.includes('<Sender '));
 for(const prop of ['allowSpeech','allowSpeech={true}','{...{allowSpeech:true}}'])
  assert.equal(violations(file,chat.replace('<Sender ',`<Sender ${prop} `)).length,1,prop);
 for(const source of ['new SpeechRecognition();','new window.webkitSpeechRecognition();',"const R=window['SpeechRecognition'];new R();"])
  assert.equal(violations('src/Other.jsx',source).length,1,source);
 assert.equal(violations('src/Other.jsx','export const footer=(_,{components:{SpeechButton}})=><SpeechButton/>;').length,1);
 assert.deepEqual(violations('src/Other.jsx','// new SpeechRecognition() and allowSpeech\nexport const a=1;'),[]);
});

test('the assistant privacy tooltip describes voice input in all three languages',()=>{
 const chat=sources.find(([name])=>name==='src/ChatAdvisor.jsx')[1];
 // Outside the hosted/own-key choice, so both kinds of tooltip carry it.
 const key=chat.match(/:s\.notice\}<\/div><div>\{t\('(语音输入[^']+)'\)\}/)?.[1];
 assert.ok(key,'the tooltip has a voice input sentence');
 const copy={'zh-CN':key,'zh-TW':translations['zh-TW'][key],'en-US':translations['en-US'][key]};
 assert.match(copy['zh-CN'],/本机识别.*同意.*语音服务.*不录音.*按发送.*撤回/);
 assert.match(copy['zh-TW'],/本機辨識.*同意.*語音服務.*不錄音.*按傳送.*撤回/);
 assert.match(copy['en-US'],/on this device.*accept.*speech service.*never records.*press send.*withdraw/);
});
