/**
 * Korean retail firepower — four leveraged layers of household money in the
 * KOSPI/KOSDAQ, in trillions of won (조원), one point per trading day.
 *
 *   deposit  투자자예탁금        cash parked at brokers, ready to buy
 *   cma      CMA 잔고           sweep accounts (the innermost, least-levered layer)
 *   margin   신용거래융자        broker margin loans
 *   etf      레버리지 ETF 순자산  2× ETFs (index + the single-stock ones opened up
 *                               in May 2026, which now dominate the layer)
 *
 * Both sources are anonymous JSON APIs — no key, no login.
 *
 * KOFIA (freesis.kofia.or.kr) — the industry body's free statistics portal. Its
 * eXBuilder front-end posts every table through one endpoint,
 * /meta/getMetaDataList.do, keyed by OBJ_NM. Two traps:
 *   • tmpV40/tmpV41 is the unit divisor, and the backend divides the raw won
 *     figure by the *literal code value*, not by the power of ten the code
 *     labels (code "12" = 조 divides by 12, not 1e12). Passing "01" divides by
 *     one, i.e. returns raw won — the only value we can reason about.
 *   • omit the divisor entirely and every money column comes back null while
 *     the percentage columns still populate, so the response looks healthy.
 * KOFIA publishes with a 1–3 day lag; the ETF layer is same-day.
 *
 * Daum Finance — /api/quote/{code}/days carries listedSharesCount per day, so a
 * fund's AUM on any past day is price × shares that day. That makes the whole
 * ETF layer exactly reconstructable from listing, with no estimation.
 */
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'koreaLeverageHistory.json');
const BLOB = 'koreaLeverageHistory';

const TRILLION = 1e12;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ── KOFIA ─────────────────────────────────────────────────────────── */

const KOFIA_URL = 'https://freesis.kofia.or.kr/meta/getMetaDataList.do';

// OBJ_NM → the one column we want out of each table.
const KOFIA_SERIES = {
  deposit: { obj: 'STATSCU0100000060BO', col: 'TMPV2', name: '증시자금추이 · 투자자예탁금' },
  margin:  { obj: 'STATSCU0100000070BO', col: 'TMPV2', name: '신용공여 잔고추이 · 신용거래융자(전체)' },
  cma:     { obj: 'STATSCU0100000110BO', col: 'TMPV7', name: '운용대상별 CMA잔고 추이 · 합계', extra: { tmpV59: '' } },
};

