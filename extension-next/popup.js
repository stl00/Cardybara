import {BUILD_ID} from './build-info.js';
import {CONNECTABLE_BANKS,PROVIDERS,SCOPED} from './providers.js';
import {exportCollectorState} from './export-state.js';
import {RELEASE_WORDS,popupLanguage,bankName,bankMark,fill} from './popup-i18n.js';
import {collectReport,needsReport,reportFileName} from './problem-report.js';
const lang=popupLanguage(),t=RELEASE_WORDS[lang],$=s=>document.querySelector(s),status=$('#status');
document.documentElement.lang=lang;
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
async function command(type,bank){const r=await chrome.runtime.sendMessage({type,requestId:crypto.randomUUID(),...(bank?{bank}:{})});if(!r?.ok)throw Error(r?.error||t.failed);return r.state;}
const active=['queued','opening','navigating','capturing'],good=['updated'],warn=['partial','needs_login','needs_confirmation','no_data','ambiguous'];
const tone=s=>active.includes(s)?'wait':good.includes(s)?'ok':warn.includes(s)?'login':['cancelled'].includes(s)?'':'error';
function render(s){
 const current=s.runtimeBuild===BUILD_ID,running=s.run?.status==='running',update=$('#apply-update');
 $('#build-status').textContent=current?fill(t.buildCurrent,s.runtimeBuild):t.buildStale+(running?' '+t.buildWait:'');
 update.hidden=current;update.disabled=running;
 const run=s.run,tag=$('#run-tag');
 tag.hidden=!run;if(run){tag.textContent=(t.runStatus[run.status]||run.status)+' · '+fill(t.progress,run.jobs.filter(j=>!active.includes(j.status)).length,run.jobs.length);tag.className='tag '+(running?'wait':run.status==='complete'?'ok':'');}
 status.textContent=run?'':t.noRun;
 $('#jobs').replaceChildren(...(run?.jobs||[]).map(j=>{const li=el('li','bank'),act=el('div','act');act.append(el('span','tag '+tone(j.status),t.phases[j.status]||j.status));if(needsReport(j,s.records?.[j.bank])){const b=el('button','small',t.reportButton);b.type='button';b.onclick=()=>showReport(j,s).catch(error);act.append(b);}li.append(bankMark(j.bank),el('span','name',bankName(j.bank,lang)),act);return li;}));
 $('#cancel').disabled=!running;
 $('#banks').replaceChildren(...(SCOPED?CONNECTABLE_BANKS:Object.keys(PROVIDERS)).map(bank=>{
  const off=s.disabled.includes(bank),li=el('li','bank'),act=el('div','act');
  for(const [type,label,cls]of [[off?'connect':'disconnect',off?t.connect:t.disconnect,off?'small':'small danger'],['clear',t.clear,'small']]){const b=el('button',cls,label);b.type='button';b.onclick=()=>command(type,bank).then(render).catch(error);act.append(b);}
  li.append(bankMark(bank),el('span','name',bankName(bank,lang)),act);if(off)li.append(el('div','info',t.disabled));return li;
 }));
}
function error(e){status.textContent=e.message;}
// The tester reads the whole report before saving it, and sends the file themselves (#196).
async function showReport(job,s){
 const report=await collectReport(job,s);
 const text=JSON.stringify(report,null,2),box=$('#report');box.hidden=false;
 const save=el('button','primary small',t.reportSave),close=el('button','small',t.reportClose);save.type=close.type='button';
 save.onclick=()=>{const url=URL.createObjectURL(new Blob([text+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=reportFileName(job.bank);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 close.onclick=()=>{box.hidden=true;box.replaceChildren();};
 const actions=el('div','row');actions.append(save,close);
 box.replaceChildren(el('h2',null,fill(t.reportTitle,bankName(job.bank,lang))),el('p','note',t.reportNote),...(report.structure?[]:[el('p','note',t.reportNoPage)]),el('pre','report-json',text),actions);
}
$('#subtitle').textContent=t.subtitle;$('#open-wallet').textContent=t.openWallet+' ↗';$('#wallet-link').textContent=t.openWallet+' ↗';$('#run-label').textContent=t.run;status.textContent=t.loading;
$('#cancel').textContent=t.cancel;$('#export').textContent=t.export;$('#apply-update').textContent=t.applyUpdate;$('#manage-label').textContent=t.manage;$('#disable-note').textContent=t.disableNote;$('#privacy').textContent=t.privacy;$('#title').textContent=t.title;
$('#cancel').onclick=()=>command('cancel').then(render).catch(error);
$('#export').onclick=()=>command('export').then(s=>{const url=URL.createObjectURL(new Blob([JSON.stringify(exportCollectorState(s),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='cardybara-extension-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(error);
$('#apply-update').onclick=()=>{$('#build-status').textContent=t.reloading;chrome.runtime.reload();};
command('hello').then(render).catch(error);
// Diagnostics stay folded below the build panel.
function diagnostic(label,text){const box=el('details'),summary=el('summary',null,t.diagnostics+' · '+label);box.append(summary,el('p','diag',text));$('#build-panel').after(box);}
chrome.storage.local.get('cardybara:last-capture-error').then(s=>{const d=s['cardybara:last-capture-error'];if(d)diagnostic(t.captureDiag,`${d.bank} · ${d.stage} · ${d.code} · ${d.name}`);});
chrome.storage.local.get('cardybara:last-read-diagnostic').then(s=>{const d=s['cardybara:last-read-diagnostic'];if(d)diagnostic(t.readDiag,JSON.stringify(d));});
