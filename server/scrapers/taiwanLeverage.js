/**
 * Taiwan retail firepower — the leveraged layers of household money in the
 * TWSE/TPEx market, in 億元 (hundred-million NT$), one point per trading day.
 *
 *   margin  融資餘額        broker margin loans — listed (TWSE) + OTC (TPEx)
 *   etf     槓桿 ETF 淨資產  net assets of the 2× ("正2") ETFs
 *
 * Sources, and why each one:
 *
 * • Margin, listed — TWSE MI_MARGN publishes 融資金額 in money terms, daily.
 *   FinMind mirrors the identical figure over a date range (one request for any
 *   window, where TWSE is one request per day), so it carries the history while
 *   TWSE itself is re-read for the newest days.
 *
 * • Margin, OTC — TPEx's 融資餘額 table is per-stock and quoted in lots, but its
 *   *summary* rows carry 融資金(仟元): the OTC market's margin balance in money.
 *   This is a whole borrowing market — roughly a quarter of Taiwan's margin debt
 *   — and leaving it out understates the layer badly. TPEx has no range query,
 *   so history costs one request per day (~3s per 5 dates; fine for a backfill).
 *
 * • ETF — Yuanta's own API returns FUND_SIZE, the fund's exact net assets, per
 *   day, five years deep, for every 2× fund it issues. That is the authoritative
 *   number (units × NAV only approximates it, since published NAV is rounded).
 *   The other issuers of Taiwan 2× funds have no usable daily history: Cathay
 *   exposes no date-queryable endpoint and Capital sits behind bot protection.
 *   So the layer is Yuanta's 2× funds — the largest issuer, and 00631L alone is
 *   about two thirds of all Taiwan 2× assets. `etfMarketTotal` records the whole
 *   listed 2× market for the current day (TWSE's live feed) purely so the page
 *   can state what share of it this layer actually covers, instead of implying
 *   the layer is the whole market.
 *
 * There is deliberately no cash layer and no short band: Taiwan publishes no
 * daily customer-cash aggregate, and short balances are reported in lots, which
 * cannot be stacked onto a money axis.
 */
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'taiwanLeverageHistory.json');
const BLOB = 'taiwanLeverageHistory';

const OKU = 1e8;   // 億 — the unit Taiwan quotes
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Margin: TWSE (listed) ─────────────────────────────────────────── */

async function finmindListedMargin(from, to) {
  const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockTotalMarginPurchaseShortSale&start_date=${from}&end_date=${to}`
    + (process.env.FINMIND_TOKEN ? `&token=${process.env.FINMIND_TOKEN}` : '');
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`FinMind HTTP ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const row of json.data ?? []) {
    if (row.name !== 'MarginPurchaseMoney') continue;
    const bal = Number(row.TodayBalance);
    if (Number.isFinite(bal) && row.date) out[row.date] = bal / OKU;
  }
  if (!Object.keys(out).length) throw new Error('FinMind returned no margin rows');
  return out;
}

// TWSE MI_MARGN — the authoritative table, one date per call. "融資金額(仟元)" is
// thousands of NT$; its last column is today's balance.
async function twseListedMargin(day) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${day.replace(/-/g, '')}&selectType=MS&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.twse.com.tw/' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
  const json = await res.json();
  if (json.stat !== 'OK') return null;                   // market closed
  const row = (json.tables?.[0]?.data ?? []).find(r => String(r[0]).includes('融資金額'));
  if (!row) return null;
  const thousands = Number(String(row[row.length - 1]).replace(/,/g, ''));
  return Number.isFinite(thousands) ? (thousands * 1000) / OKU : null;
}

/* ── Margin: TPEx (OTC) ────────────────────────────────────────────── */

