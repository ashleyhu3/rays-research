import { useMemo, useState } from 'react';
import { useResource } from '../../services/resourceCache';

// Fixed column geometry, shared by the candlestick chart and the data table so
// every candle lands exactly above its quarter's column. Both render as tables
// with the same <colgroup>, stacked in one horizontal-scroll container.
const LABEL_W = 96; // sticky left column (ticker / y-axis)
const COL_W = 60; // each quarter column
const CHART_H = 360; // candlestick chart height

const SUBTABS = [
  { key: 'oneDay', label: '1 Day' },
  { key: 'threeDay', label: '3 Days' },
  { key: 'oneWeek', label: '1 Week' },
];

const VIEWS = [
  { key: 'all', label: 'All Tickers' },
  { key: 'soxx', label: 'SOXX Index' },
];

// A ±10% move saturates the heatmap fully; larger moves clamp there.
const FILL_CLAMP = 0.10;
const UP = '#3fb950';
const DOWN = '#f87171';

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
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

function returnFill(value) {
  if (value == null || !Number.isFinite(value)) return undefined;
  return heatFill(Math.max(-1, Math.min(1, value / FILL_CLAMP)));
}

function shareFill(share) {
  if (share == null || !Number.isFinite(share)) return undefined;
  return heatFill((share - 0.5) / 0.5);
}

// Per-column mean return and share of tickers positive, over only the tickers
// with a value in that column (missing cells excluded from both).
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
    avg[q] = values.reduce((sum, v) => sum + v, 0) / values.length;
    share[q] = values.filter(v => v > 0).length / values.length;
  }
  return { avg, share };
}

function ColGroup({ quarters }) {
  return (
    <colgroup>
      <col style={{ width: LABEL_W }} />
      {quarters.map(q => <col key={q} style={{ width: COL_W }} />)}
    </colgroup>
  );
}

// Quarterly SOXX candlestick, rendered as a single-row table sharing the data
// table's column widths so each candle aligns with its quarter column. All
// candles use one shared price scale (global high/low across shown quarters).
// Both tables get the same explicit pixel width so their columns are identical
// regardless of container width — the guarantee behind candle/column alignment.
function tableWidth(quarters) {
  return LABEL_W + quarters.length * COL_W;
}

function CandleChart({ quarters, soxx }) {
  const candles = quarters.map(q => soxx[q]).filter(Boolean);
  if (!candles.length) return null;

  const hi = Math.max(...candles.map(c => c.high));
  const lo = Math.min(...candles.map(c => c.low));
  const pad = 10;
  const span = hi - lo || 1;
  const y = price => pad + (hi - price) / span * (CHART_H - 2 * pad);

  const TICKS = 6;
  const axisTicks = Array.from({ length: TICKS }, (_, i) => hi - (span * i) / (TICKS - 1));

  return (
    <table className="pr-candle-table" style={{ width: tableWidth(quarters) }}>
      <ColGroup quarters={quarters} />
      <tbody>
        <tr>
          <td className="pr-candle-axis">
            <svg width={LABEL_W} height={CHART_H} aria-hidden="true">
              {axisTicks.map((p, i) => (
                <text key={i} x={LABEL_W - 6} y={y(p) + 3} textAnchor="end" className="pr-candle-axis-label">
                  {p >= 100 ? p.toFixed(0) : p.toFixed(1)}
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
                  <svg width={COL_W} height={CHART_H} aria-hidden="true">{gridlines}</svg>
                </td>
              );
            }
            const up = c.close >= c.open;
            const color = up ? UP : DOWN;
            const bodyTop = y(Math.max(c.open, c.close));
            const bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));
            const cx = COL_W / 2;
            const bw = Math.round(COL_W * 0.5);
            return (
              <td key={q} className="pr-candle-cell">
                <svg width={COL_W} height={CHART_H} role="img"
                  aria-label={`SOXX ${q}: open ${c.open.toFixed(2)}, high ${c.high.toFixed(2)}, low ${c.low.toFixed(2)}, close ${c.close.toFixed(2)}`}>
                  <title>{`SOXX ${q} — O ${c.open.toFixed(2)}  H ${c.high.toFixed(2)}  L ${c.low.toFixed(2)}  C ${c.close.toFixed(2)}`}</title>
                  {gridlines}
                  <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.5" />
                  <rect x={cx - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
                </svg>
              </td>
            );
          })}
        </tr>
      </tbody>
    </table>
  );
}

// Price reaction to each tracked ticker's last ~40 quarterly earnings calls
// (~10 years), one column per reported quarter (chronological, oldest left),
// one row per ticker, above a quarterly SOXX candlestick aligned to the same
// columns. The sidebar switches between all tracked tickers and just the SOXX
// index members; the subtabs switch the post-earnings window.
export default function PriceReturn() {
  const { data, error, loading } = useResource('/api/alerts/price-return');
  const [view, setView] = useState('all');
  const [metric, setMetric] = useState('oneDay');

  const allRows = data?.rows ?? [];
  const soxxSet = useMemo(() => new Set(data?.soxxConstituents ?? []), [data]);
  const rows = view === 'soxx' ? allRows.filter(r => soxxSet.has(r.ticker)) : allRows;
  // API returns quarters newest-first; show chronologically (oldest left).
  const quarters = useMemo(() => [...(data?.quarters ?? [])].reverse(), [data]);
  const soxx = data?.soxx ?? {};
  const { avg, share } = useMemo(() => columnSummary(rows, quarters, metric), [rows, quarters, metric]);

  return (
    <div className="pr-layout">
      <nav className="pr-nav" aria-label="Price return views">
        {VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            className={`or-nav-item${view === v.key ? ' active' : ''}`}
            onClick={() => setView(v.key)}
          >
            <span className="or-nav-name">{v.label}</span>
          </button>
        ))}
      </nav>

      <section className="pr-page">
        <header className="cal-head">
          <h3>Price Return After Earnings{view === 'soxx' ? ' — SOXX Index' : ''}</h3>
          {loading && <span className="cal-status">Loading price return data…</span>}
          {error && <span className="cal-status err">{error}</span>}
        </header>

        <div className="pr-subtabs" role="tablist" aria-label="Return window">
          {SUBTABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={metric === tab.key}
              className={`rbtn${metric === tab.key ? ' active' : ''}`}
              onClick={() => setMetric(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!loading && !error && !rows.length && (
          <div className="or-status">No price return data yet — run the backfill script to populate it.</div>
        )}

        {rows.length > 0 && (
          <div className="or-table-wrap pr-scroll">
            <div className="pr-candle-caption">SOXX — quarterly price</div>
            <CandleChart quarters={quarters} soxx={soxx} />
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
                  <td className="pr-ticker-col pr-summary-label">Average</td>
                  {quarters.map(q => (
                    <td key={q} className={avg[q] == null ? 'pr-empty' : undefined} style={returnFill(avg[q])}>
                      {formatPct(avg[q])}
                    </td>
                  ))}
                </tr>
                <tr className="pr-summary pr-summary-last">
                  <td className="pr-ticker-col pr-summary-label">% Positive</td>
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
                          style={returnFill(value)}
                          title={cell?.date ? `Reported ${cell.date}` : undefined}
                        >
                          {formatPct(value)}
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
    </div>
  );
}
