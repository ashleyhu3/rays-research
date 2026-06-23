import { useEffect, useState, useMemo, useCallback } from 'react';

/* Data Validity Terminal — an independent operational view of the data feeds,
   decoupled from the RAG. It hits /api/validity/status (registry + live
   telemetry, served from memory) and polls; if the LLM is down this page stays
   live, proving the underlying feeds are intact. */

const STATUS_COLOR = {
  OPERATIONAL:    { fg: '#4ade80', bg: 'rgba(74,222,128,.12)' },
  STALE:          { fg: '#fbbf24', bg: 'rgba(251,191,36,.12)' },
  'RATE-LIMITED': { fg: '#f0883e', bg: 'rgba(240,136,62,.12)' },
  DOWN:           { fg: '#f87171', bg: 'rgba(248,113,113,.12)' },
  UNKNOWN:        { fg: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
};

function fmtAge(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m}m ${s}s ago`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return `${h}h ${mm}m ago`;
  const d = Math.floor(h / 24), hh = h % 24;
  return `${d}d ${hh}h ago`;
}

function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function StatusPill({ status }) {
  const c = STATUS_COLOR[status] ?? STATUS_COLOR.UNKNOWN;
  return (
    <span style={{ color: c.fg, background: c.bg, padding: '2px 9px', borderRadius: 4, fontSize: 11, fontWeight: 600, letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
      ● {status}
    </span>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 180, padding: '14px 18px', background: 'rgba(17,20,25,.7)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 8 }}>
      <div style={{ color: '#8a8f99', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ color: color ?? 'var(--text)', fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-m, monospace)' }}>{value}</div>
      {sub && <div style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function AuditInspector({ s, onClose }) {
  const row = (label, val) => (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
      <div style={{ color: '#8a8f99', fontSize: 12, width: 150, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.5 }}>{val}</div>
    </div>
  );
  return (
    <div style={{ background: 'rgba(17,20,25,.85)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, padding: '16px 20px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <span style={{ fontFamily: 'var(--font-m, monospace)', color: 'var(--accent)', fontSize: 15 }}>{s.id}</span>
          <span style={{ color: '#8a8f99', marginLeft: 10, fontSize: 13 }}>{s.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#6b7280', fontSize: 11 }}>live updates paused while inspecting</span>
          <button onClick={onClose} style={{ background: 'transparent', color: '#8a8f99', border: '1px solid rgba(255,255,255,.15)', borderRadius: 5, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>✕ Close</button>
        </div>
      </div>
      {row('Status', <StatusPill status={s.status} />)}
      {row('Upstream provider', s.provider)}
      {row('Reliability grade', <span><b style={{ color: '#4ade80' }}>{s.reliabilityGrade}</b> — {s.reliabilityNote}</span>)}
      {row('Source data lag', <span><b>{s.upstreamLagText}</b> — {s.upstreamLagNote}</span>)}
      {row('Source cadence', s.sourceCadence)}
      {row('Our poll cadence', `${fmtDur(s.ourCadenceMs)} (stale alert if no pull in ${fmtDur(s.criticalLagThresholdMs)})`)}
      {row('Last successful pull', fmtAge(s.pullAgeSeconds))}
      {row('RAG scope / mapping', s.ragScope)}
      {row('Fallback behavior', s.fallback)}
      {row('Endpoint', <a href={s.endpointUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{s.endpointUrl}</a>)}
      {row('Payload', s.payloadKB)}
      {row('Runs (this process)', `${s.successCount} ok · ${s.failCount} failed`)}
      {s.error && row('Last error', <span style={{ color: '#f87171', fontFamily: 'var(--font-m, monospace)', fontSize: 12 }}>{s.error}</span>)}
    </div>
  );
}

export default function DataValidity() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/validity/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Poll every 15s, but freeze the live cycle while a row is being inspected.
  useEffect(() => {
    load();
    if (selected) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, selected]);

  const sources = state?.sources ?? [];
  const sel = selected ? sources.find(s => s.id === selected) : null;

  const shown = useMemo(() => {
    let list = sources;
    if (filter === 'warnings') list = list.filter(s => s.status === 'STALE' || s.status === 'RATE-LIMITED');
    else if (filter === 'degraded') list = list.filter(s => s.status === 'DOWN');
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(s => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.provider.toLowerCase().includes(q));
    // Worst status first, then oldest pull.
    const rank = { DOWN: 0, 'RATE-LIMITED': 1, STALE: 2, UNKNOWN: 3, OPERATIONAL: 4 };
    return [...list].sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.pullAgeSeconds ?? 0) - (a.pullAgeSeconds ?? 0)));
  }, [sources, filter, query]);

  const sum = state?.summary;
  const th = { textAlign: 'left', padding: '8px 12px', color: '#8a8f99', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid rgba(255,255,255,.1)', fontWeight: 600, position: 'sticky', top: 0, background: '#0e1116' };
  const td = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid rgba(255,255,255,.04)' };
  const tab = (id, label) => (
    <button onClick={() => setFilter(id)} style={{ background: filter === id ? 'rgba(255,255,255,.08)' : 'transparent', color: filter === id ? 'var(--text)' : '#8a8f99', border: '1px solid rgba(255,255,255,.12)', borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>{label}</button>
  );

  return (
    <div style={{ padding: '4px 2px 40px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Component A — System-wide SLA summary */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Kpi label="Pipeline Health Index"
          value={sum?.pipelineHealthPct != null ? `${sum.pipelineHealthPct}%` : '—'}
          sub={sum ? `${sum.operational}/${sum.totalSources} sources operational` : ''}
          color={sum?.pipelineHealthPct >= 95 ? '#4ade80' : sum?.pipelineHealthPct >= 80 ? '#fbbf24' : '#f87171'} />
        <Kpi label="Avg Data Age (vol-weighted)"
          value={fmtAge(sum?.avgDataAgeSeconds)}
          sub="across all cached sources" />
        <Kpi label="SLA Violations"
          value={sum?.slaViolations ?? '—'}
          sub="sources off OPERATIONAL"
          color={sum?.slaViolations > 0 ? '#f87171' : '#4ade80'} />
      </div>

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {tab('all', 'All Sources')}
        {tab('warnings', 'Active Warnings')}
        {tab('degraded', 'Degraded Only')}
        <div style={{ flex: 1 }} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search source…" spellCheck={false}
          style={{ background: '#1a1f2a', color: 'var(--text)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 6, padding: '6px 11px', fontSize: 13, minWidth: 200 }} />
        <span style={{ color: '#6b7280', fontSize: 11 }}>{error ? `⚠ ${error}` : selected ? 'paused' : 'live · 15s'}</span>
      </div>

      {/* Component B — Data integrity grid */}
      <div style={{ background: 'rgba(14,17,22,.6)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto', maxHeight: 560 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-m, monospace)' }}>
            <thead>
              <tr>
                <th style={th}>Source Identifier</th>
                <th style={th}>Health</th>
                <th style={th}>Data Lag (source)</th>
                <th style={th}>Source Cadence</th>
                <th style={th}>Last Pull</th>
                <th style={th}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.id} onClick={() => setSelected(s.id)}
                  style={{ cursor: 'pointer', background: selected === s.id ? 'rgba(255,255,255,.06)' : 'transparent' }}
                  onMouseEnter={e => { if (selected !== s.id) e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
                  onMouseLeave={e => { if (selected !== s.id) e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ ...td, color: 'var(--accent)' }}>{s.id}
                    <span style={{ color: '#6b7280', marginLeft: 8, fontFamily: 'var(--font, sans-serif)' }}>{s.name}</span>
                  </td>
                  <td style={td}><StatusPill status={s.status} /></td>
                  <td style={{ ...td, color: '#cbd5e1' }}>{s.upstreamLagText}</td>
                  <td style={{ ...td, color: '#8a8f99' }}>{s.sourceCadence}</td>
                  <td style={{ ...td, color: s.pullAgeSeconds > s.criticalLagThresholdMs / 1000 ? '#fbbf24' : '#cbd5e1' }}>{fmtAge(s.pullAgeSeconds)}</td>
                  <td style={{ ...td, color: s.payloadBytes ? '#cbd5e1' : '#f87171' }}>{s.payloadKB}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={6} style={{ ...td, color: '#6b7280', textAlign: 'center', padding: 30 }}>
                  {state ? 'No sources match this filter.' : 'Loading telemetry…'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Component C — Source blueprint & audit inspector */}
      {sel && <AuditInspector s={sel} onClose={() => setSelected(null)} />}

      <p style={{ color: '#6b7280', fontSize: 11, marginTop: 14, lineHeight: 1.6 }}>
        <b>Data Lag (source)</b> is the inherent latency of each feed — how far behind reality the value is due to how the provider collects it — not how often we poll.
        This terminal reads only in-memory telemetry, so it stays live even if the Ask (RAG) service is down.
      </p>
    </div>
  );
}
