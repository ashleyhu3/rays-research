import { useData } from '../context/DataContext';

const WEEK_OPTIONS = [
  { label: '12 wk', value: 12 },
  { label: '24 wk', value: 24 },
  { label: '1 yr',  value: 52 },
];

export default function Topbar({ title, weeks, onWeeksChange }) {
  const { liveData, loading } = useData();

  const badge = loading
    ? { text: '● fetching…', cls: 'live-badge loading-badge' }
    : liveData
      ? { text: '● live',      cls: 'live-badge' }
      : { text: '● simulated', cls: 'live-badge sim-badge' };

  return (
    <div className="topbar">
      <h1>{title}</h1>
      <div className="topbar-r">
        {WEEK_OPTIONS.map(({ label, value }) => (
          <button
            key={value}
            className={`rbtn${weeks === value ? ' active' : ''}`}
            onClick={() => onWeeksChange(value)}
          >
            {label}
          </button>
        ))}
        <span className={badge.cls}>{badge.text}</span>
      </div>
    </div>
  );
}
