import { NAV_SECTIONS } from '../../config/navigation';
import { useData } from '../../context/DataContext';
import { orWeeklyTrend } from '../../utils/openrouterProvider';
import { pricingTrend } from '../../utils/pricingTrend';

/** Company nav item id → OpenRouter provider name for weekly-token trend. */
const COMPANY_PROVIDERS = {
  'demand-openai':    'OpenAI',
  'demand-anthropic': 'Anthropic',
  'demand-google':    'Google',
  'demand-zhipu':     'Zhipu AI',
  'demand-minimax':   'MiniMax',
  'demand-xai':       'xAI',
  'demand-kimi':      'Moonshot AI',
  'demand-qwen':      'Alibaba (Qwen)',
  'demand-deepseek':  'DeepSeek',
  'demand-xiaomi':    'Xiaomi',
  'demand-tencent':   'Tencent',
};

const TREND_LABEL = {
  demand:  { up: 'Weekly token usage increasing', down: 'Weekly token usage decreasing', flat: 'Weekly token usage unchanged' },
  pricing: { up: 'Latest price higher than previous datapoint', down: 'Latest price lower than previous datapoint', flat: 'No change from previous datapoint' },
};

const TREND_GLYPH = { up: '▲', down: '▼', flat: '—' };

/** Resolve the up/down arrow (and its tooltip kind) for a nav item, if any. */
function trendFor(item, ld) {
  const provider = COMPANY_PROVIDERS[item.id];
  if (provider) return { dir: orWeeklyTrend(ld?.openrouterRanks, provider), kind: 'demand' };
  if (item.id.startsWith('pricing-')) return { dir: pricingTrend(ld, item.id), kind: 'pricing' };
  return { dir: null };
}

export default function Sidebar({ currentView, onNavigate, mode = 'demand', subtabByView = {}, onNavigateSubtab }) {
  const { liveData: ld } = useData();
  const sections = NAV_SECTIONS.filter(s => (s.mode ?? 'demand') === mode);

  return (
    <aside className="sidebar">
      {sections.map((section) => {
        const hasOverview = section.items.some(item => item.isOverview);
        const overviewId  = hasOverview && section.sectorId ? `${section.sectorId}-overview` : null;
        const headerActive = overviewId && currentView === overviewId;
        const visibleItems = section.items.filter(item => !item.isOverview);
        const hasGroupLabel = section.sectorId != null;

        return (
          <div key={section.label} className="nav-sec">
            {overviewId ? (
              <button
                className={`nav-lbl-btn${headerActive ? ' active' : ''}`}
                onClick={() => onNavigate(overviewId)}
              >
                {section.label}
              </button>
            ) : hasGroupLabel ? (
              <span className="nav-lbl">{section.label}</span>
            ) : null}
            {visibleItems.map((item) => {
              const { dir, kind } = trendFor(item, ld);
              const label = dir ? TREND_LABEL[kind][dir] : null;
              const isActiveItem = currentView === item.id;
              return (
                <div key={item.id}>
                  <button
                    className={hasGroupLabel ? `nav-item${isActiveItem ? ' active' : ''}` : `nav-lbl-btn${isActiveItem ? ' active' : ''}`}
                    onClick={() => onNavigate(item.id)}
                  >
                    {item.label}
                    {dir && (
                      <span className={`nav-trend ${dir}`} aria-label={label} title={label}>
                        {TREND_GLYPH[dir]}
                      </span>
                    )}
                  </button>
                  {item.subitems && (
                    <div className="nav-subitems">
                      {item.subitems.map(sub => (
                        <button
                          key={sub.key}
                          className={`nav-subitem${isActiveItem && subtabByView[item.id] === sub.key ? ' active' : ''}`}
                          onClick={() => onNavigateSubtab?.(item.id, sub.key)}
                        >
                          {sub.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
