/**
 * Korean retail firepower — the leveraged layers of household money in the
 * KOSPI/KOSDAQ, in trillions of won (조원), one point per trading day.
 *
 *   margin      신용거래융자        broker margin loans
 *   collateral  예탁증권 담보융자    loans against pledged securities — the quieter
 *                                  cousin of margin: same borrowing, but the
 *                                  cash can leave the account
 *   etf         레버리지 ETF 순자산  2× ETFs (index + the single-stock ones opened
 *                                  up in May 2026, which now dominate the layer)
 *
 * Only borrowed money is charted. The cash layers KOFIA also publishes
 * (투자자예탁금 broker deposits, CMA sweep balances) are not leverage — they are
 * dry powder — and were removed from the stack.
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

// Both credit layers come out of one table (신용공여 잔고 추이) — its columns are
// 신용거래융자(전체) and, at the far right, 예탁증권 담보융자.
const KOFIA_MARGIN_TABLE = {
  obj: 'STATSCU0100000070BO',
  cols: { margin: 'TMPV2', collateral: 'TMPV9' },
};

async function kofiaCredit(from, to) {
  const spec = KOFIA_MARGIN_TABLE;
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
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`KOFIA credit HTTP ${res.status}`);
  const json = await res.json();
  const out = { margin: {}, collateral: {} };
  for (const row of json.ds1 ?? []) {
    const raw = String(row.TMPV1 ?? '');
    if (!/^\d{8}$/.test(raw)) continue;
    const day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    for (const [key, col] of Object.entries(spec.cols)) {
      const won = row[col];
      if (Number.isFinite(won)) out[key][day] = won / TRILLION;
    }
  }
  if (!Object.keys(out.margin).length) throw new Error('KOFIA credit returned no rows');
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

// Daum only publishes the Korean fund name. The dashboard reads in English, so
// each name is rendered from its parts (the issuer brand is left as-is — KODEX
// and TIGER are the brands, not Korean words).
const TERMS = [
  [/SK하이닉스/g, 'SK Hynix'],
  [/삼성전자/g, 'Samsung Electronics'],
  [/선물/g, 'Futures'],
  [/단일종목레버리지/g, 'Single-Stock 2×'],
  [/레버리지/g, 'KOSPI200 2×'],
];

function englishName(name) {
  let out = name;
  for (const [re, en] of TERMS) out = out.replace(re, ` ${en} `);
  return out.replace(/\s+/g, ' ').trim();
}

async function leverageUniverse() {
  const json = await daumJson('https://finance.daum.net/api/etfs?page=1&perPage=1000&fieldName=marketCap&order=desc&pagination=true');
  const funds = (json.data ?? [])
    .filter(r => isSingleStock(r.name) || INDEX_LEVERAGE.has(r.symbolCode))
    .map(r => ({
      code: r.symbolCode,
      name: englishName(r.name),
      nameKo: r.name,
      kind: isSingleStock(r.name) ? 'single' : 'index',
    }));
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

  const [credit, funds] = await Promise.all([
    kofiaCredit(compact(from), compact(iso(today))),
    leverageUniverse(),
  ]);

  const fundSeries = await mapPool(funds, 4, f => fundHistory(f.code, from));

  const history = loadHistory();
  const days_ = new Set([
    ...Object.keys(credit.margin), ...Object.keys(credit.collateral),
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
      ...(Number.isFinite(credit.margin[day])     ? { margin:     round(credit.margin[day])     } : {}),
      ...(Number.isFinite(credit.collateral[day]) ? { collateral: round(credit.collateral[day]) } : {}),
      ...(Number.isFinite(etfDay) ? { etf: etfDay, funds: { ...(prev.funds ?? {}), ...perFund } } : {}),
    };
  }
  // Names live alongside the series so a read-only assemble (no scrape) can
  // still label the fund table.
  history.names = Object.fromEntries(funds.map(f => [f.code, { name: f.name, kind: f.kind }]));
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
  const layers = { collateral: [], margin: [], etf: [] };
  const last = {};
  const carried = { collateral: null, margin: null, etf: null };

  // Rebuild the ETF layer fund-by-fund rather than trusting the stored daily
  // total: if a fund is missing from a day's scrape, summing only the funds that
  // did report invents a drop in the layer that is really a data gap. Carry each
  // fund's own last value, and count a fund only from the day it first appears —
  // so a fund that hasn't listed yet reads as absent, not as zero.
  const etfByDay = {};
  const lastAum = {};
  for (const day of dates) {
    for (const [code, aum] of Object.entries(history[day]?.funds ?? {})) {
      if (Number.isFinite(aum)) lastAum[code] = aum;
    }
    const codes = Object.keys(lastAum);
    if (codes.length) etfByDay[day] = round(codes.reduce((s, c) => s + lastAum[c], 0));
  }

  for (const day of dates) {
    for (const key of Object.keys(layers)) {
      const v = key === 'etf' ? etfByDay[day] : history[day]?.[key];
      if (Number.isFinite(v)) { last[key] = v; carried[key] = null; }
      else if (Number.isFinite(last[key]) && carried[key] == null) carried[key] = day;
      layers[key].push(Number.isFinite(last[key]) ? last[key] : null);
    }
  }

  const total = dates.map((_, i) =>
    ['collateral', 'margin', 'etf'].reduce((s, k) => s + (layers[k][i] ?? 0), 0));

  // Latest per-fund breakdown, biggest first — the tiles above the chart. Uses
  // each fund's last known value, matching how the layer itself is summed.
  const lastDay = [...dates].reverse().find(d => history[d]?.funds);
  const byName = { ...(history.names ?? {}), ...Object.fromEntries(funds.map(f => [f.code, f])) };
  const fundRows = Object.entries(lastAum)
    .map(([code, aum]) => ({ code, name: byName[code]?.name ?? code, kind: byName[code]?.kind ?? 'single', aum: round(aum) }))
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
