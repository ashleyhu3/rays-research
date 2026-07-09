import React, { useMemo } from 'react';
import { useLayout } from '../../context/LayoutContext';
import { useUI } from '../../context/UIContext';
import { useDashboard } from '../../context/DashboardContext';

function MoveUpIcon()   { return <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1 L9 7 H1 Z"/></svg>; }
function MoveDownIcon() { return <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 9 L1 3 H9 Z"/></svg>; }

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

  // Fixed default order: cards flagged `pinTop` come first, then everything in
  // the order it's written in the view file. Deterministic — it does not depend
  // on the live data, so the layout is identical across environments — until the
  // user pins an explicit arrangement (below), which then wins. All charts
  // default to half-width; callers can optionally set a default column.
  const defaultLayout = useMemo(() => {
    const ordered = cards.map((c, i) => ({
      item: {
        chartId: c.props.chartId,
        span: c.props.defaultFull ? 'full' : 'half',
        col: c.props.defaultCol ?? 'auto',
      },
      pin:  c.props.pinTop ? 1 : 0,
      i,
    }));
    ordered.sort((a, b) => (b.pin - a.pin) || (a.i - b.i)); // pinTop first, else JSX order
    return ordered.map(s => s.item);
  }, [cards]);

  const stored = getLayout(viewId);

  // Stored (user-arranged) layout wins; otherwise follow the fixed default.
  // Any chart missing from a stored layout (e.g. added in a later release) is
  // appended so it still renders.
  const layout = useMemo(() => {
    if (!stored) return defaultLayout;
    const known = new Set(stored.map(it => it.chartId));
    const extra = defaultLayout.filter(d => !known.has(d.chartId));
    return extra.length ? [...stored, ...extra] : stored;
  }, [stored, defaultLayout]);

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
