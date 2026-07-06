import { NAV_SECTIONS } from '../../config/navigation';
import { useData } from '../../context/DataContext';
import { orWeeklyTrend } from '../../utils/openrouterProvider';

/** Company nav item id → OpenRouter provider name for weekly-token trend. */
const COMPANY_PROVIDERS = {
  'demand-openai':    'OpenAI',
  'demand-anthropic': 'Anthropic',
  'demand-google':    'Google',
  'demand-zhipu':     'Zhipu AI',
  'demand-minimax':   'MiniMax',
};

export default function Sidebar({ currentView, onNavigate, mode = 'demand' }) {
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
              const provider = COMPANY_PROVIDERS[item.id];
              const trend = provider ? orWeeklyTrend(ld?.openrouterRanks, provider) : null;
              return (
                <button
                  key={item.id}
                  className={hasGroupLabel ? `nav-item${currentView === item.id ? ' active' : ''}` : `nav-lbl-btn${currentView === item.id ? ' active' : ''}`}
                  onClick={() => onNavigate(item.id)}
                >
                  {item.label}
                  {trend && (
                    <span
                      className={`nav-trend ${trend}`}
                      aria-label={trend === 'up' ? 'Weekly token usage increasing' : 'Weekly token usage decreasing'}
                      title={trend === 'up' ? 'Weekly token usage increasing' : 'Weekly token usage decreasing'}
                    >
                      {trend === 'up' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
