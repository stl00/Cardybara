import {INTERVALS,POPUP_WORDS,bankRow,fill} from './schedule-core.js';
import {popupLanguage,bankName,bankMark} from './popup-i18n.js';
import {PROVIDERS} from './providers.js';
const lang=popupLanguage(),t=POPUP_WORDS[lang],$=id=>document.getElementById(id);
document.documentElement.lang=lang;
const ask=m=>chrome.runtime.sendMessage(m);
const sameDay=at=>new Date(at).toDateString()===new Date().toDateString();
const time=at=>new Date(at).toLocaleString(lang,sameDay(at)?{hour:'2-digit',minute:'2-digit'}:{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
function row(settings,bank,running){
 const r=bankRow(settings,bank,t,time),li=el('li','bank');
 const tag=el('span','tag '+r.tone,r.tag),info=el('div','info');info.append(el('b',null,r.detail));if(r.last)info.append(' · '+r.last);
 const act=el('div','act');act.append(tag);
 // Retry clears only this bank's stop; the next check reads it under the usual rules.
 if(r.action==='retry'){const b=el('button','small',t.retry);b.type='button';b.disabled=running;b.onclick=async()=>{b.disabled=true;const res=await ask({type:'dev-retry-bank',bank});if(res?.ok){render(res);$('status').textContent=bankName(bank,lang)+' · '+t.retried;}else{b.disabled=false;$('status').textContent=t.retryFailed;}};act.append(b);}
 // Opens only the bank's own sign-in page from the registry. The owner signs in; the popup never does.
 if(r.action==='open'&&PROVIDERS[bank]?.url){const a=el('a','btn small',t.open);a.href=PROVIDERS[bank].url;a.target='_blank';a.rel='noopener noreferrer';act.append(a);}
 li.append(bankMark(bank),el('span','name',bankName(bank,lang)),act,info);return li;
}
function render({settings,running}){
 $('read-now').disabled=!!running;if(running)$('status').textContent=t.running;
 $('on').checked=settings.enabled;$('every').value=String(settings.intervalMinutes);
 const plan=(settings.readNow||[]).map(b=>bankName(b,lang));
 $('read-now-plan').textContent=running?'':plan.length?fill(t.readNowWill,plan.join(lang==='en-US'?', ':'、')):t.readNowNone;
 $('banks').replaceChildren(...Object.keys(settings.skips||{}).map(bank=>row(settings,bank,running)));
 $('checked').textContent=settings.lastCheckAt?fill(t.checked,time(settings.lastCheckAt)):'';
}
$('title').textContent=t.title;$('on-label').textContent=t.on;$('every-label').textContent=t.every;$('note').textContent=t.note;$('wallet').textContent=t.wallet+' ↗';$('banks-label').textContent=t.banks;$('read-now').textContent=t.readNow;
$('every').append(...INTERVALS.map(m=>{const o=el('option',null,fill(t.hours,String(m/60)));o.value=String(m);return o;}));
const save=async()=>{const r=await ask({type:'dev-schedule-set',enabled:$('on').checked,intervalMinutes:Number($('every').value)});if(r?.ok)render(r);};
$('on').onchange=save;$('every').onchange=save;
let wasRunning=false;
$('read-now').onclick=async()=>{$('read-now').disabled=true;const r=await ask({type:'dev-read-now'});if(!r?.ok)return;wasRunning=r.outcome==='started'||r.running;render(r);$('status').textContent=r.outcome==='started'?t.readStarted:r.outcome==='running'?t.running:t.nothingToRead;};
// While the popup is open it follows the run, so each bank's result shows when it ends.
const full=()=>ask({type:'dev-schedule-get'}).then(r=>{if(r?.ok){wasRunning=r.running;render(r);}});
// Polling reads stored state only; a full check, which looks at bank tabs, runs on opening and once a run ends.
const follow=()=>ask({type:'dev-schedule-state'}).then(r=>{if(!r?.ok)return;if(wasRunning&&!r.running){$('status').textContent='';full();return;}wasRunning=r.running;render(r);});
full();setInterval(follow,3000);
