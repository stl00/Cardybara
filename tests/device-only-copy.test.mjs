// #670: a signed-in wallet with sync on (the default) is uploaded, so no assistant or onboarding text may say
// the wallet stays only on this device without also saying when a copy goes to the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const TEXTS = [
  ['src/ChatAdvisor.jsx', 'assistant', '由 Cardybara 服务回答'],
  ['src/ModelKeySettings.jsx', 'assistant', '聊天助手在 Cardybara 服务上运行'],
  ['src/WalletOnboarding.jsx', 'onboarding', '从卡种目录里选一张卡'],
];
// What each language must say: the device is only the default, and sync is what sends a copy to the server.
const QUALIFIED = {
  'zh-CN': [/默认只保存在/, /开启同步/, /服务器/],
  'zh-TW': [/預設只(保存|儲存)在/, /開啟同步/, /伺服器/],
  'en-US': [/by default/i, /sync on/, /server/],
};

for (const [component, area, start] of TEXTS) {
  test(`${component}: the wallet storage claim names sync in all three languages`, () => {
    const key = [...read(component).matchAll(/t\('([^']+)'\)/g)].map(m => m[1]).find(text => text.startsWith(start));
    assert.ok(key, 'the component still shows this text');
    const dictionary = JSON.parse(read(`src/i18n/${area}.json`));
    const shown = {'zh-CN': key};
    for (const lang of ['zh-TW', 'en-US']) {
      shown[lang] = dictionary[lang]?.[key];
      assert.ok(shown[lang], `${lang} translation exists`);
    }
    for (const [lang, patterns] of Object.entries(QUALIFIED))
      for (const pattern of patterns) assert.match(shown[lang], pattern, lang);
  });
}
