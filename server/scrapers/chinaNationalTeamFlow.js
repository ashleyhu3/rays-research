/**
 * Estimated daily "national team" flow into China's five major broad-based
 * index ETF families — the vehicles Central Huijin / the state stabilization
 * funds are reported to use to support the market. One point per trading day
 * per ticker, derived from creation/redemption activity rather than reported
 * directly by any source:
 *
 *   share_change  = total_shares[t] - total_shares[t-1]      (fund units)
 *   flow_CNY       = share_change × previous_close[t]         (T-1 close, the
 *                    price basket creations/redemptions on day T are struck at)
 *
 * Total shares outstanding come from each exchange's own ETF "基金规模" report:
 *   .SH  query.sse.com.cn/commonQuery.do — the sqlId behind the 基金规模 table
 *        on https://www.sse.com.cn/assortment/fund/list/etfinfo/basic/. Its
 *        "MOREN" (default) view always returns just the last ~9 trading days
 *        regardless of pageHelp.pageSize (verified empirically) — cheap for
 *        the daily poll. There is no range query for older history; the
 *        "SEARCH" variant takes one STAT_DATE at a time, so backfilling past
 *        that window costs one request per missing trading day, same
 *        trade-off chinaLeverage.js hits on SZSE's margin report.
 *   .SZ  www.szse.cn/api/report/ShowReport/data, CATALOGID=fund_jjgm — the
 *        same ShowReport mechanism chinaLeverage.js already uses for margin
 *        data, here queried against the ETF-fund-size catalog. Unlike SSE,
 *        this report takes a real txtStart/txtEnd range (paginated 20
 *        rows/page), so a multi-year SZ backfill is cheap; SSE's per-ticker,
 *        per-day cost is the bottleneck for a deep backfill.
 * Both report a security's confirmed, post-settlement share count keyed by
 * the trading day it settled for (SSE's own note: "统计数据为当日清算后数据";
 * SZSE's column tooltip: the evening figure is provisional, the following
 * morning's is the confirmed T-day number) — so no cross-exchange date shift
 * is needed here. Every poll re-requests SZSE's whole recent window (not just
 * missing days), so a provisional value quietly gets overwritten by the
 * confirmed one once SZSE posts it; SSE's own days don't get revised.
 *
 * Previous-close prices are fetched fresh from Yahoo Finance on every run
 * (never persisted verbatim, only used to compute flow) — same approach
 * chinaLeverage.js uses for its FX/AUM legs. A-share ETF tickers use Yahoo's
 * .SS suffix for Shanghai and .SZ for Shenzhen.
 *
 * Validated: SSE's TOT_VOL for 510300 on 2026-03-31 (4,482,858.77万份 =
 * 448.2858… 亿份) matches East Money's independently reported quarterly share
 * count for the same date (448.29亿份) to within rounding — confirms TOT_VOL
 * is denominated in 万份 as its own column label says.
 */
'use strict';
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'chinaNationalTeamFlowHistory.json');
const BLOB = 'chinaNationalTeamFlowHistory';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const round2 = v => Math.round(v * 100) / 100;

// A handful of requests intermittently come back with a connection reset or
// an empty body rather than a real HTTP error — retry a few times with a
// short backoff before giving up on that request.
async function withRetry(fn, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try { return await fn(); }
    catch (e) {
      if (attempt === tries) throw e;
      await sleep(500 * attempt);
    }
  }
}

/** Bounded-concurrency map — same small-pool pattern chinaLeverage.js uses so
 * a burst of requests doesn't get an IP throttled. */
async function mapPool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]); }
  }));
}

/* ── Ticker universe ───────────────────────────────────────────────── */

const TICKER_GROUPS = {
  '沪深300': ['510310.SH', '510330.SH', '510300.SH', '159919.SZ'],
  '中证500': ['159922.SZ', '510500.SH', '512500.SH'],
  '中证1000': ['159845.SZ', '512100.SH', '560010.SH', '159629.SZ'],
  '科创': ['588050.SH', '588000.SH', '588080.SH'],
  '创业板': ['159915.SZ', '159952.SZ', '159977.SZ'],
};
const GROUP_KEYS = Object.keys(TICKER_GROUPS);
const ALL_TICKERS = GROUP_KEYS.flatMap(g => TICKER_GROUPS[g]);
const TICKER_GROUP = Object.fromEntries(GROUP_KEYS.flatMap(g => TICKER_GROUPS[g].map(t => [t, g])));

