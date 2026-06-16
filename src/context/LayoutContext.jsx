import { createContext, useContext, useCallback, useState } from 'react';

// v2: v1 eagerly persisted every visited view's default order. Bumping the key
// dropped those stale auto-seeded layouts; only explicit user arrangements are
// stored now, so unedited pages always follow the fixed default order in code.
const STORAGE_KEY = 'chart-layouts-v2';

function loadLayouts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function persist(layouts) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts)); } catch {}
}

const LayoutContext = createContext({
  getLayout:   () => null,
  moveChart:   () => {},
  setSpan:     () => {},
  setCol:      () => {},
  resetLayout: () => {},
});

export const useLayout = () => useContext(LayoutContext);

// A view only gets a stored layout once the user explicitly rearranges it.
// Until then EditableGrid follows its fixed default order (pinTop cards first,
// then the order written in the view file). The mutators take the current
// effective layout as their base so the first edit seeds storage from whatever
// order is on screen.
export function LayoutProvider({ children }) {
  const [layouts, setLayouts] = useState(loadLayouts);

  const getLayout = useCallback((viewId) => layouts[viewId] ?? null, [layouts]);

  const commit = useCallback((viewId, layout) => {
    setLayouts(prev => {
      const next = { ...prev, [viewId]: layout };
      persist(next);
      return next;
    });
  }, []);

  const moveChart = useCallback((viewId, layout, fromIdx, dir) => {
    const arr = [...layout];
    const toIdx = fromIdx + dir;
    if (toIdx < 0 || toIdx >= arr.length) return;
    [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]];
    commit(viewId, arr);
  }, [commit]);

  const setSpan = useCallback((viewId, layout, chartId, span) => {
    commit(viewId, layout.map(item =>
      item.chartId === chartId ? { ...item, span, col: 'auto' } : item));
  }, [commit]);

  const setCol = useCallback((viewId, layout, chartId, col) => {
    commit(viewId, layout.map(item =>
      item.chartId === chartId ? { ...item, col } : item));
  }, [commit]);

  const resetLayout = useCallback((viewId) => {
    setLayouts(prev => {
      const next = { ...prev };
      delete next[viewId];
      persist(next);
      return next;
    });
  }, []);

  return (
    <LayoutContext.Provider value={{ getLayout, moveChart, setSpan, setCol, resetLayout }}>
      {children}
    </LayoutContext.Provider>
  );
}
