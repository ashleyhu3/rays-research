const WEEK_OPTIONS = [
  { label: '12 wk', value: 12 },
  { label: '24 wk', value: 24 },
  { label: '1 yr',  value: 52 },
];

export default function Topbar({ title, isNew, weeks, onWeeksChange }) {
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

        {isNew && <span className="new-badge">● new source</span>}
        <span className="live-badge">● simulated</span>
      </div>
    </div>
  );
}
