/**
 * ARR trajectory model.
 *
 * Takes a company's disclosed annualized-revenue run-rate points (from Epoch AI,
 * in $B) and derives a live-extrapolated model: an exponential fit over recent
 * disclosures, a projected "current" run-rate ticking up in real time, the
 * implied month-over-month growth, a trailing year-over-year figure, and a
 * forward projection with a widening uncertainty band.
 *
 * All growth math is done in continuous (log) space: `b` is the fitted
 * continuous daily growth rate, so value(t) = last · e^{b·Δdays}.
 */

const DAY = 86400000;
const MONTH_DAYS = 30.4375;
const MONTH = MONTH_DAYS * DAY;

const tOf = (d) => Date.parse(d + 'T00:00:00Z');

/** Log-linear (exponential) least-squares fit over [{ x(ms), y>0 }]. */
function fitExp(points) {
  const n = points.length;
  if (n < 2) return null;
  const x0 = points[0].x;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    const x = (p.x - x0) / DAY;        // days since first fit point
    const y = Math.log(p.y);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const b = (n * sxy - sx * sy) / denom;   // continuous growth / day
  const a = (sy - b * sx) / n;             // ln value at x0
  let ss = 0;
  for (const p of points) {
    const x = (p.x - x0) / DAY;
    const r = Math.log(p.y) - (a + b * x);
    ss += r * r;
  }
  const sigma = n > 2 ? Math.sqrt(ss / (n - 2)) : 0;   // residual std (ln space)
  return { a, b, x0, sigma };
}

/** Log-linear interpolation of the disclosed series at time t (ms). */
function interpAt(hist, t) {
  if (t <= hist[0].x) return hist[0].y;
  const last = hist[hist.length - 1];
  if (t >= last.x) return last.y;
  for (let i = 1; i < hist.length; i++) {
    if (t <= hist[i].x) {
      const p0 = hist[i - 1], p1 = hist[i];
      if (p1.x === p0.x) return p1.y;
      const f = (t - p0.x) / (p1.x - p0.x);
      return Math.exp(Math.log(p0.y) + f * (Math.log(p1.y) - Math.log(p0.y)));
    }
  }
  return last.y;
}

/**
 * @param {{date:string, value:number}[]} series  disclosed run-rate points ($B)
 * @param {{ now?:number, horizonMonths?:number, fitMonths?:number, asOf?:string }} opts
 * @returns model, or null if there isn't enough data to fit.
 */
export function buildArrModel(series, opts = {}) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const hist = series
    .map(p => ({ x: tOf(p.date), y: +p.value }))
    .filter(p => Number.isFinite(p.x) && p.y > 0)
    .sort((a, b) => a.x - b.x);
  if (hist.length < 2) return null;

  const last = hist[hist.length - 1];
  const now = Math.max(opts.now ?? Date.now(), last.x);
  const horizonMonths = opts.horizonMonths ?? 8;
  const fitMonths = opts.fitMonths ?? 18;

  // Fit the exponential over the trailing window (falls back to the last few
  // points when the window is too sparse to be meaningful).
  const fitCutoff = last.x - fitMonths * MONTH;
  let fitPts = hist.filter(p => p.x >= fitCutoff);
  if (fitPts.length < 4) fitPts = hist.slice(-Math.min(hist.length, 5));
  const fit = fitExp(fitPts);
  if (!fit) return null;
  const b = fit.b;

  const monthlyPct = (Math.exp(b * MONTH_DAYS) - 1) * 100;
  const curr = last.y * Math.exp(b * (now - last.x) / DAY);   // current $B run-rate
  const perHourUsd = (b / 24) * curr * 1e9;                   // $ added per hour
  const yAgo = interpAt(hist, now - 365 * DAY);
  const yoyPct = (curr / yAgo - 1) * 100;

  // Forward path: the instantaneous growth rate decays from its current value
  // `b` toward a terminal monthly rate over timescale `lambda`, so the
  // extrapolation tempers instead of compounding a blistering recent pace off
  // the chart. The path's initial slope still equals `b`, so it meets the live
  // ticker's rate exactly at "now". Cumulative log-growth τ days after now:
  //   ∫₀^τ [bTerm + (b−bTerm)·e^{−u/λ}] du
  const termMonthly = opts.terminalMonthly ?? 0.06;
  const bTerm = Math.min(b, Math.log(1 + termMonthly) / MONTH_DAYS);
  const lambda = opts.decayDays ?? 90;
  const gFwd = (tau) => bTerm * tau + (b - bTerm) * lambda * (1 - Math.exp(-tau / lambda));
  const valueAt = (t) => t <= now
    ? last.y * Math.exp(b * (t - last.x) / DAY)               // short gap: recent rate
    : curr * Math.exp(gFwd((t - now) / DAY));                 // forward: decaying rate

  // Forward samples (fortnightly) from the last disclosure through the horizon,
  // with a band that stays tight up to "now" then widens ∝ √(months ahead).
  const horizonEnd = now + horizonMonths * MONTH;
  const k = Math.min(0.16, Math.max(0.09, (fit.sigma || 0) * 0.5)); // band / √month
  const projection = [], bandUpper = [], bandLower = [];
  const steps = Math.max(2, Math.round((horizonEnd - last.x) / (MONTH / 2)));
  for (let i = 0; i <= steps; i++) {
    const t = last.x + (i / steps) * (horizonEnd - last.x);
    const y = valueAt(t);
    projection.push({ x: t, y: +y.toFixed(3) });
    const monthsAhead = Math.max(0, (t - now) / MONTH);
    const hw = Math.min(0.9, k * Math.sqrt(monthsAhead));
    bandUpper.push({ x: t, y: +(y * Math.exp(hw)).toFixed(3) });
    bandLower.push({ x: t, y: +(y * Math.exp(-hw)).toFixed(3) });
  }

  return {
    history: hist.map(p => ({ x: p.x, y: p.y })),
    projection, bandUpper, bandLower,
    curr, perHourUsd, monthlyPct, yoyPct, b,
    now, horizonEnd,
    lastDate: series[series.length - 1]?.date,
    asOf: opts.asOf,
  };
}
