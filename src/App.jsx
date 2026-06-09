import { useState } from 'react';
import { VIEW_META, SECTOR_OVERVIEW_IDS, NAV_SECTIONS } from './config/navigation';

function getModeForView(viewId) {
  for (const s of NAV_SECTIONS) {
    if (s.items.some(item => item.id === viewId)) return s.mode ?? 'demand';
  }
  return 'demand';
}
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Navbar from './components/Navbar';
import { UIProvider } from './context/UIContext';
import { DashboardProvider } from './context/DashboardContext';

// ── View components (static imports for reliability) ─────────────────
import PyPI          from './views/PyPI';
import GitHub        from './views/GitHub';
import Trends        from './views/Trends';
import Web           from './views/Web';
import Reddit        from './views/Reddit';
import HuggingFace   from './views/HuggingFace';
import GPU           from './views/GPU';
import Datacenter    from './views/Datacenter';
import Electricity   from './views/Electricity';
import Chinese       from './views/Chinese';
import SectorOverview from './views/SectorOverview';
import AISupply, { AISupplyOptics, AISupplyPCB } from './views/AISupply';

/** Map view id → React component */
const VIEW_COMPONENTS = {
  pypi:        PyPI,
  github:      GitHub,
  trends:      Trends,
  web:         Web,
  reddit:      Reddit,
  hf:          HuggingFace,
  gpu:         GPU,
  datacenter:  Datacenter,
  electricity: Electricity,
  chinese:     Chinese,
  'ai-supply':        AISupply,
  'ai-supply-optics': AISupplyOptics,
  'ai-supply-pcb':    AISupplyPCB,
};

export default function App() {
  const [currentView, setCurrentView] = useState('overview');
  const [weeks, setWeeks] = useState(12);
  const [months, setMonths] = useState(12);

  const meta = VIEW_META[currentView] ?? { title: currentView.toUpperCase(), isNew: false };
  const mode = getModeForView(currentView);

  // Check if this is a sector overview page
  const sectorId = SECTOR_OVERVIEW_IDS[currentView] ?? null;
  const ViewComponent = sectorId ? null : VIEW_COMPONENTS[currentView];

  return (
    <DashboardProvider>
      <UIProvider>
        <Navbar onNavigate={setCurrentView} currentView={currentView} />
        <div className="app-body">
          <Sidebar currentView={currentView} onNavigate={setCurrentView} mode={mode} />
          <main className="main">
            <Topbar
              title={meta.title}
              isNew={meta.isNew}
              weeks={weeks}
              onWeeksChange={setWeeks}
              months={mode === 'supply' ? months : undefined}
              onMonthsChange={mode === 'supply' ? setMonths : undefined}
              sectorId={sectorId}
            />
            <div className="content">
              {sectorId
                ? <SectorOverview key={sectorId} sectorId={sectorId} weeks={weeks} />
                : ViewComponent && <ViewComponent weeks={weeks} months={mode === 'supply' ? months : undefined} />
              }
            </div>
          </main>
        </div>
      </UIProvider>
    </DashboardProvider>
  );
}
