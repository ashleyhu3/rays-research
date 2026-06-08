import { useData } from '../context/DataContext';

const NAV_ITEMS = [
  { id: 'ai-demand', label: 'AI Demand' },
];

export default function Navbar({ currentSection, onSectionChange }) {
  const { loading, lastUpdated, error, refresh } = useData();

  const timeStr = lastUpdated
    ? lastUpdated.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <nav className="navbar">
      <div className="navbar-brand">SIGNAL</div>

      <div className="navbar-links">
        {NAV_ITEMS.map(({ id, label }) => (
          <button
            key={id}
            className={`nlink${currentSection === id ? ' active' : ''}`}
            onClick={() => onSectionChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="navbar-r">
        {error   && <span className="fetch-status error">⚠ {error}</span>}
        {timeStr && !error && <span className="fetch-status">Updated {timeStr}</span>}
        <button
          className={`fetch-btn${loading ? ' loading' : ''}`}
          onClick={refresh}
          disabled={loading}
        >
          {loading ? '↻ Fetching…' : '↻ Refresh'}
        </button>
      </div>
    </nav>
  );
}
