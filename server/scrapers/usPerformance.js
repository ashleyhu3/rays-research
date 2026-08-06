'use strict';

const path = require('path');
const { createPersistedSeries, isoDaysAgo } = require('./persistedSeries');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    });
  }
  return _yf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      const rateLimited = e.message?.includes('429') || /Too Many Requests|crumb/i.test(e.message ?? '');
      if (i === tries || !rateLimited) throw e;
      await sleep(1500 * i);
    }
  }
}

function isoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

// Bounded-concurrency map, same pattern as generateDailyOptionsReport.js —
// fetching every ticker fully in parallel is the main source of Yahoo 429s.
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

const TICKERS = [
  // Sector rotation (overview chart + per-sector ratio vs SPX)
  { ticker: 'XLC',   label: 'XLC',  name: 'Communication Services' },
  { ticker: 'XLY',   label: 'XLY',  name: 'Consumer Discretionary' },
  { ticker: 'XLP',   label: 'XLP',  name: 'Consumer Staples' },
  { ticker: 'XLE',   label: 'XLE',  name: 'Energy' },
  { ticker: 'XLF',   label: 'XLF',  name: 'Financial' },
  { ticker: 'XLV',   label: 'XLV',  name: 'Health Care' },
  { ticker: 'XLI',   label: 'XLI',  name: 'Industrial' },
  { ticker: 'XLB',   label: 'XLB',  name: 'Materials' },
  { ticker: 'XLRE',  label: 'XLRE', name: 'Real Estate' },
  { ticker: 'XLK',   label: 'XLK',  name: 'Technology' },
  { ticker: 'XLU',   label: 'XLU',  name: 'Utilities' },
  { ticker: '^GSPC', label: 'SPX',  name: 'S&P 500' },

  // Equal-weight pinned chart (RSP/SPX)
  { ticker: 'RSP',   label: 'RSP',  name: 'Equal Weight' },

  // Tech ratio pairs (SOX/SPX, SOX/IGV, SOX/MAGS, MAGS/SPX, IGV/SPX, CIBR/IGV)
  { ticker: '^SOX', label: 'SOX',  name: 'Semiconductors' },
  { ticker: 'SOXX', label: 'SOXX', name: 'Semiconductors Volume Proxy' },
  { ticker: 'IGV',  label: 'IGV',  name: 'Software' },
  { ticker: 'MAGS', label: 'MAGS', name: 'Magnificent Seven' },
  { ticker: 'CIBR', label: 'CIBR', name: 'Cybersecurity' },

  // Correlation section (SOX/KWEB cross-correlations)
  { ticker: '^NDX', label: 'NDX',  name: 'Nasdaq 100' },
  { ticker: 'KWEB', label: 'KWEB', name: 'China Internet (KWEB)' },

  // Theme ETFs vs SPX
  { ticker: 'XBI',  label: 'XBI',  name: 'Biotechnology' },
  { ticker: 'IHI',  label: 'IHI',  name: 'Medical Devices' },
  { ticker: 'ITA',  label: 'ITA',  name: 'Aerospace & Defense' },
  { ticker: 'GDX',  label: 'GDX',  name: 'Gold Miners' },
  { ticker: 'COPX', label: 'COPX', name: 'Copper Miners' },
  { ticker: 'XHB',  label: 'XHB',  name: 'Homebuilders' },
  { ticker: 'XRT',  label: 'XRT',  name: 'Retail' },
  { ticker: 'OIH',  label: 'OIH',  name: 'Oil Services' },
  { ticker: 'KBE',  label: 'KBE',  name: 'Banks' },
  { ticker: 'MOO',  label: 'MOO',  name: 'Agribusiness' },
  { ticker: 'BOTZ', label: 'BOTZ', name: 'Robotics & AI' },

  // Factor ETFs vs SPX
  { ticker: 'MTUM', label: 'MTUM', name: 'Momentum Factor' },
  { ticker: 'VLUE', label: 'VLUE', name: 'Value Factor' },
  { ticker: 'QUAL', label: 'QUAL', name: 'Quality Factor' },
  { ticker: 'USMV', label: 'USMV', name: 'Min Volatility Factor' },

  // Sentiment section: raw volatility-index levels (VIX/VIXEQ/VXN) and the
  // GLD/VIX cross-asset ratio
  { ticker: '^VIX',   label: 'VIX',   name: 'CBOE Volatility Index' },
  { ticker: '^VIXEQ', label: 'VIXEQ', name: 'CBOE S&P 500 Constituent Volatility' },
  { ticker: '^VXN',   label: 'VXN',   name: 'CBOE Nasdaq-100 Volatility Index' },
  { ticker: '^MOVE',  label: 'MOVE',  name: 'ICE BofA MOVE Index' },
  { ticker: '^GVZ',   label: 'GVZ',   name: 'CBOE Gold ETF Volatility Index' },
  { ticker: 'GLD',    label: 'GLD',   name: 'SPDR Gold Shares' },
];

