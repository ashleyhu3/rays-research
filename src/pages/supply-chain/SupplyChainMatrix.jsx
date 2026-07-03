import { useMemo } from 'react';
import { MATRIX_COLUMNS, MATRIX_GROUPS, MATRIX_ROWS } from '../../config/supplyChainMatrix';

/**
 * Rich-text hierarchical matrix (heatmap + data-grid hybrid) for the Nomura
 * server supply-chain table (Fig. 70). Every supplier string is preserved;
 * cell background encodes supplier-count resilience, and the coloured left
 * gutter bar encodes the tier category.
 *
 * See src/config/supplyChainMatrix.js for the source data and cell DSL.
 */

// ── DSL parser ─────────────────────────────────────────────────────────────
function parseSupplier(raw, i) {
  let s = raw.trim();
  const exclusive = s.startsWith('!');
  if (exclusive) s = s.slice(1).trim();
  if (s === '?') return { unknown: true, name: '?' };
  // Uncertain if the *name* (not a parenthetical) ends with '?'.
  const uncertain = /\?$/.test(s) && !/\)\s*$/.test(s);
  const m = s.match(/^([^(]+?)\s*(?:\((.+)\))?\s*$/);
  const name = (m ? m[1] : s).replace(/\?$/, '').trim();
  const detail = m && m[2] ? m[2] : null;
  return { name, detail, uncertain, exclusive, primary: i === 0 };
}

function parseCell(str) {
  if (str == null || str === '') return { blank: true, entries: [], count: 0 };
  if (str === 'N.A.') return { na: true, entries: [], count: 0 };
  const entries = str.split(' · ').map((p, i) => parseSupplier(p, i)).filter(e => e.name);
  const count = entries.filter(e => !e.unknown).length;
  return { entries, count, blank: false, na: false };
}

// Supplier-count → resilience tier → cell background.
function tierOf(cell) {
  if (cell.blank) return 'blank';
  if (cell.na || cell.count <= 1) return 'critical'; // single point of failure / N.A.
  if (cell.count <= 3) return 'moderate';
  return 'resilient'; // 4+ suppliers — commoditised, resilient
}

const TIER_BG = {
  resilient: 'rgba(34,197,94,.30)',
  moderate:  'rgba(234,179,8,.28)',
  critical:  'rgba(239,68,68,.30)',
  blank:     'rgba(255,255,255,.02)',
};

// ── Cell renderer ───────────────────────────────────────────────────────────
function CellText({ cell }) {
  if (cell.blank) return <span style={{ color: 'var(--ter)', opacity: 0.5 }}>—</span>;
  if (cell.na) return <span style={{ color: '#fca5a5', fontStyle: 'italic', fontWeight: 600 }}>N.A.</span>;
  return (
    <>
      {cell.entries.map((e, i) => {
        const muted = e.uncertain || e.unknown;
        return (
          <span key={i}>
            {i > 0 && <span style={{ color: 'var(--sec)', opacity: 0.6 }}>, </span>}
            <span
              style={{
                fontWeight: e.primary && !muted ? 700 : 500,
                color: muted ? 'var(--sec)' : 'var(--text)',
                fontStyle: muted ? 'italic' : 'normal',
              }}
            >
              {e.exclusive && <span title="Exclusive / unique strategy" style={{ marginRight: 2 }}>🔒</span>}
              {e.name}{e.uncertain ? '?' : ''}
              {e.detail && (
                <span style={{ color: 'var(--sec)', fontWeight: 400, fontStyle: 'italic' }}>
                  {' '}({e.detail})
                </span>
              )}
            </span>
          </span>
        );
      })}
    </>
  );
}

const TD_BASE = {
  padding: '6px 6px',
  borderRight: '1px solid var(--border)',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  fontSize: 12,
  lineHeight: 1.4,
  wordBreak: 'break-word',
  overflowWrap: 'anywhere',
};

