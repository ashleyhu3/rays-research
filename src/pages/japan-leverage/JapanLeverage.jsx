import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';

const SURFACE = '#111419';
const MUTED = '#8a8a84';

const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const GOLD = '#c9a227';

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

const MARKED_POINTS = {
  id: 'japanLeverageMarkedPoints',
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    const points = chart.getDatasetMeta(0).data;
    const color = options.color ?? chart.data.datasets[0].borderColor;

    ctx.save();
    for (const mark of options.marks ?? []) {
      const point = points[mark.index];
      if (!point || point.skip) continue;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 3.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = SURFACE;
      ctx.textAlign = mark.anchor === 'right' ? 'right' : 'center';
      const x = mark.anchor === 'right' ? point.x - 2 : point.x;

      const valueAbove = point.y - chartArea.top > 25;
      ctx.font = "700 11px 'Inter', sans-serif";
      ctx.textBaseline = valueAbove ? 'bottom' : 'top';
      const valueY = valueAbove ? point.y - 7 : point.y + 7;
      ctx.strokeText(mark.value, x, valueY);
      ctx.fillStyle = color;
      ctx.fillText(mark.value, x, valueY);

      ctx.font = "700 10px 'Inter', sans-serif";
      ctx.textBaseline = 'top';
      const dateY = chartArea.bottom + 21;
      ctx.strokeText(mark.date, x, dateY);
      ctx.fillStyle = color;
      ctx.fillText(mark.date, x, dateY);
    }
    ctx.restore();
  },
};

// Three metrics from JPX's weekly market-wide margin workbook — purchases and
// sales are the officially published yen balances, ratio is purchases ÷ sales
// computed from those same two balances (see japanLeverage.js on the server).
const METRICS = [
  {
    key: 'purchases', label: 'Outstanding Margin Purchases', jp: '信用買残 / 信用買残高',
    color: BLUE, fmt: v => `${v.toFixed(2)}T`,
  },
  {
    key: 'sales', label: 'Outstanding Margin Sales', jp: '信用売残 / 信用売残高',
    color: ORANGE, fmt: v => `${v.toFixed(2)}T`,
  },
  {
    key: 'ratio', label: 'Margin Buy/Sell Ratio', jp: '信用買残 ÷ 信用売残',
    color: GOLD, fmt: v => `${v.toFixed(2)}×`,
  },
];

const RANGES = [
  { id: '12m', label: '12M', days: 366 },
  { id: '18m', label: '18M', days: 548 },
  { id: '5y', label: '5Y', days: 1830 },
  { id: '10y', label: '10Y', days: 3660 },
  { id: 'all', label: 'All', days: null },
];

const MARKED_DATES = ['2025-04-07', '2026-03-30'];

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

function markedDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${year.slice(-2)}/${month}/${day}`;
}

function sessionIndex(dates, target) {
  let found = -1;
  for (let index = 0; index < dates.length; index += 1) {
    if (dates[index] <= target) found = index;
    else break;
  }
  return found;
}

function rangeFrom(dates, range) {
  if (!dates.length || !range.days) return 0;
  const cutoff = new Date(
    new Date(`${dates.at(-1)}T00:00:00Z`).getTime() - range.days * 86400000,
  ).toISOString().slice(0, 10);
  const idx = dates.findIndex(d => d >= cutoff);
  return idx < 0 ? 0 : idx;
}

/** Slice the three metric series to the selected trailing window. */
function windowed(dates, seriesMap, range) {
  if (!dates?.length) return null;
  const from = rangeFrom(dates, range);
  const cut = arr => (arr ?? []).slice(from);
  return {
    dates: cut(dates),
    series: Object.fromEntries(Object.entries(seriesMap).map(([key, arr]) => [key, cut(arr)])),
  };
}

function metricMarks(win, metric) {
  const values = win.series[metric.key] ?? [];
  const marks = MARKED_DATES.map(target => {
    const index = sessionIndex(win.dates, target);
    if (index < 0 || !Number.isFinite(values[index])) return null;
    return {
      index,
      date: markedDate(win.dates[index]),
      value: metric.fmt(values[index]),
      anchor: 'center',
    };
  }).filter(Boolean);

  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;
  if (latestIndex >= 0) {
    marks.push({
      index: latestIndex,
      date: markedDate(win.dates[latestIndex]),
      value: metric.fmt(values[latestIndex]),
      anchor: 'right',
    });
  }
  return marks;
}

function metricChartData(win, metric) {
  const long = win.dates.length > 100;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: [{
      label: metric.label,
      data: win.series[metric.key],
      backgroundColor: alpha(metric.color, 0.38),
      borderColor: metric.color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: metric.color,
      pointHoverBorderColor: SURFACE,
      pointHoverBorderWidth: 2,
      tension: 0.25,
      fill: 'origin',
    }],
  };
}

function metricChartOptions(win, metric) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 18 } },
    plugins: {
      legend: { display: false },
      japanLeverageMarkedPoints: { marks: metricMarks(win, metric), color: metric.color },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => ` ${context.dataset.label}: ${metric.fmt(context.raw)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0, padding: 3, font: { size: 10 },
        },
      },
      y: {
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => metric.fmt(Number(value)), font: { size: 10 } },
      },
    },
  };
}

