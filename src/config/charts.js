/**
 * Registry of all individual charts across the dashboard.
 * Each entry maps to one ChartCard in a view file.
 * sectorId groups charts for sector-overview pages.
 * subView groups charts within the edit panel.
 * defaultPinned = shown on sector overview by default.
 */
export const CHART_REGISTRY = [
  // ── Developer signals ──────────────────────────────────────────────
  { id: 'pypi-installs',   sectorId: 'dev', subView: 'pypi',   title: 'PyPI weekly downloads',               defaultPinned: true  },
  { id: 'pypi-share',      sectorId: 'dev', subView: 'pypi',   title: 'Share of combined installs',          defaultPinned: false },
  { id: 'pypi-npm',        sectorId: 'dev', subView: 'pypi',   title: 'npm weekly downloads',                defaultPinned: false },
  { id: 'pypi-so',         sectorId: 'dev', subView: 'pypi',   title: 'Stack Overflow questions by tag',     defaultPinned: false },
  { id: 'github-deps',     sectorId: 'dev', subView: 'github', title: 'GitHub "Used By" dependents',         defaultPinned: true  },
  { id: 'github-new-deps', sectorId: 'dev', subView: 'github', title: 'New dependents per week',             defaultPinned: false },
  { id: 'github-cache',    sectorId: 'dev', subView: 'github', title: 'prompt_caching code mentions',        defaultPinned: false },
  { id: 'trends-api',      sectorId: 'dev', subView: 'trends', title: 'Google Trends — API search interest', defaultPinned: true  },
  { id: 'trends-geo',      sectorId: 'dev', subView: 'trends', title: 'Search interest by US metro',         defaultPinned: false },
  { id: 'trends-brand',    sectorId: 'dev', subView: 'trends', title: 'Brand search (Claude vs ChatGPT)',    defaultPinned: false },
  { id: 'trends-jobs',     sectorId: 'dev', subView: 'trends', title: 'Open roles by AI lab',                defaultPinned: false },

  // ── Consumer signals ───────────────────────────────────────────────
  { id: 'reddit-mentions',  sectorId: 'consumer', subView: 'reddit', title: 'Reddit weekly mentions',           defaultPinned: true  },
  { id: 'reddit-sentiment', sectorId: 'consumer', subView: 'reddit', title: 'Reddit sentiment score',           defaultPinned: false },
  { id: 'reddit-twitter',   sectorId: 'consumer', subView: 'reddit', title: 'X/Twitter daily mention count',    defaultPinned: false },
  { id: 'web-visits',       sectorId: 'consumer', subView: 'web',    title: 'Monthly web visits',               defaultPinned: true  },
  { id: 'web-session',      sectorId: 'consumer', subView: 'web',    title: 'Average session duration',         defaultPinned: false },
  { id: 'web-bounce',       sectorId: 'consumer', subView: 'web',    title: 'Bounce rate',                      defaultPinned: false },
  { id: 'hf-downloads',     sectorId: 'consumer', subView: 'hf',     title: 'HuggingFace download velocity',    defaultPinned: true  },
  { id: 'hf-categories',    sectorId: 'consumer', subView: 'hf',     title: 'Model category breakdown',         defaultPinned: false },
  { id: 'hf-uploads',       sectorId: 'consumer', subView: 'hf',     title: 'New model uploads per week',       defaultPinned: false },

  // ── Infrastructure ─────────────────────────────────────────────────
  { id: 'gpu-prices',      sectorId: 'infra', subView: 'pricing',     title: 'GPU spot price $/hr',                   defaultPinned: true  },
  { id: 'gpu-avail',       sectorId: 'infra', subView: 'pricing',     title: 'GPU availability by region',            defaultPinned: false },
  { id: 'gpu-spread',      sectorId: 'infra', subView: 'pricing',     title: 'H200–H100 price spread',                defaultPinned: false },
  { id: 'gpu-index',       sectorId: 'infra', subView: 'pricing',     title: 'Mainstream GPU spot price index',       defaultPinned: false },
  { id: 'dram-index',      sectorId: 'infra', subView: 'pricing',     title: 'Mainstream DRAM spot price index',      defaultPinned: false },
  { id: 'dram-chips',      sectorId: 'infra', subView: 'pricing',     title: 'DRAM chip & GDDR spot price',           defaultPinned: false },
  { id: 'dram-modules',    sectorId: 'infra', subView: 'pricing',     title: 'Memory module spot price',              defaultPinned: false },
  { id: 'dram-change',     sectorId: 'infra', subView: 'pricing',     title: 'DRAM spot session change (%)',          defaultPinned: false },
  { id: 'dc-capex',        sectorId: 'infra', subView: 'datacenter',  title: 'Hyperscaler capex committed',           defaultPinned: true  },
  { id: 'dc-capacity',     sectorId: 'infra', subView: 'datacenter',  title: 'Capacity under construction (GW)',      defaultPinned: false },
  { id: 'dc-state',        sectorId: 'infra', subView: 'datacenter',  title: 'Permitted capacity by US state',        defaultPinned: false },
  { id: 'dc-grid',         sectorId: 'infra', subView: 'datacenter',  title: 'Grid interconnection queue',            defaultPinned: false },
  { id: 'dc-btm',          sectorId: 'infra', subView: 'datacenter',  title: 'Behind-the-meter generation',          defaultPinned: false },
  { id: 'dc-deals',        sectorId: 'infra', subView: 'datacenter',  title: 'Datacenter deals signed per quarter',  defaultPinned: false },
  { id: 'elec-consumption',sectorId: 'infra', subView: 'electricity', title: 'US datacenter electricity consumption', defaultPinned: true  },
  { id: 'elec-state',      sectorId: 'infra', subView: 'electricity', title: 'State share of datacenter electricity', defaultPinned: false },
  { id: 'elec-ai-share',   sectorId: 'infra', subView: 'electricity', title: 'AI electricity as % of US total',      defaultPinned: false },
  { id: 'elec-rates',      sectorId: 'infra', subView: 'electricity', title: 'Household electricity rate impact',    defaultPinned: false },
  { id: 'elec-mix',        sectorId: 'infra', subView: 'electricity', title: 'Renewable vs fossil share',            defaultPinned: false },
  { id: 'elec-pue',        sectorId: 'infra', subView: 'electricity', title: 'Power Usage Effectiveness (PUE)',      defaultPinned: false },

  // ── Token consumption ──────────────────────────────────────────────
  { id: 'cn-tokens',  sectorId: 'tokens', subView: 'chinese', title: 'Chinese LLM token consumption',    defaultPinned: true  },
  { id: 'cn-market',  sectorId: 'tokens', subView: 'chinese', title: 'China LLM market share (enterprise)', defaultPinned: false },
  { id: 'cn-pricing', sectorId: 'tokens', subView: 'chinese', title: 'Chinese vs US model pricing',      defaultPinned: true  },
  { id: 'cn-mau',     sectorId: 'tokens', subView: 'chinese', title: 'MiniMax consumer app MAU',         defaultPinned: false },
  { id: 'cn-revenue', sectorId: 'tokens', subView: 'chinese', title: 'Zhipu AI revenue',                 defaultPinned: false },
  { id: 'cn-bench',   sectorId: 'tokens', subView: 'chinese', title: 'SWE-bench scores',                 defaultPinned: false },

  // ── Supply chain ───────────────────────────────────────────────────
  { id: 'supply-all-rev',    sectorId: 'supply', subView: 'ai-supply',        title: 'All companies — monthly revenue',         defaultPinned: true  },
  { id: 'supply-all-yoy',    sectorId: 'supply', subView: 'ai-supply',        title: 'All companies — revenue YoY growth (%)',  defaultPinned: false },
  { id: 'supply-all-mom',    sectorId: 'supply', subView: 'ai-supply',        title: 'All companies — revenue MoM growth (%)',  defaultPinned: false },
  { id: 'supply-optics-rev', sectorId: 'supply', subView: 'ai-supply-optics', title: 'Optics supply chain — monthly revenue',   defaultPinned: true  },
  { id: 'supply-optics-yoy', sectorId: 'supply', subView: 'ai-supply-optics', title: 'Optics — revenue YoY growth (%)',         defaultPinned: false },
  { id: 'supply-optics-mom', sectorId: 'supply', subView: 'ai-supply-optics', title: 'Optics — revenue MoM growth (%)',         defaultPinned: false },
  { id: 'supply-pcb-rev',    sectorId: 'supply', subView: 'ai-supply-pcb',    title: 'PCB supply chain — monthly revenue',      defaultPinned: true  },
  { id: 'supply-pcb-yoy',    sectorId: 'supply', subView: 'ai-supply-pcb',    title: 'PCB — revenue YoY growth (%)',            defaultPinned: false },
  { id: 'supply-pcb-mom',    sectorId: 'supply', subView: 'ai-supply-pcb',    title: 'PCB — revenue MoM growth (%)',            defaultPinned: false },
];

/** Quick lookup: chartId → registry entry */
export const CHART_BY_ID = Object.fromEntries(CHART_REGISTRY.map(c => [c.id, c]));

const DEMAND = ['dev', 'consumer', 'infra', 'tokens'];

/** All charts for a given sector, grouped by subView */
export function chartsForSector(sectorId) {
  const charts = sectorId === 'overview'
    ? CHART_REGISTRY.filter(c => DEMAND.includes(c.sectorId))
    : CHART_REGISTRY.filter(c => c.sectorId === sectorId);
  const groups = {};
  for (const c of charts) {
    if (!groups[c.subView]) groups[c.subView] = [];
    groups[c.subView].push(c);
  }
  return groups;
}

/** Build the default pinned set for a sector */
export function defaultPins(sectorId) {
  const source = sectorId === 'overview'
    ? CHART_REGISTRY.filter(c => DEMAND.includes(c.sectorId) && c.defaultPinned)
    : CHART_REGISTRY.filter(c => c.sectorId === sectorId && c.defaultPinned);
  return source.map(c => c.id);
}
