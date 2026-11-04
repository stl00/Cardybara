// Cardybara registry. Design reference: nextcard-sync, see THIRD_PARTY_NOTICES.md.
export const VERSION='1.1.0';
export const ORIGIN='http://127.0.0.1:8766';
const amex=['www.americanexpress.com','global.americanexpress.com'];
export const PROVIDERS={
 'Amex US':{issuer:'Amex',region:'US',locales:['en-US'],currency:'USD',hosts:amex,regionPath:/en-us|\/us\//i,url:'https://www.americanexpress.com/en-us/account/login',evidence:'unverified'},
 'Amex HK':{issuer:'Amex',region:'HK',locales:['zh-HK','zh-CN','en-HK'],currency:'HKD',hosts:amex,regionPath:/zh-hk|en-hk|\/hk\//i,url:'https://www.americanexpress.com/zh-hk/account/login',evidence:'unverified'},
 // Archived: code and fixtures stay, off by default. A wallet already holding these cards keeps its records.
 'Amex CA':{archived:true,issuer:'Amex',region:'CA',locales:['en-CA','fr-CA'],currency:'CAD',hosts:amex,regionPath:/en-ca|fr-ca|\/canada\//i,url:'https://www.americanexpress.com/en-ca/account/login',evidence:'unverified'},
 'Chase':{issuer:'Chase',region:'US',locales:['en-US'],currency:'USD',hosts:['secure.chase.com'],url:'https://secure.chase.com/web/auth/dashboard#/dashboard/overview',evidence:'one-account'},
 'BOA':{issuer:'Bank of America',region:'US',locales:['en-US'],currency:'USD',hosts:['secure.bankofamerica.com','www.bankofamerica.com'],url:'https://secure.bankofamerica.com/myaccounts/brain/redirect.go',evidence:'unverified'},
 'HSBC HK':{issuer:'HSBC',region:'HK',locales:['zh-HK','zh-CN','en-HK'],currency:'HKD',hosts:['www.hsbc.com.hk','www.ebanking.hsbc.com.hk','www.security.online-banking.hsbc.com.hk'],url:'https://www.hsbc.com.hk/online/dashboard/',evidence:'fixture-only'},
 'Citi US':{issuer:'Citi',region:'US',locales:['en-US'],currency:'USD',hosts:['www.citi.com','online.citi.com'],url:'https://www.citi.com/',evidence:'unverified'},
 // SC's post-login pages hold no billing fields; its account details page does, and opens directly.
 'SC HK':{readPage:{from:/^\/hk\/nfs\/ibank\/(?:landing|account_overview|card_summary)\.htm$/,url:'https://retail.sc.com/hk/nfs/ibank/card_details.htm'},issuer:'Standard Chartered',region:'HK',locales:['zh-HK','zh-CN','en-HK'],currency:'HKD',hosts:['retail.sc.com','www.sc.com'],url:'https://retail.sc.com/hk/nfs/login.htm',evidence:'unverified'}
};
export const ACTIVE_BANKS=Object.keys(PROVIDERS).filter(bank=>!PROVIDERS[bank].archived);
export function allowed(bank,href){
 try{const p=PROVIDERS[bank],u=new URL(href);return !!p&&u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&p.hosts.includes(u.hostname)&&!/(?:log.?out|log.?off|signout|signoff)/i.test(u.pathname)&&(!p.regionPath||p.regionPath.test(u.pathname));}catch{return false;}
}
export const FIELDS=['balance','available','statement','statementClosing','minimum','creditLimit'];

// A region-selected Amex login may redirect to its shared overview. Read only
// registered, globally unique card tails there; reader locale/currency checks remain.
export function guidedPage(bank,href){
 if(allowed(bank,href))return true;
 try{const u=new URL(href);return bank.startsWith('Amex ')&&u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&u.hostname==='global.americanexpress.com'&&/^\/(overview|dashboard|rewards|benefits|card-benefits|offers|activity)(?:\/|$)/.test(u.pathname)&&(!/(?:redeem|enroll|activate|transfer|payment|logout|signout)/i.test(u.pathname)||/^\/offers\/(?:enrolled|eligible|redeemed)$/.test(u.pathname));}catch{return false;}
}
