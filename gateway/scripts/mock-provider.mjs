#!/usr/bin/env node
// A stand-in for the model provider for `wrangler dev --env local`: it answers every chat completion with a
// fixed reply and usage numbers, and accepts only the synthetic key in .dev.vars.example. It prints the
// method, path and status only, never a body or header.
import {createServer} from 'node:http';
const port=Number(process.env.PORT||8799),key='synthetic-provider-key-not-real';
createServer((req,res)=>{
 const chunks=[];req.on('data',c=>chunks.push(c));
 req.on('end',()=>{
  const send=(status,value)=>{console.log(req.method,req.url,status);res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
  if(req.headers.authorization!=='Bearer '+key)return send(401,{error:{message:'mock: unknown key'}});
  if(req.method!=='POST'||req.url!=='/chat/completions')return send(404,{error:{message:'mock: not found'}});
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:{message:'mock: bad json'}});}
  send(200,{id:'mock-1',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message:{role:'assistant',content:'Mock provider reply.'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:4}});
 });
}).listen(port,'127.0.0.1',()=>console.log('mock provider on http://127.0.0.1:'+port));
