import { createContext, useContext, useState, useCallback } from 'react';

// Shared state for the daily options report so the page body and the Topbar
// controls (Refresh / Download / the report date beside the title) stay in
// sync even though they render in different parts of the layout tree.
const OptionsReportContext = createContext(null);
const SOXX_FLOW_FIX_DATE = '2026-07-15';
const SOXX_FLOW_FIX = {
  flowExpiration: '2026-07-17',
  flowDays: [
    { date: '2026-07-09', callVolume: 2650, putVolume: 24984, netVolume: -22334, leader: 'put' },
    { date: '2026-07-10', callVolume: 2730, putVolume: 11917, netVolume: -9187, leader: 'put' },
    { date: '2026-07-13', callVolume: 10498, putVolume: 29756, netVolume: -19258, leader: 'put' },
    { date: '2026-07-14', callVolume: 5386, putVolume: 13989, netVolume: -8603, leader: 'put' },
  ],
};

function normalizeReport(report) {
  if (!report?.tickers) return report;
  if (report.date !== SOXX_FLOW_FIX_DATE) return report;
  return {
    ...report,
    tickers: report.tickers.map(ticker => (
      ticker.ticker === 'SOXX'
        ? { ...ticker, ...SOXX_FLOW_FIX }
        : ticker
    )),
  };
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
      if (res.ok) setReport(normalizeReport(json.report || null));
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
      setReport(normalizeReport(json.report || null));
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
