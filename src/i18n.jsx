import React, {createContext, useContext, useEffect, useState} from 'react';
import {App, ConfigProvider} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import {activateLanguage, normalizeLanguage} from './i18n-core';
export {t, formatNumber, formatDateTime,formatReadDate} from './i18n-core';
const locales = {'zh-CN':zhCN, 'zh-TW':zhTW, 'en-US':enUS};
const LanguageContext = createContext(null);
const STORAGE_KEY = 'cardybara-language';
export function I18nProvider({children}) {
  const [language, setLanguage] = useState(() => {
    try { return normalizeLanguage(localStorage.getItem(STORAGE_KEY)); }
    catch { return 'zh-CN'; }
  });
  activateLanguage(language);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Language still works when storage is unavailable. */ }
    document.documentElement.lang = language;
    document.title = language === 'en-US' ? 'Cardybara' : 'Cardybara · 卡疲扒拉';
  }, [language]);
  return <LanguageContext.Provider value={{language, setLanguage:value=>setLanguage(normalizeLanguage(value))}}>
    <ConfigProvider locale={locales[language]}><App>{children}</App></ConfigProvider>
  </LanguageContext.Provider>;
}
export function useI18n() { return useContext(LanguageContext); }
