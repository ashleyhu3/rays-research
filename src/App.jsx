import { useEffect, useRef, useState } from 'react';
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
import Chat from './views/AIDemand/Chat';
import { UIProvider } from './context/UIContext';
import { DashboardProvider } from './context/DashboardContext';
import { LayoutProvider } from './context/LayoutContext';

// ── View components (static imports for reliability) ─────────────────
import PyPI          from './views/AIDemand/PyPI';
import GitHub        from './views/AIDemand/GitHub';
import Trends        from './views/AIDemand/Trends';
import Web           from './views/AIDemand/Web';
import Reddit        from './views/AIDemand/Reddit';
import HuggingFace   from './views/AIDemand/HuggingFace';
import Pricing       from './views/Pricing/Pricing';
import Datacenter    from './views/AIDemand/Datacenter';
import Electricity   from './views/AIDemand/Electricity';
import Chinese       from './views/AIDemand/Chinese';
import SectorOverview from './views/AIDemand/SectorOverview';
import AISupply, { AISupplyOptics, AISupplyPCB } from './views/AISupply/AISupply';
import GitHubActivity from './views/AIDemand/GitHubActivity';
import Docker         from './views/AIDemand/Docker';
import Community      from './views/AIDemand/Community';
import Options        from './views/AIDemand/Options';
import DemandOpenAI   from './views/AIDemand/DemandOpenAI';
import DemandAnthropic from './views/AIDemand/DemandAnthropic';
import DemandGoogle   from './views/AIDemand/DemandGoogle';
import DemandZhipu    from './views/AIDemand/DemandZhipu';
import DemandMiniMax  from './views/AIDemand/DemandMiniMax';
import DemandGeneral      from './views/AIDemand/DemandGeneral';
import DemandOpenRouter   from './views/AIDemand/DemandOpenRouter';

/** Views that use EditableGrid and support layout customisation */
const LAYOUT_EDITABLE = new Set([
  'pypi','github','trends','web','reddit','hf','pricing','datacenter','electricity','chinese',
  'demand-openai','demand-anthropic','demand-google','demand-zhipu','demand-minimax','demand-general','openrouter-rankings',
]);

/** Map view id → React component */
const VIEW_COMPONENTS = {
  pypi:        PyPI,
  github:      GitHub,
  trends:      Trends,
  web:         Web,
  reddit:      Reddit,
  hf:          HuggingFace,
  pricing:     Pricing,
  datacenter:  Datacenter,
  electricity: Electricity,
  chinese:     Chinese,
  'ai-supply':        AISupply,
  'ai-supply-optics': AISupplyOptics,
  'ai-supply-pcb':    AISupplyPCB,
  'github-commits':   GitHubActivity,
  'docker':           Docker,
  'community':        Community,
  'options':          Options,
  'demand-openai':    DemandOpenAI,
  'demand-anthropic': DemandAnthropic,
  'demand-google':    DemandGoogle,
  'demand-zhipu':     DemandZhipu,
  'demand-minimax':   DemandMiniMax,
  'demand-general':        DemandGeneral,
  'openrouter-rankings':   DemandOpenRouter,
  chat:                    Chat,
};

export default function App() {
  const [currentView, setCurrentView] = useState('demand-openai');
  const [weeks, setWeeks] = useState(52);
  const [months, setMonths] = useState(12);

  const meta = VIEW_META[currentView] ?? { title: currentView.toUpperCase(), isNew: false };
  const mode = getModeForView(currentView);
  const prevView = useRef(null);

  // When the user enters the OpenRouter rankings page, default the global
  // weeks selection to the available multi-year window so YoY growth can
  // stretch across the full dataset.
  useEffect(() => {
    if (currentView === 'openrouter-rankings' && prevView.current !== 'openrouter-rankings' && weeks < 104) {
      setWeeks(104);
    }
    prevView.current = currentView;
  }, [currentView, weeks]);

  // Check if this is a sector overview page
  const sectorId = SECTOR_OVERVIEW_IDS[currentView] ?? null;
  const ViewComponent = sectorId ? null : VIEW_COMPONENTS[currentView];
  const showSidebar = currentView !== 'pricing' && currentView !== 'options';

  return (
    <DashboardProvider>
      <UIProvider>
        <LayoutProvider>
        <Navbar onNavigate={setCurrentView} currentView={currentView} />
        <div className="app-body">
          {showSidebar && <Sidebar currentView={currentView} onNavigate={setCurrentView} mode={mode} />}
          <main className="main">
            {currentView !== 'chat' && (
              <Topbar
                title={meta.title}
                isNew={meta.isNew}
                weeks={mode === 'demand' || mode === 'pricing' ? weeks : undefined}
                onWeeksChange={mode === 'demand' || mode === 'pricing' ? setWeeks : undefined}
                months={mode === 'supply' ? months : undefined}
                onMonthsChange={mode === 'supply' ? setMonths : undefined}
                sectorId={sectorId}
                viewId={currentView}
                layoutEditable={LAYOUT_EDITABLE.has(currentView)}
              />
            )}
            <div className={`content${currentView === 'chat' ? ' content--chat' : ''}`}>
              {sectorId
                ? <SectorOverview key={sectorId} sectorId={sectorId} weeks={weeks} />
                : currentView === 'chat'
                ? <Chat onNavigate={setCurrentView} />
                : ViewComponent && <ViewComponent weeks={weeks} months={mode === 'supply' ? months : undefined} />
              }
            </div>
          </main>
        </div>
        </LayoutProvider>
      </UIProvider>
    </DashboardProvider>
  );
}
