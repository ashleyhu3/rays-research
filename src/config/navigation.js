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
    items: [
      { id: 'market-signals', label: 'Market signals' },
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
      { id: 'ai-supply-mlcc',   label: 'MLCC supply chain'   },
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
    label: 'Sentiment',
    mode: 'tool',
    items: [
      { id: 'sentiment', label: 'StockTwits sentiment' },
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

/** Page title shown in the top bar, keyed by view id. */
export const VIEW_META = {
  overview:           { title: 'OVERVIEW DASHBOARD' },
  // Company demand pages
  'demand-openai':    { title: 'OPENAI / CHATGPT' },
  'demand-anthropic': { title: 'ANTHROPIC / CLAUDE' },
  'demand-google':    { title: 'GOOGLE / GEMINI' },
  'demand-zhipu':     { title: 'ZHIPU AI / GLM' },
  'demand-minimax':   { title: 'MINIMAX' },
  'market-signals':        { title: 'MARKET SIGNALS' },
  'demand-general':        { title: 'INFRASTRUCTURE & OSS SIGNALS' },
  'openrouter-rankings':   { title: 'OPENROUTER MODEL RANKINGS' },
  // Source-specific signal pages — reachable via direct navigation or Ask tab
  pypi:              { title: 'PYPI / NPM' },
  github:            { title: 'GITHUB DEPENDENTS' },
  trends:            { title: 'GOOGLE TRENDS' },
  web:               { title: 'WEB TRAFFIC & STICKINESS' },
  hf:                { title: 'HUGGINGFACE DOWNLOADS' },
  pricing:           { title: 'PRICING — GPU & MEMORY SPOT' },
  datacenter:        { title: 'US DATACENTER BUILD' },
  electricity:       { title: 'AI ELECTRICITY DEMAND' },
  chinese:           { title: 'CHINESE LLM USAGE' },
  'ai-supply':        { title: 'AI SUPPLY — OVERVIEW' },
  'ai-supply-optics': { title: 'AI SUPPLY — OPTICS' },
  'ai-supply-pcb':    { title: 'AI SUPPLY — PCB' },
  'ai-supply-mlcc':   { title: 'AI SUPPLY — MLCC' },
  'github-commits':   { title: 'GITHUB COMMIT VELOCITY' },
  docker:             { title: 'DOCKER HUB DEPLOYS' },
  community:          { title: 'HN & WIKIPEDIA PULSE' },
  options:            { title: 'OPTIONS FLOW' },
  sentiment:          { title: 'STOCKTWITS SENTIMENT' },
};

/** Map sector overview view id → sectorId */
export const SECTOR_OVERVIEW_IDS = {
  'overview': 'overview',
};
