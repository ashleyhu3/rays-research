import { chartTitle } from './chartMeta';

/**
 * Registry of which charts appear on the sector-overview pages and in the
 * "Customise" picker. Each entry maps to one ChartCard in a view file:
 *   sectorId      — groups charts for sector-overview pages
 *   subView       — groups charts within the edit panel
 *   defaultPinned — shown on the sector overview by default
 *
 * Chart titles are NOT stored here — they come from src/config/chartText.js
 * (the single place to edit chart names). Use chartsForSector() / CHART_BY_ID,
 * which attach the title for you.
 */
const REGISTRY = [
  // ── Developer signals ──────────────────────────────────────────────
  { id: 'pypi-installs',   sectorId: 'dev', subView: 'pypi',   defaultPinned: false },
  { id: 'pypi-share',      sectorId: 'dev', subView: 'pypi',   defaultPinned: false },
  { id: 'pypi-npm',        sectorId: 'dev', subView: 'pypi',   defaultPinned: false },
  { id: 'github-stars',    sectorId: 'dev', subView: 'github', defaultPinned: false },
  { id: 'github-deps',     sectorId: 'dev', subView: 'github', defaultPinned: false },

  // ── Market signals ─────────────────────────────────────────────────
  // OpenRouter model rankings
  { id: 'or-revenue',   sectorId: 'market', subView: 'openrouter', defaultPinned: true },
  { id: 'or-top',       sectorId: 'market', subView: 'openrouter', defaultPinned: false },
  { id: 'or-volprice',  sectorId: 'market', subView: 'openrouter', defaultPinned: true },
  { id: 'or-provstack', sectorId: 'market', subView: 'openrouter', defaultPinned: true },
  { id: 'or-combo',     sectorId: 'market', subView: 'openrouter', defaultPinned: true },
  { id: 'or-growth',    sectorId: 'market', subView: 'openrouter', defaultPinned: false },
  // Infrastructure & OSS signals
  { id: 'gen-ai-revenue', sectorId: 'market', subView: 'general', defaultPinned: true  },
  { id: 'gen-mcp',       sectorId: 'market', subView: 'general', defaultPinned: true },
  { id: 'gen-sec',       sectorId: 'market', subView: 'general', defaultPinned: true },
  { id: 'gen-commits',   sectorId: 'market', subView: 'general', defaultPinned: false },
  { id: 'gen-docker',    sectorId: 'market', subView: 'general', defaultPinned: false },
  { id: 'gen-hn',        sectorId: 'market', subView: 'general', defaultPinned: true },
  { id: 'gen-cnmarket',  sectorId: 'market', subView: 'general', defaultPinned: false },
  { id: 'gen-tw-drones', sectorId: 'market', subView: 'general', defaultPinned: true },
  // ── Web traffic ────────────────────────────────────────────────────
  { id: 'web-visits-total', sectorId: 'market', subView: 'web', defaultPinned: true },

  // ── Consumer signals ───────────────────────────────────────────────
  { id: 'hf-downloads',     sectorId: 'consumer', subView: 'hf',     defaultPinned: true  },
  { id: 'hf-families',      sectorId: 'consumer', subView: 'hf',     defaultPinned: false },
  { id: 'hf-categories',    sectorId: 'consumer', subView: 'hf',     defaultPinned: false },
  { id: 'hf-uploads',       sectorId: 'consumer', subView: 'hf',     defaultPinned: false },

  // ── Infrastructure ─────────────────────────────────────────────────
  { id: 'dram-index',      sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'dram-chips',      sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'dram-modules',    sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'nand-spot',       sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'tft-lcd-panel',   sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'cpu-spot-history', sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'tpu-spot-history', sectorId: 'infra', subView: 'pricing',     defaultPinned: false },
  { id: 'dc-capex',        sectorId: 'infra', subView: 'datacenter',  defaultPinned: true  },
  { id: 'dc-capacity',     sectorId: 'infra', subView: 'datacenter',  defaultPinned: false },
  { id: 'dc-state',        sectorId: 'infra', subView: 'datacenter',  defaultPinned: false },
  { id: 'dc-grid',         sectorId: 'infra', subView: 'datacenter',  defaultPinned: false },
  { id: 'dc-btm',          sectorId: 'infra', subView: 'datacenter',  defaultPinned: false },
  { id: 'dc-deals',        sectorId: 'infra', subView: 'datacenter',  defaultPinned: false },
  { id: 'elec-consumption',sectorId: 'infra', subView: 'electricity', defaultPinned: true  },
  { id: 'elec-state',      sectorId: 'infra', subView: 'electricity', defaultPinned: false },
  { id: 'elec-ai-share',   sectorId: 'infra', subView: 'electricity', defaultPinned: false },
  { id: 'elec-rates',      sectorId: 'infra', subView: 'electricity', defaultPinned: false },
  { id: 'elec-mix',        sectorId: 'infra', subView: 'electricity', defaultPinned: false },
  { id: 'elec-pue',        sectorId: 'infra', subView: 'electricity', defaultPinned: false },

  // ── Token consumption ──────────────────────────────────────────────
  { id: 'cn-tokens',  sectorId: 'tokens', subView: 'chinese', defaultPinned: false },
  { id: 'cn-market',  sectorId: 'tokens', subView: 'chinese', defaultPinned: false },
  { id: 'cn-pricing', sectorId: 'tokens', subView: 'chinese', defaultPinned: true  },
  { id: 'cn-mau',     sectorId: 'tokens', subView: 'chinese', defaultPinned: false },
  { id: 'cn-revenue', sectorId: 'tokens', subView: 'chinese', defaultPinned: false },
  { id: 'cn-bench',   sectorId: 'tokens', subView: 'chinese', defaultPinned: false },

  // ── Supply chain ───────────────────────────────────────────────────
  ...['optics', 'fiber', 'ccl', 'pcb', 'abf', 'mlcc', 'cooling', 'power', 'equipment', 'memory', 'foundry', 'cpu', 'odm'].flatMap(chain => [
    { id: `supply-${chain}-rev`,       sectorId: 'supply', subView: `ai-supply-${chain}`, defaultPinned: true  },
    { id: `supply-${chain}-total-rev`, sectorId: 'supply', subView: `ai-supply-${chain}`, defaultPinned: false },
    { id: `supply-${chain}-yoy`,       sectorId: 'supply', subView: `ai-supply-${chain}`, defaultPinned: false },
    { id: `supply-${chain}-mom`,       sectorId: 'supply', subView: `ai-supply-${chain}`, defaultPinned: false },
  ]),
];

/** Registry with the display title attached from chartText.js. */
export const CHART_REGISTRY = REGISTRY.map(c => ({ ...c, title: chartTitle(c.id) ?? c.id }));

/** Quick lookup: chartId → registry entry (title included) */
export const CHART_BY_ID = Object.fromEntries(CHART_REGISTRY.map(c => [c.id, c]));

const DEMAND = ['dev', 'consumer', 'market', 'infra', 'tokens'];

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
