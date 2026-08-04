import { useEffect, useMemo, useRef, useState } from 'react';
import { useResource } from '../../services/resourceCache';

const TABS = [
  { key: 'us', label: 'US Close' },
  { key: 'asia', label: 'Asia Close' },
];

const SLOT_LABEL = { 'us-close': 'US Close', 'asia-close': 'Asia Close' };

function formatEntryDate(entry) {
  return entry.date;
}

// Reports are full self-contained HTML documents (their own <style> sets body/table/a),
// so they're embedded in an iframe rather than dangerouslySetInnerHTML — injecting the
// markup directly would let the report's CSS leak into the rest of the dashboard. The
// iframe also scopes window.print() to just the report when there's no stored PDF yet.
export default function Reports() {
  const { data: index } = useResource('/api/reports/index', { revalidate: true });
  const [kind, setKind] = useState('us');
  const [selected, setSelected] = useState(null); // { date, slot }
  const iframeRef = useRef(null);

  const entries = index?.[kind] ?? [];
  const active = useMemo(() => {
    if (!entries.length) return null;
    if (selected) {
      const match = entries.find(e => e.date === selected.date && e.slot === selected.slot);
      if (match) return match;
    }
    return entries[0];
  }, [entries, selected]);

  // Switching tabs (or the index loading in) should default back to that kind's latest
  // report rather than carrying over a selection from the other kind.
  useEffect(() => { setSelected(null); }, [kind]);

  const { data: pdfMeta } = useResource(
    active ? `/api/reports/${kind}/${active.date}/pdf-meta` : null,
  );

  const handleDownload = () => {
    if (pdfMeta?.available) return; // anchor handles this case directly
    const win = iframeRef.current?.contentWindow;
    win?.focus();
    win?.print();
  };

  return (
    <div className="pr-layout">
      <nav className="pr-nav" aria-label="Report history">
        <div className="pr-nav-group">
          <div className="pr-nav-group-label">Report</div>
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              className={`or-nav-item${kind === t.key ? ' active' : ''}`}
              onClick={() => setKind(t.key)}
            >
              <span className="or-nav-name">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="pr-nav-group">
          <div className="pr-nav-group-label">History</div>
          {!entries.length && <div className="or-status">No reports yet</div>}
          {entries.map(e => {
            const isActive = active && e.date === active.date && e.slot === active.slot;
            return (
              <button
                key={`${e.date}-${e.slot}`}
                type="button"
                className={`or-nav-item${isActive ? ' active' : ''}`}
                onClick={() => setSelected({ date: e.date, slot: e.slot })}
              >
                <span className="or-nav-name">
                  {formatEntryDate(e)}
                  {!e.isFresh && <span className="report-stale-dot" title={`Reused from ${e.reusedFrom}`}> ●</span>}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <section className="pr-page">
        <header className="pr-head">
          <h3>{active ? active.title : `${TABS.find(t => t.key === kind)?.label} report`}</h3>
          {active && <span className="cal-status">{SLOT_LABEL[active.slot]} · {active.date}</span>}
          {active && !active.isFresh && (
            <span className="report-stale-chip">价格沿用 {active.reusedFrom}</span>
          )}
          {active && (
            pdfMeta?.available ? (
              <a
                className="rbtn"
                href={`/api/reports/${kind}/${active.date}/pdf`}
                download
              >
                Download PDF
              </a>
            ) : (
              <button type="button" className="rbtn" onClick={handleDownload} disabled={!active}>
                Download PDF
              </button>
            )
          )}
        </header>

        {!active && <div className="or-status">No reports published yet for this kind.</div>}
        {active && (
          <iframe
            ref={iframeRef}
            key={`${kind}-${active.date}-${active.slot}`}
            className="report-frame"
            src={`/api/reports/${kind}/${active.date}/html`}
            title={active.title}
          />
        )}
      </section>
    </div>
  );
}
