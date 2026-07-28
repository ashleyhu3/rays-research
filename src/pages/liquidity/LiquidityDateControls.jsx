import { useState } from 'react';

const PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y', label: '1Y', getStart: () => isoYearsAgo(1) },
  { id: '3y', label: '3Y', getStart: () => isoYearsAgo(3) },
  { id: '5y', label: '5Y', getStart: () => isoYearsAgo(5) },
  { id: 'all', label: 'All', getStart: () => '2000-01-01' },
];

function isoYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function useLiquidityDateRange(defaultPreset = '1y') {
  const preset = PRESETS.find(item => item.id === defaultPreset) ?? PRESETS[1];
  const [startDate, setStartDate] = useState(() => preset.getStart());
  const [endDate, setEndDate] = useState(() => todayIso());
  return { startDate, setStartDate, endDate, setEndDate };
}

export function filterDateRange(points, startDate, endDate) {
  return (points ?? []).filter(point => point.date >= startDate && point.date <= endDate);
}

export default function LiquidityDateControls({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}) {
  const maxDate = todayIso();

  return (
    <div className="usp-head">
      <div className="usp-date-fields">
        <label className="usp-date-field">
          <span>From</span>
          <input
            type="date"
            className="usp-date-input"
            value={startDate}
            max={endDate || maxDate}
            onChange={event => event.target.value && setStartDate(event.target.value)}
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
            onChange={event => event.target.value && setEndDate(event.target.value)}
          />
        </label>
      </div>
      <div className="view-toggle">
        {PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`vt-btn${preset.getStart() === startDate && endDate === maxDate ? ' active' : ''}`}
            onClick={() => {
              setStartDate(preset.getStart());
              setEndDate(maxDate);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
