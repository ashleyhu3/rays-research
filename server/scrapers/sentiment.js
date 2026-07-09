'use strict';
const path = require('path');
const storage = require('../storage');
const stocktwitsStore = require('../stocktwitsStore');

/**
 * StockTwits sentiment / posting-volume vs stock-price analysis.
 *
 * Ports the exploratory notebook (Posting Volume vs Stock Price Analysis) into
 * a server scraper: it reads per-day StockTwits message buckets from the Mongo
 * store (stocktwitsStore — `stocktwits_daily`, with a committed-CSV fallback
 * for keyless local dev), joins them to daily prices from Massive
 * (Yahoo fallback), and computes the same volume↔price metrics — plus a
 * bull/bear sentiment dimension the notebook didn't use (each message carries
 * a self-reported sentiment label). The JSON it returns drives the Sentiment
 * dashboard tab.
 *
 * Metrics per ticker (mirrors the notebook):
 *   - weekly series: first close, post volume, bull/bear share, net sentiment
 *   - weekly correlations: volume vs price level / current-week / next-week return
 *   - daily significance: post volume → next-day return (Pearson r + p-value)
 *   - daily significance: net sentiment → next-day return
 *   - summary stats incl. top-quartile-volume win rate
 * Plus a category-average 30-day rolling correlation (the periodicity chart)
 * and a cross-ticker weekly bull/bear aggregate (the headline sentiment trend).
 */

// Categories from the notebook. STX (Seagate) lives in the data dir too — group
// it with storage/memory so its data isn't wasted.
const CATEGORIES = {
  'Memory Semiconductors': ['SNDK', 'MU', 'WDC', 'STX'],
  'Optics':                ['AAOI', 'CIEN', 'LITE', 'COHR', 'GLW', 'APH'],
  'Optics Equipment':      ['TER', 'TSEM', 'VIAV', 'KEYS', 'AEHR'],
  'Semi Equipment':        ['LRCX', 'AMAT', 'KLAC'],
};
const TICKER_CATEGORY = {};
for (const [cat, ts] of Object.entries(CATEGORIES)) for (const t of ts) TICKER_CATEGORY[t] = cat;

const ROLL_WINDOW_DAYS = 30; // calendar days

// Per-UTC-day { count, bull, bear } buckets for one ticker, from the Mongo
// store (`stocktwits_daily`), falling back to the local CSVs when no
// MONGODB_URI is configured (dev).
const loadTicker = ticker => stocktwitsStore.getDailyBuckets(ticker);

// ── Daily closes: Massive (Polygon-compatible) primary, Yahoo fallback ───────
// Massive is our authenticated market-data provider (same key as the options and
// short-interest scrapers), so unlike Yahoo's unofficial endpoint it isn't
// throttled by shared-IP rate limits — the flakiness that used to make this
// whole snapshot fail to recompute and stay frozen for days. Yahoo remains a
// fallback so local dev (no key) and a Massive hiccup degrade gracefully.
const MASSIVE_BASE = 'https://api.massive.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'], fetchOptions: { headers: { 'User-Agent': BROWSER_UA } } });
  }
  return _yf;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isoDay = d => new Date(d).toISOString().slice(0, 10);

// Massive daily bars → Map<'YYYY-MM-DD', close>. Returns null when Massive is
// unavailable (no key or request error) so the caller can fall back to Yahoo;
// returns a (possibly empty) Map when the request itself succeeds.
async function massiveDailyCloses(ticker, start, end) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return null;
  const url = `${MASSIVE_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${isoDay(start)}/${isoDay(end)}`
            + `?adjusted=true&sort=asc&limit=50000`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      if (!res.ok) {
        if (attempt === 3 || res.status !== 429) { console.warn(`[sentiment] massive price ${ticker} HTTP ${res.status}`); return null; }
        await sleep(1200 * attempt); continue;
      }
      const data = await res.json();
      const out = new Map();
      for (const b of data.results ?? []) {
        if (b.c == null || b.t == null) continue;
        out.set(isoDay(b.t), b.c);
      }
      return out;
    } catch (e) {
      if (attempt === 3) { console.warn(`[sentiment] massive price ${ticker} failed:`, e.message); return null; }
      await sleep(1200 * attempt);
    }
  }
  return null;
}

