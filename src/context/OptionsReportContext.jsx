import { createContext, useContext, useState, useCallback } from 'react';

// Shared state for the daily options report so the page body and the Topbar
// controls (Refresh / Download / the report date beside the title) stay in
// sync even though they render in different parts of the layout tree.
const OptionsReportContext = createContext(null);

export function OptionsReportProvider({ children }) {
  const [report, setReport]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [msg, setMsg]         = useState(null);   // { kind: 'ok'|'err', text }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts/daily-options-report');
      const json = await res.json();
      if (res.ok) setReport(json.report || null);
    } catch { setReport(null); }
    finally { setLoading(false); }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/alerts/daily-options-report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReport(json.report || null);
      setMsg({ kind: 'ok', text: `Updated the report for ${json.meta?.date || 'today'}.` });
    } catch (err) {
      setMsg({ kind: 'err', text: `Update failed: ${err.message}` });
    } finally { setBusy(false); }
  }, []);

  const download = useCallback(() => window.print(), []);

  return (
    <OptionsReportContext.Provider value={{ report, loading, busy, msg, load, refresh, download }}>
      {children}
    </OptionsReportContext.Provider>
  );
}

export function useOptionsReport() {
  const ctx = useContext(OptionsReportContext);
  if (!ctx) throw new Error('useOptionsReport must be used within OptionsReportProvider');
  return ctx;
}
