import { useEffect } from 'react';
import { useOptionsReport } from '../../context/OptionsReportContext';

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

// The Alerts view is now just the daily options report body. Its title, date and
// action buttons live in the Topbar (see App.jsx). Data is scraped from Massive
// and stored in Mongo once a day at 7:45 AM Hong Kong time.
export default function Alerts() {
  const { report, loading, msg, load } = useOptionsReport();

  useEffect(() => { load(); }, [load]);

  return (
    <div className="alerts-page">
      {msg?.kind === 'err' && (
        <div className="alerts-note err" style={{ marginBottom: 14, maxWidth: 'none' }}>{msg.text}</div>
      )}

      {loading && !report ? (
        <div className="or-status">Loading the latest report…</div>
      ) : !report ? (
        <div className="or-status">
          No report has been generated yet. It builds automatically at 7:45 AM Hong Kong time — or click “Refresh now”.
        </div>
      ) : (
        <div className="or-report">
          {report.tickers?.map(t => (
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
          ))}
        </div>
      )}
    </div>
  );
}
