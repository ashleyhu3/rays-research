import { fa } from '../config/colors.js';

/* ─── Shared axis / grid tokens ─────────────────────────────────────── */
export const GRID = { color: 'rgba(255,255,255,.04)' };
export const TICK = { color: '#b0b0a8', font: { size: 11, family: "'Inter',sans-serif" } };
export const BORD = { color: 'rgba(255,255,255,.06)' };

/* ─── Value formatters ──────────────────────────────────────────────── */
export const fmtM = v =>
  v >= 1e12 ? `${(v / 1e12).toFixed(1)}T`
  : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k`
  : String(v);

export const fmtK = v => (v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v));
export const fmtN = v => v.toLocaleString();
export const fmtP = v => `${v.toFixed(1)}`;

/* ─── Base chart options (line / bar) ───────────────────────────────── */
export const baseOpts = (yFmt) => ({
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
      bodyFont:  { family: "'Inter',sans-serif", size: 11 },
      padding: 10,
      callbacks: {
        label: c => ` ${c.dataset.label}: ${yFmt(c.parsed.y)}`,
      },
    },
    zoom: {
      zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
      pan: { enabled: true, mode: 'x' },
    },
  },
  scales: {
    x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
    y: { grid: GRID, ticks: { ...TICK, callback: v => yFmt(v) }, border: BORD, beginAtZero: false },
  },
});

/* ─── Horizontal bar overrides ──────────────────────────────────────── */
export const hBarOpts = (xFmt) => {
  const base = baseOpts(xFmt);
  return {
    ...base,
    indexAxis: 'y',
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          // Value lives on the x-axis for horizontal bars (not y). Drop the
          // "label:" prefix when a dataset has no label.
          label: c => `${c.dataset.label ? ` ${c.dataset.label}: ` : ' '}${xFmt(c.parsed.x)}`,
        },
      },
      // Category axis is y for horizontal bars, so zoom/pan along y (not x).
      zoom: {
        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'y' },
        pan: { enabled: true, mode: 'y' },
      },
    },
    scales: {
      x: { grid: GRID, ticks: { ...TICK, callback: v => xFmt(v) }, border: BORD, beginAtZero: true },
      y: { grid: GRID, ticks: { ...TICK }, border: BORD },
    },
  };
};

/* ─── Doughnut chart options ────────────────────────────────────────── */
export const doughnutOpts = (cutout = '55%') => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  cutout,
  plugins: {
    legend: {
      display: true,
      position: 'right',
      labels: {
        color: '#c8c8c0',
        font: { size: 10, family: "'Inter',sans-serif" },
        padding: 10,
        boxWidth: 10,
      },
    },
    tooltip: {
      backgroundColor: '#1a1f2a',
      borderColor: 'rgba(255,255,255,.12)',
      borderWidth: 1,
      bodyFont: { family: "'Inter',sans-serif", size: 11 },
      callbacks: { label: c => ` ${c.label}: ${c.parsed}%` },
    },
  },
});

/* ─── Dual-axis options (volume on left, secondary series on right) ──
   Datasets with yAxisID 'y1' are formatted with y1Fmt in the tooltip. */
export const dualAxisOpts = (yFmt, y1Fmt) => {
  const base = baseOpts(yFmt);
  return {
    ...base,
    plugins: {
      ...base.plugins,
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          color: '#c8c8c0',
          font: { size: 10, family: "'Inter',sans-serif" },
          padding: 10,
          boxWidth: 10,
        },
      },
      tooltip: {
        ...base.plugins.tooltip,
        callbacks: {
          label: c => ` ${c.dataset.label}: ${(c.dataset.yAxisID === 'y1' ? y1Fmt : yFmt)(c.parsed.y)}`,
        },
      },
    },
    scales: {
      x: base.scales.x,
      y:  { position: 'left',  grid: GRID, ticks: { ...TICK, callback: v => yFmt(v) }, border: BORD, beginAtZero: true },
      y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { ...TICK, callback: v => y1Fmt(v) }, border: BORD },
    },
  };
};

/* ─── Stacked bar options ───────────────────────────────────────────── */
export const stackedOpts = (yFmt) => ({
  ...baseOpts(yFmt),
  scales: {
    x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
    y: { grid: GRID, ticks: { ...TICK, callback: v => yFmt(v) }, border: BORD, stacked: true },
  },
});

/* ─── Line dataset factory ──────────────────────────────────────────── */
export const mkDs = (label, color, data, fill = false) => ({
  label,
  data,
  borderColor: color,
  backgroundColor: fill ? fa(color, 0.12) : fa(color, 0),
  pointBackgroundColor: color,
  pointRadius: 3,
  pointHoverRadius: 5,
  borderWidth: 2,
  tension: 0.4,
  fill,
});

/* ─── Bar dataset factory ───────────────────────────────────────────── */
export const mkBar = (label, color, data, alpha = 0.75) => ({
  label,
  data,
  backgroundColor: fa(color, alpha),
  borderColor: color,
  borderWidth: 1,
  borderRadius: 4,
});
