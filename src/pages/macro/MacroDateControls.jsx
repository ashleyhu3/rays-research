export const MACRO_DATE_PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y', label: '1Y', getStart: () => isoYearsAgo(1) },
  { id: '3y', label: '3Y', getStart: () => isoYearsAgo(3) },
  { id: '5y', label: '5Y', getStart: () => isoYearsAgo(5) },
];

export function isoYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function inDateRange(date, startDate, endDate) {
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

export default function MacroDateControls({ startDate, endDate, onStartDate, onEndDate }) {
  const maxDate = todayIso();
  return (
    <div className="usp-head macro-date-controls">
      <div className="usp-date-fields">
        <label className="usp-date-field">
          <span>From</span>
          <input
            type="date"
            className="usp-date-input"
            value={startDate}
            max={endDate || maxDate}
            onChange={event => event.target.value && onStartDate(event.target.value)}
          />
        </label>
        <label className="usp-date-field">
          <span>To</span>
          <input
            type="date"
            className="usp-date-input"
            value={endDate}
            min={startDate}
            max={maxDate}
            onChange={event => event.target.value && onEndDate(event.target.value)}
          />
        </label>
      </div>
      <div className="view-toggle" aria-label="Default time ranges">
        {MACRO_DATE_PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`vt-btn${preset.getStart() === startDate && endDate === maxDate ? ' active' : ''}`}
            onClick={() => { onStartDate(preset.getStart()); onEndDate(maxDate); }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
