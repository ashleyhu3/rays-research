import { useEffect, useMemo, useRef, useState } from 'react';
import './Transcripts.css';

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth();
const DEFAULT_QUARTER = CURRENT_MONTH < 3 ? 'Q4' : `Q${Math.ceil(CURRENT_MONTH / 3)}`;
const DEFAULT_YEAR = CURRENT_MONTH < 3 ? CURRENT_YEAR - 1 : CURRENT_YEAR;

// Display names for the covered tickers. Anything not listed falls back to the
// raw symbol, so a newly reviewed ticker still renders in the selector.
const COMPANY_NAMES = {
  GOOGL: 'Alphabet',
  GOOG: 'Alphabet',
  MSFT: 'Microsoft',
  AMZN: 'Amazon',
  META: 'Meta Platforms',
  ORCL: 'Oracle',
};

// A review takes Claude a while to write on a runner — far longer than a data job — so
// the page polls patiently rather than declaring failure at the first quiet stretch.
const POLL_MS = 20000;
const MAX_MS = 30 * 60 * 1000;

const prettyPeriod = period => (period ? String(period).replace(/(\d{4})(Q\d)/, '$1 $2') : '');

const verdictClass = verdict => {
  if (!verdict) return '';
  const value = verdict.toLowerCase();
  if (value.includes('beat')) return ' is-pos';
  if (value.includes('miss')) return ' is-neg';
  return '';
};

const SAMPLE = `Prepared Remarks

Sundar Pichai -- Chief Executive Officer
Cloud revenues accelerated across all key areas and were up 63% to $20 billion, driven by strong AI demand.

Anat Ashkenazi -- Chief Financial Officer
[00:14:22] We now expect full-year capital expenditures of approximately $85 billion as we invest to meet cloud and AI demand.

Question-and-Answer Session

Analyst -- Morgan Stanley
How should we think about the capex trajectory into next year given the AI infrastructure ramp?

Sundar Pichai -- Chief Executive Officer
We remain confident in the return on our AI investments. Gemini adoption and Cloud backlog give us conviction in this level of spend.`;

