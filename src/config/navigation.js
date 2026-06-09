/** Sidebar navigation structure */
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'overview', label: 'Overview dashboard' },
    ],
  },
  {
    label: 'Developer signals',
    sectorId: 'dev',
    items: [
      { id: 'dev-overview', label: 'Developer overview', isOverview: true },
      { id: 'pypi',         label: 'PyPI / npm / Stack Overflow' },
      { id: 'github',       label: 'GitHub dependents'           },
      { id: 'trends',       label: 'Google Trends & Jobs'        },
    ],
  },
  {
    label: 'Consumer signals',
    sectorId: 'consumer',
    items: [
      { id: 'consumer-overview', label: 'Consumer overview', isOverview: true },
      { id: 'reddit',    label: 'App Store & Reddit'          },
      { id: 'web',       label: 'Web traffic & stickiness'    },
      { id: 'hf',        label: 'HuggingFace downloads'       },
    ],
  },
  {
    label: 'Infrastructure',
    sectorId: 'infra',
    items: [
      { id: 'infra-overview', label: 'Infrastructure overview', isOverview: true },
      { id: 'gpu',         label: 'GPU spot pricing'        },
      { id: 'datacenter',  label: 'US datacenter build'     },
      { id: 'electricity', label: 'AI electricity demand'   },
    ],
  },
  {
    label: 'Token consumption',
    sectorId: 'tokens',
    items: [
      { id: 'tokens-overview', label: 'Token consumption overview', isOverview: true },
      { id: 'chinese', label: 'Chinese LLM usage' },
    ],
  },
  {
    label: 'Supply chain',
    sectorId: 'supply',
    mode: 'supply',
    items: [
      { id: 'ai-supply',        label: 'Overview'            },
      { id: 'ai-supply-optics', label: 'Optics supply chain' },
      { id: 'ai-supply-pcb',    label: 'PCB supply chain'    },
    ],
  },
];

/** Flat view metadata — title & isNew flag */
export const VIEW_META = {
  overview:          { title: 'OVERVIEW DASHBOARD',             isNew: false },
  'dev-overview':      { title: 'DEVELOPER SIGNALS OVERVIEW',   isNew: false },
  'consumer-overview': { title: 'CONSUMER SIGNALS OVERVIEW',    isNew: false },
  'infra-overview':    { title: 'INFRASTRUCTURE OVERVIEW',      isNew: false },
  'tokens-overview':   { title: 'TOKEN CONSUMPTION OVERVIEW',   isNew: false },
  pypi:              { title: 'PYPI / NPM / STACK OVERFLOW',    isNew: false },
  github:            { title: 'GITHUB DEPENDENTS',              isNew: false },
  trends:            { title: 'GOOGLE TRENDS & JOBS',           isNew: false },
  reddit:            { title: 'APP STORE & REDDIT',             isNew: false },
  web:               { title: 'WEB TRAFFIC & STICKINESS',       isNew: false },
  hf:                { title: 'HUGGINGFACE DOWNLOADS',          isNew: false },
  gpu:               { title: 'GPU SPOT PRICING',               isNew: false },
  datacenter:        { title: 'US DATACENTER BUILD',            isNew: true  },
  electricity:       { title: 'AI ELECTRICITY DEMAND',          isNew: true  },
  chinese:           { title: 'CHINESE LLM USAGE',              isNew: true  },
  'ai-supply':        { title: 'AI SUPPLY — OVERVIEW',       isNew: true },
  'ai-supply-optics': { title: 'AI SUPPLY — OPTICS',         isNew: true },
  'ai-supply-pcb':    { title: 'AI SUPPLY — PCB',            isNew: true },
};

/** Map sector overview view id → sectorId */
export const SECTOR_OVERVIEW_IDS = {
  'overview':          'overview',
  'dev-overview':      'dev',
  'consumer-overview': 'consumer',
  'infra-overview':    'infra',
  'tokens-overview':   'tokens',
};
