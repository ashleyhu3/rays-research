import { useEffect, useState } from 'react';
import { getCached, setCached, removeCachedPrefix } from './cache';

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
  // localStorage/memory are the intentional cache layers for these resources.
  // Do not let the browser's HTTP cache add a third stale copy underneath them.
  const res = await fetch(url, { cache: 'no-store' });
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

// Drop every cached entry (memory + localStorage) whose URL starts with
// `prefix`, so the next mount of a `useResource(url)` consumer does a fresh
// network fetch instead of serving stale data. Used by page-scoped refresh
// buttons ahead of remounting the view.
export function invalidateResource(prefix) {
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  removeCachedPrefix(prefix);
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
// distinct URL is cached separately. Pass `{ revalidate: true }` for datasets
// written by an external collector: cached data paints immediately, then a
// network request refreshes it on every mount.
export function useResource(url, { skip = false, revalidate = false } = {}) {
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
      if (!revalidate) return undefined;
    }

    let live = true;
    if (cached == null) setLoading(true);
    setError(null);
    fetchResource(url)
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch((e) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [url, skip, revalidate]);

  return { data, error, loading };
}
