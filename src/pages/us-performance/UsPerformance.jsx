import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';

// 12-hue categorical palette, one slot per sector ETF, order fixed (never
// cycled — see the dataviz skill). Generated and validated for CVD
// separation / lightness band / contrast against this app's dark card
// surface (#111419) with scripts/validate_palette.js — all checks pass.
const SECTOR_COLORS = [
  '#3c8cdd', '#da5a2f', '#198f5e', '#9c7c1c', '#8749df', '#dc386e',
  '#44981b', '#1f96ad', '#dd40dd', '#89931a', '#4551de', '#da2f2f',
];
// SPX is the benchmark, not a 13th competing hue: neutral ink, thicker,
// dashed, so it reads as "the line everything else is measured against".
const SPX_COLOR = '#eaeae0';

const PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y',  label: '1Y',  getStart: () => isoYearsAgo(1) },
  { id: '3y',  label: '3Y',  getStart: () => isoYearsAgo(3) },
  { id: '5y',  label: '5Y',  getStart: () => isoYearsAgo(5) },
];

function isoYearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// Rebase a raw close-price series to 100 at its first available value —
// a series that starts trading after `start` (XLSR pre-2019) is simply
// rebased to its own first print instead of showing nulls throughout.
function rebase(closes) {
  const baseIdx = closes.findIndex(v => v != null);
  if (baseIdx === -1) return closes.map(() => null);
  const base = closes[baseIdx];
  return closes.map((v, i) => (i < baseIdx || v == null ? null : (v / base) * 100));
}

// Dashed reference line at the rebased-100 baseline, drawn behind the series.
const BASELINE_100 = {
  id: 'usPerfBaseline',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const y = scales.y.getPixelForValue(100);
    ctx.save();
    ctx.strokeStyle = 'rgba(234,234,224,.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
};

function buildChartData(payload) {
  const labels = payload.dates.map(fmtDate);
  const datasets = payload.series.map((s, i) => {
    const isSpx = s.ticker === '^GSPC';
    const color = isSpx ? SPX_COLOR : SECTOR_COLORS[i % SECTOR_COLORS.length];
    return {
      label: s.label,
      fullName: s.name,
      data: rebase(s.closes),
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: isSpx ? 3 : 1.75,
      borderDash: isSpx ? [6, 3] : undefined,
      pointRadius: 0,
      pointHoverRadius: 3,
      pointHitRadius: 6,
      tension: 0.15,
      spanGaps: true,
    };
  });
  return { labels, datasets };
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: '#c8c8c0',
          font: { size: 10, family: "'Inter',sans-serif" },
          padding: 8,
          boxWidth: 10,
        },
      },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => {
            const v = c.parsed.y;
            if (v == null) return ` ${c.dataset.label}: —`;
            const pct = v - 100;
            return ` ${c.dataset.label}: ${v.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
          },
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: { grid: GRID, ticks: { ...TICK, callback: v => v.toFixed(0) }, border: BORD },
    },
  };
}

export default function UsPerformance() {
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`/api/us-performance?start=${startDate}`)
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) { setPayload(data); setLoading(false); } })
      .catch(fetchError => { if (live) { setError(fetchError.message); setLoading(false); } });
    return () => { live = false; };
  }, [startDate]);

  const chartData = useMemo(() => (payload ? buildChartData(payload) : null), [payload]);

  const controls = (
    <div className="usp-head">
      <label className="usp-date-field">
        <span>From</span>
        <input
          type="date"
          className="usp-date-input"
          value={startDate}
          max={todayIso()}
          onChange={e => e.target.value && setStartDate(e.target.value)}
        />
      </label>
      <div className="view-toggle">
        {PRESETS.map(p => (
          <button
            key={p.id}
            className={`vt-btn${p.getStart() === startDate ? ' active' : ''}`}
            onClick={() => setStartDate(p.getStart())}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {controls}
      <div className="cgrid">
        <ChartCard
          title="US Performance — Sector ETFs vs SPX"
          src="Yahoo Finance"
          srcUrl="https://finance.yahoo.com"
          freq="Daily"
          span2
          height={480}
        >
          {error ? (
            <div className="empty">Could not load US performance data: {error}</div>
          ) : !chartData ? (
            <div className="empty">{loading ? 'Loading US performance data…' : 'No data'}</div>
          ) : (
            <Line data={chartData} options={chartOptions()} plugins={[BASELINE_100]} />
          )}
        </ChartCard>
      </div>
    </>
  );
}
