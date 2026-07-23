import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import { HSCI_META, HK_SECTIONS } from '../../config/hkPerformance';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';
import { rankChartsByLatestStrength } from '../../utils/chartRanking';

const PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y',  label: '1Y',  getStart: () => isoYearsAgo(1) },
  { id: '3y',  label: '3Y',  getStart: () => isoYearsAgo(3) },
  { id: '5y',  label: '5Y',  getStart: () => isoYearsAgo(5) },
];

const ROLLING_AVG_DAYS = 50;
// A 50-session moving average needs extra calendar days to cover weekends and holidays.
const ROLLING_FETCH_LOOKBACK_DAYS = 80;
const SECTOR_TICKERS = new Set([
  HSCI_META.ticker,
  ...HK_SECTIONS.find(section => section.title === 'Sector').tickers.map(meta => meta.ticker),
]);

function isoYearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysBefore(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - n);
  return date.toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

function rebase(closes) {
  const baseIdx = closes.findIndex(v => v != null);
  if (baseIdx === -1) return closes.map(() => null);
  const base = closes[baseIdx];
  return closes.map((v, i) => (i < baseIdx || v == null ? null : (v / base) * 100));
}

function rebaseAgainstIndex(values, baseIdx) {
  if (baseIdx < 0 || values[baseIdx] == null) return values.map(() => null);
  const base = values[baseIdx];
  return values.map(v => (v == null ? null : (v / base) * 100));
}

function rollingAverage(values, windowSize = 50) {
  const rollingWindow = [];
  let sum = 0;

  return values.map(v => {
    if (v == null || !Number.isFinite(v)) return null;

    rollingWindow.push(v);
    sum += v;
    if (rollingWindow.length > windowSize) sum -= rollingWindow.shift();

    return rollingWindow.length === windowSize ? sum / windowSize : null;
  });
}

function visibleBounds(dates, startDate, endDate) {
  const startIndex = dates.findIndex(d => d >= startDate);
  if (startIndex === -1) return null;

  let endIndex = -1;
  for (let i = dates.length - 1; i >= startIndex; i -= 1) {
    if (dates[i] <= endDate) {
      endIndex = i;
      break;
    }
  }

  return endIndex >= startIndex ? { startIndex, endIndex } : null;
}

function sliceBounds(values, bounds) {
  return values.slice(bounds.startIndex, bounds.endIndex + 1);
}

function firstValidIndex(values, bounds) {
  for (let i = bounds.startIndex; i <= bounds.endIndex; i += 1) {
    if (values[i] != null && Number.isFinite(values[i])) return i;
  }
  return -1;
}

