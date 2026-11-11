// A stand-in for Chrome on --remote-debugging-pipe, for tests/e2e-chrome-start.test.mjs. It reads
// NUL-separated CDP requests on fd 3 and answers on fd 4.
//   node fake-chrome.mjs answer <delayMs>  answers nothing until delayMs has passed, then everything
//   node fake-chrome.mjs hang              reads requests and never answers
//   node fake-chrome.mjs exit <code>       exits at once
import {createReadStream,createWriteStream} from 'node:fs';

const [mode,arg]=process.argv.slice(2);
if(mode==='exit')process.exit(Number(arg||1));
const input=createReadStream(null,{fd:3}),output=createWriteStream(null,{fd:4});
const ready=Date.now()+(mode==='answer'?Number(arg||0):Infinity);
let buffer=Buffer.alloc(0);const queue=[];
const answer=()=>{if(Date.now()<ready)return;while(queue.length){const {id,method}=queue.shift();output.write(JSON.stringify({id,result:method==='Browser.getVersion'?{product:'FakeChrome/1.0'}:{}})+'\0');}};
input.on('data',chunk=>{
 buffer=Buffer.concat([buffer,chunk]);let i;
 while((i=buffer.indexOf(0))>=0){queue.push(JSON.parse(buffer.subarray(0,i).toString('utf8')));buffer=buffer.subarray(i+1);}
 answer();
});
setInterval(answer,20);
