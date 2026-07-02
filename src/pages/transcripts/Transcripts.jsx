import { useEffect, useMemo, useState } from 'react';
import './Transcripts.css';

const CURRENT_YEAR = new Date().getFullYear();
const SAMPLE = `Prepared Remarks

Sanjay Mehrotra -- President and Chief Executive Officer
We delivered a record quarter, supported by strong data center demand and improving pricing.

Mark Murphy -- Executive Vice President and Chief Financial Officer
[00:14:22] Revenue grew 18% sequentially and operating cash flow reached $1.2 billion.

Question-and-Answer Session

C.J. Muse -- Evercore ISI Analyst
How should investors think about gross margin pressure if NAND spot prices continue to decline?

Sanjay Mehrotra -- President and Chief Executive Officer
Spot pricing does not reflect our long-term contracts. We expect temporary inventory digestion, while cloud demand remains solid.`;

const ROLE_COLORS = {
  Management: '#70d6a7',
  Analyst: '#ffad72',
  Operator: '#8da2c0',
  Unknown: '#a2a8b3',
};

function Icon({ name, size = 16 }) {
  const paths = {
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
    split: <><path d="M6 3v5c0 2 1.5 3 3.5 3H18" /><path d="m15 8 3 3-3 3" /><path d="M6 21v-5c0-2 1.5-3 3.5-3H18" /></>,
    file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M9 12h6M9 16h6" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    users: <><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    quote: <><path d="M9 11H5a3 3 0 0 0-3 3v5h7v-8Zm13 0h-4a3 3 0 0 0-3 3v5h7v-8Z" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    spark: <><path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8L12 3Z" /><path d="m5 15 .7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15Z" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function PipelineStep({ number, title, caption, icon, active, complete, locked }) {
  return (
    <div className={`tx-pipeline-step${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}${locked ? ' is-locked' : ''}`}>
      <div className="tx-pipeline-icon">{complete ? <Icon name="check" /> : <Icon name={icon} />}</div>
      <div>
        <div className="tx-eyebrow">Stage {number}</div>
        <div className="tx-pipeline-title">{title}</div>
        <div className="tx-pipeline-caption">{caption}</div>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, icon }) {
  return (
    <div className="tx-metric">
      <div className="tx-metric-icon"><Icon name={icon} /></div>
      <div>
        <div className="tx-metric-value">{value}</div>
        <div className="tx-metric-label">{label}</div>
        {detail && <div className="tx-metric-detail">{detail}</div>}
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div className="tx-empty">
      <div className="tx-empty-mark"><Icon name="file" size={26} /></div>
      <h3>No transcript loaded</h3>
      <p>Choose a ticker and fiscal period to collect a transcript from Alpha Vantage, or paste one into the local parser.</p>
      <div className="tx-empty-example">
        <span>Example</span>
        <code>GOOGL · Q1 · 2026</code>
      </div>
    </div>
  );
}

function TranscriptViewer({ document, enrichment }) {
  const [mode, setMode] = useState('transcript');
  const [section, setSection] = useState('all');
  const [speaker, setSpeaker] = useState('all');
  const [topic, setTopic] = useState('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setMode('transcript');
    setSection('all');
    setSpeaker('all');
    setTopic('all');
    setQuery('');
  }, [document?.fiscal_period, document?.ticker]);

  const blocks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (document?.speaker_blocks ?? []).filter(block => {
      if (section !== 'all' && block.section !== section) return false;
      if (speaker !== 'all' && block.speaker !== speaker) return false;
      return !needle || block.text.toLowerCase().includes(needle) || block.speaker.toLowerCase().includes(needle);
    });
  }, [document, section, speaker, query]);

  const chunks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (enrichment?.chunks ?? []).filter(chunk => {
      if (section !== 'all' && chunk.section !== section) return false;
      if (speaker !== 'all' && chunk.speaker !== speaker) return false;
      if (topic !== 'all' && !chunk.topics.includes(topic)) return false;
      return !needle
        || chunk.text.toLowerCase().includes(needle)
        || chunk.speaker.toLowerCase().includes(needle)
        || chunk.topics.some(value => value.toLowerCase().includes(needle));
    });
  }, [enrichment, query, section, speaker, topic]);

  const facts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (enrichment?.facts ?? []).filter(fact => {
      if (section !== 'all' && fact.section !== section) return false;
      if (speaker !== 'all' && fact.speaker !== speaker) return false;
      if (topic !== 'all' && !fact.topics.includes(topic)) return false;
      return !needle
        || fact.statement.toLowerCase().includes(needle)
        || fact.speaker.toLowerCase().includes(needle)
        || fact.topics.some(value => value.toLowerCase().includes(needle));
    });
  }, [enrichment, query, section, speaker, topic]);

  const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const visibleCount = mode === 'facts' ? facts.length : mode === 'chunks' ? chunks.length : blocks.length;
  const sectionCount = value => {
    if (mode === 'facts') return enrichment?.facts.filter(item => item.section === value).length || 0;
    if (mode === 'chunks') return enrichment?.chunks.filter(item => item.section === value).length || 0;
    return value === 'prepared' ? document.stats.preparedBlocks : document.stats.qaBlocks;
  };

  return (
    <section className="tx-viewer-card">
      <div className="tx-viewer-head">
        <div>
          <div className="tx-eyebrow">Normalized transcript</div>
          <h2>{document.ticker} <span>{document.fiscal_period}</span></h2>
          <p>{document.earnings_date ? `Earnings call · ${document.earnings_date}` : 'Earnings date unavailable'} · collected via {document.metadata?.provider || 'Octagon'}</p>
        </div>
        <div className="tx-normalized-badge"><Icon name="check" size={13} /> Parsed locally</div>
      </div>

      <div className="tx-metrics">
        <Metric icon="users" value={document.stats.speakers} label="Speakers" detail="identified participants" />
        <Metric icon="quote" value={document.stats.preparedBlocks} label="Prepared" detail="speaker paragraphs" />
        <Metric icon="split" value={document.stats.qaBlocks} label="Q&A" detail="questions + answers" />
        <Metric icon="file" value={document.stats.wordCount.toLocaleString()} label="Words" detail={`${document.stats.totalBlocks} total blocks`} />
      </div>

      {enrichment && (
        <>
          <div className="tx-enrichment">
            <div>
              <span>Semantic layer</span>
              <strong>{enrichment.stats.chunks} chunks · {enrichment.stats.topics} topics</strong>
            </div>
            <div className="tx-topic-cloud">
              {enrichment.topicSummary.slice(0, 8).map(item => (
                <button key={item.topic} onClick={() => { setMode('chunks'); setTopic(item.topic); }}>
                  {item.topic}<span>{item.count}</span>
                </button>
              ))}
            </div>
            <div className={`tx-vector-status${enrichment.embedding ? ' is-ready' : ''}`}>
              <Icon name={enrichment.embedding ? 'check' : 'clock'} size={12} />
              {enrichment.embedding ? `${enrichment.embedding.model.split('/').pop()} · ${enrichment.embedding.dimension}d` : 'Vector index pending'}
            </div>
          </div>
          {(enrichment.factSummary || enrichment.toneSummary) && (
            <div className="tx-analysis-strip">
              <div><span>Extracted facts</span><strong>{enrichment.factSummary?.total || 0}</strong><small>{enrichment.factSummary?.highConfidence || 0} high confidence</small></div>
              <div><span>Forward looking</span><strong>{enrichment.factSummary?.forwardLooking || 0}</strong><small>guidance statements</small></div>
              <div><span>Investor confidence</span><strong>{enrichment.toneSummary?.averageInvestorConfidence ?? '—'}</strong><small>0–100 composite</small></div>
              <div><span>LLM interpreted</span><strong>{enrichment.toneSummary?.llmInterpreted || 0}</strong><small>management answers</small></div>
            </div>
          )}
        </>
      )}

      <div className="tx-toolbar">
        <div className="tx-toolbar-left">
          <div className="tx-view-toggle">
            <button className={mode === 'transcript' ? 'active' : ''} onClick={() => setMode('transcript')}>Transcript</button>
            <button className={mode === 'chunks' ? 'active' : ''} onClick={() => setMode('chunks')} disabled={!enrichment}>Semantic chunks</button>
            <button className={mode === 'facts' ? 'active' : ''} onClick={() => setMode('facts')} disabled={!enrichment?.facts?.length}>Facts</button>
          </div>
          <div className="tx-tabs">
            {[
              ['all', 'All', mode === 'facts' ? enrichment?.factSummary?.total : mode === 'chunks' ? enrichment?.stats.chunks : document.stats.totalBlocks],
              ['prepared', 'Prepared', sectionCount('prepared')],
              ['qa', 'Q&A', sectionCount('qa')],
            ].map(([value, label, count]) => (
              <button key={value} className={section === value ? 'active' : ''} onClick={() => setSection(value)}>
                {label}<span>{count || 0}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="tx-filters">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'facts' ? 'Search facts or metrics' : mode === 'chunks' ? 'Search chunks or topics' : 'Search transcript'} />
          {mode !== 'transcript' && (
            <select value={topic} onChange={event => setTopic(event.target.value)}>
              <option value="all">All topics</option>
              {enrichment?.topicSummary.map(item => <option key={item.topic} value={item.topic}>{item.topic} ({item.count})</option>)}
            </select>
          )}
          <select value={speaker} onChange={event => setSpeaker(event.target.value)}>
            <option value="all">All speakers</option>
            {document.speakers.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </div>
      </div>

      {mode === 'transcript' ? (
        <div className="tx-block-list">
          {blocks.map(block => (
            <article className="tx-block" key={block.id}>
              <div className="tx-avatar" style={{ '--speaker-color': ROLE_COLORS[block.role] || ROLE_COLORS.Unknown }}>{initials(block.speaker)}</div>
              <div className="tx-block-body">
                <div className="tx-block-meta">
                  <div>
                    <strong>{block.speaker}</strong>
                    {block.title && <span className="tx-speaker-title">{block.title}</span>}
                  </div>
                  <div className="tx-block-tags">
                    <span className={`tx-role tx-role--${block.role.toLowerCase()}`}>{block.role}</span>
                    <span>{block.section === 'qa' ? (block.kind === 'question' ? 'Question' : block.kind === 'answer' ? 'Answer' : 'Q&A') : 'Prepared'}</span>
                    {block.timestamp && <span><Icon name="clock" size={11} /> {block.timestamp}</span>}
                  </div>
                </div>
                <p>{block.text}</p>
                <div className="tx-block-foot">Block {String(block.id).padStart(2, '0')} · paragraph {block.paragraph} · {block.company} {block.quarter}</div>
              </div>
            </article>
          ))}
          {!blocks.length && <div className="tx-no-results">No transcript blocks match these filters.</div>}
        </div>
      ) : mode === 'chunks' ? (
        <div className="tx-block-list">
          {chunks.map(chunk => (
            <article className="tx-block tx-chunk" key={chunk.id}>
              <div className="tx-avatar" style={{ '--speaker-color': ROLE_COLORS[chunk.role] || ROLE_COLORS.Unknown }}>{initials(chunk.speaker)}</div>
              <div className="tx-block-body">
                <div className="tx-block-meta">
                  <div>
                    <strong>{chunk.speaker}</strong>
                    {chunk.title && <span className="tx-speaker-title">{chunk.title}</span>}
                  </div>
                  <div className="tx-block-tags">
                    <span className="tx-topic-primary">{chunk.topic}</span>
                    {chunk.tone?.composite && (
                      <span className={`tx-tone${chunk.tone.composite.investorConfidence < 43 ? ' is-concerned' : chunk.tone.composite.investorConfidence >= 58 ? ' is-confident' : ''}`}>
                        Tone {chunk.tone.composite.investorConfidence}
                      </span>
                    )}
                    <span>{chunk.tokenCount} tokens</span>
                    <span>{chunk.section === 'qa' ? 'Q&A' : 'Prepared'}</span>
                  </div>
                </div>
                <p>{chunk.text}</p>
                <div className="tx-chunk-topics">
                  {chunk.topics.map(value => <button key={value} onClick={() => setTopic(value)}>{value}</button>)}
                </div>
                {chunk.tone?.llm && (
                  <div className="tx-tone-reason">
                    <strong>{chunk.tone.llm.stance.replaceAll('_', ' ')}</strong>
                    <span>{chunk.tone.llm.reasoning}</span>
                  </div>
                )}
                <div className="tx-block-foot">{chunk.id} · source block {chunk.sourceBlockId} · topic confidence {(chunk.topicConfidence * 100).toFixed(0)}%</div>
              </div>
            </article>
          ))}
          {!chunks.length && <div className="tx-no-results">No semantic chunks match these filters.</div>}
        </div>
      ) : (
        <div className="tx-block-list">
          {facts.map(fact => (
            <article className="tx-fact" key={fact.id}>
              <div className="tx-fact-head">
                <div>
                  <span className="tx-topic-primary">{fact.topic}</span>
                  {fact.forwardLooking && <span className="tx-forward">Forward looking</span>}
                  <span>{fact.confidence} confidence</span>
                </div>
                <small>{fact.speaker} · {fact.section === 'qa' ? 'Q&A' : 'Prepared'}</small>
              </div>
              <blockquote>{fact.statement}</blockquote>
              {!!fact.metrics.length && (
                <div className="tx-fact-metrics">
                  {fact.metrics.map(metric => <span key={`${metric.type}-${metric.value}`}>{metric.value}<small>{metric.type.replaceAll('_', ' ')}</small></span>)}
                </div>
              )}
              {fact.sentiment && (
                <div className="tx-fact-tone">
                  <span>{fact.sentiment.label}</span>
                  <div><i style={{ width: `${fact.sentiment.investorConfidence}%` }} /></div>
                  <strong>{fact.sentiment.investorConfidence}</strong>
                </div>
              )}
              <div className="tx-block-foot">{fact.id} · source block {fact.sourceBlockId}</div>
            </article>
          ))}
          {!facts.length && <div className="tx-no-results">No structured facts match these filters.</div>}
        </div>
      )}
      <div className="tx-result-count">{visibleCount} {mode === 'facts' ? 'facts' : mode === 'chunks' ? 'chunks' : 'blocks'} shown</div>
    </section>
  );
}

function documentFromEnrichment(enrichment) {
  const chunks = enrichment?.chunks ?? [];
  const speakerMap = new Map();
  for (const chunk of chunks) {
    if (!chunk.speaker || speakerMap.has(chunk.speaker)) continue;
    speakerMap.set(chunk.speaker, {
      name: chunk.speaker,
      title: chunk.title || '',
      role: chunk.role || 'Unknown',
    });
  }
  const preparedBlocks = chunks.filter(chunk => chunk.section === 'prepared').length;
  const qaBlocks = chunks.filter(chunk => chunk.section === 'qa').length;
  return {
    ticker: enrichment.ticker,
    quarter: enrichment.quarter,
    year: enrichment.year,
    fiscal_period: enrichment.fiscal_period,
    earnings_date: enrichment.earnings_date || null,
    metadata: {
      provider: enrichment.sourceProvider || 'local analysis',
      analyzed: true,
    },
    speakers: [...speakerMap.values()],
    speaker_blocks: chunks.map((chunk, index) => ({
      id: chunk.id || index + 1,
      speaker: chunk.speaker || 'Unknown speaker',
      title: chunk.title || '',
      role: chunk.role || 'Unknown',
      section: chunk.section || 'prepared',
      kind: chunk.kind || 'remark',
      timestamp: chunk.timestamp || null,
      paragraph: chunk.chunkInBlock || 1,
      company: enrichment.ticker,
      quarter: enrichment.fiscal_period,
      text: chunk.text,
    })),
    stats: {
      speakers: speakerMap.size,
      preparedBlocks,
      qaBlocks,
      totalBlocks: chunks.length,
      wordCount: chunks.reduce(
        (total, chunk) => total + String(chunk.text || '').split(/\s+/).filter(Boolean).length,
        0,
      ),
    },
  };
}

function AnalysisOverview({ payload, loading, error, onSelectPeriod }) {
  const report = payload?.reports?.[0];
  const timelines = payload?.analysis?.timelines ?? [];
  const topicNames = new Set(report?.topics?.map(item => item.topic) ?? []);
  const visibleTimelines = timelines.filter(item => topicNames.has(item.topic));
  const usage = payload?.modelUsage;

  if (loading) {
    return (
      <section className="tx-analysis-overview is-loading">
        <div className="tx-analysis-loader"><span className="tx-spinner" /> Running deterministic cross-quarter analysis…</div>
      </section>
    );
  }
  if (error) {
    return <section className="tx-analysis-overview is-error">{error}</section>;
  }
  if (!report) return null;

  return (
    <section className="tx-analysis-overview">
      <div className="tx-report-head">
        <div>
          <div className="tx-eyebrow">Stages 08–12 · Cross-quarter report</div>
          <h2>{report.company} transcript intelligence</h2>
          <p>{report.coverage.periods.join(' · ')} · {report.coverage.topics} topics · {report.coverage.comparisons} quarter comparisons</p>
        </div>
        <div className="tx-confidence">
          <strong>{report.overallConfidence}</strong>
          <span>Overall confidence</span>
          <small>{report.tone}</small>
        </div>
      </div>

      <div className="tx-processing-note">
        <span>Hybrid pipeline</span>
        <strong>{usage?.totalChunks || 0} chunks processed deterministically</strong>
        <p>
          Gemini/Groq interpreted {usage?.llmInterpreted || 0} selected management answers
          {usage?.totalChunks ? ` (${((usage.llmShare || 0) * 100).toFixed(1)}% of chunks)` : ''}; the complete transcripts were not sent through an LLM.
        </p>
      </div>

      <div className="tx-report-grid">
        <div className="tx-topic-signals">
          <div className="tx-report-section-head"><span>Topic signals</span><small>First → latest quarter</small></div>
          {report.topics.map(topic => (
            <div className="tx-signal" key={topic.topic}>
              <strong>{topic.topic}</strong>
              <span className={`tx-direction${topic.direction.includes('↓') ? ' is-down' : topic.direction.includes('↑') ? ' is-up' : ''}`}>{topic.direction}</span>
              <div><i style={{ width: `${topic.confidence}%` }} /></div>
              <small>{topic.confidence}</small>
            </div>
          ))}
        </div>

        <div className="tx-notable-change">
          <div className="tx-report-section-head"><span>Notable change</span><small>{report.notableChange.from} → {report.notableChange.to}</small></div>
          <h3>{report.notableChange.narrative}</h3>
          <div className="tx-change-stats">
            <span>Sentiment <strong>{report.notableChange.sentimentDelta > 0 ? '+' : ''}{report.notableChange.sentimentDelta}</strong></span>
            <span>Confidence <strong>{report.notableChange.confidenceDelta > 0 ? '+' : ''}{Math.round(report.notableChange.confidenceDelta * 100)}</strong></span>
          </div>
          <div className="tx-report-evidence">
            {report.notableChange.evidence.map(item => (
              <blockquote key={`${item.period}-${item.statement}`}>
                <span>{item.period} · {item.speaker}</span>
                {item.statement}
              </blockquote>
            ))}
          </div>
        </div>
      </div>

      <div className="tx-timeline">
        <div className="tx-report-section-head"><span>Topic timeline</span><small>Click a quarter to open its transcript</small></div>
        {visibleTimelines.map(timeline => (
          <div className="tx-timeline-row" key={timeline.topic}>
            <strong>{timeline.topic}</strong>
            <div>
              {timeline.points.map(point => (
                <button key={point.period} onClick={() => onSelectPeriod(point.period)}>
                  <span>{point.period}</span>
                  <i className={point.sentimentScore >= .2 ? 'is-positive' : point.sentimentScore <= -.2 ? 'is-negative' : ''} />
                  <small>{point.sentiment} · {Math.round(point.confidenceScore * 100)}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="tx-contradiction-summary">
        <span>Potential contradictions</span>
        <strong>{report.contradictions.length}</strong>
        <p>{report.contradictions.length ? 'Review the flagged quarter-over-quarter statements below.' : 'No comparable management statements crossed the contradiction threshold.'}</p>
      </div>
    </section>
  );
}

export default function Transcripts() {
  const [ticker, setTicker] = useState('GOOGL');
  const [quarter, setQuarter] = useState('Q1');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [document, setDocument] = useState(null);
  const [enrichment, setEnrichment] = useState(null);
  const [library, setLibrary] = useState([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [analysisError, setAnalysisError] = useState('');

  const refreshLibrary = () => {
    fetch('/api/transcripts/library')
      .then(response => response.ok ? response.json() : [])
      .then(data => {
        const items = Array.isArray(data) ? data : [];
        setLibrary(items);
        setDocument(current => current || items.find(
          item => item.ticker === 'GOOGL' || item.transcript?.ticker === 'GOOGL',
        )?.transcript || null);
      })
      .catch(() => setLibrary([]));
  };

  useEffect(refreshLibrary, []);

  useEffect(() => {
    setAnalysisLoading(true);
    setAnalysisError('');
    fetch('/api/transcripts/analysis/GOOGL')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
      })
      .then(data => {
        setAnalysis(data);
        const latestPeriod = data.reports?.[0]?.coverage?.periods?.at(-1);
        if (latestPeriod) loadAnalyzedPeriod(latestPeriod);
      })
      .catch(requestError => setAnalysisError(requestError.message))
      .finally(() => setAnalysisLoading(false));
  }, []);

  useEffect(() => {
    if (!document?.ticker || !document?.fiscal_period) {
      setEnrichment(null);
      return;
    }
    setEnrichment(null);
    fetch(`/api/transcripts/enrichment/${document.ticker}/${document.fiscal_period}`)
      .then(response => response.ok ? response.json() : null)
      .then(setEnrichment)
      .catch(() => setEnrichment(null));
  }, [document?.ticker, document?.fiscal_period]);

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
      setDocument(data.transcript);
      setEnrichment(data.enrichment || null);
      refreshLibrary();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading('');
    }
  }

  const collect = event => {
    event.preventDefault();
    submit('/api/transcripts/collect', { ticker, quarter, year: Number(year) }, `Collecting ${ticker.toUpperCase()} ${year}${quarter}…`);
  };

  const parseManual = () => submit(
    '/api/transcripts/parse',
    { ticker, quarter, year: Number(year), text: manualText },
    'Parsing transcript locally…',
  );

  async function loadAnalyzedPeriod(period) {
    const fiscalPeriod = period.replace(/\s+/g, '');
    try {
      const response = await fetch(`/api/transcripts/enrichment/GOOGL/${fiscalPeriod}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setDocument(documentFromEnrichment(data));
      setEnrichment(data);
      setTicker('GOOGL');
      setQuarter(data.quarter || fiscalPeriod.slice(-2));
      setYear(data.year || fiscalPeriod.slice(0, 4));
    } catch (requestError) {
      setAnalysisError(requestError.message);
    }
  }

  const selectAnalyzedPeriod = period => {
    const fiscalPeriod = period.replace(/\s+/g, '');
    const item = library.find(entry => (
      (entry.ticker === 'GOOGL' || entry.transcript?.ticker === 'GOOGL')
      && (entry.fiscal_period === fiscalPeriod || entry.transcript?.fiscal_period === fiscalPeriod)
    ));
    if (item?.transcript) {
      setDocument(item.transcript);
      return;
    }
    loadAnalyzedPeriod(period);
  };

  return (
    <div className="tx-page">
      <header className="tx-hero">
        <div>
          <div className="tx-kicker"><span /> Research pipeline</div>
          <h1>Earnings calls, structured before they are analyzed.</h1>
          <p>Collect once, preserve every speaker, then build topic-aware semantic chunks and local retrieval vectors without sending the full call through an LLM.</p>
        </div>
        <div className="tx-provider">
          <div className="tx-provider-mark">A</div>
          <div><span>Transcript source</span><strong>Alpha Vantage</strong></div>
          <i>Full call</i>
        </div>
      </header>

      <div className="tx-pipeline">
        <PipelineStep number="01" title="Collect" caption="Alpha Vantage → JSON + Markdown" icon="database" active={!document} complete={!!document} />
        <Icon name="arrow" />
        <PipelineStep number="02" title="Parse" caption="Prepared · Q&A · speakers" icon="split" active={!!document} complete={!!document} />
        <Icon name="arrow" />
        <PipelineStep number="03" title="Chunk" caption="Speaker + topic boundaries" icon="split" active={!!document && !enrichment} complete={!!enrichment} />
        <Icon name="arrow" />
        <PipelineStep number="04" title="Embed" caption="BGE · Chroma" icon="database" active={!!enrichment && !enrichment.embedding} complete={!!enrichment?.embedding} />
        <Icon name="arrow" />
        <PipelineStep number="05" title="Classify" caption="Deterministic topic tags" icon="spark" complete={!!enrichment?.topicSummary?.length} />
        <Icon name="arrow" />
        <PipelineStep number="06" title="Extract" caption="Facts · metrics · guidance" icon="file" complete={!!enrichment?.factSummary?.total} />
        <Icon name="arrow" />
        <PipelineStep number="07" title="Tone" caption="FinBERT · emotion · LLM" icon="spark" complete={enrichment?.toneSummary?.chunks === enrichment?.stats?.chunks} />
      </div>

      <div className="tx-workspace">
        <aside className="tx-collector">
          <div className="tx-card-head">
            <div>
              <div className="tx-eyebrow">Stage 01</div>
              <h2>Collect a transcript</h2>
            </div>
            <span className="tx-live-dot">Source only</span>
          </div>
          <p className="tx-card-copy">Alpha Vantage supplies the complete speaker-segmented call. No Gemini or Groq analysis runs during collection or parsing.</p>
          <div className="tx-source-note">
            The free API is limited to 25 requests per day. Stored transcripts are reused locally and in MongoDB, so downstream analysis does not spend additional transcript requests.
          </div>

          <form onSubmit={collect} className="tx-form">
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
              {loading && loading.startsWith('Collecting') ? loading : 'Collect & normalize'}
            </button>
          </form>

          {error && <div className="tx-error">{error}</div>}

          <div className="tx-divider"><span>or use a local transcript</span></div>
          <button className="tx-secondary" onClick={() => setManualOpen(value => !value)}>
            <Icon name="upload" /> {manualOpen ? 'Hide pasted transcript' : 'Paste transcript'}
          </button>
          {manualOpen && (
            <div className="tx-manual">
              <textarea value={manualText} onChange={event => setManualText(event.target.value)} placeholder="Prepared Remarks&#10;&#10;Speaker Name -- Title&#10;Transcript paragraph…" />
              <div>
                <button onClick={() => setManualText(SAMPLE)} disabled={!!loading}>Load sample</button>
                <button onClick={parseManual} disabled={!!loading || !ticker.trim() || !manualText.trim()}>
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
            {library.slice(0, 6).map(item => (
              <button key={`${item.ticker}-${item.fiscal_period}`} onClick={() => setDocument(item.transcript)}>
                <span>{item.ticker}</span>
                <div><strong>{item.fiscal_period}</strong><small>{item.stats?.totalBlocks || 0} blocks · {item.stats?.wordCount?.toLocaleString() || 0} words</small></div>
                <Icon name="arrow" size={14} />
              </button>
            ))}
            {!library.length && <p>Normalized transcripts will appear here after collection.</p>}
          </div>
        </aside>

        <main className="tx-main">
          <AnalysisOverview
            payload={analysis}
            loading={analysisLoading}
            error={analysisError}
            onSelectPeriod={selectAnalyzedPeriod}
          />
          {document ? <TranscriptViewer document={document} enrichment={enrichment} /> : <EmptyViewer />}
        </main>
      </div>
    </div>
  );
}