// The per-stock table is in lots; the summary block underneath it carries the
// money row. Column 6 of that row ("資餘額") is the closing balance.
async function tpexOtcMargin(day) {
  const [y, m, d] = day.split('-');
  const url = `https://www.tpex.org.tw/www/zh-tw/margin/balance?date=${y}%2F${m}%2F${d}&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.tpex.org.tw/' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`TPEx HTTP ${res.status}`);
  const json = await res.json();
  const summary = json.tables?.[0]?.summary ?? [];
  const row = summary.find(r => typeof r?.[1] === 'string' && r[1].includes('融資金'));
  if (!row) return null;                                  // market closed / no data
  const thousands = Number(String(row[6]).replace(/,/g, ''));
  return Number.isFinite(thousands) ? (thousands * 1000) / OKU : null;
}

/* ── Leveraged ETFs: Yuanta ────────────────────────────────────────── */

// Yuanta's front-end calls this with a device UUID; a malformed one is rejected
// as "Bad Request", so keep a well-formed constant here.
const YUANTA_API = 'https://etfapi.yuantaetfs.com/ectranslation/api/trans';
const YUANTA_DEVICE = '9ba170bb-6dfc-4efc-8d67-30b9423937f0';

// Every 2× fund Yuanta issues (including the futures-based ones, which trade
// under the 期元大 brand but answer on the same API).
const YUANTA_FUNDS = ['00631L', '00637L', '00647L', '00680L', '00683L', '00706L', '00708L'];

async function yuantaFund(code, from, to) {
  const q = new URLSearchParams({
    APIType: 'ETFBackstage', CompanyName: 'YUANTAFUNDS', PageName: '/tradeInfo',
    DeviceId: YUANTA_DEVICE, FuncId: 'ETFNAV/GetComparison', AppName: 'ETF',
    Device: '4', Platform: 'ETF',
    stk_cd: code, SDATE: from.replace(/-/g, ''), EDATE: to.replace(/-/g, ''),
  });
  const res = await fetch(`${YUANTA_API}?${q}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.yuantaetfs.com/' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Yuanta ${code} HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.Data) ? json.Data : [];
  const out = {};
  let name = code;
  for (const r of rows) {
    const day = String(r.TRAN_DATE ?? '').slice(0, 10);
    const size = Number(r.FUND_SIZE);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(size) || size <= 0) continue;
    out[day] = size / OKU;                                // FUND_SIZE is the exact AUM
    if (r.STK_NAME) name = r.STK_NAME;
  }
  return { name: englishName(name), days: out };
}

const TERMS = [
  [/期元大/g, 'Yuanta Futures'], [/元大/g, 'Yuanta'],
  [/台灣50/g, 'Taiwan 50'], [/[臺台]灣加權/g, 'TAIEX'], [/滬深300/g, 'CSI 300'],
  [/美債20/g, 'US 20Y Treasury'], [/美元指/g, 'US Dollar Index'],
  [/S&P黃金/g, 'S&P Gold'], [/S&P日圓/g, 'S&P Yen'], [/正2/g, '2×'],
];

function englishName(name) {
  let out = name;
  for (const [re, en] of TERMS) out = out.replace(re, ` ${en} `);
  return out.replace(/\s+/g, ' ').trim();
}

/* ── Whole listed 2× market (today only) ───────────────────────────── */

