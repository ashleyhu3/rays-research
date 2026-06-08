import { fa } from '../config/colors';

/* ─── Shared axis / grid tokens ─────────────────────────────────────── */
export const GRID = { color: 'rgba(255,255,255,.04)' };
export const TICK = { color: '#454540', font: { size: 10, family: "'Outfit',sans-serif" } };
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
      titleFont: { family: "'Outfit',sans-serif", size: 11 },
      bodyFont:  { family: "'Outfit',sans-serif", size: 11 },
      padding: 10,
      callbacks: {
        label: c => ` ${c.dataset.label}: ${yFmt(c.parsed.y)}`,
      },
    },
  },
  scales: {
    x: { grid: GRID, ticks: { ...TICK, maxTicksLimit: 8, autoSkip: true }, border: BORD },
    y: { grid: GRID, ticks: { ...TICK, callback: v => yFmt(v) }, border: BORD, beginAtZero: false },
  },
});

/* ─── Horizontal bar overrides ──────────────────────────────────────── */
export const hBarOpts = (yFmt) => ({
  ...baseOpts(yFmt),
  indexAxis: 'y',
});

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
        color: '#7a7a72',
        font: { size: 10, family: "'Outfit',sans-serif" },
        padding: 10,
        boxWidth: 10,
      },
    },
    tooltip: {
      backgroundColor: '#1a1f2a',
      borderColor: 'rgba(255,255,255,.12)',
      borderWidth: 1,
      bodyFont: { family: "'Outfit',sans-serif", size: 11 },
      callbacks: { label: c => ` ${c.label}: ${c.parsed}%` },
    },
  },
});

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
