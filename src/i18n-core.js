import {translations} from './i18n/index.js';
export const LANGUAGES = ['zh-CN', 'zh-TW', 'en-US'];
let activeLanguage = 'zh-CN';
export function normalizeLanguage(language) {
  return LANGUAGES.includes(language) ? language : 'zh-CN';
}
export function activateLanguage(language) { activeLanguage = normalizeLanguage(language); }
export function translate(key, params = [], language = activeLanguage) {
  if (key == null) return '';
  const source = String(key);
  let text = language === 'zh-CN' ? source : translations[language]?.[source] ?? source;
  // Collector notes contain live counts; translate the sentence without touching the readings.
  const liveNote = source.match(/^本机 Chrome 已读取 (\d+) 张卡的可见字段；其他金额、积分与账单保留各自原采集日期。$/);
  if (liveNote && language === 'en-US') text = `Local Chrome read visible fields for ${liveNote[1]} cards. Other amounts, points and statements retain their original collection dates.`;
  if (liveNote && language === 'zh-TW') text = `本機 Chrome 已讀取 ${liveNote[1]} 張卡的可見欄位；其他金額、積分與帳單保留各自原採集日期。`;
  if (source === '本次未读取新数据；保留此前成功读取的字段和原采集日期。') {
    if (language === 'en-US') text = 'No new data was read. Previously collected fields and their original dates were kept.';
    if (language === 'zh-TW') text = '本次未讀取新資料；保留此前成功讀取的欄位和原採集日期。';
  }
  return text.replace(/\{(\d+)\}/g, (token, index) => params[index] == null ? token : String(params[index]));
}
export const t = translate;
export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(activeLanguage, options).format(value);
}
export function formatDateTime(value, options = {}) {
  const hasFields = ['year','month','day','hour','minute','second','dateStyle','timeStyle'].some(key => key in options);
  const defaults = hasFields ? {} : {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'};
  return new Intl.DateTimeFormat(activeLanguage, {timeZone:'America/Chicago', ...defaults, ...options}).format(new Date(value));
}

export function formatReadDate(value){
 if(!value)return t('未采集');
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):t('未采集');
}
const scriptOf = lang => /^en/.test(lang) ? 'en' : /^zh-(?:HK|TW|Hant)/.test(lang) ? 'zh-Hant' : /^zh/.test(lang) ? 'zh-Hans' : lang;
// Rule text for the reader: the same language first (the original, a stored translation, or the dictionary),
// then the zh-CN text for a Chinese reader, then the official original, then zh-CN. `field` is 'title' or 'summary'; zh is the zh-CN text.
export function ruleField(zh, { original, translations: shown } = {}, field = 'title', language = activeLanguage) {
  if (original && scriptOf(original.lang) === scriptOf(language)) return original[field];
  const stored = Object.entries(shown || {}).find(([lang]) => scriptOf(lang) === scriptOf(language));
  if (stored) return stored[1][field];
  if (language === 'zh-CN' || zh == null) return zh ?? '';
  const known = translations[language]?.[String(zh)];
  if (known != null) return known;
  return original && !/^zh/.test(language) ? original[field] : String(zh);
}
