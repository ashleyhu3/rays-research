/**
 * Taiwan retail firepower — the leveraged layers of household money in the
 * TWSE/TPEx market, in 億元 (hundred-million NT$), one point per trading day.
 *
 *   margin  融資餘額        broker margin loans — listed (TWSE) + OTC (TPEx)
 *   etf     槓桿 ETF 淨資產  net assets of the 2× ("正2") ETFs
 *   ratio   charted leverage / market capitalization, in percent
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
 *   day, five years deep, for 00631L (元大台灣50正2, Yuanta Taiwan 50 2×) — the
 *   original and largest Taiwan 2× fund, about two thirds of all Taiwan 2×
 *   assets on its own. Fubon exposes no batched history API for 00675L (富邦臺
 *   灣加權正2, third-largest), but its PCF (creation/redemption basket) page
 *   reports the fund's exact net assets one reference date per request — see
 *   fubonPcfDay for the date-shift quirk that makes this workable. Both are
 *   the authoritative number (units × NAV only approximates it, since
 *   published NAV is rounded). `etfMarketTotal` records the whole listed 2×
 *   market for the current day (TWSE's live feed) purely so the page can
 *   state what share of it these funds cover, instead of implying the layer
 *   is the whole market.
 *
 * • Market size — TWSE publishes its total listed-equity capitalization in a
 *   weekly workbook; TPEx publishes the market value of every OTC company for
 *   any requested date. The denominator is their sum on the TWSE week-end date.
 *   It is carried forward between weekly observations, while the numerator
 *   continues to update daily.
 *
 * There is deliberately no cash layer and no short band: Taiwan publishes no
 * daily customer-cash aggregate, and short balances are reported in lots, which
 * cannot be stacked onto a money axis.
 */
const path = require('path');
const { inflateRawSync } = require('zlib');
const XLSX = require('@e965/xlsx');
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

/* ── Market capitalization: TWSE listed + TPEx OTC ─────────────────── */

