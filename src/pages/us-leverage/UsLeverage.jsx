import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';

const SURFACE = '#111419';
const MUTED = '#8a8a84';

const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const GOLD = '#c9a227';
const PURPLE = '#7864b4';
const GREEN = '#4a9b6e';

const ETF_COLOR = PURPLE;

function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

const MARKED_POINTS = {
  id: 'usLeverageMarkedPoints',
  afterDatasetsDraw(chart, _args, options) {
    const { ctx, chartArea } = chart;
    const dsIndex = options.datasetIndex ?? 0;
    const points = chart.getDatasetMeta(dsIndex).data;
    const color = options.color ?? chart.data.datasets[dsIndex].borderColor;

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

const fmtBillions = v => (v == null ? '—' : `$${v.toFixed(2)}B`);
const fmtContracts = v => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
};

const PRESETS = [
  { id: '3m', label: '3M', getStart: () => isoMonthsAgo(3) },
  { id: '12m', label: '12M', getStart: () => isoMonthsAgo(12) },
  { id: '18m', label: '18M', getStart: () => isoMonthsAgo(18) },
  { id: '5y', label: '5Y', getStart: () => isoMonthsAgo(60) },
  { id: 'all', label: 'All', getStart: () => '2000-01-01' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

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

function windowBounds(dates, startDate, endDate) {
  let from = dates.findIndex(d => d >= startDate);
  if (from < 0) from = 0;
  let to = dates.length - 1;
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    if (dates[i] <= endDate) { to = i; break; }
  }
  if (to < from) to = dates.length - 1;
  return { from, to };
}

/** Slice every series in `seriesMap` to the selected [startDate, endDate] window. */
function windowed(dates, seriesMap, startDate, endDate) {
  if (!dates?.length) return null;
  const { from, to } = windowBounds(dates, startDate, endDate);
  const cut = arr => (arr ?? []).slice(from, to + 1);
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
      usLeverageMarkedPoints: { marks: metricMarks(win, metric), color: metric.color },
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

function SourceLink({ label, url, color }) {
  return (
    <span className="lev-srcs">
      <a className="ch-src" href={url} target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: color }} />{label}
      </a>
    </span>
  );
}

function MetricPanel({ chartId, title, metric, win, freq, lag, src, srcNote }) {
  const chart = (
    <Line data={metricChartData(win, metric)} options={metricChartOptions(win, metric)} plugins={[MARKED_POINTS]} />
  );
  return (
    <ChartCard
      chartId={chartId}
      title={title}
      src={src}
      freq={freq}
      lag={lag}
      span2
      height={320}
      legend={[[metric.label, metric.color]]}
      srcNote={srcNote}
    >
      {chart}
    </ChartCard>
  );
}

/* ── 1. FINRA margin debt ───────────────────────────────────────────── */

const MARGIN_METRIC = { key: 'debit', label: "Debit Balances in Customers' Securities Margin Accounts", color: BLUE, fmt: fmtBillions };
const MARGIN_SRC_NOTE = 'FINRA Rule 4521(d) monthly margin statistics — plotted at that native monthly cadence with no interpolation between points. '
  + 'This is customer debit balances only, i.e. cash-equity margin debt; it does not include FINRA\'s daily short-sale volume, which is a different report and is not treated as margin debt or short interest here.';

function MarginDebtPanel({ data, startDate, endDate }) {
  const win = useMemo(() => (data
    ? windowed(data.dates, { debit: data.values }, startDate, endDate) : null), [data, startDate, endDate]);
  if (!win) {
    return (
      <ChartCard chartId="us-leverage-margin-debt" title="US · FINRA Customer Margin Debt" freq="Monthly" span2 height={320}>
        <div className="empty">Loading FINRA margin debt…</div>
      </ChartCard>
    );
  }
  return (
    <MetricPanel
      chartId="us-leverage-margin-debt"
      title="US · FINRA Customer Margin Debt"
      metric={MARGIN_METRIC}
      win={win}
      freq="Monthly"
      lag="Published ~3rd week of the following month"
      src={<SourceLink label="FINRA Margin Statistics" url="https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics" color={BLUE} />}
      srcNote={MARGIN_SRC_NOTE}
    />
  );
}

/* ── 2. CFTC TFF leveraged-fund equity-index futures ───────────────── */

const CFTC_OI_COLOR = '#d0d3cb';
const CFTC_MARKETS = [
  { key: 'ES', label: 'E-mini S&P 500', color: BLUE },
  { key: 'NQ', label: 'E-mini Nasdaq-100', color: ORANGE },
  { key: 'RTY', label: 'E-mini Russell 2000', color: PURPLE },
  { key: 'YM', label: 'Dow Jones $5 Index', color: GREEN },
];

const CFTC_LAYERS = [
  { key: 'long', label: 'Leveraged Funds Long', color: BLUE },
  { key: 'short', label: 'Leveraged Funds Short', color: ORANGE },
  { key: 'spreading', label: 'Leveraged Funds Spreading', color: GOLD },
];

const CFTC_NOTE = 'CFTC Traders in Financial Futures report, futures-only. The stacked layers are direct source-published '
  + 'Leveraged Funds long, short, and spreading positions; the Total Open Interest line is the direct source-published market total. '
  + 'No long/short netting or notional conversion is applied.';

function cftcStack(values) {
  const parts = CFTC_LAYERS.map(layer => values?.[layer.key]).filter(Number.isFinite);
  if (!parts.length) return null;
  return parts.reduce((sum, value) => sum + value, 0);
}

function cftcStackSeries(win) {
  return win.dates.map((_, index) => CFTC_LAYERS.reduce(
    (sum, layer) => sum + (Number(win.series[layer.key]?.[index]) || 0),
    0,
  ));
}

function cftcLayerBoundarySeries(win, layerIndex) {
  return win.dates.map((_, index) => CFTC_LAYERS.slice(0, layerIndex + 1).reduce(
    (sum, layer) => sum + (Number(win.series[layer.key]?.[index]) || 0),
    0,
  ));
}

function cftcMarks(win) {
  const values = cftcStackSeries(win);
  const marks = MARKED_DATES.map(target => {
    const index = sessionIndex(win.dates, target);
    if (index < 0 || !Number.isFinite(values[index])) return null;
    return { index, date: markedDate(win.dates[index]), value: fmtContracts(values[index]), anchor: 'center' };
  }).filter(Boolean);

  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;
  if (latestIndex >= 0) {
    marks.push({ index: latestIndex, date: markedDate(win.dates[latestIndex]), value: fmtContracts(values[latestIndex]), anchor: 'right' });
  }
  return marks;
}

function cftcChartData(win) {
  const long = win.dates.length > 100;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: [
      ...CFTC_LAYERS.map((layer, index) => ({
        label: layer.label,
        sourceKey: layer.key,
        data: cftcLayerBoundarySeries(win, index),
        backgroundColor: alpha(layer.color, 0.42),
        borderColor: layer.color,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: layer.color,
        pointHoverBorderColor: SURFACE,
        pointHoverBorderWidth: 2,
        tension: 0.22,
        fill: index === 0 ? 'origin' : '-1',
      })),
      {
        label: 'Total Open Interest',
        data: win.series.totalOpenInterest,
        backgroundColor: alpha(CFTC_OI_COLOR, 0),
        borderColor: CFTC_OI_COLOR,
        borderWidth: 1.6,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: CFTC_OI_COLOR,
        pointHoverBorderColor: SURFACE,
        pointHoverBorderWidth: 2,
        tension: 0.18,
        fill: false,
      },
    ],
  };
}