export default function SupplyChainMatrix() {
  const rows = useMemo(
    () => MATRIX_ROWS.map(r => ({
      ...r,
      parsedCells: r.cells
        ? Object.fromEntries(MATRIX_COLUMNS.map(c => [c.key, parseCell(r.cells[c.key])]))
        : null,
      parsedSegments: r.segments ? r.segments.map(s => ({ ...s, parsed: parseCell(s.cell) })) : null,
    })),
    []
  );

  // Row label spans: hide the group/sub label when identical to the row above
  // so the hierarchical grouping reads cleanly down the left edge.
  return (
    <div className="cbox span2">
      <div className="ch-head">
        <div className="ch-title">Server supply chain — customer × tier dependency matrix</div>
        <div className="ch-meta">
          <span className="ch-src">Nomura research (Fig. 70)</span>
        </div>
      </div>
      <div className="ch-sub">
        Every disclosed supplier is preserved. Cell shading encodes resilience by supplier count —{' '}
        <b style={{ color: '#4ade80' }}>green = 4+ (commoditised)</b>,{' '}
        <b style={{ color: '#eab308' }}>yellow = 2–3</b>,{' '}
        <b style={{ color: '#f87171' }}>red = single source / N.A.</b>. Bold = primary vendor;
        italic = conditional (?); 🔒 = unique strategy.
      </div>

      <div className="scm-wrap">
        <table className="scm-table">
          <thead>
            <tr>
              <th className="scm-th">Tier</th>
              {MATRIX_COLUMNS.map(c => (
                <th key={c.key} className="scm-th">
                  <div>{c.label}</div>
                  {c.sub && <div className="scm-th-sub">{c.sub}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const g = MATRIX_GROUPS[r.group];
              const prev = rows[ri - 1];
              const groupStart = !prev || prev.group !== r.group;
              return (
                <tr key={ri}>
                  <td
                    className="scm-td scm-rowlabel"
                    style={{ borderLeft: `4px solid ${g.color}` }}
                  >
                    {groupStart && (
                      <div className="scm-group" style={{ color: g.color }}>{g.label}</div>
                    )}
                    <div className="scm-sub">{r.sub}</div>
                  </td>

                  {r.parsedSegments
                    ? r.parsedSegments.map((seg, si) => {
                        const tier = tierOf(seg.parsed);
                        return (
                          <td
                            key={si}
                            colSpan={seg.span}
                            className="scm-td"
                            style={{ ...TD_BASE, background: TIER_BG[tier] }}
                          >
                            <CellText cell={seg.parsed} />
                          </td>
                        );
                      })
                    : MATRIX_COLUMNS.map(c => {
                        const cell = r.parsedCells[c.key];
                        const tier = tierOf(cell);
                        return (
                          <td key={c.key} className="scm-td" style={{ ...TD_BASE, background: TIER_BG[tier] }}>
                            <CellText cell={cell} />
                          </td>
                        );
                      })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="src-note">Source: Company data, Nomura research · Fig. 70 Server supply chain</div>
    </div>
  );
}

// ── Per-company view ─────────────────────────────────────────────────────────
// Which segment (of a colSpan "industry-shared" row) covers a given column index.
function segmentForColumn(segments, colIdx) {
  let acc = 0;
  for (const seg of segments) {
    if (colIdx < acc + seg.span) return seg;
    acc += seg.span;
  }
  return null;
}

// Slice the full matrix down to a single customer column: keep only rows where
// that customer has disclosed data. Industry-shared (colSpan) rows are flagged
// `shared` since they apply to every customer, not just this one.
function buildCompanyRows(column) {
  const colIdx = MATRIX_COLUMNS.findIndex(c => c.key === column);
  const out = [];
  for (const r of MATRIX_ROWS) {
    if (r.cells) {
      const cell = parseCell(r.cells[column] ?? '');
      if (cell.blank) continue;
      out.push({ group: r.group, sub: r.sub, cell, shared: false });
    } else if (r.segments) {
      const seg = segmentForColumn(r.segments, colIdx);
      if (!seg) continue;
      const cell = parseCell(seg.cell);
      if (cell.blank) continue;
      out.push({ group: r.group, sub: r.sub, cell, shared: true });
    }
  }
  return out;
}

/**
 * Company-scoped supply-chain table — the same Fig. 70 matrix filtered to a
 * single customer column (e.g. 'amazon' for AWS). Rendered on the per-company
 * AI supply-chain pages. Companies with no column in the matrix (they buy
 * capacity/GPUs rather than design silicon) get an explanatory note instead.
 */
export function CompanySupplyTable({ column, label }) {
  const rows = useMemo(() => (column ? buildCompanyRows(column) : []), [column]);

  // Group tiers by supply-chain section so each section is one table row.
  const sections = useMemo(() => {
    const out = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.group === r.group) last.tiers.push(r);
      else out.push({ group: r.group, tiers: [r] });
    }
    return out;
  }, [rows]);

  if (!column || rows.length === 0) {
    return (
      <div className="cbox span2">
        <div className="ch-head">
          <div className="ch-title">{label} — server supply chain</div>
          <div className="ch-meta"><span className="ch-src">Nomura research (Fig. 70)</span></div>
        </div>
        <div className="ch-sub">
          {label} procures compute capacity through GPU vendors and hyperscale partners
          rather than operating a disclosed in-house server supply chain in the Nomura
          matrix. See the hyperscaler pages (Amazon AWS, Google, Microsoft, Meta) for
          component-level sourcing.
        </div>
      </div>
    );
  }

  return (
    <div className="cbox span2">
      <div className="ch-head">
        <div className="ch-title">{label} — server supply chain</div>
        <div className="ch-meta"><span className="ch-src">Nomura research (Fig. 70)</span></div>
      </div>
      <div className="ch-sub">
        {label}'s disclosed suppliers, sliced from the full matrix. Bold = primary vendor;
        italic = conditional (?); 🔒 = unique strategy;{' '}
        <i style={{ color: 'var(--sec)' }}>shared</i> = industry-wide (not {label}-specific).
      </div>

      <div className="scm-wrap scm-wrap--h">
        <table className="scm-table scm-table--h">
          <thead>
            <tr>
              {rows.map((r, ri) => {
                const g = MATRIX_GROUPS[r.group];
                const prev = rows[ri - 1];
                const groupStart = !prev || prev.group !== r.group;
                return (
                  <th key={ri} className="scm-th">
                    {groupStart && <div className="scm-group" style={{ color: g.color }}>{g.label}</div>}
                    <div className="scm-sub">
                      {r.sub}
                      {r.shared && (
                        <span style={{ color: 'var(--sec)', fontStyle: 'italic', fontWeight: 400 }}> · shared</span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              {rows.map((r, ri) => (
                <td key={ri} className="scm-td" style={TD_BASE}>
                  <CellText cell={r.cell} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="src-note">Source: Company data, Nomura research · Fig. 70 Server supply chain</div>
    </div>
  );
}
