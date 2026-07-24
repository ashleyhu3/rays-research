import { useMemo, useState } from 'react';
import { useResource } from '../../services/resourceCache';

const SUBTABS = [
  { key: 'oneDay', label: '1 Day' },
  { key: 'threeDay', label: '3 Days' },
  { key: 'oneWeek', label: '1 Week' },
];

// A ±10% move saturates the heatmap fully; anything larger is clamped. Most
// post-earnings reactions fall inside this band, so smaller moves still get a
// visible tint while the extremes read as vivid green/red.
const FILL_CLAMP = 0.10;

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

// Diverging heatmap fill from a signed intensity in [-1, 1]: gray at 0, green
// for positive, red for negative, saturation growing with magnitude. Lightness
// is held dark enough that white text stays legible even near zero. Returns
// undefined for no-data cells so they keep the plain muted "—" styling.
function heatFill(intensity) {
  if (intensity == null || !Number.isFinite(intensity)) return undefined;
  const mag = Math.min(Math.abs(intensity), 1);
  const hue = intensity >= 0 ? 145 : 5;
  const sat = Math.round(12 + mag * 63); // 12%..75%
  const light = Math.round(42 - mag * 6); // 42%..36%
  return { backgroundColor: `hsl(${hue} ${sat}% ${light}%)`, color: '#fff' };
}

// Fill for a return value (0-centered): scale against the ±10% clamp.
function returnFill(value) {
  if (value == null || !Number.isFinite(value)) return undefined;
  return heatFill(Math.max(-1, Math.min(1, value / FILL_CLAMP)));
}

// Fill for a share-positive value in [0, 1] (50%-centered): 100% → green,
// 50% → neutral, 0% → red.
function shareFill(share) {
  if (share == null || !Number.isFinite(share)) return undefined;
  return heatFill((share - 0.5) / 0.5);
}

// Per-column mean return and share of tickers that were positive, computed only
// over the tickers that actually have a value in that column (missing cells are
// excluded from both, not counted as zero).
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

// Price reaction to each tracked ticker's last ~40 quarterly earnings calls
// (~10 years), one column per earnings-reporting quarter (chronological, oldest
// on the left) and one row per ticker. The three subtabs switch which
// post-earnings window (1 trading day / 3 trading days / 1 week) the cells
// report — the data is fetched once and shared across all three. It's scraped
// and computed ahead of time (API Ninjas earnings dates + Yahoo Finance daily
// closes — see server/priceReturnAfterEarnings.js), so this is a cache read.
export default function PriceReturn() {
  const { data, error, loading } = useResource('/api/alerts/price-return');
  const [metric, setMetric] = useState('oneDay');

  const rows = data?.rows ?? [];
  // API returns quarters newest-first; show them chronologically (oldest left).
  const quarters = useMemo(() => [...(data?.quarters ?? [])].reverse(), [data]);
  const { avg, share } = useMemo(
    () => columnSummary(rows, quarters, metric),
    [rows, quarters, metric],
  );

  return (
    <section className="pr-page">
      <header className="cal-head">
        <h3>Price Return After Earnings</h3>
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
        <div className="or-table-wrap pr-table-wrap">
          <table className="or-table pr-table">
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
  );
}