// Dashed reference line at the rebased-100 baseline, drawn behind the series.
const BASELINE_100 = {
  id: 'hkPerfBaseline',
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

function findSeries(payload, ticker) {
  return payload.series.find(s => s.ticker === ticker);
}

function buildOverviewChartData(payload, startDate, endDate) {
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  if (!bounds) return null;

  const sectorMeta = new Map(
    HK_SECTIONS.find(section => section.title === 'Sector').tickers.map(meta => [meta.ticker, meta])
  );
  const datasets = payload.series
    .filter(series => SECTOR_TICKERS.has(series.ticker))
    .map(series => {
      const isBaseline = series.ticker === HSCI_META.ticker;
      const meta = isBaseline ? HSCI_META : sectorMeta.get(series.ticker);
      return {
        label: meta.name,
        fullName: meta.name,
        data: rebase(sliceBounds(series.closes, bounds)),
        borderColor: meta.color,
        backgroundColor: 'transparent',
        borderWidth: isBaseline ? 3 : 1.75,
        borderDash: isBaseline ? [6, 3] : undefined,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 6,
        tension: 0.15,
        spanGaps: true,
      };
    });

  return { labels: sliceBounds(payload.dates, bounds).map(fmtDate), datasets };
}

// Ratio chart for a single ticker vs the HSCI baseline.
function buildPairChartData(payload, numMeta, denMeta, startDate, endDate) {
  const numSeries = findSeries(payload, numMeta.ticker);
  const denSeries = findSeries(payload, denMeta.ticker);
  if (!numSeries || !denSeries) return null;
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  if (!bounds) return null;

  const ratios = numSeries.closes.map((close, i) => {
    const denClose = denSeries.closes[i];
    return close != null && denClose != null && denClose !== 0 ? close / denClose : null;
  });
  const baseIndex = firstValidIndex(ratios, bounds);
  const rebasedRatios = rebaseAgainstIndex(ratios, baseIndex);
  const rollingAvg = rollingAverage(rebasedRatios, ROLLING_AVG_DAYS);
  const pairLabel = `${numMeta.label}/${denMeta.label}`;

  return {
    labels: sliceBounds(payload.dates, bounds).map(fmtDate),
    datasets: [
      {
        label: pairLabel,
        fullName: `${numMeta.name} relative to ${denMeta.name}`,
        data: sliceBounds(rebasedRatios, bounds),
        ratios: sliceBounds(ratios, bounds),
        borderColor: numMeta.color,
        backgroundColor: 'transparent',
        borderWidth: 2.25,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 6,
        tension: 0.15,
        spanGaps: true,
      },
      {
        label: '50D avg',
        fullName: `${pairLabel} rolling 50-day average`,
        data: sliceBounds(rollingAvg, bounds),
        borderColor: 'rgba(234,234,224,.78)',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHoverRadius: 2,
        pointHitRadius: 6,
        tension: 0.15,
        spanGaps: true,
      },
    ],
  };
}

function chartOptions({ relative = false, compact = false } = {}) {
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
          padding: compact ? 6 : 8,
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
            if (relative) {
              const ratio = c.dataset.ratios?.[c.dataIndex];
              const ratioText = Number.isFinite(ratio) ? `, ratio ${ratio.toFixed(5)}` : '';
              return ` ${c.dataset.label}: ${v.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% rel)${ratioText}`;
            }
            return ` ${c.dataset.label}: ${v.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
          },
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: compact ? 6 : 10, autoSkip: true }, border: BORD },
      y: {
        grid: GRID,
        ticks: { ...TICK, maxTicksLimit: compact ? 5 : 8, callback: v => v.toFixed(0) },
        border: BORD,
      },
    },
  };
}

export default function HkPerformance({ section = null }) {
  const { liveData } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [payload, setPayload] = useState(() => liveData?.hkPerformanceDefault ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchStartDate = useMemo(
    () => isoDaysBefore(startDate, ROLLING_FETCH_LOOKBACK_DAYS),
    [startDate]
  );
  // The default 1-year-to-today window DataContext preloads on app visit —
  // captured once so later comparisons aren't thrown off by "today" ticking over.
  const defaults = useRef({ start: isoYearsAgo(1), end: todayIso() }).current;
  const isDefaultWindow = startDate === defaults.start && endDate === defaults.end;

  useEffect(() => {
    if (isDefaultWindow && liveData?.hkPerformanceDefault) {
      setPayload(liveData.hkPerformanceDefault);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start: fetchStartDate, end: endDate });
    fetch(`/api/hk-performance?${params}`)
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) { setPayload(data); setLoading(false); } })
      .catch(fetchError => { if (live) { setError(fetchError.message); setLoading(false); } });
    return () => { live = false; };
  }, [fetchStartDate, endDate, isDefaultWindow, liveData?.hkPerformanceDefault]);

  const overviewChartData = useMemo(
    () => (payload ? buildOverviewChartData(payload, startDate, endDate) : null),
    [payload, startDate, endDate]
  );

  const sectionCharts = useMemo(() => {
    if (!payload) return [];
    return HK_SECTIONS.map(section => ({
      title: section.title,
      charts: section.tickers
        .map(meta => ({ id: meta.ticker, title: meta.name, data: buildPairChartData(payload, meta, HSCI_META, startDate, endDate) }))
        .filter(chart => chart.data),
    })).filter(section => section.charts.length > 0);
  }, [payload, startDate, endDate]);
  const maxDate = todayIso();

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

  const ratioGrid = (charts) => (
    <div className="usp-etf-grid">
      {rankChartsByLatestStrength(charts).map(({ id, title, data }) => (
        <ChartCard
          key={id}
          title={title}
          src="East Money"
          freq="Daily"
          height={255}
        >
          <Line data={data} options={chartOptions({ relative: true, compact: true })} plugins={[BASELINE_100]} />
        </ChartCard>
      ))}
    </div>
  );

  const activeSectionCharts = sectionCharts.find(s => s.title === section);

  return (
    <>
      {controls}
      {section == null && (
        <div className="cgrid">
          <ChartCard
            title="Aggregate Performance"
            src="Hang Seng Indexes"
            freq="Daily"
            span2
            height={480}
          >
            {error ? (
              <div className="empty">Could not load HK performance data: {error}</div>
            ) : !overviewChartData ? (
              <div className="empty">{loading ? 'Loading HK performance data…' : 'No data'}</div>
            ) : (
              <Line data={overviewChartData} options={chartOptions()} plugins={[BASELINE_100]} />
            )}
          </ChartCard>
        </div>
      )}
      {section != null && <div className="usp-section-label">{section}</div>}

      {section != null && error ? (
        <div className="empty">Could not load HK performance data: {error}</div>
      ) : section != null && !payload ? (
        <div className="empty">{loading ? 'Loading HK performance data…' : 'No data'}</div>
      ) : section != null && activeSectionCharts ? (
        ratioGrid(activeSectionCharts.charts)
      ) : section != null ? (
        <div className="empty">No data</div>
      ) : null}
    </>
  );
}
