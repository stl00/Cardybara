// One navigation config for every screen size (#496, #497): the desktop sider shows `primary`, a "More" group
// title, then `more`; phones show `primary` as a bottom tab bar and `more` in a drawer.
// `label` is the full name (a zh-CN catalog key), `short` the tab-bar name (a `nav|…` context key, see tx in
// i18n-core.js), `icon` a name resolved to a component by NavIcon.jsx, so this file stays plain data for tests.
export const NAV = {
  primary: [
    {key: 'overview', label: '总览', short: '总览', icon: 'appstore'},
    {key: 'wallet', label: '卡片钱包', short: '钱包', icon: 'credit-card'},
    {key: 'advisor', label: '问问卡疲扒拉', short: '问问', icon: 'capybara'},
    {key: 'credits', label: '本期福利', short: '福利', icon: 'gift'},
  ],
  more: [
    {key: 'rewards', label: '积分账户', short: '积分', icon: 'wallet'},
    // Reading bank pages exists only where the platform can collect (the extension and the dev server).
    {key: 'connections', label: '银行连接', short: '银行', icon: 'link', needs: 'collection'},
    {key: 'catalog', label: '卡片资料库', short: '卡片库', icon: 'book'},
    {key: 'guide', label: '福利资料库', short: '福利库', icon: 'read'},
    {key: 'settings', label: '设置', short: '设置', icon: 'setting'},
  ],
};

const available = (item, {collects}) => item.needs !== 'collection' || !!collects;

// The groups this runtime shows: `connections` only where the runtime can collect.
export function navGroups({collects = false} = {}) {
  return {
    primary: NAV.primary.filter(item => available(item, {collects})),
    more: NAV.more.filter(item => available(item, {collects})),
  };
}

// The desktop menu's page order: primary, then more.
export function navOrder(options) {
  const {primary, more} = navGroups(options);
  return [...primary, ...more].map(item => item.key);
}

// Items for the desktop antd Menu: primary, then a "More" group title holding `more`.
export function siderItems(options, {label = item => item.label, icon = () => null, moreLabel = '更多'} = {}) {
  const {primary, more} = navGroups(options);
  const item = entry => ({key: entry.key, label: label(entry), icon: icon(entry)});
  return [...primary.map(item), {type: 'group', key: 'more', label: moreLabel, children: more.map(item)}];
}
