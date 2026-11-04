import {taskStatus} from './personalBenefits.js';
import {CREDIT_CATEGORIES} from './creditCategories.js';
// What the benefit view shows: a short list of what is ending, with everything else behind a
// category, a search or one more click. Unknown stays "not confirmed"; it is never counted as unused.
export const ENDING_SOON_DAYS=14,SHORT_LIST=5,COMPACT_LIST=3;
const DONE=new Set(['used','skipped']);
export const isDone=status=>DONE.has(status);
export function daysLeft(task,asOf){return Math.round((Date.parse(task.period.end+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/86400000);}
/**
 * @param {object} filters state: todo|done|all, category: an id or 'all', query, textOf: searchable text for a task
 */
export function creditView(tasks,events,asOf,{state='todo',category='all',query='',textOf=task=>task.title}={}){
 const rows=tasks.map(task=>{const status=taskStatus(task,events),days=daysLeft(task,asOf);return {task,status,days,endingSoon:!isDone(status)&&days<=ENDING_SOON_DAYS};});
 const open=rows.filter(r=>!isDone(r.status)),done=rows.filter(r=>isDone(r.status));
 const pool=state==='done'?done:state==='all'?rows:open;
 const categories=CREDIT_CATEGORIES.map(({id,label})=>({id,label,count:pool.filter(r=>r.task.categories?.includes(id)).length})).filter(c=>c.count);
 const needle=query.trim().toLowerCase();
 const matches=pool.filter(r=>(category==='all'||r.task.categories?.includes(category))&&(!needle||textOf(r.task).toLowerCase().includes(needle)));
 return {rows:matches,open,done,pool,categories,ending:open.filter(r=>r.endingSoon),filtered:category!=='all'||!!needle};
}