function Icon({ name, size = 16 }) {
  const paths = {
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M9 12h6M9 16h6" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// Status of a dispatched GitHub Actions run. The run is asynchronous — Claude reads the
// call and writes the review on a runner, which takes many minutes — so this shows a
// queued/running state and polls for the published result rather than streaming stages.
function DispatchStatus({ dispatch }) {
  if (!dispatch) return null;
  const { phase, ticker, period, runsUrl, elapsedSec } = dispatch;
  const label = prettyPeriod(period);
  const busy = phase === 'preparing' || phase === 'dispatching' || phase === 'running';
  return (
    <div className={`tx-dispatch is-${phase}`}>
      <div className="tx-dispatch-head">
        {busy ? <span className="tx-spinner" /> : <span className="tx-dispatch-mark">{phase === 'done' ? '✓' : '!'}</span>}
        <strong>
          {phase === 'preparing' && 'Saving pasted transcript…'}
          {phase === 'dispatching' && 'Starting the review run…'}
          {phase === 'running' && `Writing ${ticker} ${label}…`}
          {phase === 'done' && `${ticker} ${label} review ready`}
          {phase === 'timeout' && 'Still running…'}
          {phase === 'error' && 'Could not start the review'}
        </strong>
      </div>
      <p className="tx-dispatch-copy">
        {phase === 'preparing' && 'Normalizing speakers and sections so the review can be written against it.'}
        {phase === 'running' && `Claude is reading the call and writing the review on a GitHub Actions runner, then publishing it here. This usually takes 10–25 minutes.${elapsedSec ? ` Elapsed ${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s.` : ''}`}
        {phase === 'done' && 'The review is live — it has loaded below.'}
        {phase === 'timeout' && 'The runner is taking longer than usual. The review will appear here automatically once it finishes.'}
      </p>
      {runsUrl && phase !== 'done' && (
        <a className="tx-dispatch-link" href={runsUrl} target="_blank" rel="noreferrer">View the run on GitHub ↗</a>
      )}
    </div>
  );
}

// ── Sidebar: pick a ticker/quarter, optionally paste a transcript, recent reviews ──
function Collector({
  ticker, setTicker, quarter, setQuarter, year, setYear,
  onAnalyze,
  loading, error, dispatch, entries, onSelect,
}) {
  const [source, setSource] = useState('provider');
  const [manualText, setManualText] = useState('');
  const [earningsDate, setEarningsDate] = useState('');
  const fileRef = useRef(null);
  const wordCount = manualText.trim() ? manualText.trim().split(/\s+/).length : 0;

  const submitAnalysis = event => {
    event.preventDefault();
    onAnalyze({
      ticker,
      quarter,
      year: Number(year),
      source,
      ...(source === 'stored' ? { text: manualText, earnings_date: earningsDate || undefined } : {}),
    });
  };

  const loadFile = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    setManualText(await file.text());
    event.target.value = '';
  };

  return (
    <aside className="tx-collector">
      <div className="tx-card-head">
        <div>
          <div className="tx-eyebrow">Source</div>
          <h2>Write a review</h2>
        </div>
      </div>
      <p className="tx-card-copy">Pick a published earnings call or paste your own transcript. Either way Claude reads the full call and writes a buy-side review — financials, segment detail, prepared remarks, every Q&amp;A exchange, and the trading implications.</p>

      <div className="tx-source-tabs" role="tablist" aria-label="Transcript source">
        <button type="button" role="tab" aria-selected={source === 'provider'} className={source === 'provider' ? 'active' : ''} onClick={() => setSource('provider')}>
          <Icon name="database" size={14} />
          Fetch transcript
        </button>
        <button type="button" role="tab" aria-selected={source === 'stored'} className={source === 'stored' ? 'active' : ''} onClick={() => setSource('stored')}>
          <Icon name="file" size={14} />
          Paste or upload
        </button>
      </div>

      <form onSubmit={submitAnalysis} className="tx-form">
        <label>
          Company ticker
          <input value={ticker} onChange={event => setTicker(event.target.value.toUpperCase())} placeholder="e.g. GOOGL" maxLength={10} spellCheck={false} />
        </label>
        <div className="tx-form-row">
          <label>
            Fiscal quarter
            <select value={quarter} onChange={event => setQuarter(event.target.value)}>
              {['Q1', 'Q2', 'Q3', 'Q4'].map(value => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Fiscal year
            <input type="number" min="2000" max="2100" value={year} onChange={event => setYear(event.target.value)} />
          </label>
        </div>
        {source === 'stored' && (
          <div className="tx-paste-fields">
            <label>
              <span className="tx-label-row">Earnings date <em>optional</em></span>
              <input type="date" value={earningsDate} onChange={event => setEarningsDate(event.target.value)} />
            </label>
            <label>
              Transcript text
              <textarea
                value={manualText}
                onChange={event => setManualText(event.target.value)}
                placeholder={'Prepared Remarks\n\nSpeaker Name — Title\nTranscript paragraph…\n\nQuestion-and-Answer Session…'}
                spellCheck={false}
              />
            </label>
            <div className="tx-paste-actions">
              <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" onChange={loadFile} hidden />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!loading}>
                <Icon name="upload" size={13} /> Upload .txt or .md
              </button>
              <button type="button" onClick={() => setManualText(SAMPLE)} disabled={!!loading}>Load sample</button>
              <span>{wordCount.toLocaleString()} words</span>
            </div>
          </div>
        )}
        <button className="tx-primary" disabled={!!loading || !ticker.trim() || (source === 'stored' && !manualText.trim())}>
          {loading ? <span className="tx-spinner" /> : <Icon name="arrow" />}
          {loading || (source === 'stored' ? 'Review pasted transcript' : 'Fetch & write review')}
        </button>
        <small className="tx-form-note">
          {source === 'stored'
            ? 'Speaker labels and Q&A headings improve parsing. Your transcript is normalized, stored, and reviewed.'
            : 'Fetches the selected fiscal quarter from Alpha Vantage, then writes and publishes the review here.'}
        </small>
      </form>

      <DispatchStatus dispatch={dispatch} />

      {error && <div className="tx-error">{error}</div>}

      <div className="tx-library">
        <div className="tx-library-head">
          <span>Recent reviews</span>
          <small>{entries.length}</small>
        </div>
        {entries.slice(0, 8).map(item => (
          <button key={`${item.ticker}-${item.period}`} onClick={() => onSelect(item)}>
            <span>{item.ticker}</span>
            <div>
              <strong>{prettyPeriod(item.period)}</strong>
              <small>{item.verdict || 'review'}{item.priceReaction ? ` · ${item.priceReaction}` : ''}</small>
            </div>
            <Icon name="arrow" size={14} />
          </button>
        ))}
        {!entries.length && <p>Published reviews will appear here.</p>}
      </div>
    </aside>
  );
}

export default function Transcripts() {
  const [ticker, setTicker] = useState('GOOGL');
  const [quarter, setQuarter] = useState(DEFAULT_QUARTER);
  const [year, setYear] = useState(DEFAULT_YEAR);

  const [entries, setEntries] = useState([]);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexError, setIndexError] = useState('');
  const [activeTicker, setActiveTicker] = useState(null);
  const [period, setPeriod] = useState(null);

  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [dispatch, setDispatch] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [pdfMeta, setPdfMeta] = useState(null);
  const iframeRef = useRef(null);
  // Guards the async setStates below (the dispatch poll runs for many minutes). Set on
  // mount as well as cleared on unmount — StrictMode mounts twice in dev, and a ref that
  // is only ever cleared would stay false after the first cleanup.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // The published index drives everything on the right: which tickers exist, which
  // periods each has, and which review the iframe points at.
  useEffect(() => {
    setIndexLoading(true);
    fetch('/api/earnings-review/index', { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return Array.isArray(data.entries) ? data.entries : [];
      })
      .then(items => {
        if (!mountedRef.current) return;
        setEntries(items);
        setIndexError('');
        // Default to the newest review unless the user has already chosen one.
        const newest = items[0];
        if (newest) {
          setActiveTicker(current => current || newest.ticker);
          setPeriod(current => current || newest.period);
        }
      })
      .catch(requestError => {
        if (!mountedRef.current) return;
        setEntries([]);
        setIndexError(requestError.message);
      })
      .finally(() => mountedRef.current && setIndexLoading(false));
  }, [reloadNonce]);

  // Whether a stored PDF exists decides if Download PDF is a link or a print call.
  useEffect(() => {
    setPdfMeta(null);
    if (!activeTicker || !period) return;
    fetch(`/api/earnings-review/${activeTicker}/${period}/pdf-meta`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => mountedRef.current && setPdfMeta(data))
      .catch(() => {});
  }, [activeTicker, period, reloadNonce]);

  // Fire the GitHub Action that runs the earnings-review skill on a runner, then poll
  // until the published review lands in Mongo. The run is async (10–25 minutes), so this
  // shows a queued/running status rather than live progress.
  async function runReview(payload, label) {
    if (loading) return;
    setLoading(label);
    setError('');
    const runTicker = payload.ticker.toUpperCase();
    const runPeriod = `${payload.year}${payload.quarter}`;
    setDispatch({ phase: payload.source === 'stored' ? 'preparing' : 'dispatching', ticker: runTicker, period: runPeriod, runsUrl: null, elapsedSec: 0 });
    try {
      // A pasted transcript is stored first so the runner's prep step finds it in Mongo
      // instead of going out to Alpha Vantage for a call it may not carry.
      if (payload.source === 'stored') {
        if (!payload.text?.trim()) throw new Error('Paste a transcript or upload a text file first.');
        const parseResponse = await fetch('/api/transcripts/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const parsed = await parseResponse.json().catch(() => ({}));
        if (!parseResponse.ok) throw new Error(parsed.error || `Could not parse transcript (HTTP ${parseResponse.status}).`);
        setDispatch({ phase: 'dispatching', ticker: runTicker, period: runPeriod, runsUrl: null, elapsedSec: 0 });
      }

      const baseline = await fetch(`/api/earnings-review/${runTicker}/${runPeriod}`)
        .then(res => (res.ok ? res.json() : null))
        .then(doc => doc?.generatedAt || null)
        .catch(() => null);

      const response = await fetch('/api/earnings-review/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: payload.ticker,
          quarter: payload.quarter,
          year: payload.year,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);

      const { ticker: reviewedTicker, period: reviewedPeriod, runsUrl } = data;
      if (data.cached) {
        setActiveTicker(reviewedTicker);
        setPeriod(reviewedPeriod);
        setReloadNonce(nonce => nonce + 1);
        setDispatch({ phase: 'done', ticker: reviewedTicker, period: reviewedPeriod, runsUrl: null, elapsedSec: 0 });
        return;
      }

      const startedAt = Date.now();
      setDispatch({ phase: 'running', ticker: reviewedTicker, period: reviewedPeriod, runsUrl, elapsedSec: 0 });

      for (;;) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
        if (!mountedRef.current) return;
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        setDispatch(current => (current ? { ...current, elapsedSec } : current));

        let ready = false;
        try {
          const doc = await fetch(`/api/earnings-review/${reviewedTicker}/${reviewedPeriod}`)
            .then(res => (res.ok ? res.json() : null));
          ready = !!doc?.generatedAt && doc.generatedAt !== baseline;
        } catch { /* transient — keep polling */ }

        if (ready) {
          setActiveTicker(reviewedTicker);
          setPeriod(reviewedPeriod);
          setReloadNonce(nonce => nonce + 1);
          setDispatch(current => (current ? { ...current, phase: 'done' } : current));
          break;
        }
        if (Date.now() - startedAt > MAX_MS) {
          setDispatch(current => (current ? { ...current, phase: 'timeout' } : current));
          break;
        }
      }
    } catch (requestError) {
      if (!mountedRef.current) return;
      setError(requestError.message);
      setDispatch(current => (current && current.phase === 'done' ? current : null));
    } finally {
      if (mountedRef.current) setLoading('');
    }
  }

  const onAnalyze = payload => runReview(
    payload,
    `Reviewing ${payload.ticker.toUpperCase()} ${payload.year}${payload.quarter}…`,
  );

  const onSelect = item => {
    setActiveTicker(item.ticker);
    setPeriod(item.period);
  };

  // Distinct tickers with a published review, for the selector — derived from the index
  // the page already loads, no extra request.
  const tickers = useMemo(() => {
    const byTicker = new Map();
    for (const entry of entries) {
      const symbol = String(entry.ticker || '').toUpperCase();
      if (!symbol) continue;
      if (!byTicker.has(symbol)) byTicker.set(symbol, new Set());
      if (entry.period) byTicker.get(symbol).add(entry.period);
    }
    return [...byTicker.entries()]
      .map(([symbol, periods]) => ({ ticker: symbol, name: COMPANY_NAMES[symbol] || symbol, quarters: periods.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  // Periods for the selected ticker, newest first.
  const tickerPeriods = useMemo(() => entries
    .filter(entry => entry.ticker === activeTicker && entry.period)
    .map(entry => entry.period)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => b.localeCompare(a)), [entries, activeTicker]);

  const active = useMemo(
    () => entries.find(entry => entry.ticker === activeTicker && entry.period === period) || null,
    [entries, activeTicker, period],
  );

  const selectTicker = symbol => {
    if (symbol === activeTicker) return;
    const newest = entries
      .filter(entry => entry.ticker === symbol && entry.period)
      .map(entry => entry.period)
      .sort((a, b) => b.localeCompare(a))[0];
    setActiveTicker(symbol);
    setPeriod(newest || null);
  };

  const handleDownload = () => {
    if (pdfMeta?.available) return; // the anchor handles this case directly
    const win = iframeRef.current?.contentWindow;
    win?.focus();
    win?.print();
  };

  return (
    <div className="tx-page">
      <div className="tx-workspace">
        <Collector
          ticker={ticker} setTicker={setTicker}
          quarter={quarter} setQuarter={setQuarter}
          year={year} setYear={setYear}
          onAnalyze={onAnalyze}
          loading={loading} error={error} dispatch={dispatch}
          entries={entries} onSelect={onSelect}
        />

        <main className="tx-main">
          {tickers.length > 0 && (
            <nav className="tx-ticker-bar" aria-label="Covered companies">
              <div className="tx-ticker-bar-head">
                <span className="tx-eyebrow">Companies</span>
                <small>{tickers.length} covered · click a ticker</small>
              </div>
              <div className="tx-ticker-grid">
                {tickers.map(entry => (
                  <button
                    key={entry.ticker}
                    className={`tx-ticker-card${entry.ticker === activeTicker ? ' active' : ''}`}
                    onClick={() => selectTicker(entry.ticker)}
                    aria-pressed={entry.ticker === activeTicker}
                  >
                    <span className="tx-ticker-sym">{entry.ticker}</span>
                    <span className="tx-ticker-name">{entry.name}</span>
                    <span className="tx-ticker-meta">{entry.quarters} quarter{entry.quarters === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </nav>
          )}

          {indexLoading ? (
            <section className="tx-analysis-overview is-loading">
              <div className="tx-analysis-loader"><span className="tx-spinner" /> Loading published reviews…</div>
            </section>
          ) : indexError ? (
            <section className="tx-analysis-overview is-error">{indexError}</section>
          ) : active ? (
            <>
              <header className="tx-analysis-head">
                <div>
                  <h2>{active.title || `${active.ticker} ${prettyPeriod(active.period)}`}</h2>
                  <div className="tx-period-tabs">
                    {tickerPeriods.map(name => (
                      <button
                        key={name}
                        className={period === name ? 'active' : ''}
                        onClick={() => setPeriod(name)}
                      >{prettyPeriod(name)}</button>
                    ))}
                  </div>
                </div>
                <div className="tx-head-meta">
                  {active.verdict && <span className={`tx-pill${verdictClass(active.verdict)}`}><strong>{active.verdict}</strong></span>}
                  {active.priceReaction && <span className="tx-pill"><strong>{active.priceReaction}</strong> 股价反应</span>}
                  {pdfMeta?.available ? (
                    <a className="rbtn" href={`/api/earnings-review/${activeTicker}/${period}/pdf`} download>Download PDF</a>
                  ) : (
                    <button type="button" className="rbtn" onClick={handleDownload}>Download PDF</button>
                  )}
                </div>
              </header>

              {/* The review is a full self-contained HTML document (its own <style> sets
                  body/table/a), so it's embedded in an iframe rather than injected —
                  dangerouslySetInnerHTML would let its CSS leak into the dashboard. The
                  iframe also scopes window.print() to the review when there's no PDF. */}
              <iframe
                ref={iframeRef}
                key={`${activeTicker}-${period}-${reloadNonce}`}
                className="report-frame"
                src={`/api/earnings-review/${activeTicker}/${period}/html`}
                title={active.title || `${active.ticker} ${active.period} earnings review`}
              />
            </>
          ) : (
            <section className="tx-analysis-overview is-error">
              {entries.length
                ? `No review selected for ${activeTicker || 'this company'}.`
                : 'No reviews published yet — enter a ticker and fiscal quarter to write the first one.'}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
