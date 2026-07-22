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

/* ─── Auto-rescale the value axis to the visible range after zoom/pan ──
   chartjs-plugin-zoom only changes the index (category/time) axis; left
   alone, the value axis keeps its full-series scale, so a zoomed-in chart
   shows a tiny squashed line. Wired in as zoom/pan onZoom/onPan callbacks
   below, this recomputes min/max from whatever data is currently in view
   (summing stacked datasets rather than reading them individually) and
   applies it to the given value axis/axes before the chart repaints. */
function pointIndexValue(point, idx, indexAxisId) {
  if (point && typeof point === 'object' && !Array.isArray(point)) {
    return indexAxisId === 'x' ? { pos: point.x, val: point.y } : { pos: point.y, val: point.x };
  }
  return { pos: idx, val: point };
}

function visibleRange(chart, valueAxisId, indexAxisId) {
  const idxScale = chart.scales[indexAxisId];
  if (!idxScale) return null;
  const otherAxisKey = indexAxisId === 'x' ? 'yAxisID' : 'xAxisID';
  const defaultAxis  = indexAxisId === 'x' ? 'y' : 'x';
  const stacked = !!chart.options.scales?.[valueAxisId]?.stacked;

  if (stacked) {
    const totals = new Map(); // idx -> { pos, neg }
    chart.data.datasets.forEach((ds, i) => {
      if ((ds[otherAxisKey] ?? defaultAxis) !== valueAxisId) return;
      if (chart.getDatasetMeta(i).hidden) return;
      ds.data.forEach((point, idx) => {
        const { pos, val } = pointIndexValue(point, idx, indexAxisId);
        if (val == null || Number.isNaN(val) || pos < idxScale.min || pos > idxScale.max) return;
        const entry = totals.get(idx) ?? { pos: 0, neg: 0 };
        if (val >= 0) entry.pos += val; else entry.neg += val;
        totals.set(idx, entry);
      });
    });
    let min = 0, max = 0;
    totals.forEach(({ pos, neg }) => { if (pos > max) max = pos; if (neg < min) min = neg; });
    return { min, max };
  }

  let min = Infinity, max = -Infinity;
  chart.data.datasets.forEach((ds, i) => {
    if ((ds[otherAxisKey] ?? defaultAxis) !== valueAxisId) return;
    if (chart.getDatasetMeta(i).hidden) return;
    ds.data.forEach((point, idx) => {
      const { pos, val } = pointIndexValue(point, idx, indexAxisId);
      if (val == null || Number.isNaN(val) || pos < idxScale.min || pos > idxScale.max) return;
      if (val < min) min = val;
      if (val > max) max = val;
    });
  });
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

export function autoFitValueAxes(chart, indexAxisId, valueAxisIds) {
  let changed = false;
  valueAxisIds.forEach(axisId => {
    const range = visibleRange(chart, axisId, indexAxisId);
    if (!range) return;
    const { min: rawMin, max } = range;
    const scaleOpts = chart.options.scales[axisId];
    if (chart.scales[axisId]?.type === 'logarithmic') {
      const min = Math.max(rawMin, 1e-6);
      scaleOpts.min = min / 1.08;
      scaleOpts.max = max * 1.08;
    } else {
      // Stacked axes (and anything with beginAtZero) treat 0 as a real
      // floor, not a data point — when nothing in view goes negative,
      // padding below it would manufacture a deep, meaningless negative
      // axis instead of resting the bars on the true zero line.
      const zeroFloor = !!(scaleOpts?.beginAtZero || scaleOpts?.stacked);
      const min = zeroFloor ? Math.min(0, rawMin) : rawMin;
      const span = max - min || Math.abs(max) || 1;
      const pad = span * 0.08;
      scaleOpts.min = (zeroFloor && min === 0) ? 0 : min - pad;
      scaleOpts.max = max + pad;
    }
    changed = true;
  });
  if (changed) chart.update('none');
}

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
      zoom: {
        wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x',
        onZoom: ({ chart }) => autoFitValueAxes(chart, 'x', ['y']),
      },
      pan: {
        enabled: true, mode: 'x',
        onPan: ({ chart }) => autoFitValueAxes(chart, 'x', ['y']),
      },
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
      // Category axis is y for horizontal bars, so zoom/pan (and the
      // autofit value axis) run along y instead of x.
      zoom: {
        zoom: {
          wheel: { enabled: true }, pinch: { enabled: true }, mode: 'y',
          onZoom: ({ chart }) => autoFitValueAxes(chart, 'y', ['x']),
        },
        pan: {
          enabled: true, mode: 'y',
          onPan: ({ chart }) => autoFitValueAxes(chart, 'y', ['x']),
        },
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
      // Two value axes here (left + right) — autofit both on zoom/pan.
      zoom: {
        zoom: {
          wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x',
          onZoom: ({ chart }) => autoFitValueAxes(chart, 'x', ['y', 'y1']),
        },
        pan: {
          enabled: true, mode: 'x',
          onPan: ({ chart }) => autoFitValueAxes(chart, 'x', ['y', 'y1']),
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