const HISTORY = createPersistedSeries({
  blob: 'usPerformanceHistory',
  file: path.join(__dirname, '..', 'data', 'usPerformanceHistory.json'),
  tickers: TICKERS,
  fields: ['closes', 'adjCloses', 'volumes'],
});

async function fetchSeries(yf, ticker, start, end) {
  const chart = await withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1d' }));
  const quotes = (chart?.quotes ?? []).filter(q => q.date && q.close != null);
  // adjclose is absent for indices (no dividends to adjust for) — fall back to close.
  return quotes.map(q => ({
    date: isoDate(q.date),
    close: q.close,
    adjClose: q.adjclose ?? q.close,
    volume: Number.isFinite(q.volume) && q.volume > 0 ? q.volume : null,
  }));
}

// Yahoo Finance carries only a single live snapshot for ^VIXEQ (no chart
// history at all — verified directly), so it's fetched from CBOE's own daily
// index-history CSV instead, which covers 2014+. This same URL shape serves
// every CBOE-calculated index (VIX_History.csv, VVIX_History.csv, ...), so
// it'd cover any other CBOE index added here later too.
const CBOE_INDEX_HISTORY_URL = symbol => `https://cdn.cboe.com/api/global/us_indices/daily_prices/${symbol}_History.csv`;

function parseCboeIndexCsv(text, ticker) {
  const dates = [];
  const closes = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [dateStr, valueStr] = line.split(',');
    const m = dateStr?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const value = Number(valueStr);
    if (!m || !Number.isFinite(value)) continue;
    dates.push(`${m[3]}-${m[1]}-${m[2]}`);
    closes.push(value);
  }
  return { dates, series: [{ ticker, closes, adjCloses: closes }] };
}

