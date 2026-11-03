// Dev-only DevTools client. It may only speak to a loopback browser and only send the methods
// below: no cookie, storage, network or input methods, and scripts run in an isolated world.
// This limits this client only. The port has no authentication, so any process running as this
// user can use it while the dedicated Chrome is open.
import {EventEmitter} from 'node:events';
import WebSocket from 'ws';

export const ALLOWED_METHODS=new Set([
 'Target.setDiscoverTargets','Target.getTargets','Target.createTarget','Target.closeTarget','Target.activateTarget','Target.attachToTarget',
 'Page.enable','Page.getFrameTree','Page.createIsolatedWorld','Page.navigate','Page.reload',
 'Runtime.addBinding','Runtime.evaluate'
]);
// Interception exists only for the synthetic bank page; a real run never allows it.
export const SYNTHETIC_METHODS=new Set(['Fetch.enable','Fetch.fulfillRequest','Browser.close']);
// Fails every lookup, so no synthetic-mode request can reach a real host even before interception.
export const SYNTHETIC_ARGS=['--host-resolver-rules=MAP * ~NOTFOUND'];

const CALL_TIMEOUT=60000,SCRIPT_TIMEOUT=120000,HANDSHAKE_TIMEOUT=5000;
export function assertLoopbackUrl(value){
 const u=new URL(value);
 if(u.hostname!=='127.0.0.1'||!['ws:','http:'].includes(u.protocol)||u.username||u.password)throw Error('debugging_endpoint_not_loopback');
 return value;
}
export function assertAllowedCall(method,params,extra=new Set()){
 if(!ALLOWED_METHODS.has(method)&&!extra.has(method))throw Error('cdp_method_not_allowed:'+method);
 if(method==='Runtime.evaluate'&&!Number.isInteger(params?.contextId))throw Error('cdp_main_world_evaluate_not_allowed');
}

export class CdpConnection extends EventEmitter{
 constructor(socket,{extraMethods=new Set()}={}){
  super();this.socket=socket;this.extraMethods=extraMethods;this.nextId=1;this.pending=new Map();this.closed=false;
  socket.on('message',data=>this.receive(data));
  socket.on('close',()=>this.shutdown());
  socket.on('error',()=>this.shutdown());
 }
 receive(data){
  const m=JSON.parse(data.toString());
  if(m.id===undefined){this.emit('event',m.method,m.params||{},m.sessionId);return;}
  const call=this.pending.get(m.id);if(!call)return;this.pending.delete(m.id);
  if(m.error)call.reject(Error('cdp_error:'+call.method+':'+m.error.code));else call.resolve(m.result||{});
 }
 send(method,params={},sessionId){
  assertAllowedCall(method,params,this.extraMethods);
  if(this.closed)return Promise.reject(Error('browser_disconnected'));
  const id=this.nextId++;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('cdp_timeout:'+method));},method==='Runtime.evaluate'?SCRIPT_TIMEOUT:CALL_TIMEOUT);timer.unref?.();
   this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);},method});
   this.socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
 }
 shutdown(){
  if(this.closed)return;this.closed=true;
  for(const call of this.pending.values())call.reject(Error('browser_disconnected'));
  this.pending.clear();this.emit('close');
 }
 close(){try{this.socket.close();}catch{}this.shutdown();}
}

export function connectCdp(url,options={}){
 assertLoopbackUrl(url);
 return new Promise((resolve,reject)=>{
  const socket=new WebSocket(url,{perMessageDeflate:false,maxPayload:256*1024*1024,handshakeTimeout:HANDSHAKE_TIMEOUT});
  socket.once('open',()=>resolve(new CdpConnection(socket,options)));
  socket.once('error',reject);
 });
}
