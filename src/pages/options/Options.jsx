import { useState, useRef, useMemo, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import { GRID, TICK, BORD, fmtM } from '../../utils/chartHelpers';
import { fa } from '../../config/colors';

const SAMPLES = ['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'AMZN', 'META'];

const CALL_COLOR = '#10b981';
const PUT_COLOR  = '#f87171';
const PRICE_COLOR = '#b0b0a8';

// Open-interest-by-strike distribution, restricted to strikes within ±30% of
// the current price so the heart of the chain isn't squeezed by far-OTM tails.
// OI is backfilled server-side from the most recent nonzero snapshot when
// Yahoo serves a zero-OI chain (see server/optionsStore.js).
function buildOiChart(data) {
  const price = data?.price;
  if (price == null) return null;
  const lo = price * 0.7, hi = price * 1.3;
  const pts = contracts => [...(contracts ?? [])]
    .filter(c => c.strike != null && c.strike >= lo && c.strike <= hi)
    .map(c => ({ x: c.strike, y: c.openInterest ?? 0 }))
    .sort((a, b) => a.x - b.x);

  const callPts = pts(data.calls);
  const putPts  = pts(data.puts);
  if (!callPts.length && !putPts.length) return null;

  const maxOI = Math.max(1, ...callPts.map(p => p.y), ...putPts.map(p => p.y));
  return { price, callPts, putPts, maxOI };
}

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

// Top 3 contracts by volume (with any volume at all)
function topThree(contracts) {
  return [...(contracts ?? [])]
    .filter(c => (c.volume ?? 0) > 0)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 3);
}

// Parse a comma/space-separated ticker string into an ordered, de-duplicated list.
function parseTickers(str) {
  const seen = new Set();
  const out = [];
  for (const raw of (str ?? '').split(/[,\s]+/)) {
    const t = raw.trim().toUpperCase();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

const oiChartOpts = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 300 },
  interaction: { mode: 'nearest', intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'bottom',
      labels: { color: '#c8c8c0', font: { size: 11, family: "'Inter',sans-serif" }, padding: 12, boxWidth: 12 },
    },
    tooltip: {
      backgroundColor: '#1a1f2a',
      borderColor: 'rgba(255,255,255,.12)',
      borderWidth: 1,
      titleFont: { family: "'Inter',sans-serif", size: 11 },
      bodyFont:  { family: "'Inter',sans-serif", size: 11 },
      padding: 10,
      filter: item => !item.dataset.label.startsWith('Current'),
      callbacks: {
        title: items => (items.length ? `Strike ${fmtUSD(items[0].parsed.x)}` : ''),
        label: c => ` ${c.dataset.label}: ${fmtOI(c.parsed.y)}`,
      },
    },
  },
  scales: {
    x: {
      type: 'linear',
      title: { display: true, text: 'Strike Price', color: '#b0b0a8', font: { size: 11, family: "'Inter',sans-serif" } },
      grid: GRID,
      ticks: { ...TICK, maxTicksLimit: 10, callback: v => `$${v}` },
      border: BORD,
    },
    y: {
      title: { display: true, text: 'Open Interest', color: '#b0b0a8', font: { size: 11, family: "'Inter',sans-serif" } },
      grid: GRID,
      ticks: { ...TICK, callback: v => fmtM(v) },
      border: BORD,
      beginAtZero: true,
    },
  },
};

function WaveIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

/* One ticker's results — owns its own chain data, expiry/side/chart state, so
   each panel in a multi-ticker search behaves independently. */
