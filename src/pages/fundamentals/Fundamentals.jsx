import { useEffect, useMemo, useState } from 'react';
import { useResource } from '../../services/resourceCache';

// Fixed column geometry, shared by the candlestick chart and the data table so
// every candle lands exactly above its quarter's column. Both render as tables
// with the same <colgroup>, stacked in one horizontal-scroll container. Same
// geometry as the Price Return page — the two grids are meant to read as one
// format with different numbers in the cells.
const LABEL_W = 96; // sticky left column (ticker / y-axis)
const COL_W = 60; // each quarter column

// Chart takes ~1/3 of the scrollable table region so the table gets ~2/3. The
// region is ~0.75 of the window (the top nav, header and subtabs take the rest),
// so ~1/3 of it is ~0.24 of the window height. Responsive rather than fixed px.
const CHART_VH = 0.24;
const CHART_H_MIN = 180;
// The CSP section holds only four tickers, so the table needs a fraction of the
// vertical space the SOXX section does — give the reclaimed height to the chart.
const CHART_VH_TALL = 0.46;
const CHART_H_MIN_TALL = 320;

function useChartHeight(tall) {
  const measure = (isTall) => {
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    return isTall
      ? Math.max(CHART_H_MIN_TALL, Math.round(vh * CHART_VH_TALL))
      : Math.max(CHART_H_MIN, Math.round(vh * CHART_VH));
  };
  const [height, setHeight] = useState(() => measure(tall));
  useEffect(() => {
    const onResize = () => setHeight(measure(tall));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [tall]);
  return height;
}

// The sidebar is a two-level menu. Free cash flow is specific to the CSP view;
// the SOXX section keeps the four existing growth views.
const METRICS = [
  { key: 'revenueYoY',   label: 'Revenue YoY',    title: 'Total Revenue — YoY Growth' },
  { key: 'revenueQoQ',   label: 'Revenue QoQ',    title: 'Total Revenue — QoQ Growth' },
  { key: 'netIncomeYoY', label: 'Net Income YoY', title: 'Net Income — YoY Growth' },
  { key: 'netIncomeQoQ', label: 'Net Income QoQ', title: 'Net Income — QoQ Growth' },
  { key: 'freeCashFlow', label: 'Free Cash Flow', title: 'Free Cash Flow' },
];

const SECTIONS = [
  { key: 'soxx', label: 'SOXX', suffix: ' — SOXX Index', metrics: METRICS.slice(0, 4) },
  { key: 'csp',  label: 'CSP',  suffix: ' — Cloud Service Providers', metrics: METRICS },
];

// Fallbacks if the API predates the section fields (stale cached blob). An
// empty SOXX fallback means "everything not in CSP", which is what the payload
// used to be.
const CSP_FALLBACK = ['AMZN', 'GOOG', 'MSFT', 'META'];

// Growth rates swing far wider than post-earnings price moves, so the heatmap
// saturates at a wider band than Price Return's ±10% — a ±50% quarter is a big
// but ordinary semiconductor print, and clamping at ±10% would paint most of
// the grid solid. YoY and QoQ get different clamps because sequential moves are
// naturally the smaller of the two.
const CLAMP = { revenueYoY: 0.50, revenueQoQ: 0.25, netIncomeYoY: 1.00, netIncomeQoQ: 0.50 };
const UP = '#3fb950';
const DOWN = '#f87171';

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  // Triple-digit growth is common in net income; drop the decimals there so the
  // number still fits the 60px column.
  const digits = Math.abs(pct) >= 100 ? 0 : 1;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

function formatDollars(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Diverging heatmap fill from a signed intensity in [-1, 1]: gray at 0, green
// positive, red negative, kept dark enough for white text to stay legible.
function heatFill(intensity) {
  if (intensity == null || !Number.isFinite(intensity)) return undefined;
  const mag = Math.min(Math.abs(intensity), 1);
  const hue = intensity >= 0 ? 145 : 5;
  const sat = Math.round(12 + mag * 63);
  const light = Math.round(42 - mag * 6);
  return { backgroundColor: `hsl(${hue} ${sat}% ${light}%)`, color: '#fff' };
}

function growthFill(value, clamp) {
  if (value == null || !Number.isFinite(value)) return undefined;
  return heatFill(Math.max(-1, Math.min(1, value / clamp)));
}

function shareFill(share) {
  if (share == null || !Number.isFinite(share)) return undefined;
  return heatFill((share - 0.5) / 0.5);
}

// Per-column median growth and share of tickers growing, over only the tickers
// with a value in that column (missing cells excluded from both). Median rather
// than mean: one small-base ticker printing +900% revenue growth would drag a
// mean far away from what the column actually did.
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function columnSummary(rows, quarters, metric) {
  const avg = {};
  const share = {};
  for (const q of quarters) {
    const values = [];
    for (const row of rows) {
      const v = row.cells[q]?.[metric];
      if (v != null && Number.isFinite(v)) values.push(v);
    }
    if (!values.length) { avg[q] = null; share[q] = null; continue; }
    avg[q] = median(values);
    share[q] = values.filter(v => v > 0).length / values.length;
  }
  return { avg, share };
}

function maxAbsValue(rows, quarters, metric) {
  let max = 0;
  for (const row of rows) {
    for (const q of quarters) {
      const value = row.cells[q]?.[metric];
      if (value != null && Number.isFinite(value)) max = Math.max(max, Math.abs(value));
    }
  }
  return max || 1;
}

// Round "nice" price gridlines (…50, 100, 200, 500…) spanning [lo, hi] for a
// log axis — the 1/2/5×10ⁿ ladder, which reads far cleaner than raw log-spaced
// values. Always includes a tick at or below lo and at or above hi.
function niceLogTicks(lo, hi) {
  const ladder = [1, 2, 5];
  const ticks = [];
  const startExp = Math.floor(Math.log10(lo));
  const endExp = Math.ceil(Math.log10(hi));
  for (let exp = startExp; exp <= endExp; exp++) {
    for (const m of ladder) {
      const v = m * 10 ** exp;
      if (v >= lo * 0.9 && v <= hi * 1.1) ticks.push(v);
    }
  }
  return ticks.length ? ticks : [lo, hi];
}

function ColGroup({ quarters }) {
  return (
    <colgroup>
      <col style={{ width: LABEL_W }} />
      {quarters.map(q => <col key={q} style={{ width: COL_W }} />)}
    </colgroup>
  );
}

// Both tables get the same explicit pixel width so their columns are identical
// regardless of container width — the guarantee behind candle/column alignment.
function tableWidth(quarters) {
  return LABEL_W + quarters.length * COL_W;
}

function fmtPrice(v) {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}

// Quarterly SOXX candlestick, rendered as a single-row table sharing the data
// table's column widths so each candle aligns with its quarter column. All
// candles use one shared price scale (global high/low across shown quarters).
function CandleChart({ quarters, soxx, height, onHover }) {
  const candles = quarters.map(q => soxx[q]).filter(Boolean);
  if (!candles.length) return null;

  const hi = Math.max(...candles.map(c => c.high));
  const lo = Math.min(...candles.map(c => c.low));
  // Logarithmic price axis: SOXX ranges ~7x across the window, so a linear
  // scale squashes the early, cheaper quarters into an unreadable strip. On a
  // log scale equal percentage moves take equal vertical space, so every
  // quarter's candle stays legible.
  const pad = 12;
  const logHi = Math.log(hi);
  const logLo = Math.log(lo);
  const logSpan = (logHi - logLo) || 1;
  const y = price => pad + (logHi - Math.log(price)) / logSpan * (height - 2 * pad);

  const axisTicks = niceLogTicks(lo, hi);

  return (
    <table className="pr-candle-table" style={{ width: tableWidth(quarters) }}>
      <ColGroup quarters={quarters} />
      <tbody>
        <tr>
          <td className="pr-candle-axis">
            <svg width={LABEL_W} height={height} aria-hidden="true">
              {axisTicks.map((p, i) => (
                <text key={i} x={LABEL_W - 6} y={y(p) + 3} textAnchor="end" className="pr-candle-axis-label">
                  {p >= 10 ? p.toFixed(0) : p.toFixed(1)}
                </text>
              ))}
            </svg>
          </td>
          {quarters.map(q => {
            const c = soxx[q];
            const gridlines = axisTicks.map((p, i) => (
              <line key={i} x1="0" x2={COL_W} y1={y(p)} y2={y(p)} className="pr-candle-grid" />
            ));
            if (!c) {
              return (
                <td key={q} className="pr-candle-cell">
                  <svg width={COL_W} height={height} aria-hidden="true">{gridlines}</svg>
                </td>
              );
            }
            const up = c.close >= c.open;
            const color = up ? UP : DOWN;
            const bodyTop = y(Math.max(c.open, c.close));
            const bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
            const cx = COL_W / 2;
            const bw = Math.round(COL_W * 0.5);
            const labelY = Math.max(9, y(c.high) - 5); // close price sits just above the bar
            return (
              <td key={q} className="pr-candle-cell"
                onMouseEnter={e => onHover({ q, ...c, up, x: e.clientX, y: e.clientY })}
                onMouseMove={e => onHover({ q, ...c, up, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => onHover(null)}>
                <svg width={COL_W} height={height} role="img"
                  aria-label={`SOXX ${q}: open ${c.open.toFixed(2)}, high ${c.high.toFixed(2)}, low ${c.low.toFixed(2)}, close ${c.close.toFixed(2)}`}>
                  {gridlines}
                  <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.5" />
                  <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
                  <text x={cx} y={labelY} textAnchor="middle" className="pr-candle-price">{fmtPrice(c.close)}</text>
                </svg>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

// Quarterly revenue and net-income growth, one column per fiscal quarter
// (chronological, oldest left), one row per ticker, above the same quarterly
// SOXX candlestick the Price Return page uses. The sidebar picks one of two
// ticker sections (SOXX constituents or the hyperscaler CSPs), four growth
// measures, and a CSP-only free-cash-flow level view.
export default function Fundamentals() {
  const { data, error, loading } = useResource('/api/fundamentals/growth');
  const [section, setSection] = useState('soxx');
  const [metric, setMetric] = useState('revenueYoY');
  const [hover, setHover] = useState(null);
  const chartH = useChartHeight(section === 'csp');

  const allRows = data?.rows ?? [];
  const cspSet = useMemo(() => new Set(data?.cspTickers ?? CSP_FALLBACK), [data]);
  const soxxSet = useMemo(() => new Set(data?.soxxTickers ?? []), [data]);
  const rows = useMemo(() => {
    if (section === 'csp') return allRows.filter(r => cspSet.has(r.ticker));
    // Explicit SOXX roster when the API sends one; otherwise "not a CSP", which
    // matches what the payload contained before the section split.
    return soxxSet.size
      ? allRows.filter(r => soxxSet.has(r.ticker))
      : allRows.filter(r => !cspSet.has(r.ticker));
  }, [section, allRows, soxxSet, cspSet]);

  // API returns quarters newest-first; show chronologically (oldest left).
  const quarters = useMemo(() => [...(data?.quarters ?? [])].reverse(), [data]);
  const soxx = data?.soxx ?? {};
  const { avg, share } = useMemo(() => columnSummary(rows, quarters, metric), [rows, quarters, metric]);
  const view = METRICS.find(v => v.key === metric) ?? METRICS[0];
  const sectionMeta = SECTIONS.find(s => s.key === section) ?? SECTIONS[0];
  const clamp = CLAMP[metric];
  const isDollarMetric = metric === 'freeCashFlow';
  const levelClamp = useMemo(
    () => maxAbsValue(rows, quarters, metric),
    [rows, quarters, metric],
  );
  const formatValue = isDollarMetric ? formatDollars : formatPct;
  const valueFill = value => growthFill(value, isDollarMetric ? levelClamp : clamp);

  return (
    <div className="pr-layout">
      <nav className="pr-nav" aria-label="Fundamentals views">
        {SECTIONS.map(s => (
          <div key={s.key} className="pr-nav-group">
            <div className="pr-nav-group-label">{s.label}</div>
            {s.metrics.map(v => {
              const active = section === s.key && metric === v.key;
              return (
                <button
                  key={v.key}
                  type="button"
                  className={`or-nav-item${active ? ' active' : ''}`}
                  onClick={() => { setSection(s.key); setMetric(v.key); }}
                >
                  <span className="or-nav-name">{v.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <section className="pr-page">
        <header className="pr-head">
          <h3>{view.title}{sectionMeta.suffix}</h3>
          {loading && <span className="cal-status">Loading fundamentals data…</span>}
          {error && <span className="cal-status err">{error}</span>}
        </header>

        {!loading && !error && !rows.length && (
          <div className="or-status">No fundamentals data yet — run the backfill script to populate it.</div>
        )}

        {rows.length > 0 && (
          <div className="or-table-wrap pr-scroll" style={{ '--pr-pin': `${chartH + 4}px` }}>
            {/* Pinned so the SOXX chart stays in view while the table scrolls. */}
            <div className="pr-chart-pin">
              <CandleChart quarters={quarters} soxx={soxx} height={chartH} onHover={setHover} />
            </div>
            <table className="or-table pr-table" style={{ width: tableWidth(quarters) }}>
              <ColGroup quarters={quarters} />
              <thead>
                <tr>
                  <th className="pr-ticker-col">Ticker</th>
                  {quarters.map(q => <th key={q}>{q}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="pr-summary">
                  <td className="pr-ticker-col pr-summary-label">Median</td>
                  {quarters.map(q => (
                    <td key={q} className={avg[q] == null ? 'pr-empty' : undefined} style={valueFill(avg[q])}>
                      {formatValue(avg[q])}
                    </td>
                  ))}
                </tr>
                <tr className="pr-summary pr-summary-last">
                  <td className="pr-ticker-col pr-summary-label">{isDollarMetric ? '% Positive' : '% Growing'}</td>
                  {quarters.map(q => (
                    <td key={q} className={share[q] == null ? 'pr-empty' : undefined} style={shareFill(share[q])}>
                      {share[q] == null ? '—' : `${Math.round(share[q] * 100)}%`}
                    </td>
                  ))}
                </tr>
                {rows.map(row => (
                  <tr key={row.ticker}>
                    <td className="pr-ticker-col pr-ticker">{row.ticker}</td>
                    {quarters.map(q => {
                      const cell = row.cells[q];
                      const value = cell ? cell[metric] : null;
                      return (
                        <td
                          key={q}
                          className={value == null ? 'pr-empty' : undefined}
                          style={valueFill(value)}
                          title={cell?.periodEnd ? `Fiscal quarter ended ${cell.periodEnd}` : undefined}
                        >
                          {formatValue(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hover && <CandleHoverCard hover={hover} />}
    </div>
  );
}

// Floating OHLC card that follows the cursor over a candle. position: fixed so
// it escapes the scroll container's clipping; nudged left/up near the viewport
// edges so it never runs off-screen.
function CandleHoverCard({ hover }) {
  const flipX = hover.x > window.innerWidth - 190;
  const flipY = hover.y > window.innerHeight - 150;
  const style = {
    left: flipX ? hover.x - 186 : hover.x + 16,
    top: flipY ? hover.y - 140 : hover.y + 16,
  };
  const chg = hover.open ? (hover.close / hover.open - 1) * 100 : 0;
  return (
    <div className="pr-hovercard" style={style}>
      <div className="pr-hovercard-hd">
        SOXX · {hover.q}
        <span className={hover.up ? 'up' : 'dn'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
      </div>
      <dl>
        <div><dt>Open</dt><dd>{hover.open.toFixed(2)}</dd></div>
        <div><dt>High</dt><dd>{hover.high.toFixed(2)}</dd></div>
        <div><dt>Low</dt><dd>{hover.low.toFixed(2)}</dd></div>
        <div><dt>Close</dt><dd>{hover.close.toFixed(2)}</dd></div>
      </dl>
    </div>
  );
}
