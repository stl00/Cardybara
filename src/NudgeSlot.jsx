import React from 'react';

// Quiet UI (#682): one banner per screen. Highest priority first; errors outrank nudges.
export const NUDGE_PRIORITY=['error','overdue','plaid','home-screen','backup','unjudged'];

export function orderNudges(nudges){
 const list=(nudges||[]).filter(n=>n&&n.node!=null&&n.node!==false);
 for(const n of list)if(!NUDGE_PRIORITY.includes(n.kind))throw Error('unknown nudge kind: '+n.kind);
 return list.sort((a,b)=>NUDGE_PRIORITY.indexOf(a.kind)-NUDGE_PRIORITY.indexOf(b.kind));
}

// `nudges`: [{kind, node, key?}]. Every candidate stays mounted and keeps deciding for itself whether to render (and
// keeps its own dismiss state, as before); style.css shows only the first item that rendered something, so when it is
// dismissed the next one takes its place.
export default function NudgeSlot({nudges}){
 const list=orderNudges(nudges);
 if(!list.length)return null;
 return <div className="nudge-slot">{list.map(n=><div key={n.key||n.kind} className="nudge-item" data-nudge={n.kind}>{n.node}</div>)}</div>;
}
