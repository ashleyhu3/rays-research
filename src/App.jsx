import { useEffect, useRef, useState } from 'react';
import { VIEW_META, SECTOR_OVERVIEW_IDS, NAV_SECTIONS } from './config/navigation';

function getModeForView(viewId) {
  for (const s of NAV_SECTIONS) {
    if (s.items.some(item => item.id === viewId)) return s.mode ?? 'demand';
  }
  return 'demand';
}
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import Navbar from './components/layout/Navbar';
import Chat from './pages/chat/Chat';
import { UIProvider } from './context/UIContext';
import { DashboardProvider } from './context/DashboardContext';
import { LayoutProvider } from './context/LayoutContext';

// ── Page components (static imports for reliability) ─────────────────
// Overview
import SectorOverview from './pages/overview/SectorOverview';
// AI company pages
import DemandOpenAI    from './pages/companies/OpenAI';
import DemandAnthropic from './pages/companies/Anthropic';
import DemandGoogle    from './pages/companies/Google';
import DemandZhipu     from './pages/companies/Zhipu';
import DemandMiniMax   from './pages/companies/MiniMax';
// Market signals
import MarketSignals    from './pages/market-signals/MarketSignals';
import DemandGeneral    from './pages/market-signals/InfrastructureOss';
import DemandOpenRouter from './pages/market-signals/OpenRouter';
// Supply chain
import AISupply, { AISupplyOptics, AISupplyPCB, AISupplyMLCC, AISupplyFiber } from './pages/supply-chain/SupplyChain';
import DcTimelines, { DcServerSupply, DcCapacity } from './pages/supply-chain/DcBuildouts';
// Tools
import Options from './pages/options/Options';
import Pricing from './pages/pricing/Pricing';
import Sentiment from './pages/sentiment/Sentiment';
import DataValidity from './pages/data-validity/DataValidity';
import Transcripts from './pages/transcripts/Transcripts';
// Source-specific signal pages
import PyPI          from './pages/sources/PyPI';
import GitHub        from './pages/sources/GitHub';
import Web           from './pages/sources/Web';
import HuggingFace   from './pages/sources/HuggingFace';
import Datacenter    from './pages/sources/Datacenter';
import Electricity   from './pages/sources/Electricity';
import Chinese       from './pages/sources/Chinese';
import GitHubActivity from './pages/sources/GitHubActivity';
import Docker         from './pages/sources/Docker';
import Community      from './pages/sources/Community';

/** Views that use EditableGrid and support layout customisation */
const LAYOUT_EDITABLE = new Set([
  'pypi','github','web','hf','pricing','datacenter','electricity','chinese',
  'demand-openai','demand-anthropic','demand-google','demand-zhipu','demand-minimax','demand-general','openrouter-rankings',
  'dc-capacity','dc-timelines',
]);

/** Map view id → React component */
const VIEW_COMPONENTS = {
  pypi:        PyPI,
  github:      GitHub,
  web:         Web,
  hf:          HuggingFace,
  pricing:     Pricing,
  datacenter:  Datacenter,
  electricity: Electricity,
  chinese:     Chinese,
  'ai-supply':        AISupply,
  'ai-supply-optics': AISupplyOptics,
  'ai-supply-fiber':  AISupplyFiber,
  'ai-supply-pcb':    AISupplyPCB,
  'ai-supply-mlcc':   AISupplyMLCC,
  'dc-server':        DcServerSupply,
  'dc-capacity':      DcCapacity,
  'dc-timelines':     DcTimelines,
  'github-commits':   GitHubActivity,
  'docker':           Docker,
  'community':        Community,
  'options':          Options,
  'sentiment':        Sentiment,
  'sources':          DataValidity,
  'transcripts':      Transcripts,
  'demand-openai':    DemandOpenAI,
  'demand-anthropic': DemandAnthropic,
  'demand-google':    DemandGoogle,
  'demand-zhipu':     DemandZhipu,
  'demand-minimax':   DemandMiniMax,
  'demand-general':        DemandGeneral,
  'openrouter-rankings':   DemandOpenRouter,
  'market-signals':        MarketSignals,
  chat:                    Chat,
};

export default function App() {
  const [currentView, setCurrentView] = useState('overview');
  const [weeks, setWeeks] = useState(52);
  const [months, setMonths] = useState(12);

  const meta = VIEW_META[currentView] ?? { title: currentView.toUpperCase() };
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
  const showSidebar = currentView !== 'pricing' && currentView !== 'options' && currentView !== 'chat' && currentView !== 'sentiment' && currentView !== 'sources' && currentView !== 'transcripts';

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