// Yahoo fallback (unofficial endpoint; may be IP-throttled).
async function yahooDailyCloses(ticker, start, end) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await getYF().chart(ticker, { period1: start, period2: end, interval: '1d' });
      const out = new Map(); // 'YYYY-MM-DD' -> close
      for (const q of r.quotes ?? []) {
        if (q.close == null || !q.date) continue;
        out.set(isoDay(q.date), q.close);
      }
      return out;
    } catch (e) {
      if (attempt === 3) { console.warn(`[sentiment] yahoo price ${ticker} failed:`, e.message); return new Map(); }
      await sleep(1200 * attempt);
    }
  }
  return new Map();
}

async function dailyCloses(ticker, start, end) {
  const m = await massiveDailyCloses(ticker, start, end);
  if (m && m.size) return m;
  return yahooDailyCloses(ticker, start, end);
}

// ── Stats ───────────────────────────────────────────────────────────────────
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, base = Math.floor(pos), rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
// Regularized incomplete beta (Numerical Recipes) for the two-sided t p-value.
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function gammaln(x) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
// Two-sided p-value for a Pearson r over n observations.
function corrP(r, n) {
  const df = n - 2;
  if (df <= 0 || r == null) return null;
  if (Math.abs(r) >= 1) return 0;
  const t2 = (r * r) * df / (1 - r * r);
  return betai(df / 2, 0.5, df / (df + t2));
}
// { r, p, n } for paired arrays.
function corr(x, y) {
  const r = pearson(x, y);
  if (r == null) return null;
  return { r: +r.toFixed(4), p: +(corrP(r, x.length) ?? 1).toFixed(4), n: x.length };
}
const pctChange = arr => arr.map((v, i) => (i === 0 || arr[i - 1] === 0 ? null : v / arr[i - 1] - 1));
function weekStart(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ── Per-ticker analysis ─────────────────────────────────────────────────────
function analyzeTicker(ticker, days, closes) {
  const priceDates = [...closes.keys()].sort();
  if (priceDates.length < 5 || days.size === 0) return null;

  // Daily merged (inner join price ∩ posts), chronological.
  const dRows = [];
  for (const date of priceDates) {
    const d = days.get(date);
    if (!d) continue;
    dRows.push({ date, close: closes.get(date), count: d.count, net: (d.bull - d.bear) / d.count });
  }
  if (dRows.length < 10) return null;
  for (let i = 0; i < dRows.length; i++) {
    dRows[i].ret = i === 0 ? null : dRows[i].close / dRows[i - 1].close - 1;
  }
  for (let i = 0; i < dRows.length; i++) dRows[i].retNext = dRows[i + 1] ? dRows[i + 1].ret : null;

  const dValid = dRows.filter(r => Number.isFinite(r.retNext));
  const counts = dValid.map(r => r.count);
  const retsNext = dValid.map(r => r.retNext);
  const nets = dValid.map(r => r.net);

  // Weekly: first close, summed volume, bull/bear shares.
  const wmap = new Map(); // weekStart -> { close(first), count, bull, bear, firstDate }
  for (const date of priceDates) {
    const d = days.get(date);
    if (!d) continue;
    const wk = weekStart(date);
    let w = wmap.get(wk);
    if (!w) { w = { close: closes.get(date), count: 0, bull: 0, bear: 0, firstDate: date }; wmap.set(wk, w); }
    if (date < w.firstDate) { w.firstDate = date; w.close = closes.get(date); }
    w.count += d.count; w.bull += d.bull; w.bear += d.bear;
  }
  const wkeys = [...wmap.keys()].sort();
  const wClose = wkeys.map(k => wmap.get(k).close);
  const wVol   = wkeys.map(k => wmap.get(k).count);
  const wRet   = pctChange(wClose);
  const wRetNext = wRet.map((_, i) => wRet[i + 1] ?? null);

  // Weekly correlations (align on finite pairs).
  const pair = (a, b) => { const xs = [], ys = []; for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) { xs.push(a[i]); ys.push(b[i]); } return [xs, ys]; };
  const [vx1, vy1] = pair(wVol, wClose);
  const [vx2, vy2] = pair(wVol, wRet);
  const [vx3, vy3] = pair(wVol, wRetNext);

  // Summary stats.
  const allCounts = dRows.map(r => r.count);
  const thr = quantile(allCounts, 0.75);
  const hv = dValid.filter(r => r.count >= thr);
  const summary = {
    tradingDays: dRows.length,
    avgPosts:    +mean(allCounts).toFixed(1),
    medianPosts: +median(allCounts).toFixed(1),
    maxPosts:    Math.max(...allCounts),
    avgNextRet:  +(mean(retsNext) * 100).toFixed(2),
    stdNextRet:  +(std(retsNext) * 100).toFixed(2),
    hvDays:      hv.length,
    hvAvgNextRet: hv.length ? +(mean(hv.map(r => r.retNext)) * 100).toFixed(2) : null,
    hvWinRate:   hv.length ? +((hv.filter(r => r.retNext > 0).length / hv.length) * 100).toFixed(1) : null,
  };

  // Rolling correlations over a trailing 30-CALENDAR-day window of daily rows —
  // the time-series form of the three static correlations, one value per trading
  // day. A calendar window (not a fixed count of rows) keeps it a true one-month
  // lookback instead of 30 trading days ≈ 6 calendar weeks (same reasoning as
  // the daily30 cutoff below). Two-pointer since dValid is date-sorted
  // ascending; each window ends the day before its label date, so a point
  // never looks ahead into the day it's plotted on.
  const rollDates = [];
  const rollWindows = [];
  const firstMs = dValid.length ? Date.parse(dValid[0].date + 'T00:00:00Z') : 0;
  for (let end = 0, start = 0; end < dValid.length; end++) {
    const endMs = Date.parse(dValid[end].date + 'T00:00:00Z');
    if (endMs - firstMs < ROLL_WINDOW_DAYS * 86400000) continue; // not a full month of history yet
    const cutoff = endMs - ROLL_WINDOW_DAYS * 86400000;
    while (Date.parse(dValid[start].date + 'T00:00:00Z') <= cutoff) start++;
    rollDates.push(dValid[end].date);
    rollWindows.push(dValid.slice(start, end));
  }
  const rollVals = (fx, fy) => rollWindows.map(win => {
    const r = pearson(win.map(fx), win.map(fy));
    return r == null ? null : +r.toFixed(3);
  });
  const rolling = rollDates.length
    ? {
        dates:    rollDates,
        volPrice: rollVals(r => r.count, r => r.close),
        volNextR: rollVals(r => r.count, r => r.retNext),
        sentNext: rollVals(r => r.net,   r => r.retNext),
      }
    : { dates: [], volPrice: [], volNextR: [], sentNext: [] };

  return {
    category: TICKER_CATEGORY[ticker],
    totalPosts: [...days.values()].reduce((s, d) => s + d.count, 0),
    weeks: wkeys.length,
    rolling,
    // Daily lead–lag scatter points: post count vs the NEXT day's return (%).
    scatter: {
      count: dValid.map(r => r.count),
      ret:   dValid.map(r => +(r.retNext * 100).toFixed(3)),
    },
    weekly: {
      dates:   wkeys,
      price:   wClose.map(v => (v == null ? null : +v.toFixed(2))),
      volume:  wVol,
      bullPct: wkeys.map(k => { const w = wmap.get(k); return w.count ? +((w.bull / w.count) * 100).toFixed(1) : null; }),
      bearPct: wkeys.map(k => { const w = wmap.get(k); return w.count ? +((w.bear / w.count) * 100).toFixed(1) : null; }),
      net:     wkeys.map(k => { const w = wmap.get(k); return w.count ? +(((w.bull - w.bear) / w.count) * 100).toFixed(1) : null; }),
    },
    corr: {
      priceLevel:  corr(vx1, vy1),
      currReturn:  corr(vx2, vy2),
      nextReturn:  corr(vx3, vy3),
    },
    daily: {
      volNextR:  corr(counts, retsNext),
      sentNextR: corr(nets, retsNext),
    },
    // Trailing 30 CALENDAR days of daily post count vs price (days that have
    // both a price close and ≥1 post), anchored to TODAY (UTC) — the rolling
    // 30-day window, e.g. on 07-07 it spans 06-07 → 07-07. Anchoring to today
    // (not the most recent data date) keeps the window honest even if a
    // ticker's data lags; a calendar cutoff (not the last 30 rows) keeps it a
    // true one-month window instead of 30 trading days ≈ 6 calendar weeks.
    daily30: (() => {
      if (!dRows.length) return { dates: [], price: [], volume: [] };
      const cutoff = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') - 30 * 86400000;
      const win = dRows.filter(r => Date.parse(r.date + 'T00:00:00Z') >= cutoff);
      return {
        dates:  win.map(r => r.date),
        price:  win.map(r => (r.close == null ? null : +r.close.toFixed(2))),
        volume: win.map(r => r.count),
      };
    })(),
    summary,
  };
}

