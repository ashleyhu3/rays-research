import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import ChartCard from '../../components/chart/ChartCard';
import { useData } from '../../context/DataContext';
import {
  SPX_META, US_PERFORMANCE_ETFS, EXTRA_TICKERS, TECH_PAIRS, THEME_TICKERS, FACTOR_TICKERS,
  SOX_CORRELATION_PAIRS, KWEB_CORRELATION_PAIRS, VOL_INDEX_TICKERS, GLD_VIX_PAIR,
} from '../../config/usPerformance';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';
import { rankChartsByLatestStrength, rankDatasetsByLatestStrength } from '../../utils/chartRanking';

const PRESETS = [
  { id: 'ytd', label: 'YTD', getStart: () => `${new Date().getFullYear()}-01-01` },
  { id: '1y',  label: '1Y',  getStart: () => isoYearsAgo(1) },
  { id: '3y',  label: '3Y',  getStart: () => isoYearsAgo(3) },
  { id: '5y',  label: '5Y',  getStart: () => isoYearsAgo(5) },
];

const ETF_BY_TICKER = new Map(US_PERFORMANCE_ETFS.map(etf => [etf.ticker, etf]));
const EXTRA_BY_LABEL = new Map(Object.values(EXTRA_TICKERS).map(m => [m.label, m]));
const SECTOR_TICKERS = new Set([...US_PERFORMANCE_ETFS.map(etf => etf.ticker), SPX_META.ticker]);
const ROLLING_AVG_DAYS = 50;
const CORRELATION_WINDOW = 50;
// A 50-session moving average / 50-session rolling correlation needs extra calendar
// days to cover weekends and holidays, plus slack for per-pair inner-join date loss.
const ROLLING_FETCH_LOOKBACK_DAYS = 100;

// Resolves a display label (e.g. 'SOX', 'SPX', 'XLK') to its ticker metadata,
// across the sector, SPX, and Tech/Theme/Factor ticker registries.
function metaForLabel(label) {
  if (label === SPX_META.label) return SPX_META;
  return ETF_BY_TICKER.get(label) ?? EXTRA_BY_LABEL.get(label);
}

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

function findSeries(payload, ticker) {
  return payload.series.find(s => s.ticker === ticker);
}

