/** Sidebar navigation structure */
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'overview',     label: 'Overview dashboard',     icon: '◈', tag: 'live',    isNew: false },
    ],
  },
  {
    label: 'Developer signals',
    items: [
      { id: 'pypi',         label: 'PyPI / npm downloads',   icon: '↓', tag: 'weekly',  isNew: false },
      { id: 'stackoverflow',label: 'Stack Overflow volume',  icon: '?', tag: 'weekly',  isNew: false },
      { id: 'github',       label: 'GitHub dependents',      icon: '⎇', tag: 'weekly',  isNew: false },
      { id: 'trends',       label: 'Google Trends',          icon: '↗', tag: 'daily',   isNew: false },
      { id: 'jobs',         label: 'Job keyword mentions',   icon: '⚑', tag: 'weekly',  isNew: false },
    ],
  },
  {
    label: 'Consumer signals',
    items: [
      { id: 'appstore',     label: 'App store rankings',     icon: '★', tag: 'daily',   isNew: false },
      { id: 'web',          label: 'Web traffic & stickiness',icon: '⊙', tag: 'monthly', isNew: false },
      { id: 'reddit',       label: 'Reddit / social volume', icon: '↑', tag: 'daily',   isNew: false },
      { id: 'hf',           label: 'HuggingFace downloads',  icon: '⬡', tag: 'daily',   isNew: false },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { id: 'gpu',          label: 'GPU spot pricing',       icon: '◻', tag: 'hourly',  isNew: false },
      { id: 'datacenter',   label: 'US datacenter build',    icon: '⬛', isNew: true },
      { id: 'electricity',  label: 'AI electricity demand',  icon: '⚡', isNew: true },
    ],
  },
  {
    label: 'Token consumption',
    items: [
      { id: 'tokens',       label: 'OpenRouter token flow',  icon: '⬭', isNew: true },
      { id: 'chinese',      label: 'Chinese LLM usage',      icon: '龙', isNew: true },
    ],
  },
];

/** Flat view metadata — title & isNew flag */
export const VIEW_META = {
  overview:     { title: 'OVERVIEW DASHBOARD',       isNew: false },
  pypi:         { title: 'PYPI / NPM DOWNLOADS',     isNew: false },
  stackoverflow:{ title: 'STACK OVERFLOW VOLUME',    isNew: false },
  github:       { title: 'GITHUB DEPENDENTS',        isNew: false },
  trends:       { title: 'GOOGLE TRENDS',            isNew: false },
  jobs:         { title: 'JOB KEYWORD MENTIONS',     isNew: false },
  appstore:     { title: 'APP STORE RANKINGS',       isNew: false },
  web:          { title: 'WEB TRAFFIC & STICKINESS', isNew: false },
  reddit:       { title: 'REDDIT / SOCIAL VOLUME',   isNew: false },
  hf:           { title: 'HUGGINGFACE DOWNLOADS',    isNew: false },
  gpu:          { title: 'GPU SPOT PRICING',         isNew: false },
  datacenter:   { title: 'US DATACENTER BUILD',      isNew: true  },
  electricity:  { title: 'AI ELECTRICITY DEMAND',    isNew: true  },
  tokens:       { title: 'OPENROUTER TOKEN FLOW',    isNew: true  },
  chinese:      { title: 'CHINESE LLM USAGE',        isNew: true  },
};
