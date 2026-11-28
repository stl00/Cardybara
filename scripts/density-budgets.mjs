// The quiet-UI budgets of stl00/Cardybara#682, the one place they live. What is counted: elements visible on a 375x812
// phone with a synthetic 5-card wallet (scripts/density-check.mjs): screen totals in the first viewport only, per-row and
// filter-row numbers over every rendered row of the page, below the fold included.
//
// `baseline` records the numbers of the day the check landed (2026-11-27), before any screen was changed.
// mode 'report': the numbers are printed, nothing fails. mode 'enforce': a count over its budget fails the check. Each
// screen issue flips its own screen to 'enforce' once it meets the budget.
//
// Metrics: buttons/tags/alerts = visible .ant-btn/.ant-tag/.ant-alert; paragraphs = secondary typography that is a
// Paragraph, or runs to PARAGRAPH_CHARS characters of English; tagsPerRow/buttonsPerRow = the most in any one row
// (`rows`, minus `rowButtonExclude`); filterRows = visible filter chip groups.
// The ⓘ of InfoTip is not an .ant-btn and is not counted; the ⋯ of MoreMenu is, except per credit row.
export const PARAGRAPH_CHARS = 40;

export const SCREENS = [
  {
    id: 'overview', label: 'Overview', mode: 'report',
    budget: {buttons: 6, tags: 4, alerts: 1, paragraphs: 1},
    baseline: {buttons: 8, tags: 1, alerts: 1, paragraphs: 2},
  },
  {
    id: 'wallet', label: 'Wallet list', mode: 'report', rows: '.wallet-card', rowButtonExclude: '.card-title',
    budget: {tagsPerRow: 1, buttonsPerRow: 0, alerts: 1},
    baseline: {tagsPerRow: 4, buttonsPerRow: 2, alerts: 1},
  },
  {
    id: 'drawer', label: 'Card drawer', mode: 'report', within: '.ant-drawer-open .ant-drawer-section',
    budget: {buttons: 4, tags: 2, alerts: 0},
    baseline: {buttons: 7, tags: 6, alerts: 0},
  },
  {
    id: 'credits', label: 'Credits', mode: 'report', rows: '.credit-row', rowButtonExclude: '.more-menu-trigger', filters: '.credit-filters [role="group"]',
    budget: {tagsPerRow: 1, buttonsPerRow: 1, filterRows: 1},
    baseline: {tagsPerRow: 4, buttonsPerRow: 2, filterRows: 2},
  },
  {
    id: 'rewards', label: 'Rewards', mode: 'report',
    budget: {paragraphs: 0},
    baseline: {paragraphs: 3},
  },
];
