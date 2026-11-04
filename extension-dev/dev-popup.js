import {INTERVALS} from './schedule-core.js';
const words={
 en:{on:'Refresh on a schedule',every:'At most every',hours:'h',ok:'Read',login_expired:'Signed out. It will read after you next sign in',stopped:'Stopped: turn the schedule off and on to try again',none:'Nothing read yet',note:'It reads when Chrome has been idle for 2 minutes. It never signs in and sends only a redacted report to this computer.',wallet:'Open wallet'},
 'zh-CN':{on:'定时刷新',every:'最短间隔',hours:' 小时',ok:'已读取',login_expired:'已退出登录。你下次登录后会自动读取',stopped:'已停止：关掉再打开定时刷新后才会重试',none:'尚未读取',note:'Chrome 空闲 2 分钟后才读取。插件不会替你登录，只向本机发送脱敏报告。',wallet:'打开钱包'},
 'zh-TW':{on:'定時重新整理',every:'最短間隔',hours:' 小時',ok:'已讀取',login_expired:'已登出。你下次登入後會自動讀取',stopped:'已停止：關掉再打開定時重新整理後才會重試',none:'尚未讀取',note:'Chrome 閒置 2 分鐘後才讀取。外掛不會替你登入，只向本機傳送去識別化報告。',wallet:'開啟錢包'}
};
const lang=navigator.language,t=words[/^zh-(?:TW|HK|Hant)/i.test(lang)?'zh-TW':/^zh/i.test(lang)?'zh-CN':'en'],$=id=>document.getElementById(id);
const ask=m=>chrome.runtime.sendMessage(m);
function render(settings){
 $('on').checked=settings.enabled;$('every').value=String(settings.intervalMinutes);
 $('banks').replaceChildren(...Object.entries(settings.banks).map(([bank,b])=>{const li=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span');name.textContent=bank;state.textContent=t[b.state]||t.none;li.append(name,state);return li;}));
}
$('on-label').textContent=t.on;$('every-label').textContent=t.every;$('note').textContent=t.note;$('wallet').textContent=t.wallet;
$('every').append(...INTERVALS.map(m=>{const o=document.createElement('option');o.value=String(m);o.textContent=m/60+t.hours;return o;}));
const save=async()=>{const r=await ask({type:'dev-schedule-set',enabled:$('on').checked,intervalMinutes:Number($('every').value)});if(r?.ok)render(r.settings);};
$('on').onchange=save;$('every').onchange=save;
ask({type:'dev-schedule-get'}).then(r=>{if(r?.ok)render(r.settings);});
