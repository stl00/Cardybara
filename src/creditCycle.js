// How often a credit resets, in words, and when the next cycle starts. Every terms.period the rules use
// has a label here; tests/credit-cycle.test.mjs fails when a new period value is left out.
// Labels are zh-CN source text, translated through src/i18n/cards.json like the rest of the UI.
export const CYCLE_LABELS={
 'calendar-month':'每月',
 'calendar-quarter':'每季度',
 'calendar-half-year':'每半年',
 'calendar-year':'每个日历年',
 'account-anniversary':'每个持卡年度',
 'fee-month-year':'每年（年费次月起）',
 'rolling-four-years':'每四年',
 'per-trip':'一次性',
 'per-stay':'一次性',
 'activation-based':'一次性',
 'fixed-date':'一次性',
 'promotion-period':'一次性',
 'earned-year-plus-next':'按获得年度',
 'event-based':'按事件触发',
 'annual-fee':'随年费',
 'ongoing':'长期权益'
};
/** Display order of the cycles in the filter: short cycles first. */
export const CYCLE_ORDER=['calendar-month','calendar-quarter','calendar-half-year','calendar-year','account-anniversary','fee-month-year','rolling-four-years','one-off'];
/** The filter group a period belongs to: the five one-off kinds share one, and a period without a cycle has none. */
export function cycleGroup(period){
 if(!period||!(period in CYCLE_LABELS))return null;
 return CYCLE_LABELS[period]==='一次性'?'one-off':CYCLE_ORDER.includes(period)?period:null;
}
const GROUP_LABELS={...CYCLE_LABELS,'one-off':'一次性'};
export const cycleGroupLabel=group=>GROUP_LABELS[group]||null;
/** The label for a terms.period value, or null when the value is not mapped (a caller must not guess one). */
export const cycleLabel=period=>CYCLE_LABELS[period]??null;
const addDay=day=>new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
/** The day the next cycle starts for a credit task: the day after this cycle ends. Feb 29 fee dates are already settled by the task's own period. */
export const nextResetDay=task=>task?.period?.end?addDay(task.period.end):null;
/** Cycles that repeat on a boundary of their own, so the day after period.end really is when the next one starts. */
export const RECURRING=['calendar-month','calendar-quarter','calendar-half-year','calendar-year','account-anniversary','fee-month-year'];
/** What a credit row says about its cycle: the tag label and the next start day. A one-off, promotion or any period that is not a natural boundary gets no next day. */
export const cycleFacts=task=>({label:cycleLabel(task?.cycle),next:RECURRING.includes(task?.cycle)?nextResetDay(task):null});
