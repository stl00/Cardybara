import React,{useEffect,useRef,useState} from 'react';
import {Button,Popover,Space,Typography} from 'antd';
import {useI18n} from './i18n';
import './capybara-pet.css';
const KEY='cardybara-pet-v1';
function load(){try{const r=JSON.parse(localStorage.getItem(KEY));return {hidden:r?.hidden===true,feeds:Math.max(0,Math.min(9999,Number(r?.feeds)||0)),pos:r?.pos&&Number.isFinite(r.pos.x)&&Number.isFinite(r.pos.y)?r.pos:null}}catch{return {hidden:false,feeds:0,pos:null}}}
const words={
 'zh-CN':{name:'小卡豚',pet:'摸摸水豚',feed:'喂黄瓜',sleep:'一起发呆',wake:'起床啦',close:'收起',hide:'让它休息',restore:'叫水豚回来',hint:'拖动换位置 · 方向键也可以',hello:'我在这里陪你。',happy:'呼噜呼噜…',yum:'咔嚓！黄瓜真好吃。',nap:'今天也要慢慢来。',fed:'吃过 {0} 根黄瓜',idle:['发呆是一门艺术。','刷卡要精明，生活要松弛。','别忘了喝口水。','我没有偷吃黄瓜。']},
 'zh-TW':{name:'小卡豚',pet:'摸摸水豚',feed:'餵黃瓜',sleep:'一起發呆',wake:'起床啦',close:'收起',hide:'讓牠休息',restore:'叫水豚回來',hint:'拖動換位置 · 方向鍵也可以',hello:'我在這裡陪你。',happy:'呼嚕呼嚕…',yum:'咔嚓！黃瓜真好吃。',nap:'今天也要慢慢來。',fed:'吃過 {0} 根黃瓜',idle:['發呆是一門藝術。','刷卡要精明，生活要鬆弛。','別忘了喝口水。','我沒有偷吃黃瓜。']},
 'en-US':{name:'Little Cardy',pet:'Pet your capybara',feed:'Feed cucumber',sleep:'Take a nap',wake:'Wake up',close:'Close',hide:'Let it rest',restore:'Bring capybara back',hint:'Drag to move · arrow keys work too',hello:'Here to keep you company.',happy:'Purrr…',yum:'Crunch! More cucumber, please.',nap:'It’s okay to take it slow.',fed:'{0} cucumbers enjoyed',idle:['Doing nothing is an art.','Smart cards. Slow living.','Time for a sip of water.','I didn’t eat your cucumber.']}
};
function Capy({mood}){return <svg viewBox="0 0 112 100" aria-hidden="true" className="capy-drawing"><ellipse cx="58" cy="91" rx="41" ry="5" fill="#493b31" opacity=".09"/><g className="capy-body" stroke="#493B31" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M45 65c0-21 19-29 39-21 15 6 20 23 14 36-5 10-20 11-34 8L38 84" fill="#DCC5A6"/><path d="M76 82v8h10m-35-9v9h9" fill="#DCC5A6"/><g transform="translate(3 12)"><path d="M17 40V25c0-10 7-16 17-16 9 0 15 5 17 13l7 5c3 2 4 5 4 9v9c0 7-5 12-13 12H30c-8 0-13-5-13-12Z" fill="#DCC5A6"/><path d="M20 17c-6-9-13-5-10 3l7 5M38 11c2-9 11-8 11 1v6" fill="#C2A17C"/><path d={mood==='happy'||mood==='eating'?'M29 29q4-5 8 0':'M30 28h6'}/><path d="M51 36h1m-12 9h12"/><path d="M22 53v5m19-2v3"/></g></g>{mood==='happy'&&<g className="capy-hearts" fill="#eb8d8d"><path d="M79 22c-10-9-15 4 0 12 15-8 10-21 0-12Z"/></g>}{mood==='eating'&&<text x="60" y="68" fontSize="27">🥒</text>}{mood==='sleep'&&<g className="capy-zzz" fill="#8c8c8c" fontFamily="sans-serif" fontWeight="600"><text x="70" y="30" fontSize="13">z</text><text x="83" y="20" fontSize="18">z</text></g>}</svg>}
export default function CapybaraPet(){
 const {language}=useI18n(),s=words[language]||words['zh-CN'];const [saved]=useState(load),[hidden,setHidden]=useState(saved.hidden),[feeds,setFeeds]=useState(saved.feeds),[pos,setPos]=useState(saved.pos),[mood,setMood]=useState('idle'),[line,setLine]=useState(''),[open,setOpen]=useState(false);const timer=useRef(),speech=useRef(),drag=useRef(null),dragged=useRef(false),host=useRef(null);
 const clamp=p=>({x:Math.max(4,Math.min(window.innerWidth-116,p.x)),y:Math.max(72,Math.min(window.innerHeight-110,p.y))});
 useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify({hidden,feeds,pos}))}catch{}},[hidden,feeds,pos]);
 useEffect(()=>{const resize=()=>setPos(p=>p?clamp(p):p);resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
 useEffect(()=>{const id=setInterval(()=>{if(document.hidden||hidden||open||drag.current)return;setMood(m=>m==='sleep'?m:Math.random()<.35?'wander':'idle')},14000);return()=>clearInterval(id)},[hidden,open]);
 useEffect(()=>()=>{clearTimeout(timer.current);clearTimeout(speech.current)},[]);
 const say=text=>{clearTimeout(speech.current);setLine(text);speech.current=setTimeout(()=>setLine(''),4200)};
 const play=(state,text)=>{clearTimeout(timer.current);setMood(state);say(text);if(state!=='sleep')timer.current=setTimeout(()=>setMood('idle'),3200)};
 const touch=()=>{if(dragged.current)return;setOpen(!open);play('happy',s.happy)};
 const begin=e=>{if(e.button!==0)return;const r=host.current.getBoundingClientRect();dragged.current=false;drag.current={x:e.clientX,y:e.clientY,left:r.left,top:r.top};e.currentTarget.setPointerCapture(e.pointerId)};
 const move=e=>{const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5){dragged.current=true;setOpen(false);setPos(clamp({x:d.left+e.clientX-d.x,y:d.top+e.clientY-d.y}))}};
 const end=()=>{drag.current=null};
 const key=e=>{const delta={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];if(!delta)return;e.preventDefault();const r=host.current.getBoundingClientRect();setPos(clamp({x:r.left+delta[0],y:r.top+delta[1]}))};
 if(hidden)return <button className="capy-restore" aria-label={s.restore} title={s.restore} onClick={()=>{setHidden(false);say(s.hello)}}><img src="/brand/zen.svg" alt="" width="26" height="26"/></button>;
 return <div ref={host} className={'capy-companion capy-'+mood} style={pos?{left:pos.x,top:pos.y,right:'auto',bottom:'auto'}:undefined}>
 {line&&!open&&<div className="capy-speech" role="status">{line}</div>}
 <Popover open={open} trigger={[]} placement="top" title={<Space><img src="/brand/zen.svg" alt="" width="22" height="22"/>{s.name}</Space>} content={<div className="capy-menu"><Typography.Paragraph type="secondary" style={{fontSize:12,marginBottom:12}}>{line||s.hello}</Typography.Paragraph><Space orientation="vertical" size={6} style={{width:'100%'}}><Button block onClick={()=>play('happy',s.happy)}>{s.pet}</Button><Button block onClick={()=>{setFeeds(n=>Math.min(9999,n+1));play('eating',s.yum)}}>🥒 {s.feed}</Button><Button block onClick={()=>{if(mood==='sleep')play('idle',s.hello);else play('sleep',s.nap)}}>{mood==='sleep'?s.wake:s.sleep}</Button><Button type="text" block onClick={()=>setOpen(false)}>{s.close}</Button><Button type="text" block onClick={()=>{setOpen(false);setHidden(true)}}>{s.hide}</Button></Space><Typography.Paragraph type="secondary" style={{fontSize:11,margin:'12px 0 0'}}>{s.fed.replace('{0}',feeds)}<br/>{s.hint}</Typography.Paragraph></div>}>
 <button className="capy-pet-button" aria-label={s.pet} title={s.hint} onClick={touch} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}><Capy mood={mood}/></button>
 </Popover></div>;
}
