import { useEffect, useState } from 'react';
import { useOptionsReport } from '../../context/OptionsReportContext';

// A ticker's call/put flow "surge": today's summed contract volume is a large
// step up from the prior trading day. Mirrors the up/down arrows in the pricing
// and AI-demand sidebars — here a green dot means calls surged, red means puts.
const SURGE_MULTIPLE = 1.6;   // today ≥ 1.6× the prior day
const SURGE_MIN_ABS  = 200;   // and at least +200 contracts, to ignore thin names

function flowSurge(flow) {
  if (!flow) return { calls: false, puts: false };
  const surged = (today, prior) =>
    prior > 0 && today >= prior * SURGE_MULTIPLE && today - prior >= SURGE_MIN_ABS;
  return {
    calls: surged(flow.callToday, flow.callYesterday),
    puts:  surged(flow.putToday, flow.putYesterday),
  };
}

// One contract table (calls or puts). The side (CALL/PUT) and strike price get
// their own columns; all cells arrive pre-formatted from the server payload.
function ContractTable({ rows }) {
  return (
    <div className="or-table-wrap">
      <table className="or-table">
        <thead>
          <tr>
            <th>Side</th>
            <th>Price</th>
            <th>Today</th>
            <th>Yest.</th>
            <th>Δ DoD</th>
            <th>×5D</th>
            <th>Vol/OI</th>
            <th>IV</th>
            <th>Money</th>
          </tr>
        </thead>
        <tbody>
          {rows?.length ? rows.map((r, i) => {
            // Tolerate the older payload shape ({ contract: "CALL $435.00" })
            // until a fresh scrape replaces it with { side, strike }.
            const side = r.side || (/^\s*put/i.test(r.contract || '') ? 'put' : 'call');
            const strike = r.strike || (r.contract ? r.contract.replace(/^\s*(CALL|PUT)\s+/i, '') : '—');
            return (
            <tr key={`${strike}-${i}`}>
              <td className={`or-side-cell ${side === 'call' ? 'or-c-call' : 'or-c-put'}`}>{side.toUpperCase()}</td>
              <td className="or-strike">{strike}</td>
              <td>{r.today}</td>
              <td>{r.yesterday}</td>
              <td>{r.dod}</td>
              <td>{r.fiveDay}</td>
              <td>{r.volOi}</td>
              <td>{r.iv}</td>
              <td>{r.money}</td>
            </tr>
            );
          }) : (
            <tr><td className="or-empty" colSpan={9}>—</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Human-friendly report date: "2026-07-08" → "July 8, 2026".
function formatReportDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// The report date is the prominent heading in the Topbar; "Daily Options
// Report" sits beside it as a small label.
export function OptionsReportTitle() {
  const { report } = useOptionsReport();
  const dateLabel = report?.date ? formatReportDate(report.date) : null;
  return (
    <div className="or-title">
      <h1 className="or-title-date">{dateLabel || 'Daily Options Report'}</h1>
      {dateLabel && <span className="or-title-label">Daily Options Report</span>}
    </div>
  );
}

// Refresh / Download controls that replace the time-toggle buttons in the Topbar.
export function OptionsReportControls() {
  const { report, busy, refresh, download } = useOptionsReport();
  return (
    <>
      <button type="button" className="rbtn" onClick={refresh} disabled={busy}>
        {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
      <button type="button" className="rbtn" onClick={download} disabled={!report}>
        Download PDF
      </button>
    </>
  );
}

// One ticker's full report body: price header plus a call/put block per tracked
// expiration. Shown one ticker at a time, selected from the sidebar.
function TickerReport({ t }) {
  return (
    <section className="or-ticker" key={t.ticker}>
      <header className="or-ticker-head">
        <h3>{t.ticker}</h3>
        <div className="or-ticker-price">
          <span>{t.priceText}</span>
          {t.change && <span className={t.priceChange >= 0 ? 'up' : 'down'}>{t.change}</span>}
        </div>
      </header>
      {t.expirations?.map(exp => (
        <div className="or-expiry" key={exp.selectedDate}>
          <div className="or-expiry-label">{exp.expiryLabel}</div>
          <div className="or-cols">
            <div className="or-col">
              <div className="or-chart" dangerouslySetInnerHTML={{ __html: exp.callChartSvg }} />
              <ContractTable rows={exp.tableCalls} />
            </div>
            <div className="or-col">
              <div className="or-chart" dangerouslySetInnerHTML={{ __html: exp.putChartSvg }} />
              <ContractTable rows={exp.tablePuts} />
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

// Sidebar entry for one ticker. A green dot flags a day-over-day surge in call
// volume, a red dot a surge in put volume — analogous to the trend arrows in the
// pricing / AI-demand sidebars.
function TickerNavItem({ t, active, onSelect }) {
  const surge = flowSurge(t.flow);
  return (
    <button
      className={`or-nav-item${active ? ' active' : ''}`}
      onClick={() => onSelect(t.ticker)}
    >
      <span className="or-nav-name">{t.ticker}</span>
      <span className="or-nav-dots">
        {surge.calls && (
          <span className="or-dot call" title="Large jump in call volume vs. yesterday" aria-label="Call volume surge" />
        )}
        {surge.puts && (
          <span className="or-dot put" title="Large jump in put volume vs. yesterday" aria-label="Put volume surge" />
        )}
      </span>
    </button>
  );
}

// The Alerts view is the daily options report. Each ticker gets its own page,
// switched via the left sidebar; a coloured dot next to a ticker flags a
// day-over-day call (green) or put (red) volume surge. Title, date and action
// buttons live in the Topbar (see App.jsx). Data is scraped from Massive and
// stored in Mongo once a day at 7:45 AM Hong Kong time.
export default function Alerts() {
  const { report, loading, msg, load } = useOptionsReport();
  const [selected, setSelected] = useState(null);

  useEffect(() => { load(); }, [load]);

  const tickers = report?.tickers ?? [];
  const active = tickers.find(t => t.ticker === selected) ?? tickers[0] ?? null;

  return (
    <div className="alerts-page">
      {msg?.kind === 'err' && (
        <div className="alerts-note err" style={{ marginBottom: 14, maxWidth: 'none' }}>{msg.text}</div>
      )}

      {loading && !report ? (
        <div className="or-status">Loading the latest report…</div>
      ) : !active ? (
        <div className="or-status">
          No report has been generated yet. It builds automatically at 7:45 AM Hong Kong time — or click “Refresh now”.
        </div>
      ) : (
        <div className="or-layout">
          <nav className="or-nav" aria-label="Tickers">
            {tickers.map(t => (
              <TickerNavItem
                key={t.ticker}
                t={t}
                active={t.ticker === active.ticker}
                onSelect={setSelected}
              />
            ))}
          </nav>
          <div className="or-report">
            <TickerReport t={active} />
          </div>
        </div>
      )}
    </div>
  );
}
