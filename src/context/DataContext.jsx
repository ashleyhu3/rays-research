import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchAll } from '../services/fetchers';
import { getCached, setCached } from '../services/cache';

export const DataContext = createContext(null);

const KEY = 'live';

export function DataProvider({ children }) {
  const [liveData,    setLiveData]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error,       setError]       = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (force = false) => {
    if (!force) {
      const cached = getCached(KEY);
      if (cached) {
        setLiveData(cached.data);
        setLastUpdated(new Date(cached.ts));
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAll();
      setCached(KEY, data);
      setLiveData(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Force-refreshes both layers: tells server to bypass its TTL cache and
  // re-scrape all sources, then re-fetches the fresh results.
  const forceRefresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      const data = await fetchAll();
      setCached(KEY, data);
      setLiveData(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    timer.current = setInterval(() => load(true), 24 * 60 * 60 * 1000);
    return () => clearInterval(timer.current);
  }, [load]);

  return (
    <DataContext.Provider value={{ liveData, loading, lastUpdated, error, refresh: () => load(true), forceRefresh }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
