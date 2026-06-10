import { createContext, useContext, useCallback, useState } from 'react';

const STORAGE_KEY = 'chart-layouts-v1';

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
  initLayout:  () => {},
  moveChart:   () => {},
  setSpan:     () => {},
  setCol:      () => {},
  resetLayout: () => {},
});

export const useLayout = () => useContext(LayoutContext);

export function LayoutProvider({ children }) {
  const [layouts, setLayouts] = useState(loadLayouts);

  const getLayout = useCallback((viewId) => layouts[viewId] ?? null, [layouts]);

  const initLayout = useCallback((viewId, defaults) => {
    setLayouts(prev => {
      if (prev[viewId]) return prev;
      const next = { ...prev, [viewId]: defaults };
      persist(next);
      return next;
    });
  }, []);

  const update = useCallback((viewId, fn) => {
    setLayouts(prev => {
      const next = { ...prev, [viewId]: fn(prev[viewId]) };
      persist(next);
      return next;
    });
  }, []);

  const moveChart = useCallback((viewId, fromIdx, dir) => {
    update(viewId, cur => {
      if (!cur) return cur;
      const arr  = [...cur];
      const toIdx = fromIdx + dir;
      if (toIdx < 0 || toIdx >= arr.length) return arr;
      [arr[fromIdx], arr[toIdx]] = [arr[toIdx], arr[fromIdx]];
      return arr;
    });
  }, [update]);

  const setSpan = useCallback((viewId, chartId, span) => {
    update(viewId, cur =>
      cur?.map(item => item.chartId === chartId ? { ...item, span, col: 'auto' } : item) ?? cur
    );
  }, [update]);

  const setCol = useCallback((viewId, chartId, col) => {
    update(viewId, cur =>
      cur?.map(item => item.chartId === chartId ? { ...item, col } : item) ?? cur
    );
  }, [update]);

  const resetLayout = useCallback((viewId) => {
    setLayouts(prev => {
      const next = { ...prev };
      delete next[viewId];
      persist(next);
      return next;
    });
  }, []);

  return (
    <LayoutContext.Provider value={{ getLayout, initLayout, moveChart, setSpan, setCol, resetLayout }}>
      {children}
    </LayoutContext.Provider>
  );
}
