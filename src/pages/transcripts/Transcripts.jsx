import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import '../../utils/chartSetup';
import { C, fa } from '../../config/colors';
import { baseOpts } from '../../utils/chartHelpers';
import { adminHeaders, clearAdminSecret } from '../../utils/adminAuth';
import './Transcripts.css';

const CURRENT_YEAR = new Date().getFullYear();

// Display names for the covered tickers. Anything not listed falls back to the
// raw symbol, so newly collected tickers still render in the selector.
const COMPANY_NAMES = {
  GOOGL: 'Alphabet',
  MSFT: 'Microsoft',
  AMZN: 'Amazon',
  META: 'Meta Platforms',
  ORCL: 'Oracle',
};

// The six signals the analysis is built around. Names must match the topic
// labels produced by server/transcripts/topics.js.
const FOCUS_TOPICS = [
  'CapEx',
  'CapEx Guidance',
  'Cloud Growth',
  'Cloud Guidance',
  'AI Revenue',
  'AI Guidance',
];

const FOCUS_COLORS = [C.orange, C.mistral, C.teal, C.google, C.openai, C.perplexity];

const DIR_ARROW = { up: '▲', down: '▼', flat: '→' };

const prettyPeriod = period => (period ? String(period).replace(/(\d{4})(Q\d)/, '$1 $2') : '');

function sentClass(investorConfidence) {
  if (investorConfidence == null) return 'tx-fig-tone';
  if (investorConfidence >= 58) return 'tx-fig-tone is-pos';
  if (investorConfidence < 43) return 'tx-fig-tone is-neg';
  return 'tx-fig-tone';
}

// Parse a compact value string ("$180–190B", "63%", "9x") into a number + unit
// so figures can be trended over time. Ranges collapse to their midpoint.
function parseFigureValue(text) {
  if (!text) return null;
  const source = String(text);
  const numbers = (source.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!numbers.length) return null;
  const value = numbers.length >= 2 ? (numbers[0] + numbers[1]) / 2 : numbers[0];
  const hasDollar = /\$/.test(source);
  if (/%/.test(source)) return { value, unit: '%' };
  if (/\d\s*x\b/i.test(source)) return { value, unit: '×' };
  if (/trillion/i.test(source)) return { value: value * 1000, unit: '$B' };
  if (hasDollar && /million/i.test(source)) return { value: value / 1000, unit: '$B' };
  if (/billion/i.test(source) || /\dB\b/.test(source) || hasDollar) return { value, unit: '$B' };
  if (/million/i.test(source)) return { value, unit: 'M' };
  return null;
}

// Group a keyword's figures into per-label series that span ≥2 quarters.
function buildValueSeries(figures) {
  const groups = new Map();
  for (const figure of figures) {
    const parsed = parseFigureValue(figure.current);
    if (!parsed) continue;
    const key = `${figure.label.toLowerCase().replace(/[^a-z ]/g, '').trim()}|${parsed.unit}`;
    if (!groups.has(key)) groups.set(key, { label: figure.label, unit: parsed.unit, points: new Map() });
    const group = groups.get(key);
    if (!group.points.has(figure.period)) group.points.set(figure.period, parsed.value);
  }
  return [...groups.values()]
    .filter(group => group.points.size >= 2)
    .sort((a, b) => b.points.size - a.points.size);
}

