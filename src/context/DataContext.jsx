import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchAll } from '../services/fetchers';
import { getCached, setCached } from '../services/cache';
import { adminHeaders, clearAdminSecret } from '../utils/adminAuth';

export const DataContext = createContext(null);

const KEY = 'live';

export function DataProvider({ children }) {
  const [liveData,    setLiveData]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error,       setError]       = useState(null);
  const timer = useRef(null);

  const load = useCallback(async (force = false) => {
    // Stale-while-revalidate: paint instantly from the cached snapshot, but
    // always refetch in the background so stale data shapes self-heal instead
    // of hiding new charts until the cache TTL expires.
    const cached = force ? null : getCached(KEY);
    if (cached) {
      setLiveData(cached.data);
      setLastUpdated(new Date(cached.ts));
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchAll();
      setCached(KEY, data);
      setLiveData(data);
      setLastUpdated(new Date());
    } catch (e) {
      if (!cached) setError(e.message);
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
      // Cap the round-trip so a wedged scraper can't leave the button spinning forever
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(new Error('refresh timed out after 90s')), 90000);
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: '{}',
        signal: ac.signal,
      }).finally(() => clearTimeout(tid));
      if (!res.ok) {
        // Wrong/stale admin secret — drop it so the next attempt re-prompts.
        if (res.status === 401) {
          clearAdminSecret();
          throw new Error('Admin secret rejected — check the value and try again.');
        }
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
