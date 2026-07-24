import { useEffect, useState } from 'react';
import { getCached, setCached } from './cache';

// Shared per-endpoint cache so a dataset loads once, on the first visit to the
// page that needs it, then stays loaded:
//   • in-memory Map  — instant on navigation within a session (no TTL)
//   • localStorage    — survives a full page refresh (2h TTL, via cache.js)
//   • inflight Map    — dedupes concurrent requests for the same URL
// Keyed by the full URL (query params included), so each date-window / ticker
// variant caches independently.

const memory = new Map();
const inflight = new Map();

// Returns cached data for `url` (memory first, then a still-fresh localStorage
// entry), or null if nothing usable is stored.
export function getResource(url) {
  if (!url) return null;
  if (memory.has(url)) return memory.get(url);
  const cached = getCached(url);
  if (cached) {
    memory.set(url, cached.data);
    return cached.data;
  }
  return null;
}

// Seed the cache with data obtained elsewhere (e.g. a POST /reload response),
// so the next reader gets it without a fresh GET.
export function primeResource(url, data) {
  memory.set(url, data);
  setCached(url, data);
}

async function requestJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* non-JSON error body */ }
    throw new Error(message);
  }
  return res.json();
}

// Fetch `url` once and cache it; concurrent callers share the same request.
export function fetchResource(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = requestJson(url)
    .then((data) => {
      primeResource(url, data);
      return data;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// Hook: read a URL's data, loading it lazily on first use and serving cached
// data instantly on every subsequent mount. Pass `{ skip: true }` to hold off
// (e.g. a param isn't ready yet). `url` may change (new date window) — each
// distinct URL is cached separately.
export function useResource(url, { skip = false } = {}) {
  const [data, setData] = useState(() => (skip ? null : getResource(url)));
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(() => !skip && !!url && getResource(url) == null);

  useEffect(() => {
    if (!url || skip) return undefined;

    const cached = getResource(url);
    if (cached != null) {
      setData(cached);
      setError(null);
      setLoading(false);
      return undefined;
    }

    let live = true;
    setLoading(true);
    setError(null);
    fetchResource(url)
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch((e) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [url, skip]);

  return { data, error, loading };
}
