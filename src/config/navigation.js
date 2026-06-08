/** Sidebar navigation structure — only pages with live API data */
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'overview',      label: 'Overview dashboard',    icon: '◈', tag: 'live',   isNew: false },
    ],
  },
  {
    label: 'Developer signals',
    items: [
      { id: 'pypi',          label: 'PyPI / npm downloads',  icon: '↓', tag: 'weekly', isNew: false },
      { id: 'stackoverflow', label: 'Stack Overflow volume', icon: '?', tag: 'weekly', isNew: false },
      { id: 'trends',        label: 'Google Trends',         icon: '↗', tag: 'daily',  isNew: false },
      { id: 'jobs',          label: 'Job postings',          icon: '⚑', tag: 'live',   isNew: false },
    ],
  },
  {
    label: 'Consumer signals',
    items: [
      { id: 'appstore',      label: 'App store ratings',     icon: '★', tag: 'live',   isNew: false },
    ],
  },
  {
    label: 'Token economics',
    items: [
      { id: 'tokens',        label: 'OpenRouter pricing',    icon: '⬭', tag: 'live',   isNew: false },
    ],
  },
];

/** Flat view metadata — title & isNew flag */
export const VIEW_META = {
  overview:      { title: 'OVERVIEW DASHBOARD',     isNew: false },
  pypi:          { title: 'PYPI / NPM DOWNLOADS',   isNew: false },
  stackoverflow: { title: 'STACK OVERFLOW VOLUME',  isNew: false },
  trends:        { title: 'GOOGLE TRENDS',          isNew: false },
  jobs:          { title: 'JOB POSTINGS',           isNew: false },
  appstore:      { title: 'APP STORE RATINGS',      isNew: false },
  tokens:        { title: 'OPENROUTER PRICING',     isNew: false },
};
