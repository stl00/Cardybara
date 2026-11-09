// Shared by both popups: the wallet's language, bank names and marks, and the release popup's copy.
// Where the wallet is served from the extension itself, the popup shares its origin and reads the language picked
// there; otherwise (a wallet on localhost) it follows the browser.
export const LANGUAGES=['zh-CN','zh-TW','en-US'];
const LANGUAGE_KEY='cardybara-language';
export function popupLanguage(stored=readStored(),browser=globalThis.navigator?.language||''){
 if(LANGUAGES.includes(stored))return stored;
 return /^zh-(?:TW|HK|MO|Hant)/i.test(browser)?'zh-TW':/^zh/i.test(browser)?'zh-CN':/^en/i.test(browser)?'en-US':'zh-CN';
}
function readStored(){try{return globalThis.localStorage?.getItem(LANGUAGE_KEY);}catch{return null;}}
export const fill=(text,...values)=>values.reduce((out,v,i)=>out.replaceAll('{'+i+'}',v),text);
// The same files the wallet's BankMark uses; a bank with none gets its initial.
const MARKS={'Amex US':'amex.svg','Amex HK':'amex.svg','Amex CA':'amex.svg',Chase:'chase.ico','HSBC HK':'hsbc.png','SC HK':'sc.png',BOA:'boa.png'};
const NAMES={
 'zh-CN':{'Amex US':'Amex 美国','Amex HK':'Amex 香港','Amex CA':'Amex 加拿大','HSBC HK':'香港汇丰','SC HK':'香港渣打','BOA':'Bank of America'},
 'zh-TW':{'Amex US':'Amex 美國','Amex HK':'Amex 香港','Amex CA':'Amex 加拿大','HSBC HK':'香港滙豐','SC HK':'香港渣打','BOA':'Bank of America'},
 'en-US':{'Amex US':'Amex US','Amex HK':'Amex Hong Kong','Amex CA':'Amex Canada','HSBC HK':'HSBC Hong Kong','SC HK':'SC Hong Kong','BOA':'Bank of America'}
};
export const bankName=(bank,language)=>NAMES[language]?.[bank]||bank;
export function bankMark(bank,doc=document){
 const box=doc.createElement('span');box.className='mark';box.setAttribute('aria-hidden','true');
 const initial=()=>{box.replaceChildren();box.textContent=bank.slice(0,1);box.classList.add('initial');};
 if(MARKS[bank]){const img=doc.createElement('img');img.src='brand/banks/'+MARKS[bank];img.alt='';img.onerror=initial;box.append(img);}else initial();
 return box;
}
export const RELEASE_WORDS={
 'zh-CN':{title:'Cardybara · 卡疲扒拉',subtitle:'本地预览 · 各银行支持范围见钱包',openWallet:'打开钱包',loading:'正在读取本机任务状态…',noRun:'暂无采集任务',run:'采集任务',progress:'{0}/{1} 完成',buildCurrent:'后台版本 {0} · 已生效',buildStale:'有本地更新尚未应用。应用后请重新打开钱包。',buildWait:'当前采集结束后可以更新。',applyUpdate:'应用本地更新',reloading:'正在重新加载扩展，请重新打开钱包。',cancel:'取消当前采集',export:'导出扩展记录',manage:'管理采集与清除读数',connect:'启用',disconnect:'停用并清除',clear:'清除读数',disabled:'已停用',disableNote:'停用会停止该银行采集并清除扩展读数；不会退出银行登录，也不会撤销 Chrome 的网站权限。历史网站快照单独保留。',privacy:'隐私与数据说明',diagnostics:'诊断信息',captureDiag:'上次读取诊断',readDiag:'页面识别诊断',failed:'操作未完成',
  runStatus:{running:'进行中',complete:'已完成',cancelled:'已取消',interrupted:'已中断'},
  phases:{queued:'等待刷新',opening:'准备银行页面',navigating:'等待银行加载',capturing:'读取可见字段',updated:'已读取',partial:'部分读取',needs_login:'需要登录',needs_confirmation:'等待手机确认',load_error:'页面加载失败',no_data:'未读取新字段',ambiguous:'账户不明确',cancelled:'已取消',interrupted:'已中断',timeout:'超时',navigation_changed:'页面已切换',tab_closed:'页面关闭'}},
 'zh-TW':{title:'Cardybara · 卡疲扒拉',subtitle:'本機預覽 · 各銀行支援範圍見錢包',openWallet:'開啟錢包',loading:'正在讀取本機任務狀態…',noRun:'目前沒有擷取任務',run:'擷取任務',progress:'{0}/{1} 完成',buildCurrent:'背景版本 {0} · 已生效',buildStale:'有本機更新尚未套用。套用後請重新開啟錢包。',buildWait:'目前擷取結束後可以更新。',applyUpdate:'套用本機更新',reloading:'正在重新載入擴充功能，請重新開啟錢包。',cancel:'取消目前擷取',export:'匯出擴充功能紀錄',manage:'管理擷取與清除讀數',connect:'啟用',disconnect:'停用並清除',clear:'清除讀數',disabled:'已停用',disableNote:'停用會停止該銀行擷取並清除擴充功能讀數；不會登出銀行，也不會撤銷 Chrome 的網站權限。歷史網站快照另外保留。',privacy:'隱私與資料說明',diagnostics:'診斷資訊',captureDiag:'上次讀取診斷',readDiag:'頁面識別診斷',failed:'操作未完成',
  runStatus:{running:'進行中',complete:'已完成',cancelled:'已取消',interrupted:'已中斷'},
  phases:{queued:'等待重新整理',opening:'準備銀行頁面',navigating:'等待銀行載入',capturing:'讀取可見欄位',updated:'已讀取',partial:'部分讀取',needs_login:'需要登入',needs_confirmation:'等待手機確認',load_error:'頁面載入失敗',no_data:'未讀取新欄位',ambiguous:'帳戶不明確',cancelled:'已取消',interrupted:'已中斷',timeout:'逾時',navigation_changed:'頁面已切換',tab_closed:'頁面已關閉'}},
 'en-US':{title:'Cardybara',subtitle:'Local preview · see the wallet for supported banks',openWallet:'Open wallet',loading:'Loading local status…',noRun:'No collection running',run:'Collection',progress:'{0}/{1} done',buildCurrent:'Background build {0} · active',buildStale:'A local update is not applied yet. Reopen the wallet after applying it.',buildWait:'You can update once the current collection ends.',applyUpdate:'Apply local update',reloading:'Reloading the extension. Reopen the wallet afterwards.',cancel:'Cancel collection',export:'Export extension records',manage:'Manage collection and clear readings',connect:'Enable',disconnect:'Disable and clear',clear:'Clear readings',disabled:'Disabled',disableNote:'Disabling stops collection for that bank and clears its extension readings. It does not sign you out of the bank or revoke Chrome site access. Older site snapshots are kept separately.',privacy:'Privacy and data',diagnostics:'Diagnostics',captureDiag:'Last read diagnostic',readDiag:'Page recognition diagnostic',failed:'The action did not complete',
  runStatus:{running:'Running',complete:'Complete',cancelled:'Cancelled',interrupted:'Interrupted'},
  phases:{queued:'Waiting',opening:'Preparing the bank page',navigating:'Waiting for the bank',capturing:'Reading visible fields',updated:'Read',partial:'Partly read',needs_login:'Sign-in needed',needs_confirmation:'Waiting for phone confirmation',load_error:'Page failed to load',no_data:'No new fields read',ambiguous:'Account unclear',cancelled:'Cancelled',interrupted:'Interrupted',timeout:'Timed out',navigation_changed:'Page changed',tab_closed:'Page closed'}}
};
