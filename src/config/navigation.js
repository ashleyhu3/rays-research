import { HK_CHINA_SECTIONS } from './hkChinaPerformance';
import { HK_SECTIONS } from './hkPerformance';

/** Subtabs shown under the "US" rotation nav item — mirrors the
 * page sections in src/pages/us-performance/UsPerformance.jsx. */
const US_PERFORMANCE_SUBTABS = [
  { key: 'all',         label: 'Sector' },
  { key: 'tech',        label: 'Tech' },
  { key: 'theme',       label: 'Theme' },
  { key: 'factor',      label: 'Factor' },
  { key: 'correlation', label: 'Correlation' },
  { key: 'sentiment',   label: 'Sentiment' },
];

/** Subtabs shown under the "China" rotation nav item — "Index"
 * plus one per HK_CHINA_SECTIONS entry, kept in sync with the page's data. */
const CHINA_PERFORMANCE_SUBTABS = [
  { key: 'all', label: 'Index' },
  ...HK_CHINA_SECTIONS.map(section => ({ key: section.title, label: section.title })),
  { key: 'sentiment', label: 'Sentiment' },
];

/** Subtabs shown under the "HK" rotation nav item. The parent view is the
 * aggregate sector chart; these entries open the relative-performance grids. */
const HK_PERFORMANCE_SUBTABS = HK_SECTIONS.map(section => ({ key: section.title, label: section.title }));

/** Subtabs shown under the "Global" rotation nav item — mirrors the page
 * sections in src/pages/global-performance/GlobalPerformance.jsx. */
const GLOBAL_PERFORMANCE_SUBTABS = [
  { key: 'breadth',   label: 'Breadth' },
  { key: 'technical', label: 'Technical' },
  { key: 'turnover',  label: 'Turnover' },
];

