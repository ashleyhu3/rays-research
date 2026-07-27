import { fetchResource, getResource } from './resourceCache';

function isoYearsAgo(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function isoDaysBefore(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function withDates(path, start, end) {
  return `${path}?${new URLSearchParams({ start, end })}`;
}

// Keep these URLs identical to each page's initial URL. The resource cache is
// keyed by the full URL, so the page can adopt an already-running request (or
// paint its completed result immediately) when the user navigates to it.
export function initialPageResourceUrls() {
  const end = new Date().toISOString().slice(0, 10);
  const oneYearStart = isoYearsAgo(1);
  const usFetchStart = isoDaysBefore(oneYearStart, 100);
  const asiaFetchStart = isoDaysBefore(oneYearStart, 80);

  return {
    priority: [
      '/api/alerts/price-return',
      '/api/fundamentals/growth',
      withDates('/api/us-performance', usFetchStart, end),
      withDates('/api/hk-china-performance', asiaFetchStart, end),
      '/api/alerts/daily-options-report',
      '/api/alerts/earnings-calendar',
      withDates('/api/hk-performance', asiaFetchStart, end),
      withDates('/api/global-indices', '2000-01-01', end),
      '/api/index-breadth',
    ],
    remaining: [
      '/api/aaii-sentiment',
      '/api/spx-put-call-ratio',
      withDates('/api/china-etf-premium', oneYearStart, end),
      '/api/china-national-team-flow',
      '/api/china-liquidity',
      '/api/us-liquidity',
      '/api/carry-trade',
      '/api/japan-leverage',
      '/api/us-leverage',
      '/api/buybacks',
      '/api/dc-buildouts',
      '/api/fed-watch',
    ],
  };
}

async function preloadQueue(urls, concurrency) {
  const queue = urls.filter(url => getResource(url) == null);
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const url = queue[cursor++];
      // A failed background preload must not prevent later resources from
      // loading. The page hook will expose/retry its own request normally.
      await fetchResource(url).catch(() => null);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
}

let preloadPromise;

// Start all page data on refresh, but cap concurrency so large Rotation blobs
// do not monopolize the browser or Mongo connection pool. The named slow pages
// run first; the remaining page-specific datasets follow automatically.
export function preloadDashboardPages() {
  if (preloadPromise) return preloadPromise;
  const { priority, remaining } = initialPageResourceUrls();
  preloadPromise = preloadQueue(priority, 4)
    .then(() => preloadQueue(remaining, 3));
  return preloadPromise;
}
