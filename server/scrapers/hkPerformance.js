'use strict';

const path = require('path');
const storage = require('../storage');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

// Bounded-concurrency map, same pattern as hkChinaPerformance.js.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return out;
}

// Hang Seng Composite Index series have no reliable Yahoo coverage. They are
// fetched from Hang Seng Indexes' official raw-level chart JSON and persisted
// to a Mongo-backed history
// blob (see loadHistory/saveHistory) rather than fetched live on every page
// request. A daily/6-hourly cron job (see server/scheduler.js) re-runs
// getHkPerformance() to extend the history; the API route reads the stored
// history only (readHkPerformance), so a page load never depends on East
// Money being reachable at request time.
const TICKERS = [
  { ticker: '800701', eastmoneyCode: 'HSCI',   label: '800701', name: 'HSCI' },

  // Sector
  { ticker: '800706', eastmoneyCode: 'HSCIIT', label: '800706', name: 'Information Tech' },
  { ticker: '800704', eastmoneyCode: 'HSCICH', label: '800704', name: 'Healthcare' },
  { ticker: '800702', eastmoneyCode: 'HSCICD', label: '800702', name: 'Consumer Discretionary' },
  { ticker: '800703', eastmoneyCode: 'HSCICS', label: '800703', name: 'Consumer Staples' },
  { ticker: '800712', eastmoneyCode: 'HSCIMT', label: '800712', name: 'Materials' },
  { ticker: '800713', eastmoneyCode: 'HSCIEN', label: '800713', name: 'Energy' },
  { ticker: '800708', eastmoneyCode: 'HSCIFN', label: '800708', name: 'Financials' },
  { ticker: '800711', eastmoneyCode: 'HSCIIN', label: '800711', name: 'Industrials' },
  { ticker: '800710', eastmoneyCode: 'HSCITC', label: '800710', name: 'Telecom' },
  { ticker: '800709', eastmoneyCode: 'HSCIUT', label: '800709', name: 'Utilities' },
  { ticker: '800705', eastmoneyCode: 'HSCICO', label: '800705', name: 'Conglomerates' },

  // Market Cap
  { ticker: '800714', eastmoneyCode: 'HSLI',   label: '800714', name: 'Large Cap' },
  { ticker: '800715', eastmoneyCode: 'HSMI',   label: '800715', name: 'Mid Cap' },
  { ticker: '800716', eastmoneyCode: 'HSSI',   label: '800716', name: 'Small Cap' },
];

const HSI_CODES = {
  '800701': '00011.00',
  '800706': '00011.10',
  '800704': '00011.14',
  '800702': '00011.12',
  '800703': '00011.13',
  '800712': '00011.02',
  '800713': '00011.01',
  '800708': '00011.08',
  '800711': '00011.03',
  '800710': '00011.06',
  '800709': '00011.07',
  '800705': '00011.11',
  '800714': '00012.00',
  '800715': '00013.00',
  '800716': '00016.00',
};

const BLOB = 'hkPerformanceHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'hkPerformanceHistory.json');

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

function rangeForDays(days) {
  if (days <= 35) return '1m';
  if (days <= 100) return '3m';
  if (days <= 200) return '6m';
  if (days <= 380) return '1y';
  if (days <= 1200) return '3y';
  return '5y';
}

async function fetchHsiIndexSeries(indexCode, days, startIso, tries = 3) {
  const url = `https://www.hsi.com.hk/data/eng/indexes/${indexCode}/chart.json`;
  const field = `indexLevels-${rangeForDays(days)}`;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const levels = json?.[field] ?? [];
      if (levels.length) {
        return levels
          .map(([timestamp, close]) => ({ date: isoDate(timestamp), close: Number(close) }))
          .filter(point => point.date >= startIso && Number.isFinite(point.close));
      }
    } catch { /* retry below */ }
    if (i < tries) await sleep(1000 * i);
  }
  throw new Error(`Hang Seng Indexes chart request failed after retries for ${indexCode}`);
}

// Rebuild the { dates, series } payload from the persisted history blob only —
// no network calls, so this always succeeds regardless of East Money's
// reachability from wherever the server happens to run.
function assemble(history) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const series = TICKERS.map(meta => ({
    ticker: meta.ticker,
    label: meta.label,
    name: meta.name,
    closes: dates.map(d => history[d]?.[meta.ticker] ?? null),
    error: null,
  }));
  return { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, dates, series };
}

/**
 * Scrape the last `days` calendar days of every index, merge into the
 * persisted history, and return the full assembled series (not just the
 * freshly-scraped window). `days` defaults to a light daily top-up; the
 * backfill script passes a much larger window.
 */
async function getHkPerformance(days = 30) {
  const today = new Date();
  const start = new Date(today.getTime() - days * 86400000);
  const startIso = isoDate(start);

  const results = await mapLimit(TICKERS, 4, async meta => {
    try {
      const points = await fetchHsiIndexSeries(HSI_CODES[meta.ticker], days, startIso);
      return { ...meta, points, error: null };
    } catch (e) {
      return { ...meta, points: [], error: e.message };
    }
  });

  if (!results.some(result => result.points.length > 0)) {
    throw new Error('Hang Seng Indexes returned no HK Rotation history');
  }

  const history = loadHistory();
  for (const r of results) {
    for (const p of r.points) {
      if (!Number.isFinite(p.close)) continue;
      history[p.date] = { ...(history[p.date] ?? {}), [r.ticker]: p.close };
    }
  }
  saveHistory(history);

  return assemble(history);
}

// Read-only view of the stored history (no scrape) — used by the API route so
// a page load never depends on East Money being reachable at request time.
function readHkPerformance() {
  return assemble(loadHistory());
}

module.exports = { getHkPerformance, readHkPerformance, TICKERS };
