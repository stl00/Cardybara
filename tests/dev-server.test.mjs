import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createWalletHandler} from '../scripts/dev-server.mjs';

test('source dev server and built preview use the same API without exposing configuration',async()=>{
 let handler;const server=http.createServer((req,res)=>handler(req,res));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 handler=createWalletHandler({port,staticFiles:false});
 try{
  for(const origin of [`http://127.0.0.1:${port}`,`http://localhost:${port}`]){
   const response=await fetch(`http://127.0.0.1:${port}/api/parser/status`,{headers:{Origin:origin}});assert.equal(response.status,200);
   const body=await response.json();assert.equal(typeof body.configured,'boolean');assert.equal(body.provider,'deepseek');
   assert.deepEqual(Object.keys(body).sort(),['configured','model','processing','provider','requiresKeyInput']);
  }
  const foreign=await fetch(`http://127.0.0.1:${port}/api/parser/status`,{headers:{Origin:'https://foreign.example'}});assert.equal(foreign.status,403);
  const secret=await fetch(`http://127.0.0.1:${port}/.env.local`);assert.equal(secret.status,404);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