function buildOverviewChartData(payload, startDate, endDate) {
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  if (!bounds) return null;

  // Only the sector ETFs + SPX belong in the aggregate chart — the Tech/Theme/
  // Factor tickers ride along in the same payload but are rendered as their
  // own ratio-vs-SPX cards below, not overlaid here.
  const sectorSeries = payload.series.filter(s => SECTOR_TICKERS.has(s.ticker));
  const labels = sliceBounds(payload.dates, bounds).map(fmtDate);
  const datasets = sectorSeries.map((s, i) => {
    const isSpx = s.ticker === SPX_META.ticker;
    const etf = ETF_BY_TICKER.get(s.ticker);
    const color = isSpx ? SPX_META.color : (etf?.color ?? US_PERFORMANCE_ETFS[i % US_PERFORMANCE_ETFS.length].color);
    return {
      label: isSpx ? SPX_META.name : s.name,
      fullName: s.name,
      data: rebase(sliceBounds(s.closes, bounds)),
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

// Generalized numerator/denominator ratio chart — used both for the sector
// ETFs (always vs SPX) and the Tech section's cross pairs (e.g. SOX/IGV).
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

function buildEqualWeightChartData(payload, startDate, endDate) {
  const rspMeta = metaForLabel('RSP');
  if (!rspMeta) return null;

  const chartData = buildPairChartData(payload, rspMeta, SPX_META, startDate, endDate);
  const rspSeries = findSeries(payload, rspMeta.ticker);
  const spxSeries = findSeries(payload, SPX_META.ticker);
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  if (!chartData || !rspSeries || !spxSeries || !bounds) return null;

  // Daily change in RSP's relative performance versus SPX. Calculate against
  // the prior trading session before slicing so the first visible bar still
  // has a valid DoD comparison when data exists immediately before the range.
  const ratios = rspSeries.closes.map((close, i) => {
    const spxClose = spxSeries.closes[i];
    return close != null && spxClose != null && spxClose !== 0 ? close / spxClose : null;
  });
  const dodChanges = ratios.map((ratio, i) => {
    const prior = ratios[i - 1];
    return ratio != null && prior != null && prior !== 0 ? ((ratio / prior) - 1) * 100 : null;
  });
  const visibleDod = sliceBounds(dodChanges, bounds);

  return {
    ...chartData,
    datasets: [
      ...chartData.datasets,
      {
        type: 'bar',
        label: 'DoD change',
        fullName: 'Day-over-day change in RSP relative performance versus SPX',
        data: visibleDod,
        yAxisID: 'yDod',
        backgroundColor: visibleDod.map(value => (
          value == null ? 'transparent' : value >= 0 ? 'rgba(74,222,128,.72)' : 'rgba(248,113,113,.72)'
        )),
        borderColor: visibleDod.map(value => (
          value == null ? 'transparent' : value >= 0 ? '#4ade80' : '#f87171'
        )),
        borderWidth: 1,
        borderRadius: 1,
        barPercentage: 0.88,
        categoryPercentage: 0.92,
      },
    ],
  };
}

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) { sumX += xs[i]; sumY += ys[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

// Rolling 50-observation Pearson correlation of daily log returns, computed
// on adjusted-close prices inner-joined by date so each pair only uses dates
// where both tickers actually traded — no zero-filling for gaps.
function buildCorrelationSeries(payload, aMeta, bMeta, windowSize = CORRELATION_WINDOW) {
  const seriesA = findSeries(payload, aMeta.ticker);
  const seriesB = findSeries(payload, bMeta.ticker);
  if (!seriesA || !seriesB) return null;

  const joinedDates = [];
  const joinedA = [];
  const joinedB = [];
  for (let i = 0; i < payload.dates.length; i += 1) {
    const av = seriesA.adjCloses[i];
    const bv = seriesB.adjCloses[i];
    if (av != null && bv != null) {
      joinedDates.push(payload.dates[i]);
      joinedA.push(av);
      joinedB.push(bv);
    }
  }

  const returnDates = [];
  const returnsA = [];
  const returnsB = [];
  for (let i = 1; i < joinedDates.length; i += 1) {
    const prevA = joinedA[i - 1];
    const curA = joinedA[i];
    const prevB = joinedB[i - 1];
    const curB = joinedB[i];
    if (prevA > 0 && curA > 0 && prevB > 0 && curB > 0) {
      returnDates.push(joinedDates[i]);
      returnsA.push(Math.log(curA / prevA));
      returnsB.push(Math.log(curB / prevB));
    }
  }

  const correlations = returnsA.map((_, i) => {
    if (i < windowSize - 1) return null;
    return pearsonCorrelation(returnsA.slice(i - windowSize + 1, i + 1), returnsB.slice(i - windowSize + 1, i + 1));
  });

  return { dates: returnDates, correlations };
}

function buildCorrelationChartData(payload, pairs, startDate, endDate) {
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  if (!bounds) return null;
  const labelDates = sliceBounds(payload.dates, bounds);
  const labels = labelDates.map(fmtDate);

  const datasets = rankDatasetsByLatestStrength(pairs.map(([aLabel, bLabel]) => {
    const aMeta = metaForLabel(aLabel);
    const bMeta = metaForLabel(bLabel);
    if (!aMeta || !bMeta) return null;
    const series = buildCorrelationSeries(payload, aMeta, bMeta);
    if (!series) return null;

    const valueByDate = new Map(series.dates.map((d, i) => [d, series.correlations[i]]));
    const data = labelDates.map(d => valueByDate.get(d) ?? null);
    let latest = null;
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if (data[i] != null) { latest = data[i]; break; }
    }
    const pairLabel = `${aLabel} vs ${bLabel}`;
    return {
      label: latest != null ? `${pairLabel} (${latest.toFixed(2)})` : pairLabel,
      fullName: `${aMeta.name} vs ${bMeta.name}, 50-day rolling correlation of daily log returns`,
      data,
      borderColor: bMeta.color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      pointHitRadius: 6,
      tension: 0.15,
      spanGaps: true,
    };
  }).filter(Boolean));

  return datasets.length > 0 ? { labels, datasets } : null;
}

// Raw index levels (VIX/VIXEQ/VXN are directly comparable already — no
// rebase-to-100 the way sector ETFs need for a relative-performance chart).
function buildVolIndexChartData(payload, labels, startDate, endDate) {
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  if (!bounds) return null;

  const datasets = labels.map(label => {
    const meta = metaForLabel(label);
    const series = meta && findSeries(payload, meta.ticker);
    if (!meta || !series) return null;
    return {
      label: meta.label,
      fullName: meta.name,
      data: sliceBounds(series.closes, bounds),
      borderColor: meta.color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      pointHitRadius: 6,
      tension: 0.15,
      spanGaps: true,
    };
  }).filter(Boolean);

  return datasets.length > 0
    ? { labels: sliceBounds(payload.dates, bounds).map(fmtDate), datasets }
    : null;
}

function buildVolSpreadChartData(payload, startDate, endDate) {
  const bounds = visibleBounds(payload.dates, startDate, endDate);
  const vixMeta = metaForLabel('VIX');
  const vixSeries = vixMeta && findSeries(payload, vixMeta.ticker);
  if (!bounds || !vixSeries) return null;

  const vix = sliceBounds(vixSeries.closes, bounds);
  const datasets = ['VIXEQ', 'VXN'].map(label => {
    const meta = metaForLabel(label);
    const series = meta && findSeries(payload, meta.ticker);
    if (!meta || !series) return null;
    const values = sliceBounds(series.closes, bounds);
    return {
      label: `${label} − VIX`,
      fullName: `${meta.name} minus ${vixMeta.name}`,
      data: values.map((value, index) => (
        Number.isFinite(value) && Number.isFinite(vix[index]) ? value - vix[index] : null
      )),
      borderColor: meta.color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      pointHitRadius: 6,
      tension: 0.15,
      spanGaps: true,
    };
  }).filter(Boolean);

  return datasets.length
    ? { labels: sliceBounds(payload.dates, bounds).map(fmtDate), datasets }
    : null;
}

function volIndexChartOptions({ include30 = false } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10 },
      },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)}`),
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: {
        grid: GRID,
        ticks: { ...TICK, callback: v => v.toFixed(0) },
        border: BORD,
        ...(include30 ? { suggestedMax: 32 } : {}),
      },
    },
  };
}

const VIX_30_LINE = {
  id: 'usPerfVix30Line',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const y = scales.y.getPixelForValue(30);
    ctx.save();
    ctx.strokeStyle = 'rgba(234,234,224,.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.restore();
  },
};

// AAII weekly Bullish/Neutral/Bearish % — a plain percentage line chart, not
// a price/level series, so it gets its own simple options rather than reusing
// chartOptions()'s rebased-to-100 tooltip math.
function aaiiChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10 },
      },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}%`),
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: { min: 0, max: 70, grid: GRID, ticks: { ...TICK, stepSize: 10, callback: v => `${v}%` }, border: BORD },
    },
  };
}

