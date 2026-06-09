import { NAV_SECTIONS } from '../config/navigation';

export default function Sidebar({ currentView, onNavigate, mode = 'demand' }) {
  const sections = NAV_SECTIONS.filter(s => (s.mode ?? 'demand') === mode);

  return (
    <aside className="sidebar">
      {sections.map((section) => {
        const overviewId = section.sectorId ? `${section.sectorId}-overview` : null;
        const headerActive = overviewId && currentView === overviewId;
        const visibleItems = section.items.filter(item => !item.isOverview);

        return (
          <div key={section.label} className="nav-sec">
            {overviewId ? (
              <button
                className={`nav-lbl-btn${headerActive ? ' active' : ''}`}
                onClick={() => onNavigate(overviewId)}
              >
                {section.label}
              </button>
            ) : null}
            {visibleItems.map((item) => (
              <button
                key={item.id}
                className={overviewId ? `nav-item${currentView === item.id ? ' active' : ''}` : `nav-lbl-btn${currentView === item.id ? ' active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