// A couple of describing words derived from the change, not just the number.
function describeFigure(figure) {
  const delta = figure.delta || '';
  if (figure.forwardLooking) {
    return figure.direction === 'up' ? 'Guidance raised'
      : figure.direction === 'down' ? 'Guidance cut'
      : 'Guidance reaffirmed';
  }
  if (/tripl/i.test(delta)) return 'Tripled';
  if (/doubl/i.test(delta)) return 'Doubled';
  const source = delta || figure.current || '';
  const isPercent = source.includes('%');
  const magnitude = parseFloat(source.replace(/[^0-9.]/g, ''));
  if (figure.direction === 'up') {
    if (isPercent && magnitude >= 100) return 'Surging';
    if (isPercent && magnitude >= 40) return 'Strong growth';
    if (isPercent && magnitude > 0) return 'Steady growth';
    return 'Higher';
  }
  if (figure.direction === 'down') return isPercent && magnitude >= 40 ? 'Sharp decline' : 'Lower';
  return 'Reported level';
}

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
    check: <path d="m5 12 4 4L19 6" />,
    alert: <><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ── Sidebar: collect by ticker/quarter, paste a transcript, recent library ──
// Status of a dispatched GitHub Actions analysis run. The run is asynchronous
// (FinBERT + LLM on a runner, a few minutes), so we show a queued/running state
// and poll for the result rather than streaming live stages.
function DispatchStatus({ dispatch }) {
  if (!dispatch) return null;
  const { phase, ticker, period, runsUrl, elapsedSec } = dispatch;
  const label = prettyPeriod(period);
  const busy = phase === 'dispatching' || phase === 'running';
  return (
    <div className={`tx-dispatch is-${phase}`}>
      <div className="tx-dispatch-head">
        {busy ? <span className="tx-spinner" /> : <span className="tx-dispatch-mark">{phase === 'done' ? '✓' : '!'}</span>}
        <strong>
          {phase === 'dispatching' && 'Starting GitHub Action…'}
          {phase === 'running' && `Analyzing ${ticker} ${label} on a runner…`}
          {phase === 'done' && `${ticker} ${label} analyzed`}
          {phase === 'timeout' && 'Still running…'}
          {phase === 'error' && 'Could not start analysis'}
        </strong>
      </div>
      <p className="tx-dispatch-copy">
        {phase === 'running' && `FinBERT + LLM tone, facts and figures run on a GitHub Actions runner, then publish to the database. This usually takes a few minutes.${elapsedSec ? ` Elapsed ${elapsedSec}s.` : ''}`}
        {phase === 'done' && 'Results are live — the charts below have updated.'}
        {phase === 'timeout' && 'The runner is taking longer than usual. Results will appear here automatically once it finishes.'}
      </p>
      {runsUrl && phase !== 'done' && (
        <a className="tx-dispatch-link" href={runsUrl} target="_blank" rel="noreferrer">View the run on GitHub ↗</a>
      )}
    </div>
  );
}