// SPX Put/Call Ratio — Volume and Open Interest, backed by Barchart's rolling
// 200-session historical chart feed.
function putCallChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10 },
      },
      tooltip: {
        backgroundColor: '#1a1f2a',
        borderColor: 'rgba(255,255,255,.12)',
        borderWidth: 1,
        titleFont: { family: "'Inter',sans-serif", size: 11 },
        bodyFont: { family: "'Inter',sans-serif", size: 11 },
        padding: 10,
        callbacks: {
          label: c => (c.parsed.y == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)}`),
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: { grid: GRID, ticks: { ...TICK, callback: v => v.toFixed(1) }, border: BORD, beginAtZero: true },
    },
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

// One canvas, two plotting regions: the existing relative-performance lines
// occupy the upper region and the DoD bars occupy the lower region. Keeping a
// shared chart area preserves one date axis, tooltip, legend, and hover index.
const EQUAL_WEIGHT_PANELS = {
  id: 'usPerfEqualWeightPanels',
  afterLayout(chart) {
    const { chartArea, scales } = chart;
    if (!chartArea || !scales.y || !scales.yDod) return;

    const gap = 12;
    const split = chartArea.top + chartArea.height * 0.64;
    const setVerticalBounds = (scale, top, bottom) => {
      scale.top = top;
      scale.bottom = bottom;
      scale.height = Math.max(0, bottom - top);
      scale.configure();
    };

    setVerticalBounds(scales.y, chartArea.top, split - gap / 2);
    setVerticalBounds(scales.yDod, split + gap / 2, chartArea.bottom);
  },
};

function equalWeightChartOptions() {
  const options = chartOptions({ relative: true, compact: true });
  options.plugins.tooltip.callbacks.label = c => {
    const value = c.parsed.y;
    if (value == null) return ` ${c.dataset.label}: —`;
    if (c.dataset.yAxisID === 'yDod') {
      return ` ${c.dataset.label}: ${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    }
    const pct = value - 100;
    const ratio = c.dataset.ratios?.[c.dataIndex];
    const ratioText = Number.isFinite(ratio) ? `, ratio ${ratio.toFixed(5)}` : '';
    return ` ${c.dataset.label}: ${value.toFixed(1)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% rel)${ratioText}`;
  };
  options.scales.y.ticks.maxTicksLimit = 4;
  options.scales.yDod = {
    position: 'right',
    grid: {
      color: context => (context.tick.value === 0 ? 'rgba(234,234,224,.25)' : 'rgba(255,255,255,.04)'),
      lineWidth: context => (context.tick.value === 0 ? 1 : 0.75),
    },
    ticks: {
      ...TICK,
      maxTicksLimit: 3,
      callback: value => `${Number(value).toFixed(1)}%`,
    },
    border: BORD,
    afterDataLimits: scale => {
      const extent = Math.max(Math.abs(scale.min), Math.abs(scale.max), 0.01) * 1.08;
      scale.min = -extent;
      scale.max = extent;
    },
  };
  return options;
}

