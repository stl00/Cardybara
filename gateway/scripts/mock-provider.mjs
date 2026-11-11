#!/usr/bin/env node
// A stand-in for the model provider for `wrangler dev --env local`: it answers every chat completion with a
// fixed reply and usage numbers, and accepts only the synthetic key in .dev.vars.example. It prints the
// method, path and status only, never a body or header.
// For the hosted agent (`/v1/chat`, which streams): a request with tools and no tool result yet calls list_cards
// (runs in the Worker) and query_credits (runs in the extension), so a turn makes one round trip; then it answers
// with the held card names. scripts/gateway-dev-smoke.mjs drives that turn.
import {createServer} from 'node:http';
const port=Number(process.env.PORT||8799),key='synthetic-provider-key-not-real';
createServer((req,res)=>{
 const chunks=[];req.on('data',c=>chunks.push(c));
 req.on('end',()=>{
  const send=(status,value)=>{console.log(req.method,req.url,status);res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));};
  if(req.headers.authorization!=='Bearer '+key)return send(401,{error:{message:'mock: unknown key'}});
  if(req.method!=='POST'||req.url!=='/chat/completions')return send(404,{error:{message:'mock: not found'}});
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{error:{message:'mock: bad json'}});}
  const results=(body.messages||[]).filter(m=>m.role==='tool');
  let message={role:'assistant',content:'Mock provider reply.'};
  if(body.tools?.length&&!results.length)message={role:'assistant',content:'',tool_calls:[{id:'mock-public',type:'function',function:{name:'list_cards',arguments:'{}'}},{id:'mock-wallet',type:'function',function:{name:'query_credits',arguments:'{}'}}]};
  else if(results.length){let cards=[];for(const r of results){try{const v=JSON.parse(r.content);if(Array.isArray(v))cards=v;}catch{}}message={role:'assistant',content:'Mock provider reply: you hold '+(cards.map(c=>c.name).join(' and ')||'no cards')+'.'};}
  const finish=message.tool_calls?'tool_calls':'stop',usage={prompt_tokens:12,completion_tokens:4};
  if(!body.stream)return send(200,{id:'mock-1',object:'chat.completion',created:0,model:body.model,choices:[{index:0,message,finish_reason:finish}],usage});
  console.log(req.method,req.url,200,'stream');
  const event=v=>'data: '+JSON.stringify({id:'mock-1',object:'chat.completion.chunk',...v})+'\n\n';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write(event({choices:[{index:0,delta:{role:'assistant',content:message.content||''},finish_reason:null}]}));
  if(message.tool_calls)res.write(event({choices:[{index:0,delta:{tool_calls:message.tool_calls.map((c,index)=>({index,...c}))},finish_reason:null}]}));
  res.write(event({choices:[{index:0,delta:{},finish_reason:finish}]}));
  res.end(event({choices:[],usage})+'data: [DONE]\n\n');
 });
}).listen(port,'127.0.0.1',()=>console.log('mock provider on http://127.0.0.1:'+port));
