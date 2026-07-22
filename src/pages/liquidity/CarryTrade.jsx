import { useEffect, useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

const BLUE = '#4577b4';
const PURPLE = '#7864b4';
const GREEN = '#5a9f6b';
const RED = '#c65d57';
const MUTED = '#8a8a84';

const RANGES = [
  { id: '1y', label: '1Y', years: 1 },
  { id: '3y', label: '3Y', years: 3 },
  { id: '5y', label: '5Y', years: 5 },
  { id: 'all', label: 'All' },
];

const SERIES = [
  { key: 'jpy', short: 'JPY', color: BLUE },
  { key: 'chf', short: 'CHF', color: PURPLE },
];

function fmtContracts(value, signed = false) {
  if (!Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1e6) return `${sign}${(value / 1e6).toFixed(2)}M`;
  if (absolute >= 1e3) return `${sign}${(value / 1e3).toFixed(1)}K`;
  return `${sign}${value.toLocaleString()}`;
}

function monthLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  const month = parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${month} '${String(parsed.getUTCFullYear()).slice(-2)}`;
}

function windowed(points, range) {
  if (!points?.length || !range.years) return points ?? [];
  const cutoff = new Date(`${points.at(-1).date}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - range.years);
  const start = cutoff.toISOString().slice(0, 10);
  return points.filter(point => point.date >= start);
}

function chartData(points, color) {
  return {
    labels: points.map(point => monthLabel(point.date)),
    datasets: [{
      label: 'Net contracts',
      data: points.map(point => point.value),
      backgroundColor: points.map(point => `${point.value >= 0 ? GREEN : RED}c7`),
      borderColor: points.map(point => point.value >= 0 ? GREEN : RED),
      borderWidth: 1,
      borderRadius: 2,
      maxBarThickness: 12,
      hoverBackgroundColor: color,
    }],
  };
}

function chartOptions(points) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        title: items => points[items[0]?.dataIndex]?.date ?? '',
        label: context => ` Net position: ${fmtContracts(context.raw, true)} contracts`,
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: MUTED, maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } } },
      y: {
        grid: { color: context => context.tick.value === 0 ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => fmtContracts(Number(value)), font: { size: 10 } },
        title: { display: true, text: 'Net contracts', color: MUTED, font: { size: 10 } },
      },
    },
  };
}

function Tile({ label, point, color }) {
  return (
    <div className="lev-tile">
      <div className="lev-tile-label"><span className="lev-dot" style={{ background: color }} />{label}</div>
      <div className="lev-tile-value">{fmtContracts(point?.value, true)}</div>
    </div>
  );
}

export default function CarryTrade() {
  const [rangeId, setRangeId] = useState('3y');
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const range = RANGES.find(item => item.id === rangeId) ?? RANGES[1];

  useEffect(() => {
    let live = true;
    fetch('/api/carry-trade')
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(data => { if (live) setPayload(data); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  const visible = useMemo(() => Object.fromEntries(SERIES.map(series => [
    series.key,
    windowed(payload?.series?.[series.key]?.data, range),
  ])), [payload, range]);

  const toggles = (
    <div className="lev-toggles"><div className="view-toggle">
      {RANGES.map(item => (
        <button key={item.id} className={`vt-btn${item.id === rangeId ? ' active' : ''}`} onClick={() => setRangeId(item.id)}>
          {item.label}
        </button>
      ))}
    </div></div>
  );

  if (error || !payload) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">{error ? `Carry Trade data unavailable: ${error}` : 'Loading CFTC carry-trade positioning…'}</div>
      </>
    );
  }

  if (SERIES.some(series => !visible[series.key]?.length)) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">No stored carry-trade history yet. The daily collector will populate it.</div>
      </>
    );
  }

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {SERIES.map(series => {
            const point = visible[series.key].at(-1);
            return <Tile key={series.key} label={`${series.short} net position`} point={point} color={point.value >= 0 ? GREEN : RED} />;
          })}
        </div>
        {toggles}
      </div>
      <div className="cgrid">
        {SERIES.map(series => {
          const meta = payload.series[series.key];
          const points = visible[series.key];
          return (
            <ChartCard
              key={series.key}
              chartId={`liquidity-carry-trade-${series.key}`}
              title={meta.name}
              src={<a className="ch-src" href={meta.sourceUrl} target="_blank" rel="noopener noreferrer">Investing.com / CFTC</a>}
              freq="Weekly"
              lag="Friday release; positions as of Tuesday"
              height={340}
              srcNote="Non-commercial futures longs minus shorts. Positive values indicate net long positioning; negative values indicate net short positioning. Chart dates are CFTC position dates."
            >
              <Bar data={chartData(points, series.color)} options={chartOptions(points)} />
            </ChartCard>
          );
        })}
      </div>
    </>
  );
}
