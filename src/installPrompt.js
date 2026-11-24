// #573: the browser's own install prompt (Chrome / Edge, desktop and Android). The browser fires `beforeinstallprompt`;
// we keep the event and call `prompt()` only after the person taps "Install app". iOS Safari never fires it and keeps
// the text steps. The window is injected so tests need no browser; the extension build never starts this.
import {isStandalone} from './webFirstLaunch.js';

export function createInstallPrompt(win=globalThis.window,{standalone=()=>isStandalone({matchMedia:win?.matchMedia?.bind(win),navigator:win?.navigator})}={}){
 let event=null,done=false;const listeners=new Set();
 const emit=()=>listeners.forEach(f=>{try{f();}catch{/* a listener must not break the others */}});
 const onPrompt=e=>{e.preventDefault?.();event=e;emit();};
 const onInstalled=()=>{event=null;done=true;emit();};
 win?.addEventListener?.('beforeinstallprompt',onPrompt);
 win?.addEventListener?.('appinstalled',onInstalled);
 return {
  // True only while a kept event exists, the app is not installed and it is not running standalone.
  canInstall:()=>!!event&&!done&&!standalone(),
  // Must be called from a tap handler. Resolves to the outcome ('accepted' | 'dismissed') or null.
  async install(){
   const e=event;if(!e||done||standalone())return null;
   event=null;emit();// the event can be used once: hide the button whatever the answer
   try{await e.prompt();const choice=await e.userChoice;return choice?.outcome||null;}catch{return null;}
  },
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  dispose(){win?.removeEventListener?.('beforeinstallprompt',onPrompt);win?.removeEventListener?.('appinstalled',onInstalled);listeners.clear();}
 };
}

// One controller for the page, so the event is kept even when it fires before a screen mounts.
let shared=null;
export const startInstallPrompt=()=>shared||(shared=createInstallPrompt());
