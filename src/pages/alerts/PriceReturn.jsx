import { useState } from 'react';
import { useResource } from '../../services/resourceCache';

const SUBTABS = [
  { key: 'oneDay', label: '1 Day' },
  { key: 'threeDay', label: '3 Days' },
  { key: 'oneWeek', label: '1 Week' },
];

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function pctClass(value) {
  if (value == null || !Number.isFinite(value)) return 'nt';
  return value > 0 ? 'up' : value < 0 ? 'dn' : 'nt';
}

// Price reaction to each tracked ticker's last ~20 quarterly earnings calls
// (~5 years), one column per quarter and one row per ticker. The three
// subtabs switch which post-earnings window (1 trading day / 3 trading days /
// 1 week) the table's cells report — the underlying data is fetched once and
// shared across all three. Data is scraped and computed ahead of time (Alpha
// Vantage earnings history + Yahoo Finance daily closes — see
// server/priceReturnAfterEarnings.js), so this is a synchronous cache read.
export default function PriceReturn() {
  const { data, error, loading } = useResource('/api/alerts/price-return');
  const [metric, setMetric] = useState('oneDay');

  const quarters = data?.quarters ?? [];
  const rows = data?.rows ?? [];

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
              {rows.map(row => (
                <tr key={row.ticker}>
                  <td className="pr-ticker-col pr-ticker">{row.ticker}</td>
                  {quarters.map(q => {
                    const cell = row.cells[q];
                    const value = cell ? cell[metric] : null;
                    return (
                      <td
                        key={q}
                        className={pctClass(value)}
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
