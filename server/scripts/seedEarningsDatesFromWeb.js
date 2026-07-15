'use strict';

/**
 * Seed the earningsDates Mongo blob from the web (Nasdaq), so the options
 * report's prior-cycle lines can be aligned WITHOUT spending Alpha Vantage's
 * 25/day cap. This exists for the one-off ticker backfill: the recurring daily
 * job still uses Alpha Vantage via earningsDates.js.
 *
 * For each ticker it writes the same entry shape getEarningsAnchors() reads:
 *   { upcoming: { reportDate, fiscalDateEnding }, calendarFetchedAt,
 *     history: [{ fiscalDateEnding, reportedDate }], historyFetchedAt }
 * with fresh timestamps, so a subsequent Stage-2 run sees the entry as neither
 * calendar- nor history-stale and never calls Alpha Vantage.
 *
 * The database is checked first (per the backfill plan): a ticker whose cached
 * entry is already fresh — a future upcoming date and recent fetches — is left
 * untouched and no web request is made for it.
 *
 * Sources (both public, keyed only by a User-Agent header):
 *   • https://api.nasdaq.com/api/analyst/{T}/earnings-date   → next call
 *   • https://api.nasdaq.com/api/company/{T}/earnings-surprise → reported dates
 *
 * Usage:
 *   node --env-file=.env server/scripts/seedEarningsDatesFromWeb.js [--tickers A,B] [--force]
 */

const storage = require('../storage');
const { BLOB, calendarStale, historyStale } = require('../earningsDates');

const EXTRA_TICKERS = [
  'QRVO', 'UMC', 'STX', 'RMBS', 'KLAC', 'TER', 'LRCX', 'NXPI', 'STM', 'FLEX',
  'APH', 'TEL', 'GLW', 'FORM', 'AMKR', 'SANM', 'CLS', 'ARM', 'CDNS', 'MSFT', 'META',
];

const NASDAQ = 'https://api.nasdaq.com/api';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pad(n) { return String(n).padStart(2, '0'); }
function lastDayOfMonth(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

// "4/29/2026" or "04/29/2026" → "2026-04-29".
function mdyToIso(str) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str).trim());
  if (!m) return null;
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
}

// "Jul 28, 2026" → "2026-07-28".
function monDayYearToIso(str) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(String(str));
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${pad(month)}-${pad(Number(m[2]))}`;
}

// "Jun 2026" (a fiscal-quarter-end label) → "2026-06-30".
function monYearToFiscalEnd(str) {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(String(str));
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[2]}-${pad(month)}-${pad(lastDayOfMonth(Number(m[2]), month))}`;
}

async function nasdaqGet(pathname) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${NASDAQ}${pathname}`, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.status?.rCode && json.status.rCode !== 200) {
        throw new Error(`Nasdaq rCode ${json.status.rCode}`);
      }
      return json;
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(800 * (attempt + 1));
    }
  }
  return null;
}

// The upcoming call: prefer the machine-ish reportText MM/DD/YYYY, fall back to
// the human "announcement" line. fiscalDateEnding comes from the "fiscal Quarter
// ending Mon YYYY" phrase when present.
async function fetchUpcoming(ticker) {
  const json = await nasdaqGet(`/analyst/${encodeURIComponent(ticker)}/earnings-date`);
  const data = json?.data;
  if (!data) return null;
  const text = `${data.reportText || ''}`;
  const reportDate =
    mdyToIso((text.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/) || [])[1])
    || monDayYearToIso(data.announcement || '')
    || monDayYearToIso(data.reportText || '');
  if (!reportDate) return null;
  const fiscalDateEnding = monYearToFiscalEnd((text.match(/fiscal Quarter ending ([A-Za-z]{3,}\s+\d{4})/) || [])[1] || '');
  return { reportDate, fiscalDateEnding };
}

// Past reported call dates, newest first — the shape earningsDates.pickAnchor()
// consumes to place the prior-quarter and prior-year lines.
async function fetchHistory(ticker) {
  const json = await nasdaqGet(`/company/${encodeURIComponent(ticker)}/earnings-surprise`);
  const rows = json?.data?.earningsSurpriseTable?.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(row => ({
      fiscalDateEnding: monYearToFiscalEnd(row.fiscalQtrEnd || ''),
      reportedDate: mdyToIso(row.dateReported || ''),
    }))
    .filter(row => row.reportedDate)
    .sort((a, b) => b.reportedDate.localeCompare(a.reportedDate));
}

function readBlob() {
  const blob = storage.read(BLOB.name, BLOB.file);
  if (!blob.tickers) blob.tickers = {};
  return blob;
}

function parseArgs(argv) {
  const args = { tickers: null, force: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1].split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      i += 1;
    } else if (argv[i] === '--force') {
      args.force = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  await storage.init([BLOB]);
  const tickers = args.tickers || EXTRA_TICKERS;

  let seeded = 0;
  let skipped = 0;
  for (const ticker of tickers) {
    const blob = readBlob();
    const cached = blob.tickers[ticker] ?? null;

    // Query the DB first: a fresh, future-dated entry needs no web call.
    if (!args.force && cached && !calendarStale(cached) && !historyStale(cached)) {
      console.log(`[earnings-web] ${ticker}: already fresh in DB (upcoming=${cached.upcoming?.reportDate}) — skipping`);
      skipped += 1;
      continue;
    }

    try {
      const upcoming = await fetchUpcoming(ticker);
      if (!upcoming) { console.warn(`[earnings-web] ${ticker}: no upcoming date found — skipping`); continue; }
      const history = await fetchHistory(ticker).catch(() => []);

      const now = new Date().toISOString();
      const entry = {
        ...(cached ?? {}),
        upcoming,
        calendarFetchedAt: now,
        history,
        historyFetchedAt: now,
        source: 'nasdaq-web',
      };
      const next = readBlob();
      next.tickers[ticker] = entry;
      next.updatedAt = now;
      storage.write(BLOB.name, BLOB.file, next);
      await storage.flush();
      seeded += 1;
      console.log(`[earnings-web] ${ticker}: upcoming=${upcoming.reportDate} fiscal=${upcoming.fiscalDateEnding ?? '—'} history=${history.length} (${history[0]?.reportedDate ?? 'none'} …)`);
    } catch (e) {
      console.error(`[earnings-web] ${ticker}: ${e.message}`);
    }
    await sleep(600);
  }

  await storage.flush();
  console.log(`[earnings-web] done — ${seeded} seeded, ${skipped} already fresh`);
}

main()
  .catch(error => {
    console.error('[earnings-web]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());
