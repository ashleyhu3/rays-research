import { useEffect, useRef, useState } from 'react';
import { VIEW_META, SECTOR_OVERVIEW_IDS, getModeForView } from './config/navigation';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import Navbar from './components/layout/Navbar';
import Chat from './pages/chat/Chat';
import { UIProvider } from './context/UIContext';
import { DashboardProvider } from './context/DashboardContext';
import { LayoutProvider } from './context/LayoutContext';
import { SentimentSearchProvider } from './context/SentimentSearchContext';
import SentimentSearchBar from './pages/sentiment/SentimentSearchBar';

// ── Page components (static imports for reliability) ─────────────────
// Overview
import SectorOverview from './pages/overview/SectorOverview';
// AI company pages
import DemandOpenAI    from './pages/companies/OpenAI';
import DemandAnthropic from './pages/companies/Anthropic';
import DemandGoogle    from './pages/companies/Google';
import DemandZhipu     from './pages/companies/Zhipu';
import DemandMiniMax   from './pages/companies/MiniMax';
import DemandXAI       from './pages/companies/XAI';
import DemandKimi      from './pages/companies/Kimi';
import DemandQwen      from './pages/companies/Qwen';
import DemandDeepSeek  from './pages/companies/DeepSeek';
import DemandXiaomi    from './pages/companies/Xiaomi';
import DemandTencent   from './pages/companies/Tencent';
// Market signals
import MarketSignals    from './pages/market-signals/MarketSignals';
import DemandGeneral    from './pages/market-signals/InfrastructureOss';
import DemandOpenRouter from './pages/market-signals/OpenRouter';
// Supply chain
import {
  AISupplyOptics, AISupplyCCL, AISupplyPCB, AISupplyABF, AISupplyMLCC, AISupplyFiber,
  AISupplyCooling, AISupplyPower, AISupplyEquipment, AISupplyMemory, AISupplyFoundry,
  AISupplyTrainium, AISupplyCPU, AISupplyODM,
} from './pages/supply-chain/SupplyChain';
import DcTimelines, {
  DcCapacity,
  DcCoAWS, DcCoGoogle, DcCoMicrosoft, DcCoOracle, DcCoOpenAI, DcCoNebius, DcCoMeta,
} from './pages/supply-chain/DcBuildouts';
// Tools
import Options from './pages/options/Options';
import { PricingMemory, PricingGPU, PricingCPU, PricingTPU, PricingAWS } from './pages/pricing/Pricing';
import Sentiment from './pages/sentiment/Sentiment';
import Alerts, { OptionsReportTitle, OptionsReportControls } from './pages/alerts/Alerts';
import UsPerformance from './pages/us-performance/UsPerformance';
import HkChinaPerformance from './pages/hk-china-performance/HkChinaPerformance';
import HkPerformance from './pages/hk-performance/HkPerformance';
import GlobalPerformance from './pages/global-performance/GlobalPerformance';
import { OptionsReportProvider } from './context/OptionsReportContext';
import DataValidity from './pages/data-validity/DataValidity';
import { LeverageKorea, LeverageTaiwan } from './pages/leverage/Leverage';
import TaiwanIndividual from './pages/taiwan-individual/TaiwanIndividual';
import ChinaLeverage from './pages/china-leverage/ChinaLeverage';
import JapanLeverage from './pages/japan-leverage/JapanLeverage';
import UsLeverage from './pages/us-leverage/UsLeverage';
import ChinaLiquidity from './pages/liquidity/ChinaLiquidity';
import UsLiquidity from './pages/liquidity/UsLiquidity';
import CarryTrade from './pages/liquidity/CarryTrade';
import Transcripts from './pages/transcripts/Transcripts';
import Macro from './pages/macro/Macro';
import Commodity from './pages/macro/Commodity';
import FedWatch from './pages/macro/FedWatch';
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

/** Views with sidebar-driven subtabs (see NAV_SECTIONS 'Rotation' subitems) */
const MARKET_PERF_VIEWS = new Set(['us-performance', 'hk-china-performance', 'hk-performance', 'global-performance', 'liquidity-us', 'liquidity-china-flow', 'macro-commodity']);

/** Views that use EditableGrid and support layout customisation */
const LAYOUT_EDITABLE = new Set([
  'pypi','github','web','hf','pricing-memory','pricing-gpu','pricing-aws','pricing-cpu','pricing-tpu','datacenter','electricity','chinese',
  'demand-openai','demand-anthropic','demand-google','demand-zhipu','demand-minimax','demand-general','openrouter-rankings',
  'demand-xai','demand-kimi','demand-qwen','demand-deepseek','demand-xiaomi','demand-tencent',
  'dc-capacity','dc-timelines',
  'dc-co-aws','dc-co-google','dc-co-microsoft','dc-co-oracle','dc-co-openai','dc-co-nebius','dc-co-meta',
]);

