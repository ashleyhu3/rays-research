import { useEffect, useMemo, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import '../../utils/chartSetup';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts } from '../../utils/chartHelpers';
import './Transcripts.css';

const CURRENT_YEAR = new Date().getFullYear();

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
function Collector({
  ticker, setTicker, quarter, setQuarter, year, setYear,
  provider, setProvider, onCollect, onParse,
  loading, error, library, onSelectLibrary,
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
      <p className="tx-card-copy">Pull a full earnings call by ticker and fiscal quarter, or paste your own. Collection normalizes speakers and tags the focus keywords locally.</p>

      <form onSubmit={onCollect} className="tx-form">
        <label>
          Provider
          <select value={provider} onChange={event => setProvider(event.target.value)}>
            <option value="octagon">Octagon (full transcript)</option>
            <option value="alphavantage">Alpha Vantage</option>
          </select>
        </label>
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
          {loading && loading.startsWith('Collecting') ? <span className="tx-spinner" /> : <Icon name="database" />}
          {loading && loading.startsWith('Collecting') ? loading : 'Collect & analyze'}
        </button>
      </form>

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
  const [provider, setProvider] = useState('octagon');

  const [activeTicker, setActiveTicker] = useState('GOOGL');
  const [period, setPeriod] = useState(null);
  const [enrichment, setEnrichment] = useState(null);
  const [library, setLibrary] = useState([]);

  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
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
  }, [activeTicker]);

  // Load the enrichment (keyword counts, facts, tone) for the selected period.
  useEffect(() => {
    if (!activeTicker || !period) { setEnrichment(null); return; }
    fetch(`/api/transcripts/enrichment/${activeTicker}/${period}`)
      .then(response => response.ok ? response.json() : null)
      .then(setEnrichment)
      .catch(() => setEnrichment(null));
  }, [activeTicker, period]);

  async function submit(endpoint, payload, label) {
    if (loading) return;
    setLoading(label);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
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

  const onCollect = event => {
    event.preventDefault();
    submit('/api/transcripts/collect', { ticker, quarter, year: Number(year), provider }, `Collecting ${ticker.toUpperCase()} ${year}${quarter}…`);
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

  // Keyword mention counts for the selected quarter.
  const focusMentions = useMemo(() => {
    const counts = new Map((enrichment?.topicSummary ?? []).map(item => [item.topic, item.count]));
    return FOCUS_TOPICS.map(topic => counts.get(topic) || 0);
  }, [enrichment]);

  // Topic-classification confidence per focus signal (from the report).
  const focusConfidence = useMemo(() => {
    const byTopic = new Map((report?.topics ?? []).map(item => [item.topic, item]));
    return FOCUS_TOPICS.map(topic => byTopic.get(topic)?.confidence || 0);
  }, [report]);

  // Broader keyword landscape — top mentioned topics this quarter.
  const topTopics = useMemo(() => (enrichment?.topicSummary ?? []).slice(0, 12), [enrichment]);

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

  const hasMentions = focusMentions.some(value => value > 0);
  const evidence = (report?.topics ?? [])
    .flatMap(topic => (topic.evidence ?? []).map(item => ({ ...item, topic: topic.topic })))
    .filter(item => FOCUS_TOPICS.includes(item.topic))
    .slice(0, 6);

  const barOptions = hBarOpts(value => value.toLocaleString());
  const confOptions = {
    ...hBarOpts(value => `${value}`),
    scales: { ...hBarOpts(value => `${value}`).scales, x: { ...hBarOpts(value => `${value}`).scales.x, max: 100 } },
  };
  const lineOptions = {
    ...baseOpts(value => `${value}`),
    plugins: { ...baseOpts(value => `${value}`).plugins, legend: { display: true, position: 'bottom', labels: { color: '#9aa3b0', boxWidth: 10, font: { size: 9 } } } },
    scales: { ...baseOpts(value => `${value}`).scales, y: { ...baseOpts(value => `${value}`).scales.y, beginAtZero: true, max: 100 } },
  };

  return (
    <div className="tx-page">
      <div className="tx-workspace">
        <Collector
          ticker={ticker} setTicker={setTicker}
          quarter={quarter} setQuarter={setQuarter}
          year={year} setYear={setYear}
          provider={provider} setProvider={setProvider}
          onCollect={onCollect} onParse={onParse}
          loading={loading} error={error}
          library={library} onSelectLibrary={onSelectLibrary}
        />

        <main className="tx-main">
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
                  <h2>{report.company} <span>· {period ? period.replace(/(\d{4})(Q\d)/, '$1 $2') : report.coverage.periods.at(-1)}</span></h2>
                  <p>{report.coverage.periods.join(' · ')} · {report.coverage.topics} topics tracked · {usage?.totalChunks || 0} chunks classified locally</p>
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

              <div className="tx-chart-grid">
                <ChartCard title="Focus keyword mentions" hint="this quarter" hasData={hasMentions}>
                  <Bar
                    options={barOptions}
                    data={{
                      labels: FOCUS_TOPICS,
                      datasets: [{
                        label: 'Mentions',
                        data: focusMentions,
                        backgroundColor: FOCUS_TOPICS.map((_, index) => fa(FOCUS_COLORS[index], 0.55)),
                        borderColor: FOCUS_TOPICS.map((_, index) => FOCUS_COLORS[index]),
                        borderWidth: 1,
                        borderRadius: 4,
                      }],
                    }}
                  />
                </ChartCard>

                <ChartCard title="Signal confidence" hint="topic classification · 0–100" hasData={focusConfidence.some(Boolean)}>
                  <Bar
                    options={confOptions}
                    data={{
                      labels: FOCUS_TOPICS,
                      datasets: [{
                        label: 'Confidence',
                        data: focusConfidence,
                        backgroundColor: FOCUS_TOPICS.map((_, index) => fa(FOCUS_COLORS[index], 0.35)),
                        borderColor: FOCUS_TOPICS.map((_, index) => FOCUS_COLORS[index]),
                        borderWidth: 1,
                        borderRadius: 4,
                      }],
                    }}
                  />
                </ChartCard>

                <ChartCard title="Keyword landscape" hint="top mentioned topics" wide hasData={topTopics.length > 0}>
                  <Bar
                    options={barOptions}
                    data={{
                      labels: topTopics.map(item => item.topic),
                      datasets: [{
                        label: 'Mentions',
                        data: topTopics.map(item => item.count),
                        backgroundColor: fa(C.google, 0.4),
                        borderColor: C.google,
                        borderWidth: 1,
                        borderRadius: 4,
                      }],
                    }}
                  />
                </ChartCard>

                <ChartCard title="Tone across quarters" hint={report.coverage.periods.length > 1 ? 'confidence trend · 0–100' : 'add more quarters to trend'} wide tall hasData={!!toneOverTime}>
                  <Line options={lineOptions} data={toneOverTime || { labels: [], datasets: [] }} />
                </ChartCard>
              </div>

              {evidence.length > 0 && (
                <section className="tx-evidence-card">
                  <div className="tx-chart-head"><h3>Key statements</h3><small>strongest evidence per focus signal</small></div>
                  <div className="tx-evidence-list">
                    {evidence.map(item => (
                      <div className="tx-evidence-item" key={`${item.topic}-${item.statement}`}>
                        <div>
                          <span className="tx-topic-primary">{item.topic}</span>
                          {item.forwardLooking && <span className="tx-forward">Guidance</span>}
                          <span className="tx-ev-src">{item.period} · {item.speaker || 'Unknown'} · {item.confidence}% conf.</span>
                        </div>
                        <blockquote>{item.statement}</blockquote>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <section className="tx-analysis-overview is-error">No analyzed transcripts found for {activeTicker}.</section>
          )}
        </main>
      </div>
    </div>
  );
}
