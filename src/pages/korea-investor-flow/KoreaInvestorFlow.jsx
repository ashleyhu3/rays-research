import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

// Same three colors the Korea leverage panels use, so the two pages read as one
// section rather than two palettes.
const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const PURPLE = '#7864b4';

const MUTED = '#8a8a84';

const SOURCE_URL = 'https://data.krx.co.kr/contents/MDC/MAIN/main/index.cmd?locale=en';

// Order matters: it is the stacking order within each bar, so the largest and
// most-watched group (individuals) sits nearest the zero line on both sides.
const GROUPS = [
  { key: 'individual', label: 'Individuals', color: BLUE },
  { key: 'foreign', label: 'Foreigners', color: ORANGE },
  { key: 'institution', label: 'Institutions', color: PURPLE },
];

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const PRESETS = [
  { id: '1m', label: '1M', getStart: () => isoMonthsAgo(1) },
  { id: '3m', label: '3M', getStart: () => isoMonthsAgo(3) },
  { id: '6m', label: '6M', getStart: () => isoMonthsAgo(6) },
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '12m', label: '12M', getStart: () => isoMonthsAgo(12) },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function monthLabel(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(d.getUTCFullYear()).slice(-2)}`;
}

const fmt = value => (Number.isFinite(value)
  ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}T`
  : '—');

/** Slice every series to the selected [startDate, endDate] window. */
function windowed(data, startDate, endDate) {
  if (!data?.dates?.length) return null;

  const { dates } = data;
  let from = dates.findIndex(date => date >= startDate);
  if (from < 0) from = 0;
  let to = dates.length - 1;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (dates[i] <= endDate) { to = i; break; }
  }
  if (to < from) to = dates.length - 1;

  const cut = values => (values ?? []).slice(from, to + 1);
  return {
    dates: cut(dates),
    groups: Object.fromEntries(GROUPS.map(g => [g.key, cut(data[g.key])])),
  };
}

export default function KoreaInvestorFlow() {
  const [startDate, setStartDate] = useState(() => isoMonthsAgo(3));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const maxDate = todayIso();

  useEffect(() => {
    let live = true;
    fetch('/api/korea-investor-flow')
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => { if (live) setData(payload); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  const win = useMemo(() => windowed(data, startDate, endDate), [data, startDate, endDate]);

  const toggles = (
    <div className="lev-toggles">
      <div className="usp-date-fields">
        <label className="usp-date-field">
          <span>From</span>
          <input
            type="date"
            className="usp-date-input"
            value={startDate}
            max={endDate || maxDate}
            onChange={e => e.target.value && setStartDate(e.target.value)}
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
            onChange={e => e.target.value && setEndDate(e.target.value)}
          />
        </label>
      </div>
      <div className="view-toggle">
        {PRESETS.map(preset => (
          <button
            key={preset.id}
            className={`vt-btn${preset.getStart() === startDate && endDate === maxDate ? ' active' : ''}`}
            onClick={() => { setStartDate(preset.getStart()); setEndDate(maxDate); }}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (error || !data || !win) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">
          {error
            ? `KOSPI investor flow unavailable: ${error}`
            : 'Loading KOSPI investor flow...'}
        </div>
      </>
    );
  }

  const latest = data.latest ?? {};
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {GROUPS.map(group => (
            <Tile
              key={group.key}
              label={`${group.label} — ${latest.date ?? ''}`}
              value={fmt(latest[group.key])}
              color={group.color}
            />
          ))}
        </div>
        {toggles}
      </div>
      <NetBuyingPanel win={win} />
    </>
  );
}

/**
 * Daily KOSPI net buying, one stacked bar per session: the groups that bought
 * that day stack upward from zero, the groups that sold stack downward. So the
 * bar's height is how much ownership rotated between groups that session, and
 * its composition is who was on each side.
 *
 * Net buying is zero-sum across *all* investors, and these three groups are all
 * but one of them — the excluded 기타법인 (non-financial corporates) is the only
 * reason the two sides aren't exact mirrors. It is normally a few hundredths of
 * a trillion won, so the sides read as mirrored without being forced to.
 */
function NetBuyingPanel({ win }) {
  const long = win.dates.length > 200;

  // A stacked bar's extent is the sum of its positive side (and, below zero, of
  // its negative side) — not any single group's value — so the symmetric bound
  // has to be measured on those sums.
  let maxAbs = 0;
  win.dates.forEach((_, index) => {
    let up = 0;
    let down = 0;
    for (const group of GROUPS) {
      const value = win.groups[group.key][index];
      if (!Number.isFinite(value)) continue;
      if (value > 0) up += value; else down += value;
    }
    maxAbs = Math.max(maxAbs, up, -down);
  });
  const bound = (maxAbs || 1) * 1.08;

  const data = {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: GROUPS.map(group => ({
      label: group.label,
      data: win.groups[group.key],
      backgroundColor: alpha(group.color, 0.85),
      borderColor: group.color,
      borderWidth: 0,
      barPercentage: 1,
      categoryPercentage: long ? 1 : 0.86,
    })),
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 14, right: 8, bottom: 6 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        // Chart.js orders stacked tooltip items by dataset; keep the buyers
        // together above the sellers so the day reads the way the bar looks.
        itemSort: (a, b) => b.raw - a.raw,
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => ` ${context.dataset.label}: ${fmt(context.raw)}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          color: MUTED,
          maxTicksLimit: 12,
          autoSkip: true,
          maxRotation: 0,
          padding: 4,
          font: { size: 11 },
        },
      },
      y: {
        stacked: true,
        min: -bound,
        max: bound,
        grid: {
          color: context => (context.tick.value === 0 ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.06)'),
          lineWidth: context => (context.tick.value === 0 ? 1.4 : 1),
        },
        ticks: {
          color: MUTED,
          maxTicksLimit: 7,
          callback: value => fmt(Number(value)),
          font: { size: 11 },
        },
      },
    },
  };

  return (
    <ChartCard
      chartId="korea-investor-flow-net"
      title="Korea · KOSPI net buying by investor"
      src={(
        <a className="ch-src" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          KRX investor trading trend
        </a>
      )}
      freq="Daily"
      lag="T close; published after the KRX session"
      span2
      height={380}
      legend={GROUPS.map(group => [group.label, group.color])}
    >
      <Bar data={data} options={options} />
    </ChartCard>
  );
}

function Tile({ label, value, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label">
        <span className="lev-dot" style={{ background: color }} />{label}
      </div>
      <div className="lev-tile-value">{value}</div>
    </div>
  );
}
