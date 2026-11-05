import {INTERVALS,POPUP_WORDS} from './schedule-core.js';
const lang=navigator.language,t=POPUP_WORDS[/^zh-(?:TW|HK|Hant)/i.test(lang)?'zh-TW':/^zh/i.test(lang)?'zh-CN':'en'],$=id=>document.getElementById(id);
const ask=m=>chrome.runtime.sendMessage(m);
function render(settings){
 $('on').checked=settings.enabled;$('every').value=String(settings.intervalMinutes);
 $('banks').replaceChildren(...Object.entries(settings.skips||{}).map(([bank,reason])=>{const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');name.textContent=bank;state.textContent=t[reason]||reason;li.append(name,state);return li;}));
 $('checked').textContent=settings.lastCheckAt?t.checked+': '+new Date(settings.lastCheckAt).toLocaleTimeString():'';
}
$('on-label').textContent=t.on;$('every-label').textContent=t.every;$('note').textContent=t.note;$('wallet').textContent=t.wallet;
$('every').append(...INTERVALS.map(m=>{const o=document.createElement('option');o.value=String(m);o.textContent=m/60+t.hours;return o;}));
const save=async()=>{const r=await ask({type:'dev-schedule-set',enabled:$('on').checked,intervalMinutes:Number($('every').value)});if(r?.ok)render(r.settings);};
$('on').onchange=save;$('every').onchange=save;
ask({type:'dev-schedule-get'}).then(r=>{if(r?.ok)render(r.settings);});
