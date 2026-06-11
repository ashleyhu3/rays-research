/** Sidebar navigation structure */
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { id: 'overview', label: 'Overview dashboard' },
    ],
  },
  {
    label: 'AI companies',
    sectorId: 'companies',
    items: [
      { id: 'demand-openai',     label: 'OpenAI / ChatGPT'   },
      { id: 'demand-anthropic',  label: 'Anthropic / Claude' },
      { id: 'demand-google',     label: 'Google / Gemini'    },
      { id: 'demand-zhipu',      label: 'Zhipu AI / GLM'     },
      { id: 'demand-minimax',    label: 'MiniMax'            },
    ],
  },
  {
    label: 'Market signals',
    sectorId: 'market',
    items: [
      { id: 'openrouter-rankings', label: 'OpenRouter rankings' },
      { id: 'demand-general',      label: 'Infrastructure & OSS' },
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
  {
    label: 'Markets',
    mode: 'tool',
    items: [
      { id: 'options', label: 'Options flow' },
    ],
  },
  {
    label: 'Pricing',
    mode: 'pricing',
    items: [
      { id: 'pricing', label: 'GPU & memory spot' },
    ],
  },
];

/** Flat view metadata — title & isNew flag */
export const VIEW_META = {
  overview:           { title: 'OVERVIEW DASHBOARD',          isNew: false },
  // Company demand pages
  'demand-openai':    { title: 'OPENAI / CHATGPT',            isNew: false },
  'demand-anthropic': { title: 'ANTHROPIC / CLAUDE',          isNew: false },
  'demand-google':    { title: 'GOOGLE / GEMINI',             isNew: false },
  'demand-zhipu':     { title: 'ZHIPU AI / GLM',              isNew: false },
  'demand-minimax':   { title: 'MINIMAX',                     isNew: false },
  'demand-general':        { title: 'INFRASTRUCTURE & OSS SIGNALS',  isNew: false },
  'openrouter-rankings':   { title: 'OPENROUTER MODEL RANKINGS',      isNew: true  },
  // Legacy views — still accessible via direct navigation or Ask tab
  pypi:              { title: 'PYPI / NPM / STACK OVERFLOW',   isNew: false },
  github:            { title: 'GITHUB DEPENDENTS',             isNew: false },
  trends:            { title: 'GOOGLE TRENDS & JOBS',          isNew: false },
  reddit:            { title: 'APP STORE & REDDIT',            isNew: false },
  web:               { title: 'WEB TRAFFIC & STICKINESS',      isNew: false },
  hf:                { title: 'HUGGINGFACE DOWNLOADS',         isNew: false },
  pricing:           { title: 'PRICING — GPU & MEMORY SPOT',   isNew: true  },
  datacenter:        { title: 'US DATACENTER BUILD',           isNew: false },
  electricity:       { title: 'AI ELECTRICITY DEMAND',         isNew: false },
  chinese:           { title: 'CHINESE LLM USAGE',             isNew: false },
  'ai-supply':        { title: 'AI SUPPLY — OVERVIEW',         isNew: true },
  'ai-supply-optics': { title: 'AI SUPPLY — OPTICS',           isNew: true },
  'ai-supply-pcb':    { title: 'AI SUPPLY — PCB',              isNew: true },
  arxiv:              { title: 'ARXIV PAPER SUBMISSIONS',      isNew: false },
  'github-commits':   { title: 'GITHUB COMMIT VELOCITY',       isNew: false },
  docker:             { title: 'DOCKER HUB DEPLOYS',           isNew: false },
  community:          { title: 'HN & WIKIPEDIA PULSE',         isNew: false },
  options:            { title: 'OPTIONS FLOW',                 isNew: true },
};

/** Map sector overview view id → sectorId */
export const SECTOR_OVERVIEW_IDS = {
  'overview': 'overview',
};
