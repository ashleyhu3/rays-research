import { useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import {
  CSI300_META,
  HK_CHINA_EXTRA_INDEX_PAIRS,
  HK_CHINA_INDEX_TICKERS,
  HK_CHINA_SECTIONS,
} from '../../config/hkChinaPerformance';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';

const PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y',  label: '1Y',  getStart: () => isoYearsAgo(1) },
  { id: '3y',  label: '3Y',  getStart: () => isoYearsAgo(3) },
  { id: '5y',  label: '5Y',  getStart: () => isoYearsAgo(5) },
];

const INDEX_TICKERS = new Set([...HK_CHINA_INDEX_TICKERS.map(t => t.ticker), CSI300_META.ticker]);
// ChiNext and STAR50 are fetched from East Money server-side (see
// server/scrapers/hkChinaPerformance.js) — Yahoo has no daily history for
// those two raw index instruments.
const EASTMONEY_TICKERS = new Set(['399006.SZ', '000688.SS']);
const ROLLING_AVG_DAYS = 50;
// A 50-session moving average needs extra calendar days to cover weekends and holidays.
const ROLLING_FETCH_LOOKBACK_DAYS = 80;

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

// Rebase a raw close-price series to 100 at its first available value —
// a series that starts trading after `start` (a recently-listed ETF) is
// simply rebased to its own first print instead of showing nulls throughout.
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
  id: 'hkChinaPerfBaseline',
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

