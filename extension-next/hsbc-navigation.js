// Observed HSBC HK account controls only. No payment, transfer or model selectors.
export async function hsbcCards(action,tail,cards=[]){
 if(location.hostname!=='www.hsbc.com.hk'||!/^\/online\/dashboard\/?$/.test(location.pathname))return [];
 const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 const known=cards.filter(c=>c.bank==='HSBC HK'&&/^\d{4,5}$/.test(c.tail));
 const matches=(e,t)=>new RegExp('(?:^|[^0-9])'+t+'(?:[^0-9]|$)').test(e.innerText||'');
 const closeOverlay=document.getElementById('account-details-overlay-close-btn-account-details-overlay');if(visible(closeOverlay))closeOverlay.click();
 const toggle=document.getElementById('change-account-button');
 const close=()=>{if(visible(toggle)&&toggle.getAttribute('aria-expanded')==='true')toggle.click();};
 if(action==='close'){close();return [];}
 let rows=[];
 if(visible(toggle)){
  if(toggle.getAttribute('aria-expanded')!=='true')toggle.click();
  const until=Date.now()+3000;while(Date.now()<until){rows=[...document.querySelectorAll('button[id^="dropdown-item-"]')].filter(visible);if(rows.length)break;await new Promise(r=>setTimeout(r,100));}
 }else rows=[...document.querySelectorAll('a[id^="account-container-"]')].filter(visible);
 const found=known.filter(c=>rows.filter(e=>matches(e,c.tail)).length===1);
 if(action==='select'&&known.some(c=>c.tail===tail)){
  const target=rows.filter(e=>matches(e,tail));if(target.length===1){target[0].click();return [tail];}
 }
 close();return action==='list'?found.map(c=>c.tail):[];
}
export function hsbcMoreDetails(){
 if(location.hostname!=='www.hsbc.com.hk'||!/^\/online\/dashboard\/?$/.test(location.pathname))return false;
 const visible=e=>e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 if(visible(document.getElementById('account-details-overlay')))return false;
 const button=document.getElementById('show-account-details-overlay');if(!visible(button))return false;
 button.click();return true;
}
