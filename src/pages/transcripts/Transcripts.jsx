import { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { GRID, TICK, BORD } from '../../utils/chartHelpers';

/* Earnings-Transcript Sentiment Agent.
   - Single quarter: paste, or fetch by ticker+quarter (Alpha Vantage).
   - SNDK 4-quarter series: AV newest quarter (Q&A) + SEC EDGAR press releases
     for the older three, with cross-quarter tone/catalyst comparison.
   Every flagged catalyst expands to the verbatim transcript text that caused it. */

const SAMPLE = `Sanjay Mehrotra (CEO): We are thrilled to announce a record quarter, with sequential revenue growth of 18% and demand at all-time highs.
Mark Murphy (CFO): Operating cash flows were strong at $1.2 billion and we expect structural tailwinds to lift margins next year.
C.J. Muse (Evercore ISI Analyst): NAND spot prices dropped 14% over three weeks and PC OEMs are slashing build targets. Why not expect severe margin compression next quarter?
Sanjay Mehrotra (CEO): Spot pricing is volatile and doesn't reflect our long-term contracts. We see temporary inventory digestion dipping gross margins by maybe 250 basis points, but cloud demand is solid.`;

const ROLE_COLOR = { Management: C.openai, Analyst: C.red, Operator: C.slate, Unknown: C.slate };
const ENGINE_LABEL = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'groq-llama-3.3-70b (two-tier)': 'Groq Llama-3.3-70B (two-tier)',
  'lexicon': 'Lexicon (fallback)',
};
const sevColor = s => (s >= 4 ? '#f87171' : s >= 3 ? '#fbbf24' : '#94a3b8');

