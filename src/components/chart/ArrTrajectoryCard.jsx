import { useEffect, useMemo, useState } from 'react';
import { Scatter } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';
import { buildArrModel } from '../../utils/arrModel';
import { useDashboard } from '../../context/DashboardContext';

const fmtMonth = v => new Date(v).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const fmtDate  = v => new Date(v).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const withCommas = n => Math.round(n).toLocaleString('en-US');
const fmtCurrentArr = n => `${new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 5,
  maximumSignificantDigits: 5,
}).format(n / 1e9)} B`;

// Inline plugin: dashed vertical "now" marker where history hands off to the
// live extrapolation. Config comes from options.plugins.nowLine.
const NOW_LINE = {
  id: 'nowLine',
  afterDatasetsDraw(chart, _args, opts) {
    const t = opts?.now;
    if (!t) return;
    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
    const px = x.getPixelForValue(t);
    if (px < x.left || px > x.right) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = opts.color ?? 'rgba(234,234,224,.28)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(234,234,224,.5)';
    ctx.font = "10px 'Fira Code', monospace";
    ctx.textAlign = 'center';
    ctx.fillText('now', px, top + 11);
    ctx.restore();
  },
};

/**
 * ArrTrajectoryCard — per-company "estimated ARR" tile: a live-extrapolated
 * run-rate counter, Y/Y + implied M/M, and a trajectory chart (disclosed
 * history → decaying live projection with an uncertainty band, disclosure
 * points as diamonds, and a linear/log toggle).
 *
 * @param {{ chartId:string, series:{date:string,value:number}[], color:string,
 *           name:string, height?:number }} props
 */
export default function ArrTrajectoryCard({ chartId, series, color = C.accent, name, height = 300 }) {
  const model = useMemo(() => buildArrModel(series), [series]);

  const [live, setLive] = useState(() => (model ? model.curr * 1e9 : 0));
  const [logMode, setLogMode] = useState(false);

  // Tick the counter forward at the fitted hourly rate, anchored to wall time.
  useEffect(() => {
    if (!model) return;
    const base = model.curr * 1e9;
    const start = performance.now();
    setLive(base);
    const id = setInterval(() => {
      const hrs = (performance.now() - start) / 3600000;
      setLive(base + model.perHourUsd * hrs);
    }, 120);
    return () => clearInterval(id);
  }, [model]);

  const { sectorOverviewMode, activeSector, isPinned, pageCharts } = useDashboard();

  const data = useMemo(() => {
    if (!model) return null;
    return {
      datasets: [
        // Uncertainty band (drawn first, behind everything).
        { label: 'band-hi', data: model.bandUpper, showLine: true, borderColor: 'transparent', borderWidth: 0, pointRadius: 0, fill: false, tension: 0.25 },
        { label: 'band-lo', data: model.bandLower, showLine: true, borderColor: 'transparent', borderWidth: 0, pointRadius: 0, backgroundColor: fa(color, 0.10), fill: '-1', tension: 0.25 },
        // Live extrapolation (dashed).
        { label: 'Projected', data: model.projection, showLine: true, borderColor: fa(color, 0.85), borderWidth: 2, borderDash: [6, 5], pointRadius: 0, fill: false, tension: 0.25 },
        // Disclosed history (solid, diamond markers).
        { label: 'Disclosed', data: model.history, showLine: true, borderColor: color, borderWidth: 2.5, pointStyle: 'rectRot', pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: color, pointBorderColor: color, fill: false, tension: 0 },
      ],
    };
  }, [model, color]);

  const options = useMemo(() => {
    if (!model) return null;
    const maxHi = Math.max(...model.bandUpper.map(p => p.y));
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { display: false },
        nowLine: { now: model.now },
        tooltip: {
          filter: item => item.dataset.label === 'Disclosed' || item.dataset.label === 'Projected',
          callbacks: {
            label: ctx => {
              const tag = ctx.dataset.label === 'Disclosed' ? 'disclosed' : 'projected';
              return `$${ctx.raw.y.toFixed(1)}B ${tag} · ${fmtDate(ctx.raw.x)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: model.history[0].x,
          max: model.horizonEnd,
          ticks: { ...TICK, maxTicksLimit: 7, callback: fmtMonth },
          grid: GRID,
          border: BORD,
        },
        y: logMode
          ? {
              type: 'logarithmic',
              min: Math.max(0.1, model.history[0].y * 0.8),
              grid: GRID,
              border: BORD,
              ticks: { ...TICK, callback: v => (Number.isInteger(Math.log10(v)) ? `$${v}B` : '') },
            }
          : {
              type: 'linear',
              beginAtZero: true,
              suggestedMax: maxHi * 1.05,
              grid: GRID,
              border: BORD,
              ticks: { ...TICK, callback: v => `$${v}B` },
            },
      },
    };
  }, [model, logMode]);

  if (!model) return null;
  if (sectorOverviewMode && chartId && !isPinned(chartId, activeSector)) return null;
  if (pageCharts && chartId && !pageCharts.has(chartId)) return null;

  const up = model.yoyPct >= 0;
  const rateUp = model.perHourUsd >= 0;

  return (
    <div className="cbox arr-card">
      <div className="ch-head">
        <div className="ch-title">{name.toUpperCase()} — ESTIMATED ARR</div>
        <div className="ch-meta">
          <span className="freq-badge freq-live">live</span>
        </div>
      </div>

      <div className="arr-hero">
        <div className="arr-ticker" style={{ color }}>${fmtCurrentArr(live)}</div>
        <div className="arr-sub">
          <span className={`arr-yoy ${up ? 'up' : 'dn'}`}>Y/Y {up ? '+' : ''}{withCommas(model.yoyPct)}%</span>
          <span className="arr-detail">
            {rateUp ? '+' : '−'}${withCommas(Math.abs(model.perHourUsd))}/hr
            <span className="arr-dot">·</span>
            implied M/M {model.monthlyPct.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="arr-chart-wrap" style={{ height }}>
        <button className="arr-log-btn" onClick={() => setLogMode(v => !v)} title="Toggle linear / log axis">
          {logMode ? 'linear' : 'log'}
        </button>
        <Scatter data={data} options={options} plugins={[NOW_LINE]} />
      </div>

      <div className="arr-legend">
        <span className="arr-leg"><span className="arr-leg-line" style={{ borderTopColor: color }} /> disclosed run-rate</span>
        <span className="arr-leg"><span className="arr-leg-line arr-leg-dash" style={{ borderTopColor: color }} /> live extrapolation</span>
        <span className="arr-leg"><span className="arr-leg-band" style={{ background: fa(color, 0.18) }} /> uncertainty band</span>
        <span className="arr-leg"><span className="arr-leg-diamond" style={{ background: color }} /> disclosure point</span>
      </div>

      <div className="ch-source-row">
        <span className="ch-source-label">Source:</span>{' '}
        <a className="ch-src" href="https://epoch.ai/data/ai-companies" target="_blank" rel="noopener noreferrer">
          Epoch AI — company disclosures &amp; media reports
        </a>
        <span className="ch-lag"> · extrapolation is model-based, not a forecast</span>
      </div>
    </div>
  );
}