const COMMODITY_SUBTABS = [
  { key: 'precious-rare', label: 'Precious & Rare Metal' },
  { key: 'industrial', label: 'Industrial Metal' },
  { key: 'oil-gas', label: 'Oil & Gas' },
  { key: 'ferrous', label: 'Ferrous Metal' },
  { key: 'agriculture', label: 'Agriculture Product' },
  { key: 'chemical', label: 'Chemical' },
];

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
      { id: 'demand-xai',        label: 'xAI / Grok'         },
      { id: 'demand-kimi',       label: 'Moonshot / Kimi'    },
      { id: 'demand-qwen',       label: 'Alibaba / Qwen'     },
      { id: 'demand-deepseek',   label: 'DeepSeek'           },
      { id: 'demand-xiaomi',     label: 'Xiaomi / MiMo'      },
      { id: 'demand-tencent',    label: 'Tencent / Hunyuan'  },
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
      { id: 'ai-supply-optics',    label: 'Optics supply chain'    },
      { id: 'ai-supply-fiber',     label: 'Fiber supply chain'     },
      { id: 'ai-supply-ccl',       label: 'CCL supply chain'       },
      { id: 'ai-supply-pcb',       label: 'PCB supply chain'       },
      { id: 'ai-supply-abf',       label: 'ABF supply chain'       },
      { id: 'ai-supply-mlcc',      label: 'MLCC supply chain'      },
      { id: 'ai-supply-cooling',   label: 'Cooling supply chain'   },
      { id: 'ai-supply-power',     label: 'Power supply chain'     },
      { id: 'ai-supply-equipment', label: 'Equipment supply chain' },
      { id: 'ai-supply-memory',    label: 'Memory supply chain'    },
      { id: 'ai-supply-foundry',   label: 'Foundry supply chain'   },
      { id: 'ai-supply-trainium',  label: 'Trainium supply chain'  },
      { id: 'ai-supply-cpu',       label: 'CPU supply chain'       },
      { id: 'ai-supply-odm',       label: 'ODM supply chain'       },
    ],
  },
  {
    label: 'AI supply chain',
    sectorId: 'aisupplychain',
    mode: 'aisupplychain',
    items: [
      { id: 'dc-capacity',     label: 'Overview'                },
      { id: 'dc-co-aws',       label: 'Amazon AWS'              },
      { id: 'dc-co-google',    label: 'Google'                  },
      { id: 'dc-co-microsoft', label: 'Microsoft'               },
      { id: 'dc-co-oracle',    label: 'Oracle'                  },
      { id: 'dc-co-openai',    label: 'OpenAI'                  },
      { id: 'dc-co-nebius',    label: 'Nebius'                  },
      { id: 'dc-co-meta',      label: 'Meta'                    },
    ],
  },
  {
    label: 'Markets',
    mode: 'tool',
    items: [
      { id: 'sentiment', label: 'Sentiment & options' },
      { id: 'options',   label: 'Options flow' },
    ],
  },
  {
    label: 'Rotation',
    sectorId: 'market-performance',
    mode: 'us-performance',
    items: [
      { id: 'us-performance',       label: 'US',     subitems: US_PERFORMANCE_SUBTABS },
      { id: 'hk-china-performance', label: 'China',  subitems: CHINA_PERFORMANCE_SUBTABS },
      { id: 'hk-performance',       label: 'HK',     subitems: HK_PERFORMANCE_SUBTABS },
      { id: 'global-performance',  label: 'Global', subitems: GLOBAL_PERFORMANCE_SUBTABS },
    ],
  },
  {
    label: 'Macro',
    sectorId: 'macro',
    mode: 'macro',
    items: [
      { id: 'macro-yield', label: 'Yield' },
      { id: 'macro-fed-watch', label: 'Fed Watch' },
      { id: 'macro-commodity', label: 'Commodity', subitems: COMMODITY_SUBTABS },
      { id: 'macro-us-inflation', label: 'US', subitems: [
        { id: 'macro-us-inflation', label: 'Inflation' },
        { id: 'macro-us-labor', label: 'Labor' },
        { id: 'macro-us-pmi', label: 'PMI' },
        { id: 'macro-us-household', label: 'Household' },
      ] },
      { id: 'macro-cn-inflation', label: 'China', subitems: [
        { id: 'macro-cn-inflation', label: 'Inflation' },
        { id: 'macro-cn-pmi', label: 'PMI' },
        { id: 'macro-cn-trade', label: 'Trade' },
        { id: 'macro-cn-activity', label: 'Activity' },
      ] },
    ],
  },
  {
    label: 'Leverage',
    sectorId: 'leverage',
    mode: 'leverage',
    items: [
      { id: 'leverage-korea',    label: 'Korea'  },
      { id: 'leverage-taiwan',   label: 'Taiwan' },
      { id: 'taiwan-individual', label: 'Taiwan individual' },
      { id: 'leverage-china',    label: 'A shares' },
      { id: 'leverage-japan',    label: 'Japan' },
      { id: 'leverage-us',       label: 'US' },
    ],
  },
  {
    label: 'Liquidity',
    sectorId: 'liquidity',
    mode: 'liquidity',
    items: [
      { id: 'liquidity-us', label: 'US', subitems: [
        { key: 'fed-balance', label: 'Fed Balance' },
        { key: 'credit', label: 'Credit' },
        { key: 'interbank', label: 'Interbank' },
      ] },
      { id: 'liquidity-china-flow', label: 'China', subitems: [
        { key: 'flow', label: 'Flow' },
        { key: 'stock-connect', label: 'Stock Connect' },
        { key: 'turnover', label: 'Turnover' },
        { key: 'money-supply', label: 'Money Supply' },
      ] },
      { id: 'liquidity-carry-trade', label: 'Carry Trade' },
    ],
  },
  {
    label: 'Transcripts',
    mode: 'tool',
    items: [
      { id: 'transcripts', label: 'Earnings transcript agent' },
    ],
  },
  {
    label: 'Sources',
    mode: 'tool',
    items: [
      { id: 'sources', label: 'Data validity' },
    ],
  },
  {
    label: 'Pricing',
    sectorId: 'pricing',
    mode: 'pricing',
    items: [
      { id: 'pricing-memory', label: 'Memory'    },
      { id: 'pricing-gpu',    label: 'GPU'       },
      { id: 'pricing-aws',    label: 'AWS Chips' },
      { id: 'pricing-cpu',    label: 'CPU'       },
      { id: 'pricing-tpu',    label: 'TPU'       },
    ],
  },
];