// Category-average of a per-ticker rolling series (field = volPrice | volNextR
// | sentNext), over the dates the category's tickers share.
function rollingByCategory(byTicker, field) {
  const byCategory = {};
  for (const [cat, tickers] of Object.entries(CATEGORIES)) {
    const series = tickers
      .map(t => byTicker[t]?.rolling)
      .filter(r => r && r.dates.length)
      .map(r => Object.fromEntries(r.dates.map((d, i) => [d, r[field][i]])));
    if (series.length === 0) continue;
    let common = null;
    for (const s of series) {
      const keys = new Set(Object.keys(s));
      common = common == null ? keys : new Set([...common].filter(d => keys.has(d)));
    }
    const dates = [...(common ?? [])].sort();
    if (!dates.length) continue;
    byCategory[cat] = {
      dates,
      values: dates.map(d => {
        const vals = series.map(s => s[d]).filter(v => v != null);
        return vals.length ? +mean(vals).toFixed(3) : null;
      }),
    };
  }
  return byCategory;
}

// Cross-ticker weekly bull/bear aggregate (the headline sentiment trend).
function weeklyAggregate(byTicker) {
  const wk = new Map(); // weekStart -> { bull, bear, count }
  for (const t of Object.values(byTicker)) {
    const w = t.weekly;
    for (let i = 0; i < w.dates.length; i++) {
      const vol = w.volume[i] || 0;
      const bull = w.bullPct[i] != null ? (w.bullPct[i] / 100) * vol : 0;
      const bear = w.bearPct[i] != null ? (w.bearPct[i] / 100) * vol : 0;
      let a = wk.get(w.dates[i]);
      if (!a) { a = { bull: 0, bear: 0, count: 0 }; wk.set(w.dates[i], a); }
      a.bull += bull; a.bear += bear; a.count += vol;
    }
  }
  const dates = [...wk.keys()].sort();
  return {
    dates,
    bullPct: dates.map(d => { const a = wk.get(d); return a.count ? +((a.bull / a.count) * 100).toFixed(1) : null; }),
    bearPct: dates.map(d => { const a = wk.get(d); return a.count ? +((a.bear / a.count) * 100).toFixed(1) : null; }),
    volume:  dates.map(d => Math.round(wk.get(d).count)),
  };
}

