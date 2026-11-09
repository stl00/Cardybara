import {INTERVALS,POPUP_WORDS} from './schedule-core.js';
const lang=navigator.language,t=POPUP_WORDS[/^zh-(?:TW|HK|Hant)/i.test(lang)?'zh-TW':/^zh/i.test(lang)?'zh-CN':'en'],$=id=>document.getElementById(id);
const ask=m=>chrome.runtime.sendMessage(m);
function render({settings,running}){
 $('read-now').disabled=!!running;$('status').textContent=running?t.running:'';
 $('on').checked=settings.enabled;$('every').value=String(settings.intervalMinutes);
 $('banks').replaceChildren(...Object.entries(settings.skips||{}).map(([bank,reason])=>{const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');name.textContent=bank;const result=settings.banks?.[bank]?.state;state.textContent=(t[reason]||reason)+(result?' · '+t.result+': '+(t[result]||result):'');li.append(name,state);return li;}));
 $('checked').textContent=settings.lastCheckAt?t.checked+': '+new Date(settings.lastCheckAt).toLocaleTimeString():'';
}
$('on-label').textContent=t.on;$('every-label').textContent=t.every;$('note').textContent=t.note;$('wallet').textContent=t.wallet;
$('every').append(...INTERVALS.map(m=>{const o=document.createElement('option');o.value=String(m);o.textContent=m/60+t.hours;return o;}));
const save=async()=>{const r=await ask({type:'dev-schedule-set',enabled:$('on').checked,intervalMinutes:Number($('every').value)});if(r?.ok)render(r);};
$('on').onchange=save;$('every').onchange=save;
let wasRunning=false;
$('read-now').textContent=t.readNow;
$('read-now').onclick=async()=>{$('read-now').disabled=true;const r=await ask({type:'dev-read-now'});if(!r?.ok)return;wasRunning=r.outcome==='started'||r.running;render(r);$('status').textContent=r.outcome==='started'?t.readStarted:r.outcome==='running'?t.running:t.nothingToRead;};
// While the popup is open it follows the run, so each bank's result shows when it ends.
const full=()=>ask({type:'dev-schedule-get'}).then(r=>{if(r?.ok){wasRunning=r.running;render(r);}});
// Polling reads stored state only; a full check, which looks at bank tabs, runs on opening and once a run ends.
const follow=()=>ask({type:'dev-schedule-state'}).then(r=>{if(!r?.ok)return;if(wasRunning&&!r.running){full();return;}wasRunning=r.running;render(r);});
full();setInterval(follow,3000);