async function fetchCboeIndexHistory(symbol, ticker) {
  const res = await fetch(CBOE_INDEX_HISTORY_URL(symbol), {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`CBOE ${symbol} history HTTP ${res.status}`);
  const payload = parseCboeIndexCsv(await res.text(), ticker);
  if (!payload.dates.length) throw new Error(`CBOE ${symbol} history returned no rows`);
  return payload;
}

const VIXEQ_TICKER = '^VIXEQ';
const MOVE_TICKER = '^MOVE';
const VOLUME_HISTORY_DAYS = 1825;

// ^MOVE's Yahoo chart() history is unusable for the trailing ~3 weeks: that
// whole window comes back with close=null (verified directly against the
// endpoint), except for the single most-recent bar, which is a live,
// still-updating snapshot rather than a settled close — ICE publishes the
// real MOVE close once daily, later than Yahoo's other realtime indices, so
// whatever chart() shows as "today" is often still just yesterday's level.
// Trusting that bar under today's date is what produced the one-day-stale
// values users spotted (e.g. Jul 31 showing Jul 30's real close). The quote
// endpoint's regularMarketPreviousClose is Yahoo's own authoritative settled
// figure for the prior session, so pull that each cycle and merge it under
// the correct prior trading date instead — never the live bar under "today".
async function fetchMovePreviousClose(yf, knownDates) {
  const quote = await withRetry(() => yf.quote(MOVE_TICKER));
  const previousClose = quote?.regularMarketPreviousClose;
  const asOf = isoDate(quote?.regularMarketTime);
  if (!Number.isFinite(previousClose) || !asOf) return null;

  const priorDate = [...knownDates].reverse().find(d => d < asOf);
  if (!priorDate) return null;

  return {
    dates: [priorDate],
    series: [{ ticker: MOVE_TICKER, closes: [previousClose], adjCloses: [previousClose] }],
  };
}

function inclusiveEndDate(endDate) {
  const end = new Date(endDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function getUsPerformance(startDate, endDate = new Date()) {
  const yf  = getYF();
  const end = inclusiveEndDate(endDate);
  const start = new Date(startDate);

  // ^VIXEQ has no Yahoo chart history (see fetchCboeIndexHistory above) —
  // skip the pointless Yahoo call; updateUsPerformance merges its CBOE CSV
  // history separately. ^MOVE's chart history is unreliable for recent days
  // (see fetchMovePreviousClose above) — updateUsPerformance merges it from
  // the quote endpoint separately instead.
  const yahooTickers = TICKERS.filter(meta => meta.ticker !== VIXEQ_TICKER && meta.ticker !== MOVE_TICKER);
  const results = await mapLimit(yahooTickers, 4, async meta => {
    try {
      const points = await fetchSeries(yf, meta.ticker, start, end);
      return { ...meta, points, error: null };
    } catch (e) {
      return { ...meta, points: [], error: e.message };
    }
  });

  // Union of all trading dates across every series (all trade on NYSE hours,
  // but several tickers here — e.g. MAGS, BOTZ — listed well after SPX, and
  // any single feed can be momentarily short a day, so union — not intersect
  // — keeps a late-listed or partially-failed series from truncating everyone
  // else's).
  const dateSet = new Set();
  for (const r of results) for (const p of r.points) dateSet.add(p.date);
  const dates = [...dateSet].sort();

  const series = results.map(r => {
    const byDate = new Map(r.points.map(p => [p.date, p.close]));
    const byDateAdj = new Map(r.points.map(p => [p.date, p.adjClose]));
    const byDateVolume = new Map(r.points.map(p => [p.date, p.volume]));
    return {
      ticker: r.ticker,
      label: r.label,
      name: r.name,
      closes: dates.map(d => byDate.get(d) ?? null),
      adjCloses: dates.map(d => byDateAdj.get(d) ?? null),
      volumes: dates.map(d => byDateVolume.get(d) ?? null),
      error: r.error,
    };
  });

  return { start: dates[0] ?? isoDate(start), end: dates[dates.length - 1] ?? isoDate(endDate), dates, series };
}

// Indices (^GSPC, ^SOX, ^VIX, ...) carry no real per-share volume — Yahoo
// returns 0/absent for them, which fetchSeries already nulls out. Excluding
// them here keeps this from re-attempting an unbackfillable fetch every cycle.
function hasRealVolume(ticker) {
  return !ticker.startsWith('^');
}

// The routine 45-day merge (see updateUsPerformance) only ever fills a
// rolling recent window, so any ticker added (or any ticker whose volume
// field predates 'volumes' being tracked) is permanently missing bars beyond
// that window unless it's deep-backfilled once. This checks every ticker for
// pre-existing historical closes (and, where applicable, volume) and
// backfills whichever are missing it, so it self-heals on each scheduled run
// instead of needing a one-off script per ticker (as the old RSP-only,
// volume-only version did — that version never checked `closes`, so a
// newly-added price-only ticker like VIX/VXN/GLD stayed capped at the
// rolling 45-day window forever with nothing to grow it).
async function backfillHistoricalDataIfNeeded(endDate) {
  const stored = HISTORY.assemble();
  const historicalCutoff = isoDaysAgo(60);
  const hasHistoricalField = (meta, field) => {
    const series = stored.series.find(s => s.ticker === meta.ticker);
    return series?.[field]?.some(
      (value, index) => value != null && stored.dates[index] < historicalCutoff
    );
  };
  // ^VIXEQ's deep history comes from the CBOE CSV merge below (always the
  // full series, every cycle), not from Yahoo chart() — never queue it here.
  const needsBackfill = TICKERS.filter(meta => (
    meta.ticker !== VIXEQ_TICKER
    && (!hasHistoricalField(meta, 'closes') || (hasRealVolume(meta.ticker) && !hasHistoricalField(meta, 'volumes')))
  ));
  if (!needsBackfill.length) return;

  const yf = getYF();
  const start = new Date(isoDaysAgo(VOLUME_HISTORY_DAYS));
  const end = inclusiveEndDate(endDate);
  const results = await mapLimit(needsBackfill, 4, async meta => {
    try {
      return { ticker: meta.ticker, points: await fetchSeries(yf, meta.ticker, start, end) };
    } catch (e) {
      console.warn(`[usPerformance] historical backfill ${meta.ticker}: ${e.message}`);
      return { ticker: meta.ticker, points: [] };
    }
  });

  const dateSet = new Set();
  for (const r of results) for (const p of r.points) dateSet.add(p.date);
  const dates = [...dateSet].sort();
  if (!dates.length) return;

  const series = results.map(r => {
    const byClose = new Map(r.points.map(p => [p.date, p.close]));
    const byAdjClose = new Map(r.points.map(p => [p.date, p.adjClose]));
    const byVolume = new Map(r.points.map(p => [p.date, p.volume]));
    return {
      ticker: r.ticker,
      closes: dates.map(d => byClose.get(d) ?? null),
      adjCloses: dates.map(d => byAdjClose.get(d) ?? null),
      volumes: dates.map(d => byVolume.get(d) ?? null),
    };
  });
  HISTORY.merge({ dates, series });
}

async function updateUsPerformance(days = 45) {
  const end = new Date().toISOString().slice(0, 10);
  const payload = await getUsPerformance(isoDaysAgo(days), end);
  HISTORY.merge(payload);
  try {
    // Existing stores predate volume persistence (or gained a ticker after
    // the fact) — fill five years of history once per ticker so every date
    // preset gets bars immediately after refresh.
    await backfillHistoricalDataIfNeeded(end);
  } catch (e) {
    console.warn(`[usPerformance] historical backfill: ${e.message}`);
  }
  try {
    HISTORY.merge(await fetchCboeIndexHistory('VIXEQ', VIXEQ_TICKER));
  } catch (e) {
    console.warn(`[usPerformance] CBOE VIXEQ: ${e.message}`);
  }
  try {
    const movePatch = await fetchMovePreviousClose(getYF(), payload.dates);
    if (movePatch) HISTORY.merge(movePatch);
  } catch (e) {
    console.warn(`[usPerformance] MOVE previous close: ${e.message}`);
  }
  return HISTORY.assemble();
}

function readUsPerformance(startDate, endDate) {
  return HISTORY.assemble(startDate, endDate);
}

module.exports = { getUsPerformance, updateUsPerformance, readUsPerformance, TICKERS };
