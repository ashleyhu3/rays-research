import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { GLOBAL_INDICES, BREADTH_PHASE1_KEYS } from '../../config/globalIndices';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';

const PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y',  label: '1Y',  getStart: () => isoYearsAgo(1) },
  { id: '3y',  label: '3Y',  getStart: () => isoYearsAgo(3) },
  { id: 'all', label: 'All', getStart: () => '2000-01-01' },
];

const INDEX_BY_KEY = new Map(GLOBAL_INDICES.map(idx => [idx.key, idx]));
const TURNOVER_KEYS = GLOBAL_INDICES.filter(idx => idx.turnoverSource).map(idx => idx.key);

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

function visibleBounds(dates, startDate, endDate) {
  const startIndex = dates.findIndex(d => d >= startDate);
  if (startIndex === -1) return null;
  let endIndex = -1;
  for (let i = dates.length - 1; i >= startIndex; i -= 1) {
    if (dates[i] <= endDate) { endIndex = i; break; }
  }
  return endIndex >= startIndex ? { startIndex, endIndex } : null;
}

function sliceBounds(values, bounds) {
  return values.slice(bounds.startIndex, bounds.endIndex + 1);
}

function findSeries(payload, ticker) {
  return payload?.series?.find(s => s.ticker === ticker);
}

// Rolling N-trading-day average — same "N valid values, gaps don't reset
// the window" semantics used server-side in indexBreadth.js.
function rollingAverage(values, windowSize) {
  const window = [];
  let sum = 0;
  return values.map(v => {
    if (v == null || !Number.isFinite(v)) return null;
    window.push(v);
    sum += v;
    if (window.length > windowSize) sum -= window.shift();
    return window.length === windowSize ? sum / windowSize : null;
  });
}

// Standard 14-period Wilder's-smoothing RSI. `rsi[i]` needs `period`
// consecutive valid day-over-day changes ending at i to seed; a gap forces
// re-seeding rather than fabricating a value across the gap.
function computeRsi(closes, period = 14) {
  const n = closes.length;
  const changes = new Array(n).fill(null);
  for (let i = 1; i < n; i += 1) {
    changes[i] = closes[i] != null && closes[i - 1] != null ? closes[i] - closes[i - 1] : null;
  }

  const rsi = new Array(n).fill(null);
  let avgGain = null;
  let avgLoss = null;
  for (let i = 1; i < n; i += 1) {
    const change = changes[i];
    if (change == null) { avgGain = null; avgLoss = null; continue; }
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (avgGain == null) {
      if (i < period) continue;
      let sumGain = 0, sumLoss = 0, ok = true;
      for (let k = i - period + 1; k <= i; k += 1) {
        if (changes[k] == null) { ok = false; break; }
        sumGain += Math.max(changes[k], 0);
        sumLoss += Math.max(-changes[k], 0);
      }
      if (!ok) continue;
      avgGain = sumGain / period;
      avgLoss = sumLoss / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    rsi[i] = avgGain === 0 && avgLoss === 0 ? 50 : avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function tooltipBase() {
  return {
    backgroundColor: '#1a1f2a',
    borderColor: 'rgba(255,255,255,.12)',
    borderWidth: 1,
    titleFont: { family: "'Inter',sans-serif", size: 11 },
    bodyFont: { family: "'Inter',sans-serif", size: 11 },
    padding: 10,
  };
}

function legendBase() {
  return {
    display: true,
    position: 'bottom',
    labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10 },
  };
}

function breadthChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: legendBase(),
      tooltip: {
        ...tooltipBase(),
        callbacks: { label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%`) },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
      y: { min: 0, max: 100, grid: GRID, ticks: { ...TICK, stepSize: 20, callback: v => `${v}%` }, border: BORD },
    },
  };
}

function pctUpChartOptions() {
  const opts = breadthChartOptions();
  opts.scales.y.min = 0;
  opts.scales.y.max = 100;
  return opts;
}

// Dashed 30/50/70 reference lines behind the RSI series.
const RSI_REF_LINES = {
  id: 'rsiRefLines',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(234,234,224,.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const level of [30, 50, 70]) {
      const y = scales.y.getPixelForValue(level);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
    }
    ctx.restore();
  },
};

function rsiChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: legendBase(),
      tooltip: {
        ...tooltipBase(),
        callbacks: { label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}`) },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: { min: 0, max: 100, grid: GRID, ticks: { ...TICK, stepSize: 10, callback: v => v.toFixed(0) }, border: BORD },
    },
  };
}

