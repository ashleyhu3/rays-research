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
import Chat from './views/Chat';
import { UIProvider } from './context/UIContext';
import { DashboardProvider } from './context/DashboardContext';
import { LayoutProvider } from './context/LayoutContext';

// ── View components (static imports for reliability) ─────────────────
import PyPI          from './views/PyPI';
import GitHub        from './views/GitHub';
import Trends        from './views/Trends';
import Web           from './views/Web';
import Reddit        from './views/Reddit';
import HuggingFace   from './views/HuggingFace';
import Pricing       from './views/Pricing';
import Datacenter    from './views/Datacenter';
import Electricity   from './views/Electricity';
import Chinese       from './views/Chinese';
import SectorOverview from './views/SectorOverview';
import AISupply, { AISupplyOptics, AISupplyPCB } from './views/AISupply';
import ArXiv          from './views/ArXiv';
import GitHubActivity from './views/GitHubActivity';
import Docker         from './views/Docker';
import Community      from './views/Community';
import Options        from './views/Options';
import DemandOpenAI   from './views/DemandOpenAI';
import DemandAnthropic from './views/DemandAnthropic';
import DemandGoogle   from './views/DemandGoogle';
import DemandZhipu    from './views/DemandZhipu';
import DemandMiniMax  from './views/DemandMiniMax';
import DemandGeneral      from './views/DemandGeneral';
import DemandOpenRouter   from './views/DemandOpenRouter';

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
  'arxiv':            ArXiv,
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

  // Check if this is a sector overview page
  const sectorId = SECTOR_OVERVIEW_IDS[currentView] ?? null;
  const ViewComponent = sectorId ? null : VIEW_COMPONENTS[currentView];

  return (
    <DashboardProvider>
      <UIProvider>
        <LayoutProvider>
        <Navbar onNavigate={setCurrentView} currentView={currentView} />
        <div className="app-body">
          <Sidebar currentView={currentView} onNavigate={setCurrentView} mode={mode} />
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
