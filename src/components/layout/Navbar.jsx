import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { getModeForView } from '../../config/navigation';

function RefreshIcon({ spin }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      style={spin ? { animation: 'spin .85s linear infinite' } : {}}
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function BarChartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="0" y="4" width="3" height="8" rx="0.5" />
      <rect x="4.5" y="2" width="3" height="10" rx="0.5" />
      <rect x="9" y="0" width="3" height="12" rx="0.5" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1" />
      <line x1="0.75" y1="4.5" x2="11.25" y2="4.5" />
      <line x1="0.75" y1="8" x2="11.25" y2="8" />
      <line x1="4.5" y1="0.75" x2="4.5" y2="11.25" />
    </svg>
  );
}

export default function Navbar({ onNavigate, currentView }) {
  const { tableMode, setTableMode } = useUI();
  const { loading, lastUpdated, error, forceRefresh } = useData();

  const mode        = getModeForView(currentView);
  const isChat      = currentView === 'chat';
  const isOptions   = currentView === 'options';
  const isAlerts    = currentView === 'alerts';
  const isSentiment = currentView === 'sentiment';
  const isSources   = currentView === 'sources';
  const isTranscripts = currentView === 'transcripts';
  const isSupply    = mode === 'supply';
  const isInfra     = mode === 'aisupplychain';
  const isPricing   = mode === 'pricing';
  const isLeverage  = mode === 'leverage';
  const isLiquidity = mode === 'liquidity';
  const isUsPerf    = mode === 'us-performance';
  const isMacro     = mode === 'macro';
  const isDemand    = mode === 'demand' && !isChat && !isAlerts;

  const title = loading
    ? 'Updating live data…'
    : error
    ? `Error: ${error}`
    : lastUpdated
    ? `Live data · updated ${lastUpdated.toLocaleTimeString()}`
    : 'No data loaded';

  return (
    <nav className="navbar">
      <div className="navbar-brand">SIGNAL</div>
      <div className="navbar-links">
        <button
          className={`nlink${isDemand ? ' active' : ''}`}
          onClick={() => onNavigate('overview')}
        >
          AI Demand
        </button>
        <button
          className={`nlink${isSupply ? ' active' : ''}`}
          onClick={() => onNavigate('ai-supply-optics')}
        >
          AI Supply
        </button>
        <button
          className={`nlink${isAlerts ? ' active' : ''}`}
          onClick={() => onNavigate('alerts')}
        >
          Alerts
        </button>
        <button
          className={`nlink${isUsPerf ? ' active' : ''}`}
          onClick={() => onNavigate('us-performance')}
        >
          Rotation
        </button>
        <button
          className={`nlink${isLeverage ? ' active' : ''}`}
          onClick={() => onNavigate('leverage-korea')}
        >
          Leverage
        </button>
        <button
          className={`nlink${isLiquidity ? ' active' : ''}`}
          onClick={() => onNavigate('liquidity-china-flow')}
        >
          Liquidity
        </button>
        <button
          className={`nlink${isMacro ? ' active' : ''}`}
          onClick={() => onNavigate('macro-us-inflation')}
        >
          Macro
        </button>
        <button
          className={`nlink${isSentiment || isOptions ? ' active' : ''}`}
          onClick={() => onNavigate('sentiment')}
        >
          Markets
        </button>
        <button
          className={`nlink${isPricing ? ' active' : ''}`}
          onClick={() => onNavigate('pricing-memory')}
        >
          Pricing
        </button>
        <button
          className={`nlink${isInfra ? ' active' : ''}`}
          onClick={() => onNavigate('dc-capacity')}
        >
          AI Supply Chain
        </button>
        <button
          className={`nlink${isTranscripts ? ' active' : ''}`}
          onClick={() => onNavigate('transcripts')}
        >
          Transcripts
        </button>
        <button
          className={`nlink${isSources ? ' active' : ''}`}
          onClick={() => onNavigate('sources')}
        >
          Sources
        </button>
        <button
          className={`nlink nlink-ask${isChat ? ' active' : ''}`}
          onClick={() => onNavigate('chat')}
        >
          Ask
        </button>
      </div>
      <div className="navbar-r">
        <span className={`fetch-status${error ? ' error' : ''}`} title={title}>
          {loading ? 'Updating…' : lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
        </span>
        <button
          className={`fetch-btn${loading ? ' loading' : ''}`}
          onClick={forceRefresh}
          disabled={loading}
          title="Re-scrape all live sources and refresh charts"
        >
          <RefreshIcon spin={loading} />
          {loading ? 'Updating…' : 'Refresh Data'}
        </button>
        <div className="view-toggle">
          <button
            className={`vt-btn${!tableMode ? ' active' : ''}`}
            onClick={() => setTableMode(false)}
            title="Chart view"
          >
            <BarChartIcon />
            Chart
          </button>
          <button
            className={`vt-btn${tableMode ? ' active' : ''}`}
            onClick={() => setTableMode(true)}
            title="Table view"
          >
            <TableIcon />
            Table
          </button>
        </div>
      </div>
    </nav>
  );
}
