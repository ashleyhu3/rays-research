import { useState, useRef, useEffect } from 'react';
import { CHART_REGISTRY } from '../../components/ChatCharts';

const SOURCE_META = {
  pypi:             { label: 'PyPI Downloads',     view: 'pypi'           },
  github:           { label: 'GitHub SDKs',        view: 'github'         },
  trends:           { label: 'Trends & Jobs',      view: 'trends'         },
  reddit:           { label: 'Reddit',             view: 'reddit'         },
  gpu:              { label: 'GPU & OpenRouter',   view: 'pricing'        },
  electricity:      { label: 'Electricity',        view: 'electricity'    },
  'ai-supply':      { label: 'Supply Chain',       view: 'ai-supply'      },
  'github-commits': { label: 'GitHub Commits',     view: 'github-commits' },
  docker:           { label: 'Docker Hub',         view: 'docker'         },
  community:        { label: 'HN & Wikipedia',     view: 'community'      },
  hf:               { label: 'HuggingFace',        view: 'hf'             },
  'openrouter-rankings': { label: 'OR Rankings',   view: 'openrouter-rankings' },
  dram:             { label: 'DRAM Spot',          view: 'pricing'        },
  openrouter:       { label: 'OpenRouter Pricing', view: 'pricing'        },
  mcp:              { label: 'MCP Ecosystem',      view: 'demand-general' },
  sec:              { label: 'SEC Filings',        view: 'demand-general' },
};

const SUGGESTIONS = [
  'Give me all data related to OpenAI',
  'Compare Anthropic vs OpenAI across all signals',
  'Which GPU is cheapest right now?',
  'Which AI company has the most open roles?',
  'How is open-source AI activity trending?',
];

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 L13.5 9 L20 10.5 L13.5 12 L12 19 L10.5 12 L4 10.5 L10.5 9 Z" />
      <path d="M19 2 L19.8 5.2 L23 6 L19.8 6.8 L19 10 L18.2 6.8 L15 6 L18.2 5.2 Z" />
    </svg>
  );
}

function InlineCharts({ sources }) {
  if (!sources?.length) return null;
  const charts = sources.flatMap(viewId => {
    const comps = CHART_REGISTRY[viewId] ?? [];
    return comps.map((Comp, i) => <Comp key={`${viewId}-${i}`} />);
  });
  if (!charts.length) return null;
  return <div className="chat-inline-charts">{charts}</div>;
}

export default function Chat({ onNavigate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef(null);
  const inputRef                = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: msg }]);
    setLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMessages(prev => [...prev, { role: 'assistant', text: data.text, sources: data.sources ?? [], meta: data.meta }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const isEmpty = messages.length === 0 && !loading;

  return (
    <div className="chat-page">
      <div className={`chat-page-messages${isEmpty ? ' chat-page-messages--empty' : ''}`}>

        {isEmpty ? (
          <div className="chat-page-hero">
            <div className="chat-page-hero-icon"><SparkleIcon /></div>
            <h1 className="chat-page-hero-title">Ask the data</h1>
            <p className="chat-page-hero-sub">
              Query all live signals — downloads, rankings, GPU prices, supply chain revenue, and more.
            </p>
            <div className="chat-page-suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="chat-page-suggestion" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-page-thread">
            {messages.map((m, i) => (
              <div key={i} className={`chat-page-msg chat-page-msg--${m.role}`}>

                {m.role !== 'user' && (
                  <div className="chat-page-msg-avatar">
                    {m.role === 'assistant' ? <SparkleIcon /> : '!'}
                  </div>
                )}

                <div className="chat-page-msg-body">
                  {m.meta?.total > 0 && (
                    <p className="chat-page-msg-meta" title={m.meta.intent}>
                      🔎 Vetted {m.meta.approved} of {m.meta.total} data sources
                    </p>
                  )}
                  <p className="chat-page-msg-text">{m.text}</p>

                  {/* Inline charts */}
                  {m.role === 'assistant' && <InlineCharts sources={m.sources} />}

                  {/* Source nav tags */}
                  {m.sources?.length > 0 && (
                    <div className="chat-page-sources">
                      {m.sources.map(s => {
                        const meta = SOURCE_META[s];
                        return meta ? (
                          <button
                            key={s}
                            className="chat-page-source-tag chat-page-source-tag--link"
                            onClick={() => onNavigate?.(meta.view)}
                            title={`Open ${meta.label} view`}
                          >
                            {meta.label} ↗
                          </button>
                        ) : (
                          <span key={s} className="chat-page-source-tag">{s}</span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-page-msg chat-page-msg--assistant">
                <div className="chat-page-msg-avatar"><SparkleIcon /></div>
                <div className="chat-page-msg-body">
                  <div className="chat-page-dots"><span /><span /><span /></div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="chat-page-input-wrap">
        <form className="chat-page-form" onSubmit={e => { e.preventDefault(); send(); }}>
          <input
            ref={inputRef}
            className="chat-page-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={isEmpty ? 'Ask anything about the AI industry…' : 'Ask a follow-up…'}
            disabled={loading}
          />
          <button
            className="chat-page-send"
            type="submit"
            disabled={loading || !input.trim()}
          >
            <SendIcon />
          </button>
        </form>
        <p className="chat-page-disclaimer">
          Answers generated from live dashboard data only — no outside knowledge.
        </p>
      </div>
    </div>
  );
}
