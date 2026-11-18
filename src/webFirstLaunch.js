// The web wallet's first-launch guide (#403): when to show it and which install steps fit the browser in use.
// Pure functions over plain values so tests need no browser. The extension never shows it: it keeps its own onboarding.
export const GUIDE_KEY='cardybara.webGuideSeen';
export const GUIDE_STEPS=['what','where','keep','extras'];

// 'ios' (iPhone, iPad, and iPadOS that reports itself as a Mac), 'android', or 'desktop' (everything else).
export function detectPlatform({userAgent='',platform='',maxTouchPoints=0}={}){
 if(/iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1))return 'ios';
 if(/Android/i.test(userAgent))return 'android';
 return 'desktop';
}
export const browserPlatform=(nav=globalThis.navigator)=>detectPlatform({userAgent:nav?.userAgent||'',platform:nav?.platform||'',maxTouchPoints:nav?.maxTouchPoints||0});

// True when the page runs as an installed app (Home Screen / installed PWA): the display-mode query, or iOS's own flag.
export function isStandalone({matchMedia=globalThis.matchMedia?.bind(globalThis),navigator:nav=globalThis.navigator}={}){
 try{if(matchMedia?.('(display-mode: standalone)')?.matches)return true;}catch{/* an old browser without the query */}
 return nav?.standalone===true;
}

// The install instructions to show: none when already installed, otherwise the ones for this browser.
export const installKind=({platform,standalone})=>standalone?null:platform==='ios'?'ios':platform==='android'?'android':'desktop';

// Shown once, on the web build only: never in the extension or the dev server, which has bank collection.
export const shouldShowGuide=({kind,seen})=>kind==='web'&&!seen;
export const canReopenGuide=kind=>kind==='web';

export function readSeen(storage=globalThis.localStorage){try{return storage?.getItem(GUIDE_KEY)==='1';}catch{return false;}}
export function markSeen(storage=globalThis.localStorage){try{storage?.setItem(GUIDE_KEY,'1');return true;}catch{return false;}}