// TWSE's market-information feed: `c` = units outstanding, `e` = NAV. Used only
// to size the Yuanta layer against the full 2× market on the page.
async function listedEtfMarketTotal() {
  const res = await fetch('https://mis.twse.com.tw/stock/data/all_etf.txt', {
    headers: { 'User-Agent': UA, 'Referer': 'https://mis.twse.com.tw/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`TWSE ETF feed HTTP ${res.status}`);
  const json = await res.json();
  let total = 0, day = null;
  for (const group of json.a1 ?? []) {
    for (const r of group.msgArray ?? []) {
      const name = r.b ?? '';
      if (!name.includes('正向2倍') && !name.includes('正2')) continue;
      const units = Number(r.c), nav = Number(r.e);
      if (!Number.isFinite(units) || !Number.isFinite(nav) || units <= 0 || nav <= 0) continue;
      total += (units * nav) / OKU;
      if (/^\d{8}$/.test(r.i ?? '')) day = `${r.i.slice(0, 4)}-${r.i.slice(4, 6)}-${r.i.slice(6)}`;
    }
  }
  return total > 0 ? { day, total: round(total) } : null;
}

/* ── History blob ──────────────────────────────────────────────────── */

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }
function round(v) { return Math.round(v * 10) / 10; }

const iso = d => d.toISOString().slice(0, 10);

/**
 * Scrape the last `days` days of every layer, merge into history, and return the
 * assembled series. The backfill script passes ~1830 (five years).
 *
 * TPEx has no range query, so it is fetched one day at a time — the only slow
 * part of the run, and the reason `days` defaults to a month for the daily poll.
 */
async function getTaiwanLeverage(days = 30) {
  const today = new Date();
  const from = iso(new Date(today.getTime() - days * 86400000));
  const to = iso(today);

  const [listed, etfFunds, marketTotal] = await Promise.all([
    // FinMind is a convenience — it serves TWSE's own figure over a whole range
    // in one request — but it is a free tier that rate-limits (402). It must not
    // be able to take the scrape down with it: TWSE, TPEx and Yuanta are the
    // sources that matter, and TWSE can supply the listed balance day by day.
    finmindListedMargin(from, to).catch(e => {
      console.warn(`[taiwanLeverage] FinMind unavailable (${e.message}) — falling back to TWSE per-day`);
      return {};
    }),
    Promise.all(YUANTA_FUNDS.map(c => yuantaFund(c, from, to).catch(e => {
      console.warn(`[taiwanLeverage] Yuanta ${c}: ${e.message}`);
      return { name: c, days: {} };
    }))),
    listedEtfMarketTotal().catch(e => { console.warn('[taiwanLeverage] ETF market feed:', e.message); return null; }),
  ]);

  const history = loadHistory();

  // Which days to work on. FinMind's keys are the trading calendar when it
  // answers; without it, fall back to every calendar day in the window (TWSE and
  // TPEx simply return nothing for a closed day).
  const calendar = [];
  for (let t = new Date(`${from}T00:00:00Z`); t <= today; t = new Date(t.getTime() + 86400000)) {
    const d = iso(t);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) calendar.push(d);
  }
  const tradingDays = Object.keys(listed).length ? Object.keys(listed).sort() : calendar;

  // The newest listed-margin days come straight from TWSE, so the live edge of
  // the chart is the exchange's own number rather than a mirror's copy.
  for (const day of tradingDays.slice(-3)) {
    try {
      const v = await twseListedMargin(day);
      if (Number.isFinite(v)) listed[day] = v;
    } catch (e) {
      console.warn(`[taiwanLeverage] TWSE ${day}: ${e.message}`);
    }
  }

  // Any day still without a listed balance — because FinMind was rate-limited —
  // is fetched from TWSE directly. This must be driven by what is *missing*, not
  // by whether `listed` is empty: the three re-reads above always leave it
  // non-empty, and an emptiness check let a rate-limited run write a history that
  // was OTC-only before the last few weeks, which drew the margin band stepping
  // up fourfold on the day the listed series happened to begin.
  const missingListed = tradingDays.filter(
    d => !Number.isFinite(listed[d]) && !Number.isFinite(history[d]?.marginListed));
  if (missingListed.length > 5) console.log(`[taiwanLeverage] TWSE: filling ${missingListed.length} missing listed-margin days…`);
  let listedOk = 0;
  for (const day of missingListed) {
    try {
      const v = await twseListedMargin(day);
      if (Number.isFinite(v)) { listed[day] = v; listedOk++; }
    } catch (e) {
      console.warn(`[taiwanLeverage] TWSE ${day}: ${e.message}`);
    }
    await sleep(200);
  }
  if (missingListed.length > 5) console.log(`[taiwanLeverage] TWSE: got ${listedOk}/${missingListed.length}`);

  // TPEx: one request per trading day. Skip days already stored, so the daily
  // poll costs a couple of requests and only a backfill pays the full price.
  const needOtc = tradingDays.filter(d => !Number.isFinite(history[d]?.marginOtc));
  if (needOtc.length > 5) console.log(`[taiwanLeverage] TPEx: fetching ${needOtc.length} days…`);
  let otcOk = 0;
  for (const day of needOtc) {
    try {
      const v = await tpexOtcMargin(day);
      if (Number.isFinite(v)) {
        history[day] = { ...(history[day] ?? {}), marginOtc: round(v) };
        otcOk++;
      }
    } catch (e) {
      console.warn(`[taiwanLeverage] TPEx ${day}: ${e.message}`);
    }
    await sleep(120);                                     // be a good citizen
  }
  if (needOtc.length > 5) console.log(`[taiwanLeverage] TPEx: got ${otcOk}/${needOtc.length}`);

  for (const [day, value] of Object.entries(listed)) {
    history[day] = { ...(history[day] ?? {}), marginListed: round(value) };
  }

  const names = {};
  etfFunds.forEach((f, i) => { names[YUANTA_FUNDS[i]] = f.name; });
  const etfDays = new Set(etfFunds.flatMap(f => Object.keys(f.days)));
  for (const day of etfDays) {
    const perFund = {};
    etfFunds.forEach((f, i) => {
      const aum = f.days[day];
      if (Number.isFinite(aum)) perFund[YUANTA_FUNDS[i]] = round(aum);
    });
    if (!Object.keys(perFund).length) continue;
    history[day] = {
      ...(history[day] ?? {}),
      etf: round(Object.values(perFund).reduce((a, b) => a + b, 0)),
      funds: perFund,
    };
  }
  history.names = names;
  if (marketTotal?.day) {
    history.etfMarket = marketTotal;                      // whole 2× market, today
  }

  saveHistory(history);
  return assemble(history);
}

/**
 * Turn the history blob into the payload the page draws.
 *
 * Each layer carries forward through gaps. The two margin markets publish at
 * different times of the evening, and the ETF feed is same-day, so without the
 * carry the newest point would drop whichever layer hasn't posted yet and the
 * total would appear to fall off a cliff that isn't there. `carriedFrom` names
 * the first carried day so the page can label it rather than imply fresh data.
 */
function assemble(history) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

  const keys = ['marginListed', 'marginOtc', 'etf'];
  const series = Object.fromEntries(keys.map(k => [k, []]));
  const last = {};
  const carried = Object.fromEntries(keys.map(k => [k, null]));

  // The ETF layer is rebuilt fund-by-fund rather than read off the stored daily
  // total. The funds post to Yuanta's API at different lags, so on a day when
  // only some have reported, summing just those funds invents a drop in the
  // layer that is really a reporting delay (2026-07-09: 2 of 7 funds in, and the
  // total "fell" 8%). Carry each fund's own last value instead, and only count a
  // fund from the day it first appears — so a fund that hasn't launched yet
  // reads as absent, not as zero.
  // Only the funds this scraper actually sources. Stored history can still carry
  // fund codes written by an earlier version of this scraper (it summed TWSE's
  // whole-market snapshot, Cathay and Capital included); carrying those forward
  // alongside Yuanta's double-counts the layer — it reported 102% of the entire
  // listed 2× market. Ignore anything outside the Yuanta universe.
  const universe = new Set(YUANTA_FUNDS);
  const etfByDay = {};
  const lastAum = {};
  for (const day of dates) {
    const funds = history[day]?.funds ?? {};
    for (const [code, aum] of Object.entries(funds)) {
      if (universe.has(code) && Number.isFinite(aum)) lastAum[code] = aum;
    }
    const codes = Object.keys(lastAum);
    if (codes.length) etfByDay[day] = round(codes.reduce((s, c) => s + lastAum[c], 0));
  }

  for (const day of dates) {
    for (const key of keys) {
      const v = key === 'etf' ? etfByDay[day] : history[day]?.[key];
      if (Number.isFinite(v)) { last[key] = v; carried[key] = null; }
      else if (Number.isFinite(last[key]) && carried[key] == null) carried[key] = day;
      series[key].push(Number.isFinite(last[key]) ? last[key] : null);
    }
  }

  // The chart's margin band is the whole borrowing market: listed + OTC. Both
  // components stay in the payload so the page can break them out.
  const margin = dates.map((_, i) => {
    const a = series.marginListed[i], b = series.marginOtc[i];
    return Number.isFinite(a) || Number.isFinite(b) ? round((a ?? 0) + (b ?? 0)) : null;
  });
  const total = dates.map((_, i) => round((margin[i] ?? 0) + (series.etf[i] ?? 0)));

  const lastDay = [...dates].reverse().find(d => history[d]?.funds);
  const names = history.names ?? {};
  const funds = Object.entries(lastAum)
    .map(([code, aum]) => ({ code, name: names[code] ?? code, aum: round(aum) }))
    .sort((a, b) => b.aum - a.aum);

  const i = dates.length - 1;
  return {
    dates,
    margin,
    marginListed: series.marginListed,
    marginOtc: series.marginOtc,
    etf: series.etf,
    total,
    funds,
    fundsDate: lastDay ?? null,
    // Whole listed 2× market today, so the page can say what share of it the
    // Yuanta-only ETF layer represents.
    etfMarket: history.etfMarket ?? null,
    carriedFrom: { margin: carried.marginListed ?? carried.marginOtc, etf: carried.etf },
    latest: {
      date: dates[i] ?? null,
      margin: margin[i] ?? null,
      marginListed: series.marginListed[i] ?? null,
      marginOtc: series.marginOtc[i] ?? null,
      etf: series.etf[i] ?? null,
      total: total[i] ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

function readTaiwanLeverage() { return assemble(loadHistory()); }

module.exports = { getTaiwanLeverage, readTaiwanLeverage };