const toneScale = (title) => ({
  responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
  plugins: {
    legend: { display: true, position: 'bottom', labels: { color: '#c8c8c0', font: { size: 11 }, padding: 12, boxWidth: 12 } },
    tooltip: { backgroundColor: '#1a1f2a', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1, callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(2)}` } },
  },
  scales: {
    x: { title: { display: !!title, text: title, color: '#b0b0a8', font: { size: 11 } }, grid: GRID, ticks: TICK, border: BORD },
    y: { min: -1, max: 1, title: { display: true, text: 'Sentiment (−1 to +1)', color: '#b0b0a8', font: { size: 11 } }, grid: GRID, ticks: { ...TICK, stepSize: 0.5 }, border: BORD },
  },
});

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 140, padding: '12px 16px', background: 'rgba(17,20,25,.7)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8 }}>
      <div style={{ color: '#8a8f99', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>{label}</div>
      <div style={{ color: color ?? 'var(--text)', fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-m, monospace)' }}>{value}</div>
      {sub && <div style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// A catalyst with an expandable verbatim transcript excerpt — the "script that
// caused the flag."
function CatalystCard({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: 'rgba(17,20,25,.7)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '11px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ color: sevColor(c.severity), fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-m, monospace)' }}>SEV {c.severity}/5</span>
        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 13 }}>{c.catalyst ?? '—'}</span>
        <span style={{ color: '#6b7280', fontSize: 11 }}>· block {c.block_id} · {c.role} · {c.speaker}</span>
      </div>
      <div style={{ color: '#a8afba', fontSize: 12.5, lineHeight: 1.5 }}>{c.summary}</div>
      {c.metrics?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
          {c.metrics.map((m, k) => (
            <span key={k} style={{ background: 'rgba(96,165,250,.12)', color: '#93c5fd', border: '1px solid rgba(96,165,250,.25)', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--font-m, monospace)' }}>{m}</span>
          ))}
        </div>
      )}
      {c.text && (
        <>
          <button onClick={() => setOpen(o => !o)} style={{ marginTop: 8, background: 'transparent', color: '#93c5fd', border: 'none', padding: 0, fontSize: 12, cursor: 'pointer' }}>
            {open ? '▾ hide transcript excerpt' : '▸ show transcript excerpt'}
          </button>
          {open && (
            <div style={{ marginTop: 6, padding: '8px 12px', background: 'rgba(0,0,0,.25)', borderLeft: '2px solid ' + sevColor(c.severity), borderRadius: 4, color: '#cbd5e1', fontSize: 12.5, lineHeight: 1.55, fontStyle: 'italic' }}>
              “{c.text}”
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Per-block sentiment trajectory (single quarter).
function Trajectory({ result }) {
  const data = useMemo(() => {
    const blocks = result?.blocks ?? [];
    if (!blocks.length) return null;
    const series = role => blocks.map(b => (b.role === role ? b.finbert_score : null));
    return {
      labels: blocks.map(b => b.block_id),
      datasets: ['Management', 'Analyst'].map(role => ({
        label: role, data: series(role), borderColor: ROLE_COLOR[role], backgroundColor: fa(ROLE_COLOR[role], 0.12),
        pointBackgroundColor: blocks.map(b => (b.role === role && b.flagged ? '#fbbf24' : ROLE_COLOR[role])),
        pointRadius: blocks.map(b => (b.role === role && b.flagged ? 7 : 3)), pointHoverRadius: 8, borderWidth: 2, spanGaps: true, tension: 0.25,
      })),
    };
  }, [result]);
  if (!data) return null;
  return (
    <div style={{ background: 'rgba(14,17,22,.6)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '14px 16px 8px', marginBottom: 16 }}>
      <div style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Sentiment trajectory — management vs analyst <span style={{ color: '#fbbf24', fontWeight: 400 }}>(amber = flagged shifts)</span></div>
      <div style={{ height: 280 }}><Line data={data} options={toneScale('Speech block')} /></div>
    </div>
  );
}

function SingleResult({ result }) {
  const s = result.summary;
  const gapColor = s.sentimentGap == null ? undefined : s.sentimentGap > 0.4 ? '#f87171' : s.sentimentGap < -0.2 ? '#4ade80' : '#fbbf24';
  const td = { padding: '7px 10px', fontSize: 12.5, borderBottom: '1px solid rgba(255,255,255,.05)' };
  const th = { ...td, color: '#8a8f99', textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '.05em', fontWeight: 600 };
  return (
    <>
      {result.source && (
        <div style={{ color: '#93c5fd', fontSize: 12.5, marginBottom: 10 }}>
          Source: <b>{result.source.provider}</b> · {result.source.symbol} {result.source.quarter}{!result.source.usingKey && <span style={{ color: '#6b7280' }}> (demo key)</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Kpi label="Management tone" value={s.mgmtAvg != null ? s.mgmtAvg.toFixed(2) : '—'} sub="avg score" color={s.mgmtAvg > 0 ? '#4ade80' : '#f87171'} />
        <Kpi label="Analyst tone" value={s.analystAvg != null ? s.analystAvg.toFixed(2) : '—'} sub="avg score" color={s.analystAvg > 0 ? '#4ade80' : '#f87171'} />
        <Kpi label="Sentiment gap" value={s.sentimentGap != null ? `${s.sentimentGap > 0 ? '+' : ''}${s.sentimentGap.toFixed(2)}` : '—'} sub={s.gapState} color={gapColor} />
        <Kpi label="Engine" value={ENGINE_LABEL[s.engine] ?? s.engine} sub={`${s.llmCovered}/${s.blockCount} blocks · ${s.flaggedCount} flagged`} color={s.engine === 'lexicon' ? '#fbbf24' : '#cbd5e1'} />
      </div>
      {s.gapImplication && <div style={{ background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.25)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#e8d8a8', fontSize: 13 }}><b>{s.gapState}.</b> {s.gapImplication}</div>}

      <Trajectory result={result} />

      {result.catalysts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Catalysts behind tone shifts ({result.catalysts.length}) — click to see the transcript excerpt</div>
          <div style={{ display: 'grid', gap: 10 }}>{result.catalysts.map((c, i) => <CatalystCard key={i} c={c} />)}</div>
        </div>
      )}

      <div style={{ background: 'rgba(14,17,22,.6)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>#</th><th style={th}>Speaker</th><th style={th}>Role</th><th style={th}>Tone</th><th style={th}>Flag</th><th style={th}>Catalyst</th></tr></thead>
          <tbody>{result.blocks.map(b => (
            <tr key={b.block_id} title={b.text}>
              <td style={td}>{b.block_id}</td>
              <td style={td}>{b.speaker}</td>
              <td style={{ ...td, color: ROLE_COLOR[b.role] }}>{b.role}</td>
              <td style={{ ...td, color: b.finbert_score > 0 ? '#4ade80' : b.finbert_score < 0 ? '#f87171' : '#94a3b8', fontFamily: 'var(--font-m, monospace)' }}>{b.finbert_score.toFixed(2)}</td>
              <td style={td}>{b.flagged ? <span style={{ color: '#fbbf24' }}>● {b.investigated ? 'LLM' : 'T1'}</span> : ''}</td>
              <td style={{ ...td, color: '#a8afba' }}>{b.catalyst ?? ''}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}

function SeriesResult({ series }) {
  const ordered = useMemo(() => [...series.cross.trend].reverse(), [series]); // oldest → newest
  const chart = {
    labels: ordered.map(q => q.label),
    datasets: [
      { label: 'Management tone', data: ordered.map(q => q.mgmtAvg), borderColor: ROLE_COLOR.Management, backgroundColor: fa(ROLE_COLOR.Management, 0.12), pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, spanGaps: true, tension: 0.25 },
      { label: 'Analyst tone (where available)', data: ordered.map(q => q.analystAvg), borderColor: ROLE_COLOR.Analyst, backgroundColor: fa(ROLE_COLOR.Analyst, 0.12), pointRadius: 5, pointHoverRadius: 7, borderWidth: 2, borderDash: [5, 4], spanGaps: true, tension: 0.25 },
    ],
  };
  return (
    <>
      <div style={{ color: '#cbd5e1', fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{series.symbol} — last four quarters</div>
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 14 }}>Newest quarter: Alpha Vantage (full Q&amp;A). Older three: SEC EDGAR press releases (management-only).</div>

      <div style={{ background: 'rgba(14,17,22,.6)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: '14px 16px 8px', marginBottom: 14 }}>
        <div style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Management tone across quarters</div>
        <div style={{ height: 240 }}><Line data={chart} options={toneScale('Quarter (oldest → newest)')} /></div>
      </div>

      {series.cross.narrative && (
        <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.25)', borderRadius: 8, padding: '12px 16px', marginBottom: 18, color: '#cfe0f5', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ color: '#93c5fd', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>Cross-quarter narrative</div>
          {series.cross.narrative}
        </div>
      )}

      {series.quarters.map((q, i) => {
        const s = q.result?.summary;
        return (
          <div key={i} style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>{q.label}</span>
              <span style={{ color: '#6b7280', fontSize: 12 }}>{q.period} · reported {q.date}</span>
              <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 4, background: q.hasQA ? 'rgba(74,222,128,.12)' : 'rgba(148,163,184,.12)', color: q.hasQA ? '#4ade80' : '#94a3b8' }}>{q.hasQA ? 'Full Q&A' : 'Mgmt-only'}</span>
              <span style={{ color: '#6b7280', fontSize: 11 }}>{q.source}</span>
            </div>
            {!q.result ? (
              <div style={{ color: '#f87171', fontSize: 12.5 }}>No analysis — {q.note || 'no data'}</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Kpi label="Mgmt tone" value={s.mgmtAvg != null ? s.mgmtAvg.toFixed(2) : '—'} color={s.mgmtAvg > 0 ? '#4ade80' : '#f87171'} />
                  {q.hasQA && <Kpi label="Analyst tone" value={s.analystAvg != null ? s.analystAvg.toFixed(2) : '—'} color={s.analystAvg > 0 ? '#4ade80' : '#f87171'} />}
                  {q.hasQA && <Kpi label="Gap" value={s.sentimentGap != null ? `${s.sentimentGap > 0 ? '+' : ''}${s.sentimentGap.toFixed(2)}` : '—'} sub={s.gapState} />}
                  <Kpi label="Catalysts" value={q.result.catalysts.length} sub={`top sev ${s.topSeverity}/5 · ${ENGINE_LABEL[s.engine] ?? s.engine}`} />
                </div>
                {q.result.catalysts.length > 0
                  ? <div style={{ display: 'grid', gap: 9 }}>{q.result.catalysts.map((c, k) => <CatalystCard key={k} c={c} />)}</div>
                  : <div style={{ color: '#6b7280', fontSize: 12.5 }}>No catalysts flagged (clean/positive quarter).</div>}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function Transcripts() {
  const [text, setText] = useState('');
  const [symbol, setSymbol] = useState('');
  const [quarter, setQuarter] = useState('');
  const [result, setResult] = useState(null);
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function call(url, body, busyMsg) {
    if (loading) return;
    setLoading(busyMsg || true); setError(null); setResult(null); setSeries(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    } catch (e) { setError(e.message); return null; }
    finally { setLoading(false); }
  }

  const analyze = async () => { if (text.trim()) setResult(await call('/api/transcript/analyze', { text, anomalyThreshold: 0.4 }, 'Analyzing…')); };
  const fetchTicker = async () => { if (symbol.trim() && quarter.trim()) setResult(await call('/api/transcript/analyze', { symbol, quarter }, `Fetching ${symbol.toUpperCase()} ${quarter.toUpperCase()}…`)); };
  const runSeries = async () => setSeries(await call('/api/transcript/series', { symbol: 'SNDK' }, 'Analyzing SNDK · 4 quarters (this takes a couple minutes)…'));

  const inp = { background: '#11141a', color: 'var(--text)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 6, padding: '8px 11px', fontSize: 13 };
  const btn = (primary) => ({ background: loading ? '#2a3038' : (primary ? 'var(--accent, #3b82f6)' : 'transparent'), color: primary ? '#fff' : '#8a8f99', border: primary ? 'none' : '1px solid rgba(255,255,255,.15)', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: loading ? 'default' : 'pointer' });

  return (
    <div style={{ padding: '4px 2px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 10, color: '#8a8f99', fontSize: 13, lineHeight: 1.5 }}>
        Fetch a real speaker-segmented transcript by ticker (Alpha Vantage, free), paste one, or run the SNDK four-quarter cross-analysis.
        The agent scores tone block-by-block, flags shifts, and names the catalyst — click any catalyst to see the exact transcript text that triggered it.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="Ticker (e.g. IBM)" spellCheck={false} style={{ ...inp, width: 130 }} />
        <input value={quarter} onChange={e => setQuarter(e.target.value.toUpperCase())} placeholder="Quarter (2026Q1)" spellCheck={false} style={{ ...inp, width: 150 }} />
        <button onClick={fetchTicker} disabled={!!loading || !symbol.trim() || !quarter.trim()} style={btn(true)}>Fetch &amp; analyze</button>
        <span style={{ color: '#6b7280' }}>·</span>
        <button onClick={runSeries} disabled={!!loading} style={btn(true)}>Analyze SNDK · 4 quarters</button>
      </div>

      <div style={{ color: '#6b7280', fontSize: 11.5, margin: '0 0 6px' }}>— or paste a transcript —</div>
      <textarea value={text} onChange={e => setText(e.target.value)} spellCheck={false}
        placeholder="Sanjay Mehrotra (CEO): We are thrilled to announce a record quarter…"
        style={{ width: '100%', minHeight: 110, ...inp, fontFamily: 'var(--font-m, monospace)', resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 18px', flexWrap: 'wrap' }}>
        <button onClick={analyze} disabled={!!loading || !text.trim()} style={btn(true)}>{loading ? (typeof loading === 'string' ? loading : 'Working…') : 'Analyze pasted transcript'}</button>
        <button onClick={() => setText(SAMPLE)} disabled={!!loading} style={btn(false)}>Load sample (Micron)</button>
        {error && <span style={{ color: '#f87171', fontSize: 12 }}>⚠ {error}</span>}
      </div>

      {series ? <SeriesResult series={series} /> : result && result.summary ? <SingleResult result={result} /> : null}
    </div>
  );
}
