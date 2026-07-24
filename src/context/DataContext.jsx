import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchAllProgressive } from '../services/fetchers';
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
  // Latest snapshot, so a background/force refresh can seed off it and refine
  // in place rather than blanking charts while fresh data streams in.
  const liveRef = useRef(null);
  const pendingRef = useRef(null);
  const rafRef = useRef(0);
  // Coalesce the ~29 streamed source updates: keep the newest snapshot and
  // flush at most once per animation frame so a burst of arrivals is one render.
  const applyLive = useCallback((data) => {
    liveRef.current = data;
    pendingRef.current = data;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setLiveData(pendingRef.current);
    });
  }, []);

  const load = useCallback(async (force = false) => {
    // Stale-while-revalidate: paint instantly from the cached snapshot, but
    // always refetch in the background. Each source streams into liveData as
    // it lands (progressive), so charts appear one by one instead of waiting
    // for the slowest source.
    const cached = force ? null : getCached(KEY);
    const seed = cached?.data ?? liveRef.current;
    if (cached) {
      applyLive(cached.data);
      setLastUpdated(new Date(cached.ts));
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await fetchAllProgressive(applyLive, seed);
      setCached(KEY, data);
      applyLive(data);
      setLastUpdated(new Date());
    } catch (e) {
      if (!cached) setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [applyLive]);

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
      // Keep current charts visible and refine them in place as fresh data streams in.
      const data = await fetchAllProgressive(applyLive, liveRef.current);
      setCached(KEY, data);
      applyLive(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [applyLive]);

  useEffect(() => {
    load(false);
    timer.current = setInterval(() => load(true), 24 * 60 * 60 * 1000);
    return () => {
      clearInterval(timer.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [load]);

  return (
    <DataContext.Provider value={{ liveData, loading, lastUpdated, error, refresh: () => load(true), forceRefresh }}>
      {children}
    </DataContext.Provider>
  );
}

export const useData = () => useContext(DataContext);
