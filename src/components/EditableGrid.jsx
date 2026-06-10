import React, { useEffect, useMemo } from 'react';
import { useLayout } from '../context/LayoutContext';
import { useUI } from '../context/UIContext';

function MoveUpIcon()   { return <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 1 L9 7 H1 Z"/></svg>; }
function MoveDownIcon() { return <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 9 L1 3 H9 Z"/></svg>; }

export default function EditableGrid({ viewId, children }) {
  const { getLayout, initLayout, moveChart, setSpan, setCol } = useLayout();
  const { editMode } = useUI();

  const cards = useMemo(() =>
    React.Children.toArray(children).filter(c => c?.props?.chartId),
  [children]);

  // Build defaults from JSX props (span2 prop → 'full', absence → 'half')
  const defaults = useMemo(() =>
    cards.map(c => ({
      chartId: c.props.chartId,
      span: c.props.span2 ? 'full' : 'half',
      col: 'auto',
    })),
  [cards]);

  useEffect(() => {
    if (defaults.length > 0) initLayout(viewId, defaults);
  }, [viewId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stored = getLayout(viewId);
  const layout = stored ?? defaults;

  const cardMap = useMemo(() =>
    Object.fromEntries(cards.map(c => [c.props.chartId, c])),
  [cards]);

  return (
    <div className={`cgrid${editMode ? ' cgrid--editing' : ''}`}>
      {layout.map((item, idx) => {
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
            <div key={item.chartId} className="egrid-item" style={style}>
              {cloned}
            </div>
          );
        }

        return (
          <div key={item.chartId} className="egrid-item egrid-item--on" style={style}>
            <div className="lctrl">
              <div className="lctrl-group">
                <button
                  className="lc-btn"
                  title="Move up"
                  disabled={idx === 0}
                  onClick={() => moveChart(viewId, idx, -1)}
                >
                  <MoveUpIcon />
                </button>
                <button
                  className="lc-btn"
                  title="Move down"
                  disabled={idx === layout.length - 1}
                  onClick={() => moveChart(viewId, idx, 1)}
                >
                  <MoveDownIcon />
                </button>
              </div>

              <div className="lctrl-sep" />

              <div className="lctrl-group">
                <button
                  className={`lc-btn lc-text${isFull ? ' lc-active' : ''}`}
                  title="Full width"
                  onClick={() => setSpan(viewId, item.chartId, 'full')}
                >Full</button>
                <button
                  className={`lc-btn lc-text${!isFull ? ' lc-active' : ''}`}
                  title="Half width"
                  onClick={() => setSpan(viewId, item.chartId, 'half')}
                >Half</button>
              </div>

              {!isFull && (
                <>
                  <div className="lctrl-sep" />
                  <div className="lctrl-group">
                    <button
                      className={`lc-btn lc-text${col !== 'right' ? ' lc-active' : ''}`}
                      title="Left column"
                      onClick={() => setCol(viewId, item.chartId, 'left')}
                    >L</button>
                    <button
                      className={`lc-btn lc-text${col === 'right' ? ' lc-active' : ''}`}
                      title="Right column"
                      onClick={() => setCol(viewId, item.chartId, 'right')}
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