// Dashed reference line at y=0, drawn behind the correlation series.
const ZERO_LINE = {
  id: 'usPerfZeroLine',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const y = scales.y.getPixelForValue(0);
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

function correlationChartOptions() {
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
            return v == null ? ` ${c.dataset.label}: —` : ` ${c.dataset.label}: ${v.toFixed(2)}`;
          },
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 10, autoSkip: true }, border: BORD },
      y: {
        min: -1,
        max: 1,
        grid: GRID,
        ticks: { ...TICK, stepSize: 0.5, callback: v => v.toFixed(1) },
        border: BORD,
      },
    },
  };
}

const SECTION_LABELS = {
  all: 'Sector', tech: 'Tech', theme: 'Theme', factor: 'Factor', correlation: 'Correlation', sentiment: 'Sentiment',
};

export default function UsPerformance({ section = null }) {
  const { liveData } = useData();
  const [startDate, setStartDate] = useState(() => isoYearsAgo(1));
  const [endDate, setEndDate] = useState(() => todayIso());
  const [payload, setPayload] = useState(() => liveData?.usPerformanceDefault ?? null);
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
    if (isDefaultWindow && liveData?.usPerformanceDefault) {
      setPayload(liveData.usPerformanceDefault);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ start: fetchStartDate, end: endDate });
    fetch(`/api/us-performance?${params}`)
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) { setPayload(data); setLoading(false); } })
      .catch(fetchError => { if (live) { setError(fetchError.message); setLoading(false); } });
    return () => { live = false; };
  }, [fetchStartDate, endDate, isDefaultWindow, liveData?.usPerformanceDefault]);

  const overviewChartData = useMemo(
    () => (payload ? buildOverviewChartData(payload, startDate, endDate) : null),
    [payload, startDate, endDate]
  );
  const relativeCharts = useMemo(() => {
    if (!payload) return [];
    return US_PERFORMANCE_ETFS
      .map(etf => ({ etf, data: buildPairChartData(payload, etf, SPX_META, startDate, endDate) }))
      .filter(chart => chart.data);
  }, [payload, startDate, endDate]);
  const equalWeightChart = useMemo(() => {
    if (!payload) return null;
    return buildEqualWeightChartData(payload, startDate, endDate);
  }, [payload, startDate, endDate]);
  const techCharts = useMemo(() => {
    if (!payload) return [];
    return TECH_PAIRS
      .map(([numLabel, denLabel]) => {
        const numMeta = metaForLabel(numLabel);
        const denMeta = metaForLabel(denLabel);
        const data = numMeta && denMeta ? buildPairChartData(payload, numMeta, denMeta, startDate, endDate) : null;
        return { id: `${numLabel}-${denLabel}`, title: `${numLabel}/${denLabel}`, data };
      })
      .filter(chart => chart.data);
  }, [payload, startDate, endDate]);
  const themeCharts = useMemo(() => {
    if (!payload) return [];
    return THEME_TICKERS
      .map(label => {
        const meta = metaForLabel(label);
        const data = meta ? buildPairChartData(payload, meta, SPX_META, startDate, endDate) : null;
        return { id: label, title: meta?.name ?? label, data };
      })
      .filter(chart => chart.data);
  }, [payload, startDate, endDate]);
  const factorCharts = useMemo(() => {
    if (!payload) return [];
    return FACTOR_TICKERS
      .map(label => {
        const meta = metaForLabel(label);
        const data = meta ? buildPairChartData(payload, meta, SPX_META, startDate, endDate) : null;
        return { id: label, title: meta?.name ?? label, data };
      })
      .filter(chart => chart.data);
  }, [payload, startDate, endDate]);
  const soxCorrelationData = useMemo(
    () => (payload ? buildCorrelationChartData(payload, SOX_CORRELATION_PAIRS, startDate, endDate) : null),
    [payload, startDate, endDate]
  );
  const kwebCorrelationData = useMemo(
    () => (payload ? buildCorrelationChartData(payload, KWEB_CORRELATION_PAIRS, startDate, endDate) : null),
    [payload, startDate, endDate]
  );
  const volIndexData = useMemo(
    () => (payload ? buildVolIndexChartData(payload, VOL_INDEX_TICKERS, startDate, endDate) : null),
    [payload, startDate, endDate]
  );
  const volSpreadData = useMemo(
    () => (payload ? buildVolSpreadChartData(payload, startDate, endDate) : null),
    [payload, startDate, endDate]
  );
  const gldVixData = useMemo(() => {
    if (!payload) return null;
    const [numLabel, denLabel] = GLD_VIX_PAIR;
    const numMeta = metaForLabel(numLabel);
    const denMeta = metaForLabel(denLabel);
    return numMeta && denMeta ? buildPairChartData(payload, numMeta, denMeta, startDate, endDate) : null;
  }, [payload, startDate, endDate]);

  // AAII weekly sentiment isn't part of the price-series payload above — it's
  // fetched lazily, only once the Sentiment subtab is actually opened.
  const [aaiiData, setAaiiData] = useState(null);
  const [aaiiError, setAaiiError] = useState(null);
  useEffect(() => {
    if (section !== 'sentiment' || aaiiData || aaiiError) return undefined;
    let live = true;
    fetch('/api/aaii-sentiment')
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) setAaiiData(data); })
      .catch(fetchError => { if (live) setAaiiError(fetchError.message); });
    return () => { live = false; };
  }, [section, aaiiData, aaiiError]);
  const aaiiChartData = useMemo(() => {
    if (!aaiiData?.dates?.length) return null;
    // Respect the page's shared date-range picker, same as every other chart here.
    const bounds = visibleBounds(aaiiData.dates, startDate, endDate);
    if (!bounds) return null;
    const labels = sliceBounds(aaiiData.dates, bounds).map(fmtDate);
    return {
      labels,
      datasets: [
        { label: 'Bullish %', data: sliceBounds(aaiiData.bullish, bounds), borderColor: '#4ade80', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.15, spanGaps: true },
        { label: 'Neutral %', data: sliceBounds(aaiiData.neutral, bounds), borderColor: '#94a3b8', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.15, spanGaps: true },
        { label: 'Bearish %', data: sliceBounds(aaiiData.bearish, bounds), borderColor: '#f87171', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, pointHitRadius: 6, tension: 0.15, spanGaps: true },
      ],
    };
  }, [aaiiData, startDate, endDate]);

  // SPX put/call ratios are backfilled from the same 200-session historical
  // feed that powers Barchart's lower chart, then refreshed on the server.
  const [putCallData, setPutCallData] = useState(null);
  const [putCallError, setPutCallError] = useState(null);
  useEffect(() => {
    if (section !== 'sentiment' || putCallData || putCallError) return undefined;
    let live = true;
    fetch('/api/spx-put-call-ratio')
      .then(response => (response.ok
        ? response.json()
        : response.json().then(body => Promise.reject(new Error(body.error ?? `HTTP ${response.status}`)))))
      .then(data => { if (live) setPutCallData(data); })
      .catch(fetchError => { if (live) setPutCallError(fetchError.message); });
    return () => { live = false; };
  }, [section, putCallData, putCallError]);
  const putCallChartData = useMemo(() => {
    if (!putCallData?.dates?.length) return null;
    const bounds = visibleBounds(putCallData.dates, startDate, endDate);
    if (!bounds) return null;
    return {
      labels: sliceBounds(putCallData.dates, bounds).map(fmtDate),
      datasets: [
        { label: 'Volume Ratio', data: sliceBounds(putCallData.volumeRatio, bounds), borderColor: '#4fc3f7', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, pointHitRadius: 6, tension: 0.15, spanGaps: true },
        { label: 'Open Interest Ratio', data: sliceBounds(putCallData.oiRatio, bounds), borderColor: '#f2b134', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 2, pointHoverRadius: 4, pointHitRadius: 6, tension: 0.15, spanGaps: true },
      ],
    };
  }, [putCallData, startDate, endDate]);
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

  const ratioGrid = (charts, pinned = []) => (
    <div className="usp-etf-grid">
      {[...pinned, ...rankChartsByLatestStrength(charts)].map(({ id, title, data, equalWeight = false }) => (
        <ChartCard
          key={id}
          title={title}
          src="Yahoo Finance"
          srcUrl="https://finance.yahoo.com"
          freq="Daily"
          height={equalWeight ? 370 : 255}
        >
          <Line
            data={data}
            options={equalWeight ? equalWeightChartOptions() : chartOptions({ relative: true, compact: true })}
            plugins={equalWeight ? [BASELINE_100, EQUAL_WEIGHT_PANELS] : [BASELINE_100]}
          />
        </ChartCard>
      ))}
    </div>
  );

  return (
    <>
      {controls}
      {section == null && (
        <div className="cgrid">
          <ChartCard
            title="Aggregate Performance"
            src="Yahoo Finance"
            srcUrl="https://finance.yahoo.com"
            freq="Daily"
            span2
            height={480}
          >
            {error ? (
              <div className="empty">Could not load US performance data: {error}</div>
            ) : !overviewChartData ? (
              <div className="empty">{loading ? 'Loading US performance data…' : 'No data'}</div>
            ) : (
              <Line data={overviewChartData} options={chartOptions()} plugins={[BASELINE_100]} />
            )}
          </ChartCard>
        </div>
      )}
      {section != null && <div className="usp-section-label">{SECTION_LABELS[section] ?? section}</div>}

      {section === 'all' && !error && (relativeCharts.length > 0 || equalWeightChart) &&
        ratioGrid(
          relativeCharts.map(({ etf, data }) => ({ id: etf.ticker, title: etf.name, data })),
          equalWeightChart ? [{ id: 'rsp-spx', title: 'Equal Weight', data: equalWeightChart, equalWeight: true }] : []
        )}

      {section === 'tech' && !error && techCharts.length > 0 && ratioGrid(techCharts)}

      {section === 'theme' && !error && themeCharts.length > 0 && ratioGrid(themeCharts)}

      {section === 'factor' && !error && factorCharts.length > 0 && ratioGrid(factorCharts)}

      {section === 'correlation' && !error && (soxCorrelationData || kwebCorrelationData) && (
        <div className="cgrid">
          {rankChartsByLatestStrength([
            { id: 'sox-correlations', title: 'SOX Correlations', data: soxCorrelationData },
            { id: 'kweb-correlations', title: 'KWEB Correlations', data: kwebCorrelationData },
          ].filter(chart => chart.data)).map(chart => (
            <ChartCard
              key={chart.id}
              title={chart.title}
              src="Yahoo Finance"
              srcUrl="https://finance.yahoo.com"
              freq="Daily"
              height={320}
            >
              <Line data={chart.data} options={correlationChartOptions()} plugins={[ZERO_LINE]} />
            </ChartCard>
          ))}
        </div>
      )}

      {section === 'sentiment' && !error && (
        <div className="cgrid">
          {volIndexData && (
            <ChartCard title="VIX" src="Yahoo Finance" srcUrl="https://finance.yahoo.com" freq="Daily" height={340}>
              <Line data={volIndexData} options={volIndexChartOptions({ include30: true })} plugins={[VIX_30_LINE]} />
            </ChartCard>
          )}

          {volSpreadData && (
            <ChartCard title="Volatility Index Spreads" src="Yahoo Finance" srcUrl="https://finance.yahoo.com" freq="Daily" height={340}>
              <Line data={volSpreadData} options={volIndexChartOptions()} plugins={[ZERO_LINE]} />
            </ChartCard>
          )}

          <ChartCard title="S&P500 Put Call Ratio" src="Barchart" srcUrl="https://www.barchart.com/stocks/quotes/$SPX/put-call-ratios" freq="Daily" span2 height={340}>
            {putCallChartData ? (
              <Line data={putCallChartData} options={putCallChartOptions()} />
            ) : putCallError ? (
              <div className="empty">Could not load SPX put/call ratio data: {putCallError}</div>
            ) : (
              <div className="empty">Loading SPX put/call ratio data…</div>
            )}
          </ChartCard>

          <ChartCard title="AAII Investor Sentiment" src="AAII" srcUrl="https://www.aaii.com/sentimentsurvey" freq="Weekly" span2 height={340}>
            {aaiiChartData ? (
              <Line data={aaiiChartData} options={aaiiChartOptions()} />
            ) : aaiiError ? (
              <div className="empty">Could not load AAII sentiment data: {aaiiError}</div>
            ) : (
              <div className="empty">Loading AAII sentiment data…</div>
            )}
          </ChartCard>

          {gldVixData && (
            <ChartCard title="GLD/VIX" src="Yahoo Finance" srcUrl="https://finance.yahoo.com" freq="Daily" span2 height={300}>
              <Line data={gldVixData} options={chartOptions({ relative: true, compact: true })} plugins={[BASELINE_100]} />
            </ChartCard>
          )}
        </div>
      )}
    </>
  );
}
