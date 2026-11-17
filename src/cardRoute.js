// Hash route that opens one card's detail: #card/<id>. Shared by the wallet page and the push service worker (#445).
const PREFIX='card/';
export const cardHash=id=>`#${PREFIX}${encodeURIComponent(id)}`;
/** The card id in a location.hash value, or null when the hash is not a card route. */
export function cardRouteId(hash){
 const h=String(hash||'').replace(/^#/,'');
 if(!h.startsWith(PREFIX)||h.length===PREFIX.length)return null;
 try{return decodeURIComponent(h.slice(PREFIX.length));}catch{return null;}
}
