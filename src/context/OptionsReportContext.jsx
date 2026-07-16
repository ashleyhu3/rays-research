import { createContext, useContext, useState, useCallback } from 'react';
import soxxStatic from '../pages/alerts/soxxStatic.json';

// Shared state for the daily options report so the page body and the Topbar
// controls (Refresh / Download / the report date beside the title) stay in
// sync even though they render in different parts of the layout tree.
const OptionsReportContext = createContext(null);

// SOXX was just added to the tracked ticker list, but the stored report
// predates that change and won't get a real SOXX pull until the next
// generate run. Splice in one static pull client-side (not persisted to
// Mongo/file storage) so it shows on the page in the meantime — drop this
// once a live-generated report includes SOXX on its own.
function withStaticSoxx(report) {
  if (!report?.tickers) return report;
  const tickers = report.tickers.map(ticker => {
    if (ticker.ticker !== 'SOXX' || ticker.flowDays?.length) return ticker;
    return {
      ...ticker,
      flowExpiration: soxxStatic.flowExpiration,
      flowDays: soxxStatic.flowDays,
    };
  });
  if (tickers.some(t => t.ticker === 'SOXX')) return { ...report, tickers };
  return { ...report, tickers: [...tickers, soxxStatic] };
}

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
      if (res.ok) setReport(withStaticSoxx(json.report || null));
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
      setReport(withStaticSoxx(json.report || null));
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