/** Resolve a view to the top-level navigation mode that owns it. */
export function getModeForView(viewId) {
  for (const section of NAV_SECTIONS) {
    if (section.items.some(item => item.id === viewId || item.subitems?.some(subitem => subitem.id === viewId))) {
      return section.mode ?? 'demand';
    }
  }
  return 'demand';
}

/** Page title shown in the top bar, keyed by view id. */
export const VIEW_META = {
  overview:           { title: 'OVERVIEW DASHBOARD' },
  // Company demand pages
  'demand-openai':    { title: 'OPENAI / CHATGPT' },
  'demand-anthropic': { title: 'ANTHROPIC / CLAUDE' },
  'demand-google':    { title: 'GOOGLE / GEMINI' },
  'demand-zhipu':     { title: 'ZHIPU AI / GLM' },
  'demand-minimax':   { title: 'MINIMAX' },
  'demand-xai':       { title: 'XAI / GROK' },
  'demand-kimi':      { title: 'MOONSHOT / KIMI' },
  'demand-qwen':      { title: 'ALIBABA / QWEN' },
  'demand-deepseek':  { title: 'DEEPSEEK' },
  'demand-xiaomi':    { title: 'XIAOMI / MIMO' },
  'demand-tencent':   { title: 'TENCENT / HUNYUAN' },
  'market-signals':        { title: 'MARKET SIGNALS' },
  'demand-general':        { title: 'INFRASTRUCTURE & OSS SIGNALS' },
  'openrouter-rankings':   { title: 'OPENROUTER MODEL RANKINGS' },
  // Source-specific signal pages — reachable via direct navigation or Ask tab
  pypi:              { title: 'PYPI / NPM' },
  github:            { title: 'GITHUB DEPENDENTS' },
  web:               { title: 'WEB TRAFFIC & STICKINESS' },
  hf:                { title: 'HUGGINGFACE DOWNLOADS' },
  pricing:           { title: 'PRICING — GPU & MEMORY SPOT' },
  'pricing-memory':  { title: 'PRICING — MEMORY SPOT' },
  'pricing-gpu':     { title: 'PRICING — GPU SPOT' },
  'pricing-aws':     { title: 'PRICING — AWS AI-CHIP SPOT' },
  'pricing-cpu':     { title: 'PRICING — CPU SPOT' },
  'pricing-tpu':     { title: 'PRICING — TPU PREEMPTIBLE' },
  datacenter:        { title: 'US DATACENTER BUILD' },
  electricity:       { title: 'AI ELECTRICITY DEMAND' },
  chinese:           { title: 'CHINESE LLM USAGE' },
  'ai-supply-optics':    { title: 'AI SUPPLY — OPTICS' },
  'ai-supply-fiber':     { title: 'AI SUPPLY — FIBER' },
  'ai-supply-ccl':       { title: 'AI SUPPLY — CCL' },
  'ai-supply-pcb':       { title: 'AI SUPPLY — PCB' },
  'ai-supply-abf':       { title: 'AI SUPPLY — ABF' },
  'ai-supply-mlcc':      { title: 'AI SUPPLY — MLCC' },
  'ai-supply-cooling':   { title: 'AI SUPPLY — COOLING' },
  'ai-supply-power':     { title: 'AI SUPPLY — POWER' },
  'ai-supply-equipment': { title: 'AI SUPPLY — EQUIPMENT' },
  'ai-supply-memory':    { title: 'AI SUPPLY — MEMORY' },
  'ai-supply-foundry':   { title: 'AI SUPPLY — FOUNDRY' },
  'ai-supply-trainium':  { title: 'AI SUPPLY — TRAINIUM' },
  'ai-supply-cpu':       { title: 'AI SUPPLY — CPU' },
  'ai-supply-odm':       { title: 'AI SUPPLY — ODM' },
  'dc-capacity':      { title: 'AI SUPPLY CHAIN — OVERVIEW' },
  'dc-timelines':     { title: 'AI SUPPLY CHAIN — COMPANY BUILDOUT TIMELINES' },
  'dc-co-aws':        { title: 'AI SUPPLY CHAIN — AMAZON AWS' },
  'dc-co-google':     { title: 'AI SUPPLY CHAIN — GOOGLE' },
  'dc-co-microsoft':  { title: 'AI SUPPLY CHAIN — MICROSOFT' },
  'dc-co-oracle':     { title: 'AI SUPPLY CHAIN — ORACLE' },
  'dc-co-openai':     { title: 'AI SUPPLY CHAIN — OPENAI' },
  'dc-co-nebius':     { title: 'AI SUPPLY CHAIN — NEBIUS' },
  'dc-co-meta':       { title: 'AI SUPPLY CHAIN — META' },
  'github-commits':   { title: 'GITHUB COMMIT VELOCITY' },
  docker:             { title: 'DOCKER HUB DEPLOYS' },
  community:          { title: 'HN PULSE' },
  options:            { title: 'OPTIONS FLOW' },
  alerts:             { title: 'DAILY OPTIONS REPORT' },
  sentiment:          { title: 'MARKETS — SENTIMENT & OPTIONS' },
  'us-performance':   { title: 'ROTATION — US' },
  'hk-china-performance': { title: 'ROTATION — CHINA' },
  'hk-performance':       { title: 'ROTATION — HK' },
  'global-performance':   { title: 'ROTATION — GLOBAL' },
  'macro-us-inflation': { title: 'US · INFLATION' },
  'macro-yield':        { title: 'GOVERNMENT BOND YIELDS' },
  'macro-fed-watch':    { title: 'FED WATCH — TARGET RATE PROBABILITIES' },
  'macro-commodity':    { title: 'COMMODITY' },
  'macro-us-labor':     { title: 'US · LABOR' },
  'macro-us-pmi':       { title: 'US · PMI' },
  'macro-us-household': { title: 'US · HOUSEHOLD' },
  'macro-cn-inflation': { title: 'CHINA · INFLATION' },
  'macro-cn-pmi':       { title: 'CHINA · PMI' },
  'macro-cn-trade':     { title: 'CHINA · TRADE' },
  'macro-cn-activity':  { title: 'CHINA · ACTIVITY' },
  'leverage-korea':   { title: 'LEVERAGE — KOREAN RETAIL FIREPOWER' },
  'leverage-taiwan':  { title: 'LEVERAGE — TAIWAN RETAIL FIREPOWER' },
  'taiwan-individual': { title: 'TAIWAN — INDIVIDUAL STOCK MARGIN' },
  'leverage-china':   { title: 'LEVERAGE — CHINA A-SHARES' },
  'leverage-japan':   { title: 'LEVERAGE — JAPAN MARGIN TRADING' },
  'leverage-us':      { title: 'LEVERAGE — US MARGIN, FUTURES & OPTIONS' },
  'liquidity-us': { title: 'LIQUIDITY — US' },
  'liquidity-china-flow': { title: 'LIQUIDITY — CHINA' },
  'liquidity-carry-trade': { title: 'LIQUIDITY — CARRY TRADE' },
  transcripts:        { title: 'EARNINGS TRANSCRIPT AGENT' },
  sources:            { title: 'DATA VALIDITY TERMINAL' },
};

/** Map sector overview view id → sectorId */
export const SECTOR_OVERVIEW_IDS = {
  'overview': 'overview',
};