function Collector({
  ticker, setTicker, quarter, setQuarter, year, setYear,
  onCollect, onParse,
  loading, error, dispatch, library, onSelectLibrary,
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');

  return (
    <aside className="tx-collector">
      <div className="tx-card-head">
        <div>
          <div className="tx-eyebrow">Source</div>
          <h2>Analyze a transcript</h2>
        </div>
        <span className="tx-live-dot">Free tier</span>
      </div>
      <p className="tx-card-copy">Pull a full earnings call by ticker and fiscal quarter from Alpha Vantage, or paste your own. Collection normalizes speakers and tags the focus keywords locally.</p>

      <form onSubmit={onCollect} className="tx-form">
        <label>
          Ticker
          <input value={ticker} onChange={event => setTicker(event.target.value.toUpperCase())} placeholder="GOOGL" maxLength={10} spellCheck={false} />
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
        <button className="tx-primary" disabled={!!loading || !ticker.trim()}>
          {loading && loading.startsWith('Analyzing') ? <span className="tx-spinner" /> : <Icon name="database" />}
          {loading && loading.startsWith('Analyzing') ? loading : 'Collect & analyze'}
        </button>
        <small className="tx-form-note">Fires a GitHub Action that runs the full pipeline — collect, FinBERT + LLM tone, facts, key figures — on a runner, then publishes. Takes a few minutes; results appear below when done.</small>
      </form>

      <DispatchStatus dispatch={dispatch} />

      {error && <div className="tx-error">{error}</div>}

      <div className="tx-divider"><span>or paste a transcript</span></div>
      <button className="tx-secondary" onClick={() => setManualOpen(value => !value)}>
        <Icon name="upload" /> {manualOpen ? 'Hide pasted transcript' : 'Paste transcript'}
      </button>
      {manualOpen && (
        <div className="tx-manual">
          <textarea value={manualText} onChange={event => setManualText(event.target.value)} placeholder="Prepared Remarks&#10;&#10;Speaker Name -- Title&#10;Transcript paragraph…" />
          <div>
            <button onClick={() => setManualText(SAMPLE)} disabled={!!loading}>Load sample</button>
            <button onClick={() => onParse(manualText)} disabled={!!loading || !ticker.trim() || !manualText.trim()}>
              {loading === 'Parsing transcript locally…' ? 'Parsing…' : 'Parse locally'}
            </button>
          </div>
        </div>
      )}

      <div className="tx-library">
        <div className="tx-library-head">
          <span>Recent collections</span>
          <small>{library.length}</small>
        </div>
        {library.slice(0, 8).map(item => (
          <button key={`${item.ticker}-${item.fiscal_period}`} onClick={() => onSelectLibrary(item)}>
            <span>{item.ticker}</span>
            <div><strong>{item.fiscal_period}</strong><small>{item.stats?.totalBlocks || 0} blocks · {item.stats?.wordCount?.toLocaleString() || 0} words</small></div>
            <Icon name="arrow" size={14} />
          </button>
        ))}
        {!library.length && <p>Collected transcripts will appear here.</p>}
      </div>
    </aside>
  );
}

function ChartCard({ title, hint, tall, wide, hasData, children }) {
  return (
    <div className={`tx-chart-card${wide ? ' is-wide' : ''}`}>
      <div className="tx-chart-head">
        <h3>{title}</h3>
        {hint && <small>{hint}</small>}
      </div>
      <div className={`tx-chart-body${tall ? ' is-tall' : ''}`}>
        {hasData ? children : <div className="tx-chart-empty">No data for this selection yet.</div>}
      </div>
    </div>
  );
}

export default function Transcripts() {
  const [ticker, setTicker] = useState('GOOGL');
  const [quarter, setQuarter] = useState('Q1');
  const [year, setYear] = useState(CURRENT_YEAR);

  const [activeTicker, setActiveTicker] = useState('GOOGL');
  const [period, setPeriod] = useState(null);
  const [metricFilter, setMetricFilter] = useState('all');
  const [valueUnit, setValueUnit] = useState(null);
  const selectKeyword = keyword => { setMetricFilter(keyword); setValueUnit(null); };
  const [enrichment, setEnrichment] = useState(null);
  const [library, setLibrary] = useState([]);

  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [dispatch, setDispatch] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState('');

  const refreshLibrary = () => {
    fetch('/api/transcripts/library')
      .then(response => response.ok ? response.json() : [])
      .then(data => setLibrary(Array.isArray(data) ? data : []))
      .catch(() => setLibrary([]));
  };
  useEffect(refreshLibrary, []);

  // Load the cross-quarter analysis for the active ticker.
  useEffect(() => {
    if (!activeTicker) return;
    setAnalysisLoading(true);
    setAnalysisError('');
    fetch(`/api/transcripts/analysis/${activeTicker}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
      })
      .then(data => {
        setAnalysis(data);
        const latest = data.reports?.[0]?.coverage?.periods?.at(-1);
        if (latest) setPeriod(latest.replace(/\s+/g, ''));
      })
      .catch(requestError => { setAnalysis(null); setAnalysisError(requestError.message); })
      .finally(() => setAnalysisLoading(false));
  }, [activeTicker, reloadNonce]);

  // Load the enrichment (keyword counts, facts, tone) for the selected period.
  useEffect(() => {
    if (!activeTicker || !period) { setEnrichment(null); return; }
    fetch(`/api/transcripts/enrichment/${activeTicker}/${period}`)
      .then(response => response.ok ? response.json() : null)
      .then(setEnrichment)
      .catch(() => setEnrichment(null));
  }, [activeTicker, period]);

  async function submit(endpoint, payload, label, { admin = false } = {}) {
    if (loading) return;
    setLoading(label);
    setError('');
    try {
      // Collection is a write endpoint gated by ADMIN_SECRET — attach the
      // operator's Bearer header (prompts once, cached in localStorage).
      const headers = admin
        ? adminHeaders({ 'Content-Type': 'application/json' })
        : { 'Content-Type': 'application/json' };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        // Wrong/stale secret — drop it so the next attempt re-prompts.
        if (response.status === 401 && admin) {
          clearAdminSecret();
          throw new Error('Admin secret rejected — check the value and try again.');
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      const collected = data.transcript || {};
      setActiveTicker(collected.ticker || payload.ticker.toUpperCase());
      setPeriod(collected.fiscal_period || null);
      refreshLibrary();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading('');
    }
  }

  // Fire the GitHub Action that runs the full FinBERT pipeline on a runner, then
  // poll for the enriched result to land in Mongo and refresh the charts. The run
  // is async (a few minutes), so this shows a queued/running status rather than
  // live per-stage progress. Works on the deployed site, where FinBERT can't run.
  async function dispatchAnalyze(payload, label) {
    if (loading) return;
    setLoading(label);
    setError('');
    setDispatch({ phase: 'dispatching', ticker: payload.ticker.toUpperCase(), period: null, runsUrl: null, elapsedSec: 0 });
    try {
      const response = await fetch('/api/transcripts/dispatch-analysis', {
        method: 'POST',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        clearAdminSecret();
        throw new Error('Admin secret rejected — check the value and try again.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);

      const { ticker: runTicker, period, runsUrl } = data;
      const startedAt = Date.now();
      const POLL_MS = 20000;
      const MAX_MS = 15 * 60 * 1000;
      setDispatch({ phase: 'running', ticker: runTicker, period, runsUrl, elapsedSec: 0 });

      // Poll the enrichment endpoint until the runner has published tone.
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
        if (!mountedRef.current) return;
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        setDispatch(current => (current ? { ...current, elapsedSec } : current));

        let ready = false;
        try {
          const enrichmentDoc = await fetch(`/api/transcripts/enrichment/${runTicker}/${period}`)
            .then(res => (res.ok ? res.json() : null));
          ready = (enrichmentDoc?.toneSummary?.chunks || 0) > 0;
        } catch { /* transient — keep polling */ }

        if (ready) {
          setActiveTicker(runTicker);
          setPeriod(period);
          refreshLibrary();
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

  const onCollect = event => {
    event.preventDefault();
    dispatchAnalyze({ ticker, quarter, year: Number(year) }, `Analyzing ${ticker.toUpperCase()} ${year}${quarter}…`);
  };
  const onParse = text => submit('/api/transcripts/parse', { ticker, quarter, year: Number(year), text }, 'Parsing transcript locally…');
  const onSelectLibrary = item => {
    setActiveTicker(item.ticker);
    setPeriod(item.fiscal_period);
  };

  const report = analysis?.reports?.[0];
  const timelines = analysis?.analysis?.timelines ?? [];
  const usage = analysis?.modelUsage;
  const toneReady = (enrichment?.toneSummary?.chunks || 0) > 0;

  // Distinct tickers with a collected/analyzed transcript, for the selector.
  // Derived from the library the page already loads — no extra request.
  const tickers = useMemo(() => {
    const byTicker = new Map();
    for (const item of library) {
      const symbol = String(item.ticker || '').toUpperCase();
      if (!symbol) continue;
      if (!byTicker.has(symbol)) byTicker.set(symbol, { ticker: symbol, periods: new Set() });
      if (item.fiscal_period) byTicker.get(symbol).periods.add(item.fiscal_period);
    }
    return [...byTicker.values()]
      .map(entry => ({ ticker: entry.ticker, name: COMPANY_NAMES[entry.ticker] || entry.ticker, quarters: entry.periods.size }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [library]);

  const selectTicker = symbol => {
    if (symbol === activeTicker) return;
    setActiveTicker(symbol);
    setPeriod(null);
    setMetricFilter('all');
    setValueUnit(null);
  };

  // All structured figures across quarters (for the value trend chart).
  const allFigures = useMemo(() => analysis?.keyFigures ?? [], [analysis]);

  // Figures for the selected transcript only (for the grid).
  const periodFigures = useMemo(() => allFigures
    .filter(figure => figure.fiscal_period === period)
    .sort((a, b) => (
      (b.forwardLooking === true) - (a.forwardLooking === true)
      || (b.prior ? 1 : 0) - (a.prior ? 1 : 0)
    )), [allFigures, period]);

  const figureCounts = useMemo(
    () => FOCUS_TOPICS.map(topic => periodFigures.filter(figure => figure.keyword === topic).length),
    [periodFigures],
  );

  const shownFigures = metricFilter === 'all'
    ? periodFigures
    : periodFigures.filter(figure => figure.keyword === metricFilter);

  // Numeric value series over time for the charted keyword.
  const chartKeyword = useMemo(() => {
    if (metricFilter !== 'all') return metricFilter;
    let best = null;
    let bestScore = 0;
    for (const topic of FOCUS_TOPICS) {
      const score = buildValueSeries(allFigures.filter(figure => figure.keyword === topic))
        .reduce((sum, series) => sum + series.points.size, 0);
      if (score > bestScore) { bestScore = score; best = topic; }
    }
    return best;
  }, [metricFilter, allFigures]);

  const valueChart = useMemo(() => {
    if (!chartKeyword) return null;
    const series = buildValueSeries(allFigures.filter(figure => figure.keyword === chartKeyword));
    if (!series.length) return null;
    const units = [...new Set(series.map(item => item.unit))];
    const unit = valueUnit && units.includes(valueUnit) ? valueUnit : units[0];
    const periods = report?.coverage?.periods ?? [];
    const datasets = series
      .filter(item => item.unit === unit)
      .slice(0, 5)
      .map((item, index) => ({
        label: item.label,
        data: periods.map(name => (item.points.has(name) ? item.points.get(name) : null)),
        borderColor: FOCUS_COLORS[index % FOCUS_COLORS.length],
        backgroundColor: fa(FOCUS_COLORS[index % FOCUS_COLORS.length], 0.12),
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: FOCUS_COLORS[index % FOCUS_COLORS.length],
        tension: 0.25,
        spanGaps: true,
      }));
    return { keyword: chartKeyword, unit, units, labels: periods, datasets };
  }, [chartKeyword, allFigures, valueUnit, report]);

  // Confidence-per-quarter lines for each focus signal that has a timeline.
  const toneOverTime = useMemo(() => {
    const periods = report?.coverage?.periods ?? [];
    if (!periods.length) return null;
    const datasets = FOCUS_TOPICS.map((topic, index) => {
      const timeline = timelines.find(item => item.topic === topic);
      if (!timeline) return null;
      const byPeriod = new Map(timeline.points.map(point => [point.period, Math.round((point.confidenceScore || 0) * 100)]));
      return {
        label: topic,
        data: periods.map(name => byPeriod.get(name) ?? null),
        borderColor: FOCUS_COLORS[index],
        backgroundColor: fa(FOCUS_COLORS[index], 0.15),
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: FOCUS_COLORS[index],
        tension: 0.3,
        spanGaps: true,
      };
    }).filter(Boolean);
    return datasets.length ? { labels: periods, datasets } : null;
  }, [report, timelines]);

  // Overall transcript tone per quarter, split by speaker: management answers
  // read as an investor ("investor tone") vs. the analysts' questions
  // ("analyst tone"). Both are the same 0–100 composite confidence score.
  const roleTones = useMemo(() => analysis?.toneByRole ?? [], [analysis]);
  const roleToneOverTime = useMemo(() => {
    const periods = report?.coverage?.periods ?? [];
    if (!periods.length || !roleTones.length) return null;
    const byPeriod = new Map(roleTones.map(item => [item.period, item]));
    const series = [
      { label: 'Investor tone (management)', key: 'investor', color: C.teal },
      { label: 'Analyst tone', key: 'analyst', color: C.perplexity },
    ];
    const datasets = series.map(item => ({
      label: item.label,
      data: periods.map(name => byPeriod.get(name)?.[item.key] ?? null),
      borderColor: item.color,
      backgroundColor: fa(item.color, 0.15),
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: item.color,
      tension: 0.3,
      spanGaps: true,
    }));
    return datasets.some(dataset => dataset.data.some(value => value != null))
      ? { labels: periods, datasets }
      : null;
  }, [report, roleTones]);

  // Within a single transcript: how management and analyst tone move statement
  // by statement as the call unfolds (prepared remarks → Q&A). Built from the
  // selected period's chunks; each line is that role's composite confidence.
  const callToneChart = useMemo(() => {
    const sectionRank = { prepared: 0, qa: 1 };
    const spoken = (enrichment?.chunks || [])
      .filter(chunk => (chunk.role === 'Management' || chunk.role === 'Analyst') && chunk.tone?.composite)
      .map((chunk, index) => ({ chunk, index }))
      .sort((a, b) => (sectionRank[a.chunk.section] ?? 2) - (sectionRank[b.chunk.section] ?? 2) || a.index - b.index)
      .map(item => item.chunk);
    if (spoken.length < 2) return null;
    const series = [
      { label: 'Management tone', role: 'Management', color: C.teal },
      { label: 'Analyst tone', role: 'Analyst', color: C.perplexity },
    ];
    const datasets = series.map(item => ({
      label: item.label,
      data: spoken.map(chunk => (chunk.role === item.role ? chunk.tone.composite.investorConfidence : null)),
      borderColor: item.color,
      backgroundColor: fa(item.color, 0.12),
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      pointBackgroundColor: item.color,
      tension: 0.3,
      spanGaps: true,
    }));
    return datasets.some(dataset => dataset.data.some(value => value != null))
      ? { labels: spoken.map((_, index) => index + 1), datasets }
      : null;
  }, [enrichment]);

  const legendPlugin = { display: true, position: 'bottom', labels: { color: '#9aa3b0', boxWidth: 10, font: { size: 9 } } };
  const lineOptions = {
    ...baseOpts(value => `${value}`),
    plugins: { ...baseOpts(value => `${value}`).plugins, legend: legendPlugin },
    scales: { ...baseOpts(value => `${value}`).scales, y: { ...baseOpts(value => `${value}`).scales.y, beginAtZero: true, max: 100 } },
  };
  const valueFmt = unit => value => (unit === '$B' ? `$${value}B` : unit === '%' ? `${value}%` : unit === '×' ? `${value}×` : `${value}`);
  const valueOptions = unit => ({
    ...baseOpts(valueFmt(unit)),
    plugins: { ...baseOpts(valueFmt(unit)).plugins, legend: legendPlugin },
    scales: { ...baseOpts(valueFmt(unit)).scales, y: { ...baseOpts(valueFmt(unit)).scales.y, beginAtZero: true } },
  });

  return (
    <div className="tx-page">
      <div className="tx-workspace">
        <Collector
          ticker={ticker} setTicker={setTicker}
          quarter={quarter} setQuarter={setQuarter}
          year={year} setYear={setYear}
          onCollect={onCollect} onParse={onParse}
          loading={loading} error={error} dispatch={dispatch}
          library={library} onSelectLibrary={onSelectLibrary}
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
          {analysisLoading ? (
            <section className="tx-analysis-overview is-loading">
              <div className="tx-analysis-loader"><span className="tx-spinner" /> Running cross-quarter analysis…</div>
            </section>
          ) : analysisError ? (
            <section className="tx-analysis-overview is-error">{analysisError}</section>
          ) : report ? (
            <>
              <header className="tx-analysis-head">
                <div>
                  <h2>{report.company} <span>· transcript intelligence</span></h2>
                  <div className="tx-period-tabs">
                    {report.coverage.periods.map(name => {
                      const fiscal = name.replace(/\s+/g, '');
                      return (
                        <button
                          key={name}
                          className={period === fiscal ? 'active' : ''}
                          onClick={() => setPeriod(fiscal)}
                        >{name}</button>
                      );
                    })}
                  </div>
                </div>
                <div className="tx-head-meta">
                  <span className="tx-pill is-confident"><strong>{report.overallConfidence}</strong> confidence</span>
                  <span className="tx-pill"><strong>{report.tone}</strong> tone</span>
                </div>
              </header>

              {!toneReady && (
                <div className="tx-tone-banner">
                  <Icon name="alert" size={15} />
                  <span>Keyword & guidance signals are live. FinBERT + LLM tone scoring is not yet run for this transcript — run <code>npm run analyze:transcripts</code> to populate sentiment.</span>
                </div>
              )}

              <div className="tx-stat-grid">
                <div className="tx-stat">
                  <div className="tx-stat-value">{enrichment?.factSummary?.total ?? 0}</div>
                  <div className="tx-stat-label">Extracted facts</div>
                  <div className="tx-stat-detail">{enrichment?.factSummary?.highConfidence ?? 0} high confidence</div>
                </div>
                <div className="tx-stat">
                  <div className="tx-stat-value">{enrichment?.factSummary?.forwardLooking ?? 0}</div>
                  <div className="tx-stat-label">Guidance</div>
                  <div className="tx-stat-detail">forward-looking</div>
                </div>
                <div className="tx-stat">
                  <div className="tx-stat-value">{enrichment?.factSummary?.withMetrics ?? 0}</div>
                  <div className="tx-stat-label">With metrics</div>
                  <div className="tx-stat-detail">quantified statements</div>
                </div>
                <div className="tx-stat">
                  <div className="tx-stat-value">{enrichment?.stats?.chunks ?? 0}</div>
                  <div className="tx-stat-label">Chunks</div>
                  <div className="tx-stat-detail">{enrichment?.stats?.topics ?? 0} topics tagged</div>
                </div>
                <div className="tx-stat">
                  <div className={`tx-stat-value${toneReady ? '' : ' is-muted'}`}>{enrichment?.toneSummary?.averageInvestorConfidence ?? '—'}</div>
                  <div className="tx-stat-label">Investor tone</div>
                  <div className="tx-stat-detail">{toneReady ? `${enrichment.toneSummary.llmInterpreted} LLM-scored` : 'pending FinBERT'}</div>
                </div>
              </div>

              <div className="tx-eyebrow">Tone analysis</div>
              <div className="tx-chart-grid">
                <ChartCard title="Analyst vs investor tone" hint={report.coverage.periods.length > 1 ? 'management answers vs. analyst questions · 0–100' : 'add more quarters to trend'} wide tall hasData={!!roleToneOverTime}>
                  <Line options={lineOptions} data={roleToneOverTime || { labels: [], datasets: [] }} />
                </ChartCard>

                <ChartCard title="Tone across quarters" hint={report.coverage.periods.length > 1 ? 'investor confidence by signal · 0–100' : 'add more quarters to trend'} wide tall hasData={!!toneOverTime}>
                  <Line options={lineOptions} data={toneOverTime || { labels: [], datasets: [] }} />
                </ChartCard>
              </div>

              <section className="tx-figures-card">
                <div className="tx-chart-head">
                  <h3>Key figures</h3>
                  <small>quantified changes in {period ? period.replace(/(\d{4})(Q\d)/, '$1 $2') : 'this transcript'}</small>
                </div>
                <div className="tx-figures-filter">
                  <button className={metricFilter === 'all' ? 'active' : ''} onClick={() => selectKeyword('all')}>
                    All <span>{periodFigures.length}</span>
                  </button>
                  {FOCUS_TOPICS.map((topic, index) => (
                    <button
                      key={topic}
                      className={metricFilter === topic ? 'active' : ''}
                      onClick={() => selectKeyword(topic)}
                      disabled={!figureCounts[index]}
                    >
                      {topic} <span>{figureCounts[index]}</span>
                    </button>
                  ))}
                </div>
                <div className="tx-figure-grid">
                  {shownFigures.map(figure => (
                    <div className={`tx-fig is-${figure.direction}`} key={figure.id} title={figure.statement}>
                      <div className="tx-fig-top">
                        <span className="tx-fig-kw">{figure.keyword}</span>
                        <span className="tx-fig-period">{figure.period}</span>
                      </div>
                      <div className="tx-fig-val">
                        <span className="tx-dir">{DIR_ARROW[figure.direction]}</span>
                        <b>{figure.current}</b>
                        {figure.prior && <em>from {figure.prior}</em>}
                      </div>
                      <div className="tx-fig-label">{figure.label}</div>
                      <div className="tx-fig-desc">
                        <strong>{describeFigure(figure)}</strong>
                        {figure.delta && <span>{figure.delta}</span>}
                        {figure.forwardLooking && <span className="tx-fig-guide">guidance</span>}
                      </div>
                      {figure.sentiment && (
                        <div className={sentClass(figure.sentiment.investorConfidence)}>
                          <i /> {figure.sentiment.label}
                        </div>
                      )}
                    </div>
                  ))}
                  {!shownFigures.length && <div className="tx-chart-empty">No quantified statements for this keyword yet.</div>}
                </div>
              </section>

              <div className="tx-chart-grid">
                {metricFilter === 'all' ? (
                  <ChartCard
                    title="Management vs analyst tone through the call"
                    hint={period ? 'per-statement confidence, prepared remarks → Q&A · 0–100' : 'select a quarter'}
                    wide tall hasData={!!callToneChart}
                  >
                    <Line options={lineOptions} data={callToneChart || { labels: [], datasets: [] }} />
                  </ChartCard>
                ) : (
                  <div className="tx-chart-card is-wide">
                    <div className="tx-chart-head">
                      <h3>{valueChart ? `${valueChart.keyword} values over time` : `${metricFilter} values over time`}</h3>
                      <div className="tx-chart-head-right">
                        {valueChart && valueChart.units.length > 1 && (
                          <div className="tx-unit-toggle">
                            {valueChart.units.map(unit => (
                              <button key={unit} className={valueChart.unit === unit ? 'active' : ''} onClick={() => setValueUnit(unit)}>{unit}</button>
                            ))}
                          </div>
                        )}
                        <small>{valueChart ? `${valueChart.unit} · across quarters` : 'no multi-quarter series'}</small>
                      </div>
                    </div>
                    <div className="tx-chart-body is-tall">
                      {valueChart
                        ? <Line options={valueOptions(valueChart.unit)} data={{ labels: valueChart.labels, datasets: valueChart.datasets }} />
                        : <div className="tx-chart-empty">No values repeat across quarters for this keyword.</div>}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <section className="tx-analysis-overview is-error">No analyzed transcripts found for {activeTicker}.</section>
          )}
        </main>
      </div>
    </div>
  );
}