// Recompute is heavy (CSV parse + ~17 Massive price fetches), so a stored
// snapshot is served when it's recent. Scheduled refreshers force a real
// recompute (see getSentimentData); a cold web request stays instant.
const STORE_FILE = path.join(__dirname, '..', 'data', 'sentiment.json');
const BLOB = 'sentimentData';
const MAX_AGE_DAYS = 3;

function readStored() {
  try {
    const v = storage.read(BLOB, STORE_FILE);
    if (!v?.asOf || !v.tickers) return null;
    const ageDays = (Date.now() - Date.parse(v.asOf + 'T00:00:00Z')) / 86400000;
    return ageDays <= MAX_AGE_DAYS ? v : null;
  } catch { return null; }
}

async function getSentimentData({ force = false } = {}) {
  // The web route calls this without force and serves a recent snapshot cheaply.
  // The always-on collector sets SENTIMENT_FORCE=1 to bypass the freshness gate
  // so the snapshot genuinely recomputes each run (the daily-update path). The
  // old default — no forced caller — meant a <3-day-old snapshot short-circuited
  // every refresh, so the data could never advance more than once every 4 days.
  const forced = force || process.env.SENTIMENT_FORCE === '1';
  const fresh = forced ? null : readStored();
  if (fresh) return fresh;
  const data = await computeSentiment();
  storage.write(BLOB, STORE_FILE, data);
  return data;
}

