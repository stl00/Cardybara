import React, {createContext, useContext, useEffect, useState, useSyncExternalStore} from 'react';
import {App, ConfigProvider, theme} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import {activateLanguage, normalizeLanguage} from './i18n-core';
import {subscribeSystemDark, systemPrefersDark} from './colorScheme';
export {t, ruleField, formatNumber, formatDateTime,formatReadDate} from './i18n-core';
const locales = {'zh-CN':zhCN, 'zh-TW':zhTW, 'en-US':enUS};
const LanguageContext = createContext(null);
const STORAGE_KEY = 'cardybara-language';
const LIGHT_THEME = {algorithm:theme.defaultAlgorithm};
// The dark algorithm's selected-menu text reads at only 2.5:1 on its own highlight.
const DARK_THEME = {algorithm:theme.darkAlgorithm, components:{Menu:{itemSelectedColor:'#65a9f3'}}};
export function I18nProvider({children}) {
  const [language, setLanguage] = useState(() => {
    try { return normalizeLanguage(localStorage.getItem(STORAGE_KEY)); }
    catch { return 'zh-CN'; }
  });
  const dark = useSyncExternalStore(subscribeSystemDark, systemPrefersDark);
  activateLanguage(language);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Language still works when storage is unavailable. */ }
    document.documentElement.lang = language;
    document.title = language === 'en-US' ? 'Cardybara' : 'Cardybara · 卡疲扒拉';
  }, [language]);
  return <LanguageContext.Provider value={{language, setLanguage:value=>setLanguage(normalizeLanguage(value))}}>
    <ConfigProvider locale={locales[language]} theme={dark ? DARK_THEME : LIGHT_THEME}><App>{children}</App></ConfigProvider>
  </LanguageContext.Provider>;
}
export function useI18n() { return useContext(LanguageContext); }