const PREMIUM_ZERO_LINE = {
  id: 'chinaEtfPremiumZero',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const y = scales.y.getPixelForValue(0);
    if (y < chartArea.top || y > chartArea.bottom) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(234,234,224,.35)';
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

  // Only the indices + CSI300 belong in the aggregate chart — the sector
  // tickers ride along in the same payload but are rendered as their own
  // ratio-vs-CSI300 cards below, not overlaid here.
  const indexSeries = payload.series.filter(s => INDEX_TICKERS.has(s.ticker));
  const labels = sliceBounds(payload.dates, bounds).map(fmtDate);
  const datasets = indexSeries.map((s, i) => {
    const isBaseline = s.ticker === CSI300_META.ticker;
    const meta = HK_CHINA_INDEX_TICKERS.find(t => t.ticker === s.ticker);
    const color = isBaseline ? CSI300_META.color : (meta?.color ?? HK_CHINA_INDEX_TICKERS[i % HK_CHINA_INDEX_TICKERS.length].color);
    return {
      label: isBaseline ? CSI300_META.name : s.name,
      fullName: s.name,
      data: rebase(sliceBounds(s.closes, bounds)),
      borderColor: color,
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
  return { labels, datasets };
}

// Ratio chart for a single ticker vs the CSI300 baseline.
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

function buildPremiumChartData(series) {
  const points = series.points ?? [];
  return {
    labels: points.map(point => fmtDate(point.date)),
    datasets: [{
      label: `${series.ticker} premium`,
      data: points.map(point => point.premium),
      details: points,
      borderColor: series.color,
      backgroundColor: 'transparent',
      borderWidth: 2.25,
      pointRadius: points.map((_, index) => index === points.length - 1 ? 3.5 : 0),
      pointHoverRadius: 4,
      pointHitRadius: 7,
      tension: 0.15,
      spanGaps: true,
    }],
  };
}

function premiumChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: context => {
            const point = context.dataset.details?.[context.dataIndex];
            if (!point) return ` Premium: ${context.parsed.y.toFixed(2)}%`;
            return [
              ` Premium: ${point.premium >= 0 ? '+' : ''}${point.premium.toFixed(2)}%`,
              ` Market: ¥${point.marketPrice.toFixed(4)}`,
              ` ${point.navSource}: ¥${point.nav.toFixed(4)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 7, autoSkip: true }, border: BORD },
      y: {
        grid: GRID,
        ticks: { ...TICK, maxTicksLimit: 7, callback: value => `${Number(value).toFixed(1)}%` },
        border: BORD,
      },
    },
  };
}

export default function HkChinaPerformance({ section = null }) {
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [premiumPayload, setPremiumPayload] = useState(null);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumError, setPremiumError] = useState(null);
  const fetchStartDate = useMemo(
    () => isoDaysBefore(startDate, ROLLING_FETCH_LOOKBACK_DAYS),
    [startDate]
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start: fetchStartDate, end: endDate });
    fetch(`/api/hk-china-performance?${params}`)
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) { setPayload(data); setLoading(false); } })
      .catch(fetchError => { if (live) { setError(fetchError.message); setLoading(false); } });
    return () => { live = false; };
  }, [fetchStartDate, endDate]);

  useEffect(() => {
    if (section !== 'sentiment') return undefined;
    let live = true;
    setPremiumLoading(true);
    setPremiumError(null);
    const params = new URLSearchParams({ start: startDate, end: endDate });
    fetch(`/api/china-etf-premium?${params}`)
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) { setPremiumPayload(data); setPremiumLoading(false); } })
      .catch(fetchError => { if (live) { setPremiumError(fetchError.message); setPremiumLoading(false); } });
    return () => { live = false; };
  }, [section, startDate, endDate]);

  const overviewChartData = useMemo(
    () => (payload ? buildOverviewChartData(payload, startDate, endDate) : null),
    [payload, startDate, endDate]
  );
  const indexRatioCharts = useMemo(() => {
    if (!payload) return [];
    return HK_CHINA_INDEX_TICKERS
      .filter(meta => meta.ticker !== '800000' && meta.ticker !== '800700')
      .map(meta => ({ meta, data: buildPairChartData(payload, meta, CSI300_META, startDate, endDate) }))
      .filter(chart => chart.data);
  }, [payload, startDate, endDate]);
  const extraIndexRatioCharts = useMemo(() => {
    if (!payload) return [];
    return HK_CHINA_EXTRA_INDEX_PAIRS
      .map(([numerator, denominator]) => ({
        id: `${numerator.ticker}-${denominator.ticker}`,
        title: `${numerator.label}/${denominator.label}`,
        data: buildPairChartData(payload, numerator, denominator, startDate, endDate),
        src: EASTMONEY_TICKERS.has(numerator.ticker) || EASTMONEY_TICKERS.has(denominator.ticker)
          ? 'Yahoo Finance, East Money'
          : undefined,
      }))
      .filter(chart => chart.data);
  }, [payload, startDate, endDate]);
  const sectionCharts = useMemo(() => {
    if (!payload) return [];
    return HK_CHINA_SECTIONS.map(section => ({
      title: section.title,
      charts: section.tickers
        .map(meta => ({ id: meta.ticker, title: meta.name, data: buildPairChartData(payload, meta, CSI300_META, startDate, endDate) }))
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
      {charts.map(({ id, title, data, src }) => (
        <ChartCard
          key={id}
          title={title}
          src={src ?? 'Yahoo Finance'}
          srcUrl={src ? undefined : 'https://finance.yahoo.com'}
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
            src="Yahoo Finance, East Money"
            freq="Daily"
            span2
            height={480}
          >
            {error ? (
              <div className="empty">Could not load HK/China performance data: {error}</div>
            ) : !overviewChartData ? (
              <div className="empty">{loading ? 'Loading HK/China performance data…' : 'No data'}</div>
            ) : (
              <Line data={overviewChartData} options={chartOptions()} plugins={[BASELINE_100]} />
            )}
          </ChartCard>
        </div>
      )}
      {section != null && <div className="usp-section-label">{section === 'all' ? 'Index' : section === 'sentiment' ? 'Sentiment' : section}</div>}

      {section === 'all' && !error && indexRatioCharts.length > 0 &&
        ratioGrid([
          ...indexRatioCharts.map(({ meta, data }) => ({
            id: meta.ticker,
            title: meta.name,
            data,
            src: EASTMONEY_TICKERS.has(meta.ticker) ? 'Yahoo Finance, East Money' : undefined,
          })),
          ...extraIndexRatioCharts,
        ])}

      {section !== 'all' && !error && activeSectionCharts && ratioGrid(activeSectionCharts.charts)}

      {section === 'sentiment' && (
        premiumError ? (
          <div className="empty">Could not load ETF premium data: {premiumError}</div>
        ) : !premiumPayload ? (
          <div className="empty">{premiumLoading ? 'Loading ETF premium data…' : 'No data'}</div>
        ) : (
          <div className="usp-etf-grid">
            {premiumPayload.series.map(series => {
              const latest = series.latest;
              const latestLabel = latest
                ? ` · ${latest.premium >= 0 ? '+' : ''}${latest.premium.toFixed(2)}%`
                : '';
              return (
                <ChartCard
                  key={series.ticker}
                  title={`${series.ticker} · ${series.name}${latestLabel}`}
                  src="Yahoo Finance / East Money / Tiantian Fund"
                  srcUrl="https://fund.eastmoney.com"
                  freq="Daily + live IOPV"
                  height={300}
                >
                  <Line
                    data={buildPremiumChartData(series)}
                    options={premiumChartOptions()}
                    plugins={[PREMIUM_ZERO_LINE]}
                  />
                </ChartCard>
              );
            })}
          </div>
        )
      )}
    </>
  );
}