function SourceLinks() {
  return (
    <span className="lev-srcs">
      <a
        className="ch-src"
        href="https://www.jpx.co.jp/english/markets/statistics-equities/margin/index.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="lev-dot" style={{ background: BLUE }} />JPX Outstanding Margin Trading
      </a>
    </span>
  );
}

const SRC_NOTE = 'JPX publishes market-wide margin trading balances weekly (application-date basis), not daily — '
  + 'plotted here at that native weekly cadence with no interpolation between points. Figures are Tokyo + Nagoya '
  + 'combined, Negotiable + Standardized margin transactions. Buy/Sell Ratio is calculated as Outstanding Margin '
  + 'Purchases ÷ Outstanding Margin Sales, both from the same officially published yen balances.';

function MetricPanel({ metric, win }) {
  const chart = (
    <Line
      data={metricChartData(win, metric)}
      options={metricChartOptions(win, metric)}
      plugins={[MARKED_POINTS]}
    />
  );
  return (
    <ChartCard
      chartId={`japan-leverage-${metric.key}`}
      title={`Japan · ${metric.label} (${metric.jp})`}
      src={<SourceLinks />}
      freq="Weekly"
      lag="Published Tuesday for the prior week"
      span2
      height={320}
      legend={[[metric.label, metric.color]]}
      srcNote={metric.key === 'ratio' ? SRC_NOTE : undefined}
    >
      {chart}
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

export default function JapanLeverage() {
  const [rangeId, setRangeId] = useState('5y');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const range = RANGES.find(item => item.id === rangeId) ?? RANGES.find(item => item.id === '5y');

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch('/api/japan-leverage')
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => { if (live) setData(payload); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  const win = useMemo(() => (data
    ? windowed(data.dates, { purchases: data.purchases, sales: data.sales, ratio: data.ratio }, range)
    : null), [data, range]);

  const toggles = (
    <div className="lev-toggles">
      <div className="view-toggle">
        {RANGES.map(item => (
          <button
            key={item.id}
            className={`vt-btn${item.id === rangeId ? ' active' : ''}`}
            onClick={() => setRangeId(item.id)}
          >
            {item.label}
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
            ? `Japan leverage data unavailable: ${error}`
            : 'Loading Japan leverage data...'}
        </div>
      </>
    );
  }

  const latest = data.latest ?? {};
  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {METRICS.map(metric => (
            <Tile
              key={metric.key}
              label={metric.label}
              value={latest[metric.key] != null ? metric.fmt(latest[metric.key]) : '—'}
              color={metric.color}
            />
          ))}
        </div>
        {toggles}
      </div>

      {METRICS.map(metric => (
        <MetricPanel key={metric.key} metric={metric} win={win} />
      ))}
    </>
  );
}