const secCode = ticker => ticker.split('.')[0];
const isSh = ticker => ticker.endsWith('.SH');
// Yahoo Finance uses .SS for Shanghai (not .SH) and .SZ for Shenzhen.
const yahooSymbol = ticker => `${secCode(ticker)}.${isSh(ticker) ? 'SS' : 'SZ'}`;

/* ── SSE: query.sse.com.cn/commonQuery.do ──────────────────────────── */

const SSE_URL = 'https://query.sse.com.cn/commonQuery.do';
const SSE_REFERER = 'https://www.sse.com.cn/assortment/fund/list/etfinfo/basic/index.shtml';
const SSE_SQL_RECENT = 'COMMON_SSE_ZQPZ_ETFZL_ETFJBXX_JJGM_MOREN_L';
const SSE_SQL_DAY = 'COMMON_SSE_ZQPZ_ETFZL_ETFJBXX_JJGM_SEARCH_L';

async function sseFetch(params) {
  return withRetry(async () => {
    const q = new URLSearchParams(params);
    const res = await fetch(`${SSE_URL}?${q}`, {
      headers: { 'User-Agent': UA, Referer: SSE_REFERER },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`SSE fund size HTTP ${res.status}`);
    return res.json();
  });
}

// Last ~9 trading days in one request, regardless of pageHelp.pageSize.
async function sseFundSizeRecent(code) {
  const json = await sseFetch({
    isPagination: 'true',
    sqlId: SSE_SQL_RECENT,
    SEC_CODE: code,
    'pageHelp.pageSize': '10',
  });
  const out = {};
  for (const row of json.result ?? []) {
    const day = row.STAT_DATE;
    const totVol = Number(row.TOT_VOL);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || !Number.isFinite(totVol)) continue;
    out[day] = totVol;
  }
  return out;
}

// One trading day per request — SSE has no range query for older history.
async function sseFundSizeDay(code, day) {
  const json = await sseFetch({
    isPagination: 'false',
    sqlId: SSE_SQL_DAY,
    SEC_CODE: code,
    STAT_DATE: day,
  });
  const row = json.result?.[0];
  if (!row) return null; // non-trading day or no filing yet
  const totVol = Number(row.TOT_VOL);
  return Number.isFinite(totVol) ? totVol : null;
}

/* ── SZSE: ShowReport fund_jjgm catalog (real date-range query) ────── */

const SZSE_URL = 'https://www.szse.cn/api/report/ShowReport/data';
const SZSE_REFERER = 'https://fund.szse.cn/marketdata/etf/index.html';
// The report rejects any txtStart/txtEnd span over ~6 months ("起止时间段超过
// 半年") — verified empirically. Stay comfortably under that per chunk.
const SZSE_MAX_SPAN_DAYS = 150;

// SZSE's bot detection IP-blocks after a modest number of requests (observed
// as low as ~50-60 in a continuous session, per the ShowReport mechanism this
// shares with chinaLeverage.js). Pages/chunks/tickers are paced well apart so
// a deep backfill doesn't burn through that budget in a burst, and every
// throw carries whatever rows were already gathered (`error.partial`) so a
// mid-fetch block still leaves the caller something to persist instead of
// losing the whole chunk/range.
const SZSE_PAGE_SLEEP_MS = 350;
const SZSE_CHUNK_SLEEP_MS = 900;