// TWSE publishes the full weekly history as one legacy-XLS file inside a
// one-file ZIP. Keeping the archive discovery call separate from the workbook
// URL avoids baking a staticFiles path into the scraper.
async function twseWeeklyMarketCaps() {
  const indexRes = await fetch('https://www.twse.com.tw/rwd/en/statisticsWeek/index?response=json', {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.twse.com.tw/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!indexRes.ok) throw new Error(`TWSE weekly statistics HTTP ${indexRes.status}`);
  const index = await indexRes.json();
  const download = index.data?.[0]?.[1];
  if (typeof download !== 'string' || !download) throw new Error('TWSE weekly statistics has no workbook link');

  const archiveRes = await fetch(new URL(download, 'https://www.twse.com.tw'), {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.twse.com.tw/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!archiveRes.ok) throw new Error(`TWSE market-cap workbook HTTP ${archiveRes.status}`);
  const archive = Buffer.from(await archiveRes.arrayBuffer());
  if (archive.length > 5_000_000) throw new Error('TWSE market-cap archive is unexpectedly large');
  return parseTwseWeeklyMarketCaps(unzipFirstFile(archive));
}

// The official archive currently contains one deflated workbook. Parse the ZIP
// local-file header directly instead of adding a second package solely to
// extract one small file.
function unzipFirstFile(archive) {
  if (archive.length < 30 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('TWSE market-cap download is not a ZIP archive');
  }
  const flags = archive.readUInt16LE(6);
  const method = archive.readUInt16LE(8);
  const compressedSize = archive.readUInt32LE(18);
  const rawSize = archive.readUInt32LE(22);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  if (flags & 0x01) throw new Error('TWSE market-cap ZIP is encrypted');
  if (flags & 0x08) throw new Error('TWSE market-cap ZIP uses an unsupported data descriptor');
  if (rawSize > 10_000_000) throw new Error('TWSE market-cap workbook is unexpectedly large');

  const start = 30 + nameLength + extraLength;
  const end = start + compressedSize;
  if (end > archive.length) throw new Error('TWSE market-cap ZIP is truncated');
  const compressed = archive.subarray(start, end);
  const workbook = method === 0 ? Buffer.from(compressed)
    : method === 8 ? inflateRawSync(compressed)
      : null;
  if (!workbook) throw new Error(`TWSE market-cap ZIP compression method ${method} is unsupported`);
  if (rawSize && workbook.length !== rawSize) throw new Error('TWSE market-cap workbook size does not match ZIP header');
  return workbook;
}

function workbookDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (Number.isFinite(value)) {
    const p = XLSX.SSF.parse_date_code(value);
    if (p?.y && p?.m && p?.d) {
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    }
  }
  const text = String(value ?? '').trim().replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseTwseWeeklyMarketCaps(workbook) {
  // Keep Excel dates as serials and decode them explicitly. Date objects can
  // shift a week-end back one day when the server runs in a positive UTC zone.
  const book = XLSX.read(workbook, { type: 'buffer', cellDates: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('TWSE market-cap workbook has no worksheet');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const out = {};
  for (const row of rows.slice(2)) {
    const day = workbookDate(row?.[0]);
    const value = Number(String(row?.[1] ?? '').replace(/,/g, ''));
    if (day && Number.isFinite(value) && value > 0) out[day] = round(value);
  }
  if (!Object.keys(out).length) throw new Error('TWSE market-cap workbook contains no observations');
  return out;                                             // 億元 (NT$ 100 million)
}

// TPEx publishes every OTC company's market value in NT$ millions. Summing that
// official column and dividing by 100 puts it in the same 億元 unit as TWSE.
async function tpexOtcMarketCap(day) {
  const [y, m, d] = day.split('-');
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyMarktVal?date=${y}%2F${m}%2F${d}&response=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.tpex.org.tw/' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`TPEx market value HTTP ${res.status}`);
  const json = await res.json();
  const rows = json.tables?.[0]?.data ?? [];
  let millions = 0, observations = 0;
  for (const row of rows) {
    const value = Number(String(row?.[5] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(value) || value <= 0) continue;
    millions += value;
    observations++;
  }
  return observations ? millions / 100 : null;
}

/* ── Leveraged ETFs: Yuanta ────────────────────────────────────────── */

// Yuanta's front-end calls this with a device UUID; a malformed one is rejected
// as "Bad Request", so keep a well-formed constant here.
const YUANTA_API = 'https://etfapi.yuantaetfs.com/ectranslation/api/trans';
const YUANTA_DEVICE = '9ba170bb-6dfc-4efc-8d67-30b9423937f0';

// Just the flagship: 元大台灣50正2 (Yuanta Taiwan 50 2×), the original and by far
// the largest Taiwan 2× fund — about two thirds of all Taiwan 2× assets on its
// own. Yuanta's other 2× funds (Yuanta Futures single-stock/rate/commodity
// notes) answer on the same API but are left out of the layer for now.
const YUANTA_FUNDS = ['00631L'];

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

/* ── Leveraged ETFs: Fubon (00675L) ────────────────────────────────── */

// 00675L (富邦臺灣加權正2, Fubon TAIEX 2×) — the third-largest Taiwan 2× fund.
// Fubon exposes no batched history API, but its PCF (creation/redemption
// basket) page reports the fund's exact net assets for one reference date per
// request: /FubonETF/Trade/Pcf.aspx?ddate=YYYYMMDD&stkId=00675L. The basket it
// returns is dated the *next* trading day (ddate=20241125 shows the
// 2024/11/26 PCF), so the observation date has to be read off the page
// itself, not assumed from the query param — and a pre-launch or otherwise
// empty reference date reports the fund's net assets as literally "NT$0",
// which is how an empty day is told apart from a real one.
const FUBON_CODE = '00675L';
const FUBON_HOST = 'https://websys.fsit.com.tw';

function fubonPcfUrl(ddate) {
  return `${FUBON_HOST}/FubonETF/Trade/Pcf.aspx?ddate=${ddate}&stkId=${FUBON_CODE}`;
}

// Fields are read by their label rather than a fixed position, the same
// defensive pattern the KOFIA/HKEX/TWSE readers use.
function parseFubonPcf(html) {
  const pairs = {};
  const re = /<p>([^<]+)<\/p>\s*<p>([^<]+)<\/p>/g;
  let m;
  while ((m = re.exec(html))) pairs[m[1].trim()] = m[2].trim();

  const dateMatch = html.match(/現金申購買回清單[\s\S]{0,400}?(\d{4})\/(\d{2})\/(\d{2})/);
  if (!dateMatch) return null;
  const aum = Number((pairs['基金淨資產價值'] ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(aum) || aum <= 0) return null;
  return { day: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`, aum: aum / OKU };
}

async function fubonPcfDay(ddate) {
  const res = await fetch(fubonPcfUrl(ddate), {
    headers: { 'User-Agent': UA, 'Referer': `${FUBON_HOST}/FubonETF/` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Fubon PCF HTTP ${res.status}`);
  return parseFubonPcf(await res.text());
}

// One request per weekday in [from, to] — the PCF page has no range query.
// Keyed by the *displayed* PCF date rather than the queried ddate, so a
// reference date that rolls forward over a holiday still lands on the right
// day and simply overwrites/dedupes against a neighboring query.
// The scraper's full ETF universe — Yuanta's fund(s) plus Fubon's — shared by
// getTaiwanLeverage (to build the per-day fund breakdown) and assemble() (to
// filter stored history down to funds this scraper still sources).
const FUND_CODES = [...YUANTA_FUNDS, FUBON_CODE];

async function fubonFundHistory(from, to) {
  const out = {};
  const end = new Date(`${to}T00:00:00Z`);
  for (let t = new Date(`${from}T00:00:00Z`); t <= end; t = new Date(t.getTime() + 86400000)) {
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const ddate = iso(t).replace(/-/g, '');
    try {
      const row = await fubonPcfDay(ddate);
      if (row) out[row.day] = row.aum;
    } catch (e) {
      console.warn(`[taiwanLeverage] Fubon PCF ${ddate}: ${e.message}`);
    }
    await sleep(300);                                     // be a good citizen
  }
  return out;
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
function roundRatio(v) { return Math.round(v * 10000) / 10000; }

const iso = d => d.toISOString().slice(0, 10);

/**
 * Scrape the last `days` days of every layer, merge into history, and return the
 * assembled series. The backfill script passes ~1830 (five years).
 *
 * TPEx has no range query, so margin is fetched one day at a time and market
 * capitalization once per TWSE week-end. This is why `days` defaults to a month
 * for the daily poll; the one-time denominator backfill is batched separately.
 */
async function getTaiwanLeverage(days = 30) {
  const today = new Date();
  const from = iso(new Date(today.getTime() - days * 86400000));
  const to = iso(today);

  const [listed, yuantaFunds, fubonDays, marketTotal, listedMarketCaps] = await Promise.all([
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
    fubonFundHistory(from, to).catch(e => {
      console.warn(`[taiwanLeverage] Fubon PCF unavailable (${e.message})`);
      return {};
    }),
    listedEtfMarketTotal().catch(e => { console.warn('[taiwanLeverage] ETF market feed:', e.message); return null; }),
    twseWeeklyMarketCaps().catch(e => {
      console.warn('[taiwanLeverage] TWSE weekly market cap:', e.message);
      return {};
    }),
  ]);
  const etfFunds = [...yuantaFunds, { name: 'Fubon TAIEX 2×', days: fubonDays }];

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

  // Market-size observations are weekly. The dedicated backfill fills the full
  // five-year chart in one run; normal refreshes fill at most 60 missing weeks,
  // newest first, so they stay well inside the scheduler timeout and gradually
  // heal any older holes. Four concurrent TPEx reads avoids hammering the
  // exchange while keeping that bounded batch quick.
  const historyDays = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const fiveYearsAgo = iso(new Date(today.getTime() - 1835 * 86400000));
  const capFrom = [historyDays[0] ?? from, fiveYearsAgo].sort().at(-1);
  const capDays = Object.keys(listedMarketCaps)
    .filter(day => day >= capFrom && day <= to)
    .sort();

  for (const day of capDays) {
    history[day] = { ...(history[day] ?? {}), marketSizeListed: listedMarketCaps[day] };
  }

  const missingMarketCapOtc = capDays.filter(day => !Number.isFinite(history[day]?.marketSizeOtc));
  const needMarketCapOtc = days > 365 ? missingMarketCapOtc : missingMarketCapOtc.slice(-60);
  if (needMarketCapOtc.length > 5) {
    const deferred = missingMarketCapOtc.length - needMarketCapOtc.length;
    console.log(`[taiwanLeverage] TPEx: fetching ${needMarketCapOtc.length} weekly market-cap observations`
      + (deferred ? ` (${deferred} older observations deferred)` : '') + '…');
  }
  let marketCapOtcOk = 0;
  for (let i = 0; i < needMarketCapOtc.length; i += 4) {
    const batch = needMarketCapOtc.slice(i, i + 4);
    await Promise.all(batch.map(async day => {
      try {
        const value = await tpexOtcMarketCap(day);
        if (Number.isFinite(value)) {
          history[day] = { ...(history[day] ?? {}), marketSizeOtc: round(value) };
          marketCapOtcOk++;
        }
      } catch (e) {
        console.warn(`[taiwanLeverage] TPEx market cap ${day}: ${e.message}`);
      }
    }));
    if (i + 4 < needMarketCapOtc.length) await sleep(120);
  }
  if (needMarketCapOtc.length > 5) {
    console.log(`[taiwanLeverage] TPEx: got ${marketCapOtcOk}/${needMarketCapOtc.length} weekly market-cap observations`);
  }

  const names = {};
  etfFunds.forEach((f, i) => { names[FUND_CODES[i]] = f.name; });
  const etfDays = new Set(etfFunds.flatMap(f => Object.keys(f.days)));
  for (const day of etfDays) {
    const perFund = {};
    etfFunds.forEach((f, i) => {
      const aum = f.days[day];
      if (Number.isFinite(aum)) perFund[FUND_CODES[i]] = round(aum);
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

  const keys = ['marginListed', 'marginOtc', 'etf', 'marketSizeListed', 'marketSizeOtc'];
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
  // whole-market snapshot, Cathay and Capital included, or a wider Yuanta
  // roster); carrying those forward alongside today's funds double-counts the
  // layer — it once reported 102% of the entire listed 2× market. Ignore
  // anything outside FUND_CODES.
  const universe = new Set(FUND_CODES);
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

  // A ratio is only valid when every component is present. The amount chart can
  // tolerate a temporarily missing layer by carrying it forward, but treating a
  // missing exchange or ETF value as zero would silently understate leverage.
  const marketSize = dates.map((_, i) => {
    const listed = series.marketSizeListed[i], otc = series.marketSizeOtc[i];
    return Number.isFinite(listed) && Number.isFinite(otc) ? round(listed + otc) : null;
  });
  const leverageRatio = dates.map((_, i) => {
    const completeNumerator = Number.isFinite(series.marginListed[i])
      && Number.isFinite(series.marginOtc[i])
      && Number.isFinite(series.etf[i]);
    return completeNumerator && Number.isFinite(marketSize[i]) && marketSize[i] > 0
      ? roundRatio((total[i] / marketSize[i]) * 100)
      : null;
  });

  const lastDay = [...dates].reverse().find(d => history[d]?.funds);
  const names = history.names ?? {};
  const funds = Object.entries(lastAum)
    .map(([code, aum]) => ({ code, name: names[code] ?? code, aum: round(aum) }))
    .sort((a, b) => b.aum - a.aum);

  const i = dates.length - 1;
  const marketSizeDate = [...dates].reverse().find(d =>
    Number.isFinite(history[d]?.marketSizeListed) && Number.isFinite(history[d]?.marketSizeOtc)) ?? null;
  return {
    dates,
    margin,
    marginListed: series.marginListed,
    marginOtc: series.marginOtc,
    etf: series.etf,
    total,
    marketSize,
    marketSizeListed: series.marketSizeListed,
    marketSizeOtc: series.marketSizeOtc,
    leverageRatio,
    marketSizeDate,
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
      marketSize: marketSize[i] ?? null,
      marketSizeListed: series.marketSizeListed[i] ?? null,
      marketSizeOtc: series.marketSizeOtc[i] ?? null,
      leverageRatio: leverageRatio[i] ?? null,
    },
    updatedAt: new Date().toISOString(),
  };
}

function readTaiwanLeverage() { return assemble(loadHistory()); }

module.exports = {
  getTaiwanLeverage,
  readTaiwanLeverage,
  _test: { assemble, parseTwseWeeklyMarketCaps, unzipFirstFile },
};