function turnoverChartOptions(fmt) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: legendBase(),
      tooltip: {
        ...tooltipBase(),
        callbacks: { label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${fmt(c.parsed.y)}`) },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
      y: { grid: GRID, ticks: { ...TICK, callback: v => fmt(v) }, border: BORD, beginAtZero: true },
    },
  };
}

function fmtTurnover(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
}

const SECTION_LABELS = { breadth: 'Breadth', technical: 'Technical', turnover: 'Turnover' };

export default function GlobalPerformance({ section = null }) {
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const maxDate = todayIso();

  const [indicesPayload, setIndicesPayload] = useState(null);
  const [indicesError, setIndicesError] = useState(null);
  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ start: '2000-01-01', end: maxDate });
    fetch(`/api/global-indices?${params}`)
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) setIndicesPayload(data); })
      .catch(fetchError => { if (live) setIndicesError(fetchError.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [breadthPayload, setBreadthPayload] = useState(null);
  const [breadthError, setBreadthError] = useState(null);
  useEffect(() => {
    let live = true;
    fetch('/api/index-breadth')
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) setBreadthPayload(data); })
      .catch(fetchError => { if (live) setBreadthError(fetchError.message); });
    return () => { live = false; };
  }, []);

  const breadthCharts = useMemo(() => {
    if (!breadthPayload) return [];
    return BREADTH_PHASE1_KEYS.map(key => {
      const series = breadthPayload[key];
      const meta = INDEX_BY_KEY.get(key);
      if (!series?.dates?.length) return null;
      const bounds = visibleBounds(series.dates, startDate, endDate);
      if (!bounds) return null;
      return {
        key,
        title: meta.label,
        data: {
          labels: sliceBounds(series.dates, bounds).map(fmtDate),
          datasets: [
            { label: '% above 50d & 200d MA', data: sliceBounds(series.pctAboveBoth, bounds), borderColor: '#4ade80', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.15, spanGaps: true },
            { label: '% below 50d & 200d MA', data: sliceBounds(series.pctBelowBoth, bounds), borderColor: '#f87171', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.15, spanGaps: true },
          ],
        },
      };
    }).filter(Boolean);
  }, [breadthPayload, startDate, endDate]);

  const pctUpChart = useMemo(() => {
    if (!breadthPayload) return null;
    const dateSet = new Set();
    for (const key of BREADTH_PHASE1_KEYS) for (const d of breadthPayload[key]?.dates ?? []) dateSet.add(d);
    const allDates = [...dateSet].sort();
    const bounds = visibleBounds(allDates, startDate, endDate);
    if (!bounds) return null;
    const labels = sliceBounds(allDates, bounds).map(fmtDate);
    const datasets = BREADTH_PHASE1_KEYS.map(key => {
      const series = breadthPayload[key];
      const meta = INDEX_BY_KEY.get(key);
      if (!series?.dates?.length) return null;
      const byDate = new Map(series.dates.map((d, i) => [d, series.pctUp[i]]));
      return {
        label: meta.label,
        data: sliceBounds(allDates, bounds).map(d => byDate.get(d) ?? null),
        borderColor: meta.color,
        backgroundColor: 'transparent',
        borderWidth: 1.75,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 6,
        tension: 0.15,
        spanGaps: true,
      };
    }).filter(Boolean);
    return datasets.length ? { labels, datasets } : null;
  }, [breadthPayload, startDate, endDate]);

  const rsiChart = useMemo(() => {
    if (!indicesPayload) return null;
    const bounds = visibleBounds(indicesPayload.dates, startDate, endDate);
    if (!bounds) return null;
    const labels = sliceBounds(indicesPayload.dates, bounds).map(fmtDate);
    const datasets = GLOBAL_INDICES.map(meta => {
      const series = findSeries(indicesPayload, meta.key);
      if (!series) return null;
      const rsi = computeRsi(series.closes, 14);
      return {
        label: meta.label,
        data: sliceBounds(rsi, bounds),
        borderColor: meta.color,
        backgroundColor: 'transparent',
        borderWidth: 1.75,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 6,
        tension: 0.15,
        spanGaps: true,
      };
    }).filter(Boolean);
    return datasets.length ? { labels, datasets } : null;
  }, [indicesPayload, startDate, endDate]);

  const turnoverCharts = useMemo(() => {
    if (!indicesPayload) return [];
    return TURNOVER_KEYS.map(key => {
      const meta = INDEX_BY_KEY.get(key);
      const series = findSeries(indicesPayload, key);
      if (!series) return null;
      const bounds = visibleBounds(indicesPayload.dates, startDate, endDate);
      if (!bounds) return null;
      const turnover = sliceBounds(series.turnover, bounds);
      // Rolling average is computed against the full series (not the visible
      // slice) so the window has access to data before the visible start date.
      const avg20Sliced = sliceBounds(rollingAverage(series.turnover, 20), bounds);
      if (turnover.every(v => v == null)) return null;
      return {
        key,
        title: meta.label,
        data: {
          labels: sliceBounds(indicesPayload.dates, bounds).map(fmtDate),
          datasets: [
            { label: 'Turnover', data: turnover, borderColor: meta.color, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.1, spanGaps: true },
            { label: '20D avg', data: avg20Sliced, borderColor: 'rgba(234,234,224,.78)', backgroundColor: 'transparent', borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 2, pointHitRadius: 6, tension: 0.15, spanGaps: true },
          ],
        },
      };
    }).filter(Boolean);
  }, [indicesPayload, startDate, endDate]);

  const controls = (
    <div className="usp-head">
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
        {PRESETS.map(p => (
          <button
            key={p.id}
            className={`vt-btn${p.getStart() === startDate && endDate === maxDate ? ' active' : ''}`}
            onClick={() => { setStartDate(p.getStart()); setEndDate(maxDate); }}
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
      {section != null && <div className="usp-section-label">{SECTION_LABELS[section] ?? section}</div>}

      {section === 'breadth' && (
        <>
          <div className="usp-etf-grid">
            {breadthCharts.map(chart => (
              <ChartCard key={chart.key} title={chart.title} src="Yahoo Finance" srcUrl="https://finance.yahoo.com" freq="Daily" height={255}>
                <Line data={chart.data} options={breadthChartOptions()} />
              </ChartCard>
            ))}
          </div>
          {breadthError && <div className="empty">Could not load breadth data: {breadthError}</div>}
          {!breadthPayload && !breadthError && <div className="empty">Loading breadth data…</div>}
          {pctUpChart && (
            <div className="cgrid" style={{ marginTop: 16 }}>
              <ChartCard title="% of Stocks Up" src="Yahoo Finance" srcUrl="https://finance.yahoo.com" freq="Daily" span2 height={340}>
                <Line data={pctUpChart} options={pctUpChartOptions()} />
              </ChartCard>
            </div>
          )}
          <div className="src-note" style={{ marginTop: 12 }}>
            Breadth currently covers S&amp;P 500, Nasdaq 100, SOX, Hang Seng, CSI 300, and Nikkei 225 — ChiNext, TAIEX, KOSPI 200 and TOPIX are not yet available (no confirmed constituent-level data source).
          </div>
        </>
      )}

      {section === 'technical' && (
        <div className="cgrid">
          {rsiChart ? (
            <ChartCard title="14-Day RSI — All Indices" src="Yahoo Finance / East Money" freq="Daily" span2 height={420}>
              <Line data={rsiChart} options={rsiChartOptions()} plugins={[RSI_REF_LINES]} />
            </ChartCard>
          ) : indicesError ? (
            <div className="empty">Could not load index price data: {indicesError}</div>
          ) : (
            <div className="empty">Loading index price data…</div>
          )}
        </div>
      )}

      {section === 'turnover' && (
        <>
          <div className="usp-etf-grid">
            {turnoverCharts.map(chart => (
              <ChartCard key={chart.key} title={chart.title} src="Yahoo Finance / East Money" freq="Daily" height={255}>
                <Line data={chart.data} options={turnoverChartOptions(fmtTurnover)} />
              </ChartCard>
            ))}
          </div>
          {indicesError && <div className="empty">Could not load turnover data: {indicesError}</div>}
          {!indicesPayload && !indicesError && <div className="empty">Loading turnover data…</div>}
          <div className="src-note" style={{ marginTop: 12 }}>
            KOSPI 200 and TOPIX turnover are not yet available (Yahoo has no reliable volume for these, and they're not part of Phase-1 Breadth yet, which is the other route to a turnover figure).
          </div>
        </>
      )}
    </>
  );
}
