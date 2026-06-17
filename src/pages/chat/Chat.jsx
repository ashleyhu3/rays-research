import { useState, useRef, useEffect } from 'react';
import { CHART_REGISTRY } from '../../components/chat/ChatCharts';

const SOURCE_META = {
  pypi:             { label: 'PyPI Downloads',     view: 'pypi'           },
  github:           { label: 'GitHub SDKs',        view: 'github'         },
  trends:           { label: 'Trends',             view: 'trends'         },
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
  options:          { label: 'Options Flow',       view: 'options'        },
};

const SUGGESTIONS = [
  'Give me all data related to OpenAI',
  'Compare Anthropic vs OpenAI across all signals',
  'Which GPU is cheapest right now?',
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

/* ── Lightweight markdown rendering (bold / tables / bullets) ──────────────
   The Wordsmith is prompted to answer in dense markdown — tables for
   comparisons, bullets for lists. We render the common subset without pulling
   in a markdown dependency. */
function inlineBold(s, base) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? <strong key={`${base}-${i}`}>{p.slice(2, -2)}</strong> : p
  );
}
const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const isSepRow   = l => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
const splitCells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());

function renderRich(text) {
  const lines = String(text).split('\n');
  const out = [];
  let i = 0, key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line)) {
      const block = [];
      while (i < lines.length && isTableRow(lines[i])) block.push(lines[i++]);
      const rows = block.filter(l => !isSepRow(l));
      if (rows.length) {
        const header = splitCells(rows[0]);
        const body = rows.slice(1).map(splitCells);
        out.push(
          <table className="chat-md-table" key={`t${key++}`}>
            <thead><tr>{header.map((h, j) => <th key={j}>{inlineBold(h, `h${j}`)}</th>)}</tr></thead>
            <tbody>{body.map((r, ri) => (
              <tr key={ri}>{header.map((_, ci) => <td key={ci}>{inlineBold(r[ci] ?? '', `c${ri}-${ci}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        );
      }
      continue;
    }
    if (/^\s*[-•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-•]\s+/, ''));
      out.push(<ul className="chat-md-list" key={`u${key++}`}>{items.map((it, ii) => <li key={ii}>{inlineBold(it, `li${ii}`)}</li>)}</ul>);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(<p className="chat-md-p" key={`p${key++}`}>{inlineBold(line, `p${key}`)}</p>);
    i++;
  }
  return out;
}

/* Color-coded freshness passport row — one clickable, timestamped tag per
   cited source, colored by recency (green < 12h, amber < 7d, red older). */
function FreshnessRow({ sources, freshness, onNavigate }) {
  if (!sources?.length) return null;
  return (
    <div className="chat-fresh-row">
      {sources.map(s => {
        const meta  = SOURCE_META[s];
        const f     = freshness?.[s];
        const level = f?.level ?? 'amber';
        const view  = meta?.view;
        return (
          <button
            key={s}
            className={`chat-fresh-tag chat-fresh-tag--${level}${view ? ' chat-fresh-tag--link' : ''}`}
            onClick={() => view && onNavigate?.(view)}
            title={`${f?.source ?? meta?.label ?? s}${f?.updated ? ` · updated ${f.updated}` : ''}${view ? ' · open view' : ''}`}
          >
            <span className="chat-fresh-dot" />
            {meta?.label ?? s}
            {f?.updated ? <span className="chat-fresh-ago"> · {f.updated}</span> : null}
            {view ? ' ↗' : ''}
          </button>
        );
      })}
    </div>
  );
}

function RailCharts({ sources }) {
  const charts = (sources ?? []).flatMap(viewId => {
    const comps = CHART_REGISTRY[viewId] ?? [];
    return comps.map((Comp, i) => <Comp key={`${viewId}-${i}`} />);
  });
  if (!charts.length) return null;
  return <div className="chat-rail-charts">{charts}</div>;
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
        // Send the prior turns so the server can resolve follow-up questions
        // ("what about Google?") into a self-contained query. `messages` here is
        // the conversation before this turn (the new user line is appended above
        // via setMessages, which doesn't mutate this closure's value).
        body:    JSON.stringify({
          message: msg,
          history: messages
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(({ role, text }) => ({ role, text })),
        }),
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
  // Most recent answer that produced charts drives the right-hand rail.
  const active  = [...messages].reverse().find(m => m.role === 'assistant' && m.sources?.length);

  return (
    <div className="chat-page chat-page--split">
      <div className="chat-page-main">
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
                    {m.role === 'assistant' && (
                      <FreshnessRow sources={m.sources} freshness={m.meta?.freshness} onNavigate={onNavigate} />
                    )}
                    {m.meta?.total > 0 && (
                      <p className="chat-page-msg-meta" title={m.meta.intent}>
                        🔎 Vetted {m.meta.approved} of {m.meta.total} sources
                      </p>
                    )}
                    {m.role === 'assistant'
                      ? <div className="chat-page-msg-text chat-page-msg-text--rich">{renderRich(m.text)}</div>
                      : <p className="chat-page-msg-text">{m.text}</p>}
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

      {/* Terminal-style chart rail — auto-populates with the latest answer's charts */}
      <aside className="chat-page-rail">
        <div className="chat-rail-head">Live Charts</div>
        {active ? (
          <RailCharts sources={active.sources} />
        ) : (
          <div className="chat-rail-empty">
            Charts cited in an answer appear here — each exportable to CSV.
          </div>
        )}
      </aside>
    </div>
  );
}