function TickerPanel({ ticker }) {
  const [data, setData]                 = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [side, setSide]                 = useState('calls');
  const [chartLines, setChartLines]     = useState({ calls: true, puts: true });
  const [selectedDate, setSelectedDate] = useState(null);
  const [expirations, setExpirations]   = useState([]);

  const toggleLine = which => setChartLines(prev => ({ ...prev, [which]: !prev[which] }));

  async function fetchChain(date) {
    const url = date ? `/api/options/${ticker}?date=${date}` : `/api/options/${ticker}`;
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

  // Fetch on mount / when the ticker changes; cancel stale responses.
  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null); setSelectedDate(null); setExpirations([]); setSide('calls');
    (async () => {
      const d = await fetchChain(null);
      if (cancelled || !d) return;
      setExpirations(d.expirations ?? []);
      setSelectedDate(d.selectedDate);
      setData(d);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  async function changeDate(date) {
    if (date === selectedDate || loading) return;
    setSelectedDate(date);
    const d = await fetchChain(date);
    if (d) setData(prev => ({ ...d, expirations: prev?.expirations ?? expirations }));
  }

  const rows    = topThree(side === 'calls' ? data?.calls : data?.puts);
  const oiChart = useMemo(() => buildOiChart(data), [data]);

  const oiChartData = oiChart && {
    datasets: [
      ...(chartLines.calls ? [{
        label: 'Calls',
        data: oiChart.callPts,
        borderColor: CALL_COLOR,
        backgroundColor: fa(CALL_COLOR, 0.10),
        pointBackgroundColor: CALL_COLOR,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      }] : []),
      ...(chartLines.puts ? [{
        label: 'Puts',
        data: oiChart.putPts,
        borderColor: PUT_COLOR,
        backgroundColor: fa(PUT_COLOR, 0.10),
        pointBackgroundColor: PUT_COLOR,
        pointRadius: 2,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      }] : []),
      {
        label: `Current ${fmtUSD(oiChart.price)}`,
        data: [{ x: oiChart.price, y: 0 }, { x: oiChart.price, y: oiChart.maxOI }],
        borderColor: PRICE_COLOR,
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
      },
    ],
  };

  if (error)            return <div className="opts-panel"><div className="opts-error">⚠ {ticker}: {error}</div></div>;
  if (!data && loading) return <div className="opts-panel"><div className="opts-loading">Fetching {ticker} options chain…</div></div>;
  if (!data)            return null;

  return (
    <div className="opts-panel opts-results">
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
          <button className={`opts-side-btn${side === 'calls' ? ' active' : ''}`} onClick={() => setSide('calls')}>
            ▲ Calls
          </button>
          <button className={`opts-side-btn${side === 'puts' ? ' active' : ''}`} onClick={() => setSide('puts')}>
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

      {/* Open-interest-by-strike distribution */}
      {!loading && oiChartData && (
        <div className="opts-chart-wrap">
          <div className="opts-chart-head">
            <div>
              <h3 className="opts-chart-title">Open Interest by Strike</h3>
              <p className="opts-chart-sub">
                Strikes within ±30% of current price · expires {fmtExpiry(selectedDate ?? '')}
                {data.oiAsOf && ` · OI as of ${data.oiAsOf}`}
              </p>
            </div>
            <div className="opts-chart-toggle">
              <button className={`opts-chart-toggle-btn calls${chartLines.calls ? ' active' : ''}`} onClick={() => toggleLine('calls')}>
                ▲ Calls
              </button>
              <button className={`opts-chart-toggle-btn puts${chartLines.puts ? ' active' : ''}`} onClick={() => toggleLine('puts')}>
                ▼ Puts
              </button>
            </div>
          </div>
          {chartLines.calls || chartLines.puts ? (
            <div className="opts-chart-canvas">
              <Line data={oiChartData} options={oiChartOpts} />
            </div>
          ) : (
            <div className="opts-loading">Select a line to display.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Options() {
  const [input, setInput]     = useState('');
  const [tickers, setTickers] = useState([]);
  const inputRef = useRef(null);

  function search(raw) {
    const list = parseTickers(raw ?? input);
    if (!list.length) return;
    setInput(list.join(', '));
    setTickers(list);
  }

  const isEmpty = tickers.length === 0;

  return (
    <div className="opts-page">
      {/* Search bar — accepts one or more comma-separated tickers */}
      <form className="opts-search-row" onSubmit={e => { e.preventDefault(); search(); }}>
        <input
          ref={inputRef}
          className="opts-input"
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          placeholder="Enter ticker(s), comma-separated — NVDA, MU, AVGO…"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
        />
        <button className="opts-search-btn" type="submit" disabled={!input.trim()}>
          Search
        </button>
      </form>

      {/* Empty hero */}
      {isEmpty ? (
        <div className="opts-empty">
          <div className="opts-empty-icon"><WaveIcon /></div>
          <h2>Options Flow</h2>
          <p>Top 3 calls and puts by volume. Search several tickers at once (comma-separated) — results appear in the order you enter them. Up to 2 months of expirations. 15-min delayed data via Yahoo Finance.</p>
          <div className="opts-samples">
            {SAMPLES.map(t => (
              <button key={t} className="opts-sample" onClick={() => search(t)}>{t}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="opts-multi">
          {tickers.map(t => <TickerPanel key={t} ticker={t} />)}
        </div>
      )}
    </div>
  );
}
