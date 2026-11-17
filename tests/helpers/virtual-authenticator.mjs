// A software WebAuthn authenticator for tests (the same idea as Chrome's virtual authenticator): ES256 keys, "none"
// attestation, a signature counter, discoverable credentials. `credentials` has the navigator.credentials shape the
// account client (src/accountClient.js) calls, so the client and the gateway run against each other with no browser.
import {webcrypto as crypto,createHash} from 'node:crypto';

const b64u=b=>Buffer.from(b).toString('base64url');
const buf=s=>{const x=Buffer.from(s,'base64url');return x.buffer.slice(x.byteOffset,x.byteOffset+x.byteLength);};
const sha=b=>createHash('sha256').update(Buffer.from(b)).digest();
const cat=(...parts)=>Buffer.concat(parts.map(p=>Buffer.from(p)));
const head=(major,n)=>n<24?Buffer.from([major<<5|n]):n<256?Buffer.from([major<<5|24,n]):Buffer.from([major<<5|25,n>>8,n&255]);
const cborBytes=b=>cat(head(2,b.length),b);
const cborText=t=>cat(head(3,Buffer.byteLength(t)),Buffer.from(t));
const cborInt=n=>n>=0?head(0,n):head(1,-1-n);
// DER ECDSA signature from WebCrypto's raw r||s.
const der=raw=>{
 const int=x=>{let v=Buffer.from(x);while(v.length>1&&v[0]===0)v=v.subarray(1);if(v[0]&0x80)v=cat([0],v);return cat([2,v.length],v);};
 const body=cat(int(raw.subarray(0,32)),int(raw.subarray(32)));
 return cat([0x30,body.length],body);
};

export function virtualAuthenticator({origin='https://app.cardybara.test',rpId='app.cardybara.test',counter=true}={}){
 const keys=new Map();// credential id -> {privateKey, userHandle, count}
 const state={origin,rpId};
 async function create(pk,{originOverride}={}){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const id=crypto.getRandomValues(new Uint8Array(32));
  keys.set(b64u(id),{privateKey:pair.privateKey,userHandle:new Uint8Array(pk.user.id),count:0});
  const cose=cat(Buffer.from([0xa5]),cborInt(1),cborInt(2),cborInt(3),cborInt(-7),cborInt(-1),cborInt(1),cborInt(-2),cborBytes(Buffer.from(jwk.x,'base64url')),cborInt(-3),cborBytes(Buffer.from(jwk.y,'base64url')));
  const authData=cat(sha(pk.rp.id),[0x45,0,0,0,0],new Uint8Array(16),[id.length>>8,id.length&255],id,cose);
  const attestationObject=cat([0xa3],cborText('fmt'),cborText('none'),cborText('attStmt'),[0xa0],cborText('authData'),cborBytes(authData));
  const clientDataJSON=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:b64u(pk.challenge),origin:originOverride||state.origin,crossOrigin:false}));
  return {id:b64u(id),rawId:id.buffer,type:'public-key',response:{clientDataJSON:clientDataJSON.buffer.slice(clientDataJSON.byteOffset,clientDataJSON.byteOffset+clientDataJSON.length),attestationObject:attestationObject.buffer.slice(attestationObject.byteOffset,attestationObject.byteOffset+attestationObject.length)}};
 }
 async function get(pk,{originOverride}={}){
  const found=[...keys].find(([id])=>!pk.allowCredentials?.length||pk.allowCredentials.some(c=>b64u(c.id)===id));
  if(!found)throw Object.assign(new Error('no credential'),{name:'NotAllowedError'});
  const [id,k]=found;k.count+=counter?1:0;
  const authData=cat(sha(pk.rpId),[0x05,k.count>>>24&255,k.count>>16&255,k.count>>8&255,k.count&255]);
  const clientDataJSON=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:b64u(pk.challenge),origin:originOverride||state.origin,crossOrigin:false}));
  const raw=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k.privateKey,cat(authData,sha(clientDataJSON))));
  const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.length);
  return {id,rawId:buf(id),type:'public-key',response:{clientDataJSON:ab(clientDataJSON),authenticatorData:ab(authData),signature:ab(der(raw)),userHandle:ab(Buffer.from(k.userHandle))}};
 }
 return {keys,state,create,get,
  /** navigator.credentials, as the account client calls it. */
  credentials:{create:({publicKey})=>create(publicKey),get:({publicKey})=>get(publicKey)}};
}
export {b64u as toB64u};