function cftcChartOptions(win, market) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 18 } },
    plugins: {
      legend: { display: false },
      usLeverageMarkedPoints: { marks: cftcMarks(win), color: market.color, datasetIndex: CFTC_LAYERS.length - 1 },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => {
            const sourceKey = context.dataset.sourceKey;
            const value = sourceKey ? win.series[sourceKey]?.[context.dataIndex] : context.raw;
            return ` ${context.dataset.label}: ${fmtContracts(value)}`;
          },
          afterBody: items => {
            if (!items.length) return [];
            const index = items[0].dataIndex;
            const stack = CFTC_LAYERS.reduce((sum, layer) => sum + (Number(win.series[layer.key]?.[index]) || 0), 0);
            return [` Leveraged-fund stack: ${fmtContracts(stack)}`];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0, padding: 3, font: { size: 10 } },
      },
      y: {
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => fmtContracts(Number(value)), font: { size: 10 } },
      },
    },
  };
}

function CftcSourceLink({ color }) {
  return (
    <span className="lev-srcs">
      <a className="ch-src" href="https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm" target="_blank" rel="noopener noreferrer">
        <span className="lev-dot" style={{ background: color }} />CFTC Traders in Financial Futures
      </a>
    </span>
  );
}

function CftcPanel({ market, series, startDate, endDate }) {
  const win = useMemo(() => (series
    ? windowed(series.dates, {
      long: series.long,
      short: series.short,
      spreading: series.spreading,
      totalOpenInterest: series.totalOpenInterest,
    }, startDate, endDate) : null), [series, startDate, endDate]);

  if (!win) {
    return (
      <ChartCard chartId={`us-leverage-cftc-${market.key}`} title={`US · Equity Index Futures Positions — ${market.label} (${market.key})`} freq="Weekly" span2 height={320}>
        <div className="empty">Loading {market.key} leveraged-fund positions…</div>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      chartId={`us-leverage-cftc-${market.key}`}
      title={`US · Equity Index Futures Positions — ${market.label} (${market.key})`}
      src={<CftcSourceLink color={market.color} />}
      freq="Weekly"
      lag="Tuesday positions, released Friday"
      span2
      height={320}
      legend={[
        ...CFTC_LAYERS.map(layer => [layer.label.replace('Leveraged Funds ', ''), layer.color]),
        ['Total OI', CFTC_OI_COLOR],
      ]}
      srcNote={CFTC_NOTE}
    >
      <Line data={cftcChartData(win)} options={cftcChartOptions(win, market)} plugins={[MARKED_POINTS]} />
    </ChartCard>
  );
}

/* ── 3. Leveraged ETF net assets — chart + fund table, same shape as
   JapanLeverage.jsx's EtfPanel/EtfFundTable. ───────────────────────── */

const ETF_FMT = v => (v == null ? '—' : `$${v.toFixed(2)}B`);

function etfChartData(win) {
  const long = win.dates.length > 100;
  return {
    labels: win.dates.map(long ? monthLabel : dayLabel),
    datasets: [{
      label: 'Net assets',
      data: win.series.total,
      backgroundColor: alpha(ETF_COLOR, 0.38),
      borderColor: ETF_COLOR,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: ETF_COLOR,
      pointHoverBorderColor: SURFACE,
      pointHoverBorderWidth: 2,
      tension: 0.25,
      fill: 'origin',
    }],
  };
}

function etfMarks(win) {
  const values = win.series.total ?? [];
  const marks = MARKED_DATES.map(target => {
    const index = sessionIndex(win.dates, target);
    if (index < 0 || !Number.isFinite(values[index])) return null;
    return { index, date: markedDate(win.dates[index]), value: ETF_FMT(values[index]), anchor: 'center' };
  }).filter(Boolean);

  let latestIndex = values.length - 1;
  while (latestIndex >= 0 && !Number.isFinite(values[latestIndex])) latestIndex -= 1;
  if (latestIndex >= 0) {
    marks.push({ index: latestIndex, date: markedDate(win.dates[latestIndex]), value: ETF_FMT(values[latestIndex]), anchor: 'right' });
  }
  return marks;
}

function etfChartOptions(win) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 16, right: 8, bottom: 18 } },
    plugins: {
      legend: { display: false },
      usLeverageMarkedPoints: { marks: etfMarks(win), color: ETF_COLOR },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        padding: 10,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        callbacks: {
          title: items => (items.length ? win.dates[items[0].dataIndex] : ''),
          label: context => ` Net assets: ${ETF_FMT(context.raw)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: MUTED, maxTicksLimit: 12, autoSkip: true, maxRotation: 0, padding: 3, font: { size: 10 } },
      },
      y: {
        beginAtZero: true,
        grace: '5%',
        grid: { color: 'rgba(255,255,255,.07)' },
        ticks: { color: MUTED, callback: value => ETF_FMT(Number(value)), font: { size: 10 } },
      },
    },
  };
}

function EtfFundTable({ funds, layerTotal }) {
  return (
    <table className="lev-table">
      <thead>
        <tr>
          <th>Fund</th>
          <th>Issuer</th>
          <th>Leverage</th>
          <th>Underlying</th>
          <th className="num">Net assets</th>
          <th className="num">Share of total</th>
        </tr>
      </thead>
      <tbody>
        {funds.map(fund => (
          <tr key={fund.key}>
            <td>{fund.label} <span className="lev-code">{fund.key}</span></td>
            <td className="lev-kind">{fund.issuer}</td>
            <td className="lev-kind">{fund.leverage}</td>
            <td className="lev-kind">{fund.underlying}</td>
            <td className="num">{ETF_FMT(fund.aum)}</td>
            <td className="num">
              {layerTotal ? `${((fund.aum / layerTotal) * 100).toFixed(1)}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EtfSourceLinks() {
  const sources = [
    { label: 'ProShares fund data', url: 'https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq', color: BLUE },
    { label: 'Direxion fund data', url: 'https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs', color: ORANGE },
  ];
  return (
    <span className="lev-srcs">
      {sources.map(entry => (
        <a key={entry.label} className="ch-src" href={entry.url} target="_blank" rel="noopener noreferrer">
          <span className="lev-dot" style={{ background: entry.color }} />{entry.label}
        </a>
      ))}
    </span>
  );
}

const ETF_NOTE = 'Each figure is the fund\'s own officially disclosed net assets (AUM) — never AUM multiplied by the fund\'s leverage factor. '
  + 'All nine are long/bull leveraged products (2x or 3x), so the chart\'s total is a like-for-like sum; it is not an aggregate the issuers publish '
  + 'themselves.';

function EtfPanel({ win, funds, fundsDate, layerTotal }) {
  const rows = funds?.length ?? 0;

  if (!win || !win.dates.length) {
    return (
      <ChartCard
        chartId="us-leverage-etf"
        title="US · Leveraged Equity ETF Net Assets"
        src={<EtfSourceLinks />}
        freq="Daily"
        lag="Issuer sites, same-day"
        span2
        height={320}
        srcNote={ETF_NOTE}
      >
        <div className="empty">Loading leveraged ETF net assets…</div>
      </ChartCard>
    );
  }

  const chart = (
    <Line data={etfChartData(win)} options={etfChartOptions(win)} plugins={[MARKED_POINTS]} />
  );

  return (
    <ChartCard
      chartId="us-leverage-etf"
      title="US · Leveraged Equity ETF Net Assets"
      src={<EtfSourceLinks />}
      freq="Daily"
      lag="Issuer sites, same-day"
      span2
      height={Math.max(430, 340 + rows * 32)}
      legend={[['Net assets', ETF_COLOR]]}
      srcNote={ETF_NOTE}
    >
      <div className="lev-chart-table">
        <div className="lev-layer-chart">{chart}</div>
        <div className="lev-table-wrap">
          <EtfFundTable funds={funds ?? []} layerTotal={layerTotal} />
        </div>
      </div>
      {fundsDate && <p className="opts-footer">Fund table as of {fundsDate}</p>}
    </ChartCard>
  );
}

/* ── Top-level tiles ────────────────────────────────────────────────── */

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

export default function UsLeverage() {
  const { liveData } = useData();
  const [startDate, setStartDate] = useState(() => isoMonthsAgo(12));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [data, setData] = useState(() => liveData?.usLeverage ?? null);
  const [error, setError] = useState(null);

  const maxDate = todayIso();

  // Preloaded by DataContext on app visit — only fetch here if that hasn't
  // landed yet (e.g. this key failed server-side while others succeeded).
  useEffect(() => {
    if (liveData?.usLeverage) { setData(liveData.usLeverage); return undefined; }
    let live = true;
    fetch('/api/us-leverage')
      .then(response => (response.ok
        ? response.json()
        : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(payload => { if (live) setData(payload); })
      .catch(fetchError => { if (live) setError(fetchError.message); });
    return () => { live = false; };
  }, [liveData?.usLeverage]);

  const etfWin = useMemo(
    () => (data?.leveragedEtf ? windowed(data.leveragedEtf.dates, { total: data.leveragedEtf.total }, startDate, endDate) : null),
    [data, startDate, endDate],
  );

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

  if (error || !data) {
    return (
      <>
        <div className="lev-head"><div />{toggles}</div>
        <div className="empty">
          {error ? `US leverage data unavailable: ${error}` : 'Loading US leverage data...'}
        </div>
      </>
    );
  }

  const tiles = [
    { label: MARGIN_METRIC.label, value: fmtBillions(data.marginDebt?.latest?.value), color: MARGIN_METRIC.color },
    ...CFTC_MARKETS.map(market => ({
      label: `${market.key} Leveraged Funds`,
      value: fmtContracts(cftcStack(data.cftc?.contracts?.[market.key]?.latest)),
      color: market.color,
    })),
    { label: 'Leveraged ETF Net Assets', value: ETF_FMT(data.leveragedEtf?.total?.at(-1)), color: ETF_COLOR },
  ];

  return (
    <>
      <div className="lev-head">
        <div className="lev-stats">
          {tiles.map(tile => <Tile key={tile.label} {...tile} />)}
        </div>
        {toggles}
      </div>

      <MarginDebtPanel data={data.marginDebt} startDate={startDate} endDate={endDate} />

      {CFTC_MARKETS.map(market => (
        <CftcPanel
          key={market.key}
          market={market}
          series={data.cftc?.contracts?.[market.key]}
          startDate={startDate}
          endDate={endDate}
        />
      ))}

      <EtfPanel
        win={etfWin}
        funds={data.leveragedEtf?.funds}
        fundsDate={data.leveragedEtf?.fundsDate}
        layerTotal={data.leveragedEtf?.total?.at(-1)}
      />
    </>
  );
}
