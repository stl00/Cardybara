import {activeTasks,taskStatus} from './personalBenefits.js';
import {CREDIT_CATEGORIES} from './creditCategories.js';
// What the benefit view shows: a short list of what is ending, with everything else behind a
// category, a search or one more click. Unknown stays "not confirmed"; it is never counted as unused.
export const ENDING_SOON_DAYS=14,SHORT_LIST=5,COMPACT_LIST=3;
const DONE=new Set(['used','skipped']);
export const isDone=status=>DONE.has(status);
export function daysLeft(task,asOf){return Math.round((Date.parse(task.period.end+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/86400000);}
/**
 * @param {object} filters state: todo|done|all, category: an id or 'all', query, textOf: searchable text for a task,
 * live: false when looking back at a past month, whose cycles have ended and so cannot be ending soon
 */
export function creditView(tasks,events,asOf,{state='todo',category='all',query='',textOf=task=>task.title,live=true}={}){
 // A dismissed credit is out of every state, done included; it is listed apart, where it can be restored.
 const rows=activeTasks(tasks,events).map(task=>{const status=taskStatus(task,events),days=daysLeft(task,asOf);return {task,status,days,endingSoon:live&&!isDone(status)&&days<=ENDING_SOON_DAYS};});
 const open=rows.filter(r=>!isDone(r.status)),done=rows.filter(r=>isDone(r.status));
 const pool=state==='done'?done:state==='all'?rows:open;
 const categories=CREDIT_CATEGORIES.map(({id,label})=>({id,label,count:pool.filter(r=>r.task.categories?.includes(id)).length})).filter(c=>c.count);
 // A chosen category can empty out after marking or changing month; fall back rather than strand the user.
 const active=categories.some(c=>c.id===category)?category:'all',needle=query.trim().toLowerCase();
 const matches=pool.filter(r=>(active==='all'||r.task.categories?.includes(active))&&(!needle||textOf(r.task).toLowerCase().includes(needle)));
 return {rows:matches,open,done,pool,categories,ending:open.filter(r=>r.endingSoon),category:active,filtered:active!=='all'||!!needle};
}