/** Map view id → React component */
const VIEW_COMPONENTS = {
  pypi:        PyPI,
  github:      GitHub,
  web:         Web,
  hf:          HuggingFace,
  'pricing-memory': PricingMemory,
  'pricing-gpu':    PricingGPU,
  'pricing-aws':    PricingAWS,
  'pricing-cpu':    PricingCPU,
  'pricing-tpu':    PricingTPU,
  datacenter:  Datacenter,
  electricity: Electricity,
  chinese:     Chinese,
  'ai-supply-optics':    AISupplyOptics,
  'ai-supply-fiber':     AISupplyFiber,
  'ai-supply-ccl':       AISupplyCCL,
  'ai-supply-pcb':       AISupplyPCB,
  'ai-supply-abf':       AISupplyABF,
  'ai-supply-mlcc':      AISupplyMLCC,
  'ai-supply-cooling':   AISupplyCooling,
  'ai-supply-power':     AISupplyPower,
  'ai-supply-equipment': AISupplyEquipment,
  'ai-supply-memory':    AISupplyMemory,
  'ai-supply-foundry':   AISupplyFoundry,
  'ai-supply-trainium':  AISupplyTrainium,
  'ai-supply-cpu':       AISupplyCPU,
  'ai-supply-odm':       AISupplyODM,
  'dc-capacity':      DcCapacity,
  'dc-timelines':     DcTimelines,
  'dc-co-aws':        DcCoAWS,
  'dc-co-google':     DcCoGoogle,
  'dc-co-microsoft':  DcCoMicrosoft,
  'dc-co-oracle':     DcCoOracle,
  'dc-co-openai':     DcCoOpenAI,
  'dc-co-nebius':     DcCoNebius,
  'dc-co-meta':       DcCoMeta,
  'github-commits':   GitHubActivity,
  'docker':           Docker,
  'community':        Community,
  'options':          Options,
  'alerts':           Alerts,
  'us-performance':   UsPerformance,
  'hk-china-performance': HkChinaPerformance,
  'hk-performance':   HkPerformance,
  'global-performance': GlobalPerformance,
  'sentiment':        Sentiment,
  'sources':          DataValidity,
  'leverage-korea':   LeverageKorea,
  'leverage-taiwan':  LeverageTaiwan,
  'taiwan-individual': TaiwanIndividual,
  'leverage-china':   ChinaLeverage,
  'leverage-japan':   JapanLeverage,
  'leverage-us':      UsLeverage,
  'liquidity-us': UsLiquidity,
  'liquidity-china-flow': ChinaLiquidity,
  'liquidity-carry-trade': CarryTrade,
  'transcripts':      Transcripts,
  'macro-us-inflation': Macro,
  'macro-yield':        Macro,
  'macro-fed-watch':    FedWatch,
  'macro-commodity':    Commodity,
  'macro-us-labor':     Macro,
  'macro-us-pmi':       Macro,
  'macro-us-household': Macro,
  'macro-cn-inflation': Macro,
  'macro-cn-pmi':       Macro,
  'macro-cn-trade':     Macro,
  'macro-cn-activity':  Macro,
  'demand-openai':    DemandOpenAI,
  'demand-anthropic': DemandAnthropic,
  'demand-google':    DemandGoogle,
  'demand-zhipu':     DemandZhipu,
  'demand-minimax':   DemandMiniMax,
  'demand-xai':       DemandXAI,
  'demand-kimi':      DemandKimi,
  'demand-qwen':      DemandQwen,
  'demand-deepseek':  DemandDeepSeek,
  'demand-xiaomi':    DemandXiaomi,
  'demand-tencent':   DemandTencent,
  'demand-general':        DemandGeneral,
  'openrouter-rankings':   DemandOpenRouter,
  'market-signals':        MarketSignals,
  chat:                    Chat,
};

export default function App() {
  const [currentView, setCurrentView] = useState('overview');
  const [weeks, setWeeks] = useState(52);
  const [months, setMonths] = useState(12);
  const [perfSection, setPerfSection] = useState({});
  const activeSection = perfSection[currentView] ?? null;

  // Navigating to a view resets its subtab back to "none selected" (aggregate-only default).
  const handleNavigate = (viewId) => {
    setCurrentView(viewId);
    const defaultSection = viewId === 'liquidity-us' ? 'fed-balance'
      : viewId === 'liquidity-china-flow' ? 'flow'
      : viewId === 'macro-commodity' ? 'precious-rare'
      : null;
    setPerfSection(s => ({ ...s, [viewId]: defaultSection }));
  };

  // Subtabs are shown for every market-performance item at all times, so picking one
  // may belong to a view that isn't currently active — switch to it and select it.
  const handleNavigateSubtab = (viewId, key) => {
    setCurrentView(viewId);
    setPerfSection(s => ({ ...s, [viewId]: key }));
  };

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
  const isAlerts = currentView === 'alerts';
  const showSidebar = currentView !== 'options' && currentView !== 'chat' && currentView !== 'sentiment' && currentView !== 'sources' && currentView !== 'transcripts' && currentView !== 'alerts';

  return (
    <DashboardProvider>
      <UIProvider>
        <LayoutProvider>
        <SentimentSearchProvider>
        <OptionsReportProvider>
        <Navbar onNavigate={handleNavigate} currentView={currentView} />
        <div className="app-body">
          {showSidebar && (
            <Sidebar
              currentView={currentView}
              onNavigate={handleNavigate}
              mode={mode}
              subtabByView={perfSection}
              onNavigateSubtab={handleNavigateSubtab}
            />
          )}
          <main className="main">
            {currentView !== 'chat' && (
              <Topbar
                title={meta.title}
                titleContent={
                  isAlerts ? <OptionsReportTitle />
                  : currentView === 'sentiment' ? <SentimentSearchBar />
                  : undefined
                }
                rightContent={isAlerts ? <OptionsReportControls /> : undefined}
                weeks={!isAlerts && (mode === 'demand' || mode === 'pricing') ? weeks : undefined}
                onWeeksChange={!isAlerts && (mode === 'demand' || mode === 'pricing') ? setWeeks : undefined}
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
                : ViewComponent && (
                    <ViewComponent
                      viewId={currentView}
                      weeks={weeks}
                      months={mode === 'supply' ? months : undefined}
                      {...(MARKET_PERF_VIEWS.has(currentView) ? { section: activeSection } : {})}
                    />
                  )
              }
            </div>
          </main>
        </div>
        </OptionsReportProvider>
        </SentimentSearchProvider>
        </LayoutProvider>
      </UIProvider>
    </DashboardProvider>
  );
}