async function szseFundSizeChunk(code, from, to) {
  const out = {};
  for (let page = 1; page <= 200; page++) {
    let json;
    try {
      json = await withRetry(async () => {
        const q = new URLSearchParams({
          SHOWTYPE: 'JSON',
          CATALOGID: 'fund_jjgm',
          TABKEY: 'tab1',
          txtDm: code,
          txtStart: from,
          txtEnd: to,
          PAGENO: String(page),
          random: String(Math.random()),
        });
        const res = await fetch(`${SZSE_URL}?${q}`, {
          headers: { 'User-Agent': UA, Referer: SZSE_REFERER },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`SZSE fund size HTTP ${res.status}`);
        const body = await res.json();
        if (body?.[0]?.error) throw new Error(`SZSE fund size: ${body[0].error}`);
        return body;
      });
    } catch (e) {
      e.partial = out;
      throw e;
    }
    const report = json?.[0];
    const rows = report?.data ?? [];
    for (const row of rows) {
      const day = row.size_date;
      const size = Number(String(row.current_size ?? '').replace(/,/g, ''));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '') || !Number.isFinite(size)) continue;
      out[day] = size;
    }
    const pagecount = report?.metadata?.pagecount ?? 1;
    if (page >= pagecount || rows.length === 0) break;
    await sleep(SZSE_PAGE_SLEEP_MS);
  }
  return out;
}

// Walks the full from..to span backwards in ≤6-month chunks (the report's own
// limit), merging each chunk's rows together. On failure, whatever chunks
// already succeeded (plus the failing chunk's own partial pages) travel with
// the thrown error as `error.partial` so the caller can still save that much.
async function szseFundSizeRange(code, from, to) {
  const out = {};
  let chunkEnd = to;
  while (chunkEnd >= from) {
    const cappedStart = addDays(chunkEnd, -SZSE_MAX_SPAN_DAYS);
    const chunkStart = cappedStart > from ? cappedStart : from;
    try {
      Object.assign(out, await szseFundSizeChunk(code, chunkStart, chunkEnd));
    } catch (e) {
      e.partial = { ...out, ...(e.partial ?? {}) };
      throw e;
    }
    if (chunkStart <= from) break;
    chunkEnd = addDays(chunkStart, -1);
    await sleep(SZSE_CHUNK_SLEEP_MS);
  }
  return out;
}

/* ── Yahoo Finance: previous-close prices, fetched fresh every run ──── */