async function computeSentiment() {
  // Prior snapshot: reused per-ticker when a price fetch fails, so one flaky
  // symbol (or a transient outage) degrades that ticker only instead of wiping
  // the whole snapshot.
  let prev = null;
  try { const v = storage.read(BLOB, STORE_FILE); if (v?.tickers) prev = v; } catch {}

  const tickers = Object.values(CATEGORIES).flat();
  const byTicker = {};
  let freshCount = 0;
  for (const ticker of tickers) {
    const days = await loadTicker(ticker);
    if (!days) {
      if (prev?.tickers?.[ticker]) byTicker[ticker] = prev.tickers[ticker];
      else console.warn(`[sentiment] no CSV for ${ticker}`);
      continue;
    }
    const dates = [...days.keys()].sort();
    const start = dates[0];
    const endD = new Date(dates[dates.length - 1] + 'T00:00:00Z');
    endD.setUTCDate(endD.getUTCDate() + 7);
    const end = endD.toISOString().slice(0, 10);
    const closes = await dailyCloses(ticker, start, end);
    await sleep(250); // be gentle with the price API
    const res = closes.size ? analyzeTicker(ticker, days, closes) : null;
    if (res) {
      byTicker[ticker] = res;
      freshCount++;
    } else if (prev?.tickers?.[ticker]) {
      byTicker[ticker] = prev.tickers[ticker];
      console.warn(`[sentiment] ${ticker}: price fetch failed — kept previous snapshot`);
    } else {
      console.warn(`[sentiment] ${ticker}: no price data and no prior snapshot — dropped`);
    }
  }
  // Never overwrite a good snapshot with a fully-stale one: if not a single
  // ticker refreshed, throw so the caller keeps the previous blob and retries.
  if (freshCount === 0) throw new Error('sentiment: no tickers refreshed (all price fetches failed)');

  const rolling = {
    window: ROLL_WINDOW_DAYS,
    byMetric: {
      volPrice: rollingByCategory(byTicker, 'volPrice'),
      volNextR: rollingByCategory(byTicker, 'volNextR'),
      sentNext: rollingByCategory(byTicker, 'sentNext'),
    },
  };
  const aggregate = weeklyAggregate(byTicker);

  return {
    asOf: new Date().toISOString().slice(0, 10),
    categories: CATEGORIES,
    tickers: byTicker,
    rolling,
    aggregate,
  };
}

module.exports = { getSentimentData, CATEGORIES };