async function kofiaSeries(key, from, to) {
  const spec = KOFIA_SERIES[key];
  const res = await fetch(KOFIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Referer': 'https://freesis.kofia.or.kr/',
      'User-Agent': UA,
    },
    body: JSON.stringify({
      dmSearch: {
        OBJ_NM: spec.obj,
        tmpV1: 'D',          // 자료주기: daily
        tmpV45: from,        // yyyyMMdd
        tmpV46: to,
        tmpV40: '01',        // unit divisor — "01" → divide by 1 → raw won
        tmpV41: '01',
        ...(spec.extra ?? {}),
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`KOFIA ${key} HTTP ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const row of json.ds1 ?? []) {
    const day = String(row.TMPV1 ?? '');
    const won = row[spec.col];
    if (!/^\d{8}$/.test(day) || !Number.isFinite(won)) continue;
    out[`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`] = won / TRILLION;
  }
  if (!Object.keys(out).length) throw new Error(`KOFIA ${key} returned no rows`);
  return out;
}

/* ── Daum: leveraged ETF net assets ────────────────────────────────── */

const DAUM_HEADERS = { 'User-Agent': UA, 'Referer': 'https://finance.daum.net/domestic/all_etfs' };

// The layer is the 2× funds a Korean retail investor can actually buy:
//   • every 단일종목레버리지 (single-stock 2×, incl. the futures-based ones) —
//     in practice all Samsung Electronics / SK Hynix, i.e. the memory trade
//   • the two plain KOSPI200 2× funds, which are the layer's whole history
//     before the single-stock funds opened on 2026-05-27
// CSOP 7709.HK (the HK-listed SK Hynix 2×) is deliberately excluded: it has no
// free daily AUM feed, and guessing it would put an estimate inside a layer
// that is otherwise measured.
const INDEX_LEVERAGE = new Set(['A122630', 'A123320']);   // KODEX 레버리지, TIGER 레버리지
const isSingleStock = name => name.includes('단일종목레버리지');

async function daumJson(url) {
  const res = await fetch(url, { headers: DAUM_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Daum HTTP ${res.status} for ${url}`);
  return res.json();
}

async function leverageUniverse() {
  const json = await daumJson('https://finance.daum.net/api/etfs?page=1&perPage=1000&fieldName=marketCap&order=desc&pagination=true');
  const funds = (json.data ?? [])
    .filter(r => isSingleStock(r.name) || INDEX_LEVERAGE.has(r.symbolCode))
    .map(r => ({ code: r.symbolCode, name: r.name, kind: isSingleStock(r.name) ? 'single' : 'index' }));
  if (!funds.length) throw new Error('Daum ETF list returned no leveraged funds');
  return funds;
}

// Daily AUM (조원) for one fund back to `from`, straight from price × shares.
// Daum pages 100 trading days at a time and keeps serving shares counts many
// years deep, so the cap is only a runaway guard: 40 pages ≈ 16 years, far past
// the oldest fund here (KODEX 레버리지, listed 2010).
async function fundHistory(code, from) {
  const out = {};
  for (let page = 1; page <= 40; page++) {
    const json = await daumJson(`https://finance.daum.net/api/quote/${code}/days?symbolCode=${code}&page=${page}&perPage=100&pagination=true`);
    const rows = json.data ?? [];
    for (const r of rows) {
      const day = String(r.date ?? '').slice(0, 10);
      if (!day || day < from) continue;
      if (!Number.isFinite(r.tradePrice) || !Number.isFinite(r.listedSharesCount)) continue;
      out[day] = (r.tradePrice * r.listedSharesCount) / TRILLION;
    }
    const oldest = String(rows[rows.length - 1]?.date ?? '').slice(0, 10);
    if (rows.length < 100 || (oldest && oldest < from)) break;
  }
  return out;
}

// Small pool — Daum tolerates this comfortably, but a 16-fund × 3-page burst
// with no lid is exactly the shape that gets an IP throttled.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/* ── History blob ──────────────────────────────────────────────────── */

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

const iso = d => d.toISOString().slice(0, 10);
const compact = day => day.replace(/-/g, '');

/**
 * Scrape the last `days` calendar days of all four layers, merge into history,
 * and return the assembled series.
 *
 * days defaults to a month: enough to repair a gap after the site was asleep,
 * small enough to stay a light daily poll. The backfill script passes ~400.
 */
async function getKoreaLeverage(days = 30) {
  const today = new Date();
  const start = new Date(today.getTime() - days * 86400000);
  const from = iso(start);

  const [kofia, funds] = await Promise.all([
    Promise.all(Object.keys(KOFIA_SERIES).map(k => kofiaSeries(k, compact(from), compact(iso(today)))))
      .then(([deposit, margin, cma]) => ({ deposit, margin, cma })),
    leverageUniverse(),
  ]);

  const fundSeries = await mapPool(funds, 4, f => fundHistory(f.code, from));

  const history = loadHistory();
  const days_ = new Set([
    ...Object.keys(kofia.deposit), ...Object.keys(kofia.margin), ...Object.keys(kofia.cma),
    ...fundSeries.flatMap(s => Object.keys(s)),
  ]);

  for (const day of days_) {
    const prev = history[day] ?? {};
    const perFund = {};
    funds.forEach((f, i) => {
      const aum = fundSeries[i][day];
      if (Number.isFinite(aum)) perFund[f.code] = round(aum);
    });
    const etfDay = Object.keys(perFund).length
      ? round(Object.values(perFund).reduce((a, b) => a + b, 0))
      : prev.etf;

    history[day] = {
      ...prev,
      ...(Number.isFinite(kofia.deposit[day]) ? { deposit: round(kofia.deposit[day]) } : {}),
      ...(Number.isFinite(kofia.cma[day])     ? { cma:     round(kofia.cma[day])     } : {}),
      ...(Number.isFinite(kofia.margin[day])  ? { margin:  round(kofia.margin[day])  } : {}),
      ...(Number.isFinite(etfDay) ? { etf: etfDay, funds: { ...(prev.funds ?? {}), ...perFund } } : {}),
    };
  }
  saveHistory(history);

  return assemble(history, funds);
}

function round(v) { return Math.round(v * 100) / 100; }

/**
 * Turn the history blob into the payload the Leverage page draws.
 *
 * KOFIA lags the ETF layer by 1–3 days, so the newest days would otherwise show
 * a stack that collapses to just the ETF layer. Those trailing days carry the
 * last published value forward and are named in `carriedFrom` so the page can
 * say so rather than quietly implying the money moved.
 */
function assemble(history, funds = []) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const layers = { deposit: [], cma: [], margin: [], etf: [] };
  const last = {};
  const carried = { deposit: null, cma: null, margin: null, etf: null };

  for (const day of dates) {
    for (const key of Object.keys(layers)) {
      const v = history[day]?.[key];
      if (Number.isFinite(v)) { last[key] = v; carried[key] = null; }
      else if (Number.isFinite(last[key]) && carried[key] == null) carried[key] = day;
      layers[key].push(Number.isFinite(last[key]) ? last[key] : null);
    }
  }

  const total = dates.map((_, i) =>
    ['deposit', 'cma', 'margin', 'etf'].reduce((s, k) => s + (layers[k][i] ?? 0), 0));

  // Latest per-fund breakdown, biggest first — the tiles above the chart.
  const lastDay = [...dates].reverse().find(d => history[d]?.funds);
  const perFund = history[lastDay]?.funds ?? {};
  const byName = Object.fromEntries(funds.map(f => [f.code, f]));
  const fundRows = Object.entries(perFund)
    .map(([code, aum]) => ({ code, name: byName[code]?.name ?? code, kind: byName[code]?.kind ?? 'single', aum }))
    .sort((a, b) => b.aum - a.aum);

  return {
    dates,
    ...layers,
    total: total.map(round),
    funds: fundRows,
    fundsDate: lastDay ?? null,
    // Days whose layer value is the previous publication carried forward.
    carriedFrom: carried,
    latest: {
      date: dates[dates.length - 1] ?? null,
      ...Object.fromEntries(Object.keys(layers).map(k => [k, layers[k][dates.length - 1] ?? null])),
      total: round(total[total.length - 1] ?? 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

// Read-only view of the stored history (no scrape) — used by the API route when
// the cache is warm and by anything that just wants the series.
function readKoreaLeverage() {
  return assemble(loadHistory());
}

module.exports = { getKoreaLeverage, readKoreaLeverage };