async function yahooDailyClose(symbol, range, decimals = 4) {
  const json = await withRetry(async () => {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
    return res.json();
  });
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol} returned no data`);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const tz = result.meta?.exchangeTimezoneName ?? 'Asia/Shanghai';
  const scale = 10 ** decimals;
  const out = {};
  timestamps.forEach((ts, i) => {
    const close = closes[i];
    if (!Number.isFinite(close)) return;
    const day = new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: tz });
    out[day] = Math.round(close * scale) / scale;
  });
  return out;
}

/* ── History blob ───────────────────────────────────────────────────── */

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

/**
 * Refresh recent share counts and prices for all 17 tickers, backfill any SSE
 * trading days missing within the window, merge into history, and return the
 * full assembled series (always the whole stored history, not just this
 * run's window — the page does its own client-side range slicing).
 *
 * days controls how far back this run looks: how much SZSE range history to
 * request, how many SSE trading days count as "in window" for the missing-day
 * backfill check, and which Yahoo price range to pull. Defaults to a light
 * daily-poll window; the backfill script passes a much larger value.
 *
 * tickerFilter optionally restricts the run to a subset of ALL_TICKERS (e.g.
 * just the .SZ tickers for a targeted backfill) — useful for keeping a single
 * run's SZSE request budget small enough to stay under the block threshold.
 */
async function getChinaNationalTeamFlow(days = 30, tickerFilter = null) {
  const today = new Date();
  const from = iso(new Date(today.getTime() - days * 86400000));
  const to = iso(today);

  const history = loadHistory();
  history.shares = history.shares ?? {};
  history.prices = history.prices ?? {};

  const universe = tickerFilter?.length ? ALL_TICKERS.filter(t => tickerFilter.includes(t)) : ALL_TICKERS;
  const shTickers = universe.filter(isSh);
  const szTickers = universe.filter(t => !isSh(t));

  await mapPool(shTickers, 3, async ticker => {
    try {
      const recent = await sseFundSizeRecent(secCode(ticker));
      history.shares[ticker] = { ...(history.shares[ticker] ?? {}), ...recent };
    } catch (e) {
      console.warn(`[chinaNationalTeamFlow] SSE ${ticker}: ${e.message}`);
    }
  });

  // Sequential, not pooled: SZSE's ShowReport endpoint appears to rate-limit
  // by IP under concurrent load (a burst of chunked, paginated requests across
  // several tickers at once has been observed to get the whole host briefly
  // unreachable). One ticker at a time, with a pause between, plus an outer
  // retry per ticker on top of szseFundSizeChunk's own per-request retry —
  // a whole ticker occasionally comes back "fetch failed" (network-level,
  // not a bad request), and losing its entire history for the run is worse
  // than the extra wait.
  //
  // Progress is saved after every ticker (not just once at the end of this
  // whole function) and any partial rows a failed fetch still gathered are
  // merged in too — a run that gets IP-blocked partway keeps whatever it
  // already earned instead of losing it all. Once a failure looks like an
  // actual block (network-level, not a bad request/date), the loop stops
  // early rather than spending the rest of its retries hammering a host
  // that's already refusing this IP — a later run picks up the remaining
  // tickers once the block clears (typically ~25-30 min).
  let szseBlocked = false;
  for (const ticker of szTickers) {
    if (szseBlocked) break;
    let rows = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 3 && rows == null; attempt += 1) {
      try {
        rows = await szseFundSizeRange(secCode(ticker), from, to);
      } catch (e) {
        lastError = e;
        if (e.partial && Object.keys(e.partial).length) {
          history.shares[ticker] = { ...(history.shares[ticker] ?? {}), ...e.partial };
        }
        if (attempt < 3) await sleep(4000 * attempt);
      }
    }
    if (rows) history.shares[ticker] = { ...(history.shares[ticker] ?? {}), ...rows };
    saveHistory(history);
    await storage.flush();
    if (!rows && lastError) {
      console.warn(`[chinaNationalTeamFlow] SZSE ${ticker}: ${lastError.message}`);
      if (/fetch failed|ECONNRESET|EAI_AGAIN|network|timeout/i.test(lastError.message ?? '')) {
        szseBlocked = true;
        console.warn('[chinaNationalTeamFlow] SZSE looks blocked — stopping remaining SZ tickers for this run; already-fetched data is saved, re-run later to pick up the rest.');
      }
    }
    if (!szseBlocked) await sleep(3000);
  }

  // Prices are needed to compute flow, but they also double as an independent
  // A-share trading calendar: any A-share ETF's Yahoo close dates are exactly the
  // days the market traded. Fetch them BEFORE the SSE per-day backfill so the
  // missing-day reference below doesn't depend solely on SZSE — SZSE's ShowReport
  // host is unreachable from outside China, and when it fails the SSE (.SH)
  // tickers would otherwise never get backfilled (their calendar came only from
  // the SZSE fetch).
  const priceRange = days > 1460 ? '10y' : days > 700 ? '5y' : days > 300 ? '2y' : '1y';
  await mapPool(universe, 4, async ticker => {
    try {
      const closes = await yahooDailyClose(yahooSymbol(ticker), priceRange);
      history.prices[ticker] = { ...(history.prices[ticker] ?? {}), ...closes };
    } catch (e) {
      console.warn(`[chinaNationalTeamFlow] Yahoo ${ticker}: ${e.message}`);
    }
  });

  // SSE trading days worth having in the window. Both exchanges share one trading
  // calendar, so the reference is the union of the SZSE tickers' freshly-fetched
  // dates and the Yahoo price dates — either source alone is a valid calendar, and
  // the union keeps the SSE backfill working even when one of them is unavailable.
  const knownTradingDays = new Set();
  for (const ticker of szTickers) {
    for (const day of Object.keys(history.shares[ticker] ?? {})) {
      if (day >= from && day <= to) knownTradingDays.add(day);
    }
  }
  for (const ticker of universe) {
    for (const day of Object.keys(history.prices[ticker] ?? {})) {
      if (day >= from && day <= to) knownTradingDays.add(day);
    }
  }
  // Different tickers are independent. A small pool keeps a one-year backfill
  // practical while retaining the per-ticker delay that protects the exchange.
  await mapPool(shTickers, 3, async ticker => {
    const have = history.shares[ticker] ?? {};
    const missing = [...knownTradingDays].filter(d => !(d in have)).sort();
    if (!missing.length) return;
    if (missing.length > 5) console.log(`[chinaNationalTeamFlow] SSE ${ticker}: backfilling ${missing.length} days…`);
    for (const day of missing) {
      try {
        const v = await sseFundSizeDay(secCode(ticker), day);
        if (v != null) have[day] = v;
      } catch (e) {
        console.warn(`[chinaNationalTeamFlow] SSE ${ticker} ${day}: ${e.message}`);
      }
      await sleep(150);
    }
    history.shares[ticker] = have;
  });

  saveHistory(history);
  return assemble(history);
}

/**
 * Per ticker: share_change[t] = shares[t] - shares[t-1] (own trading-day
 * sequence, so a ticker's individual reporting gaps don't shift its
 * neighbours), flow_CNY[t] = share_change[t] × previous_close (the T-1 close
 * the creation/redemption basket for day t was struck at). The very first
 * stored day for a ticker is dropped — there is no prior share count to diff
 * against. A day with no computable flow (missing price, or shares not yet
 * reported that day) is left out of that ticker's series entirely rather
 * than zero-filled, per the no-invented-zeros requirement; group totals for a
 * date only sum the tickers that actually have a value that day.
 */
function assemble(history) {
  const shares = history.shares ?? {};
  const prices = history.prices ?? {};
  const flowsByTicker = {};

  for (const ticker of ALL_TICKERS) {
    const series = shares[ticker] ?? {};
    const dates = Object.keys(series).sort();
    const priceMap = prices[ticker] ?? {};
    const flows = {};
    for (let i = 1; i < dates.length; i += 1) {
      const day = dates[i];
      const prevDay = dates[i - 1];
      const shareChange = series[day] - series[prevDay]; // 万份
      const prevClose = priceMap[prevDay];
      if (!Number.isFinite(shareChange) || !Number.isFinite(prevClose)) continue;
      const flowCny = shareChange * 10000 * prevClose;
      flows[day] = flowCny / 1e8; // 亿元
    }
    flowsByTicker[ticker] = flows;
  }

  const dateSet = new Set();
  for (const ticker of ALL_TICKERS) for (const day of Object.keys(flowsByTicker[ticker])) dateSet.add(day);
  const dates = [...dateSet].sort();

  const groups = {};
  for (const group of GROUP_KEYS) {
    groups[group] = dates.map(day => {
      const values = TICKER_GROUPS[group]
        .map(ticker => flowsByTicker[ticker][day])
        .filter(Number.isFinite);
      return values.length ? round2(values.reduce((a, b) => a + b, 0)) : null;
    });
  }

  const perTicker = ALL_TICKERS.map(ticker => {
    const flows = flowsByTicker[ticker];
    const tdates = Object.keys(flows).sort();
    const last = tdates.at(-1);
    return {
      ticker,
      group: TICKER_GROUP[ticker],
      date: last ?? null,
      flowYi: last != null ? round2(flows[last]) : null,
    };
  });

  // Full per-ticker series aligned to the shared `dates` axis, so the page
  // can break each group's stacked total down into its constituent tickers.
  const tickerSeries = {};
  for (const ticker of ALL_TICKERS) {
    tickerSeries[ticker] = dates.map(day => (Number.isFinite(flowsByTicker[ticker][day])
      ? flowsByTicker[ticker][day]
      : null));
  }

  return {
    dates, groups, perTicker, tickerSeries, tickerGroups: TICKER_GROUPS, updatedAt: new Date().toISOString(),
  };
}

function readChinaNationalTeamFlow() { return assemble(loadHistory()); }

module.exports = {
  getChinaNationalTeamFlow,
  readChinaNationalTeamFlow,
  TICKER_GROUPS,
  _test: { assemble },
};
