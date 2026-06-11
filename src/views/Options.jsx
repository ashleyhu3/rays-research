import { useState, useRef } from 'react';

const SAMPLES = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'AMZN', 'META'];

function fmtUSD(v)   { return v != null ? `$${v.toFixed(2)}` : '—'; }
function fmtVol(v)   { return v > 0 ? v.toLocaleString() : '—'; }
function fmtOI(v)    { return v != null ? v.toLocaleString() : '—'; }
function fmtIV(v)    { return v != null ? `${v.toFixed(1)}%` : '—'; }
function fmtRatio(vol, oi) {
  if (!vol || !oi) return '—';
  return (vol / oi).toFixed(2);
}

function fmtExpiry(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysUntil(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - now) / 86400000);
}

function WaveIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export default function Options() {
  const [input, setInput]     = useState('');
  const [ticker, setTicker]   = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [side, setSide]       = useState('calls');
  const [selectedDate, setSelectedDate] = useState(null);
  const [expirations, setExpirations]   = useState([]);
  const inputRef = useRef(null);

  async function fetchChain(sym, date) {
    const url = date ? `/api/options/${sym}?date=${date}` : `/api/options/${sym}`;
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function search(sym) {
    const s = (sym ?? input).trim().toUpperCase();
    if (!s) return;
    setTicker(s);
    setInput(s);
    setData(null);
    const d = await fetchChain(s, null);
    if (d) {
      setExpirations(d.expirations ?? []);
      setSelectedDate(d.selectedDate);
      setData(d);
    }
  }

  async function changeDate(date) {
    if (date === selectedDate || loading) return;
    setSelectedDate(date);
    const d = await fetchChain(ticker, date);
    if (d) setData(prev => ({ ...d, expirations: prev?.expirations ?? expirations }));
  }

  function topThree(contracts) {
    return [...(contracts ?? [])]
      .filter(c => (c.volume ?? 0) > 0)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 3);
  }

  const isEmpty = !data && !loading && !error;
  const rows    = topThree(side === 'calls' ? data?.calls : data?.puts);

  return (
    <div className="opts-page">
      {/* Search bar */}
      <form className="opts-search-row" onSubmit={e => { e.preventDefault(); search(); }}>
        <input
          ref={inputRef}
          className="opts-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Enter ticker symbol — AAPL, NVDA, SPY…"
          disabled={loading}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button className="opts-search-btn" type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Loading…' : 'Search'}
        </button>
      </form>

      {/* Empty hero */}
      {isEmpty && (
        <div className="opts-empty">
          <div className="opts-empty-icon"><WaveIcon /></div>
          <h2>Options Flow</h2>
          <p>Top 3 calls and puts by volume. Up to 2 months of expirations. 15-min delayed data via Yahoo Finance.</p>
          <div className="opts-samples">
            {SAMPLES.map(t => (
              <button key={t} className="opts-sample" onClick={() => search(t)}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="opts-error">⚠ {error}</div>}

      {/* Results */}
      {data && !error && (
        <div className="opts-results">

          {/* Ticker header */}
          <div className="opts-ticker-header">
            <span className="opts-ticker-sym">{data.ticker}</span>
            {data.price != null && (
              <span className="opts-ticker-price">{fmtUSD(data.price)}</span>
            )}
            {data.priceChange != null && (
              <span className={`opts-ticker-change ${data.priceChange >= 0 ? 'up' : 'dn'}`}>
                {data.priceChange >= 0 ? '+' : ''}{data.priceChange.toFixed(2)}{' '}
                ({data.changePct >= 0 ? '+' : ''}{data.changePct.toFixed(2)}%)
              </span>
            )}
            <span className="opts-ticker-delay">~15 min delayed · Yahoo Finance</span>
          </div>

          {/* Expiration chips + Calls/Puts toggle */}
          <div className="opts-controls">
            <div className="opts-date-chips">
              {expirations.map(d => (
                <button
                  key={d}
                  className={`opts-date-chip${d === selectedDate ? ' active' : ''}`}
                  onClick={() => changeDate(d)}
                  disabled={loading}
                >
                  {fmtExpiry(d)}
                  <span className="opts-chip-days"> {daysUntil(d)}d</span>
                </button>
              ))}
            </div>
            <div className="opts-side-toggle">
              <button
                className={`opts-side-btn${side === 'calls' ? ' active' : ''}`}
                onClick={() => setSide('calls')}
              >
                ▲ Calls
              </button>
              <button
                className={`opts-side-btn${side === 'puts' ? ' active' : ''}`}
                onClick={() => setSide('puts')}
              >
                ▼ Puts
              </button>
            </div>
          </div>

          {/* Table or loading/empty */}
          {loading ? (
            <div className="opts-loading">Fetching options chain…</div>
          ) : rows.length === 0 ? (
            <div className="opts-loading">No {side} with volume for this expiration.</div>
          ) : (
            <div className="opts-table-wrap">
              <table className="opts-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Strike</th>
                    <th>Last</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Volume</th>
                    <th>Open Int</th>
                    <th>Vol / OI</th>
                    <th>Impl. Vol</th>
                    <th>Moneyness</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.contractSymbol || i}>
                      <td className="opts-rank">#{i + 1}</td>
                      <td className="opts-strike">{fmtUSD(r.strike)}</td>
                      <td>{fmtUSD(r.lastPrice)}</td>
                      <td className="opts-dim">{fmtUSD(r.bid)}</td>
                      <td className="opts-dim">{fmtUSD(r.ask)}</td>
                      <td className="opts-vol">{fmtVol(r.volume)}</td>
                      <td>{fmtOI(r.openInterest)}</td>
                      <td>{fmtRatio(r.volume, r.openInterest)}</td>
                      <td>{fmtIV(r.impliedVolatility)}</td>
                      <td>
                        {r.inTheMoney
                          ? <span className="opts-itm">ITM</span>
                          : <span className="opts-otm">OTM</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="opts-footer">
                Top 3 {side} by volume · {data.ticker} · expires {fmtExpiry(selectedDate ?? '')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
