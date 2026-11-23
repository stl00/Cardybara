// Open the bank app from the card detail on touch devices (#582).
// Only https paths that the bank itself lists in its public apple-app-site-association file; no custom schemes.
// Snapshots live in tests/fixtures/aasa/ and tests/bank-app-links.test.mjs checks every entry against them.
// Banks absent here (Amex US/HK: only a generic /go/* redirect, BOA: only /deeplink/redirect.go whose parameters are not public,
// HSBC HK, SC HK: no readable file) keep the website link.
export const bankAppLinks={
 Chase:{url:'https://secure.chase.com/web/auth/nav',aasa:'secure.chase.com'},
 'Citi US':{url:'https://online.citi.com/US/ag/accstatement',aasa:'online.citi.com'}
};
export const isTouchDevice=()=>{try{return navigator.maxTouchPoints>0&&matchMedia('(pointer:coarse)').matches}catch{return false}};
export const bankLink=(bank,websiteUrls,touch=isTouchDevice())=>touch&&bankAppLinks[bank]?bankAppLinks[bank].url:websiteUrls[bank];
