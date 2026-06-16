import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { useLayout } from '../context/LayoutContext';
import { useUI } from '../context/UIContext';
import { useDashboard } from '../context/DashboardContext';

function MoveUpIcon()   { return <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1 L9 7 H1 Z"/></svg>; }
function MoveDownIcon() { return <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 9 L1 3 H9 Z"/></svg>; }

// ── "Biggest recent mover first" ordering ──────────────────────────────────
// Charts are ranked by how much their data has moved lately so the clearest
// trends rise to the top; snapshot/categorical charts (current rates, rankings
// by entity, distributions) have no time axis and sink to the bottom.
const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;
function timeish(s) {
  return typeof s === 'string' && (
    MONTH.test(s) ||
    /\b(19|20)\d{2}\b/.test(s) ||   // 2024, 2026e
    /\bQ[1-4]\b/i.test(s) ||        // Q1 25
    /^\d{4}-\d{2}/.test(s) ||       // 2024-06
    /\b\d{1,2}\/\d{1,2}\b/.test(s)  // 6/15
  );
}
// A bar chart counts as a trend only when its x-axis labels read like a time
// axis; line charts in this app are always time-series.
function looksTemporal(labels) {
  if (!Array.isArray(labels) || labels.length < 3) return false;
  let hits = 0;
  for (const l of labels) if (timeish(l)) hits++;
  return hits >= Math.ceil(labels.length * 0.6);
}
// Largest absolute % change over the last ~quarter of points, across datasets.
// Returns -1 for non-trend (snapshot) charts so they sort beneath every trend.
function moveScore(card) {
  const inner = React.Children.toArray(card.props.children)[0];
  const data  = inner?.props?.data;
  if (!data || !Array.isArray(data.datasets)) return -1;
  if (inner.type !== Line && !looksTemporal(data.labels)) return -1;

  let best = -1;
  for (const d of data.datasets) {
    const arr = (d.data ?? []).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (arr.length < 2) continue;
    const look = Math.min(arr.length - 1, Math.max(1, Math.ceil(arr.length * 0.25)));
    const last = arr[arr.length - 1];
    const prev = arr[arr.length - 1 - look];
    if (!Number.isFinite(prev) || prev === 0) { best = Math.max(best, 0); continue; }
    best = Math.max(best, Math.abs((last - prev) / prev));
  }
  return best;
}

export default function EditableGrid({ viewId, children }) {
  const { getLayout, moveChart, setSpan, setCol } = useLayout();
  const { editMode } = useUI();
  const { sectorOverviewMode, activeSector, isPinned, pageCharts } = useDashboard();

  const cards = useMemo(() =>
    React.Children.toArray(children).filter(c => c?.props?.chartId),
  [children]);

  const cardMap = useMemo(() =>
    Object.fromEntries(cards.map(c => [c.props.chartId, c])),
  [cards]);

  // Dynamic default order: cards flagged `pinTop` come first (kept in their JSX
  // order), then the rest by biggest recent mover. Ties keep their original JSX
  // position. Recomputed as live data updates, so the order tracks whatever is
  // trending — until the user pins an explicit arrangement (below), which then
  // wins. All charts default to half-width; users can widen any chart to full
  // via the layout controls.
  const dynamicDefault = useMemo(() => {
    const scored = cards.map((c, i) => ({
      item: { chartId: c.props.chartId, span: 'half', col: 'auto' },
      pin:  c.props.pinTop ? 1 : 0,
      score: moveScore(c),
      i,
    }));
    scored.sort((a, b) => {
      if (a.pin !== b.pin) return b.pin - a.pin;       // pinned cards first
      if (a.pin)           return a.i - b.i;            // …kept in JSX order
      return b.score - a.score || a.i - b.i;           // rest: biggest mover first
    });
    return scored.map(s => s.item);
  }, [cards]);

  const stored = getLayout(viewId);

  // Stored (user-arranged) layout wins; otherwise follow the dynamic order.
  // Any chart missing from a stored layout (e.g. added in a later release) is
  // appended so it still renders.
  const layout = useMemo(() => {
    if (!stored) return dynamicDefault;
    const known = new Set(stored.map(it => it.chartId));
    const extra = dynamicDefault.filter(d => !known.has(d.chartId));
    return extra.length ? [...stored, ...extra] : stored;
  }, [stored, dynamicDefault]);

  // On the sector-overview pages only pinned charts render. Drop the unpinned
  // ones here (rather than letting each ChartCard render null) so they don't
  // leave empty grid cells — and skip the grid entirely when nothing is pinned,
  // so a view with no selected charts adds no blank space. The per-page
  // Edit-Layout flow still operates on the full layout.
  const renderLayout = pageCharts
    ? layout.filter(item => pageCharts.has(item.chartId))
    : (sectorOverviewMode && !editMode)
      ? layout.filter(item => isPinned(item.chartId, activeSector))
      : layout;

  if (renderLayout.length === 0) return null;

  return (
    <div className={`cgrid${editMode ? ' cgrid--editing' : ''}`}>
      {renderLayout.map((item, idx) => {
        const card = cardMap[item.chartId];
        if (!card) return null;

        const isFull = item.span === 'full';
        const col    = item.col ?? 'auto';

        const style = {};
        if (isFull)         style.gridColumn = '1 / -1';
        else if (col === 'right') style.gridColumn = '2';
        else if (col === 'left')  style.gridColumn = '1';

        // Strip span2 from the card — egrid-item's style handles grid placement
        const cloned = React.cloneElement(card, { span2: false });

        if (!editMode) {
          return (
            <div key={item.chartId} className="egrid-item" style={style} data-chart-id={item.chartId}>
              {cloned}
            </div>
          );
        }

        return (
          <div key={item.chartId} className="egrid-item egrid-item--on" style={style} data-chart-id={item.chartId}>
            <div className="lctrl">
              <div className="lctrl-group">
                <button
                  className="lc-btn"
                  title="Move up"
                  disabled={idx === 0}
                  onClick={() => moveChart(viewId, layout, idx, -1)}
                >
                  <MoveUpIcon />
                </button>
                <button
                  className="lc-btn"
                  title="Move down"
                  disabled={idx === layout.length - 1}
                  onClick={() => moveChart(viewId, layout, idx, 1)}
                >
                  <MoveDownIcon />
                </button>
              </div>

              <div className="lctrl-sep" />

              <div className="lctrl-group">
                <button
                  className={`lc-btn lc-text${isFull ? ' lc-active' : ''}`}
                  title="Full width"
                  onClick={() => setSpan(viewId, layout, item.chartId, 'full')}
                >Full</button>
                <button
                  className={`lc-btn lc-text${!isFull ? ' lc-active' : ''}`}
                  title="Half width"
                  onClick={() => setSpan(viewId, layout, item.chartId, 'half')}
                >Half</button>
              </div>

              {!isFull && (
                <>
                  <div className="lctrl-sep" />
                  <div className="lctrl-group">
                    <button
                      className={`lc-btn lc-text${col !== 'right' ? ' lc-active' : ''}`}
                      title="Left column"
                      onClick={() => setCol(viewId, layout, item.chartId, 'left')}
                    >L</button>
                    <button
                      className={`lc-btn lc-text${col === 'right' ? ' lc-active' : ''}`}
                      title="Right column"
                      onClick={() => setCol(viewId, layout, item.chartId, 'right')}
                    >R</button>
                  </div>
                </>
              )}
            </div>
            {cloned}
          </div>
        );
      })}
    </div>
  );
}
