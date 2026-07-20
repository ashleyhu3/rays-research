/**
 * Japan market-wide margin trading balance — JPX's official "Outstanding
 * Margin Trading (Negotiable/Standardized)" report, Tokyo + Nagoya combined,
 * one point per week (application-date basis; JPX updates this end-of-week,
 * not daily). This is deliberately weekly, not daily: JPX does not publish a
 * market-wide margin balance more often than that.
 *
 *   purchases   信用買残 / 信用買残高   market-wide margin buy (long) balance, JPY
 *   sales       信用売残 / 信用売残高   market-wide margin sell (short) balance, JPY
 *   ratio       信用倍率              purchases ÷ sales, both in JPY value — calculated
 *
 * Source: JPX "Outstanding Margin Trading, etc." → "Historical Data on
 * Outstanding Margin Trading" (06.html) → "Outstanding Margin Transactions
 * (Negotiable/Standardized)" workbook. That workbook's own "Total" columns
 * (index 1–4: sell shares, sell value, buy shares, buy value) are the same
 * total the companion "Current Outstanding Margin Trading" workbook's
 * customer+member breakdown sums to — cross-checked row for row.
 *
 * The page's download link carries a versioned content ID that can change
 * between publishes, so the workbook URL is resolved fresh from the page's
 * HTML on every run rather than hardcoded.
 *
 * The historical archive above lags real publication by a few weeks (as of
 * writing: archive through 6/26, but JPX had already published 7/3 and
 * 7/10). "Current Outstanding Margin Trading" (04.html) publishes each new
 * week's file on time but only keeps the most recent ~5 weeks linked, in a
 * different per-week workbook layout (a Tokyo+Nagoya/Customer+Proprietary
 * matrix rather than a date-indexed row) — every run also pulls those and
 * merges them in, so the chart isn't stuck weeks behind just because the
 * archive hasn't caught up. Verified byte-for-byte identical Total-column
 * values against the archive on a week common to both.
 *
 * Also carries the 2× leveraged ETF layer: net assets (AUM) for the nine
 * listed products tracking Nikkei 225 / TOPIX / MSCI Japan at 2× daily —
 * seven Tokyo-listed, one Hong Kong-listed, one US-listed. Every figure is
 * the fund's own officially disclosed AUM — never a price × shares-outstanding
 * estimate. Six of the nine (next1570, lif1358, rakuten1458, ifree1365,
 * ifree1367, csop7262) publish genuine full daily history from their own
 * site/HKEXnews; the other three (simplex1579, simplex1568, ezj) only expose
 * a live current-value snapshot with no historical download, so their charted
 * history starts wherever this scraper's polling starts and builds forward —
 * still official, just not backfillable.
 *
 *   next1570      1570      NEXT FUNDS Nikkei 225 Leveraged Index ETF          nomura-am.co.jp CSV, full history
 *   lif1358       1358      Listed Index Fund Nikkei Leveraged Index           amova-am.com CSV, full history
 *   rakuten1458   1458      Rakuten ETF Nikkei 225 Leveraged Index             rakuten-toushin.co.jp CSV, full history
 *   ifree1365     1365      iFreeETF Nikkei 225 Leveraged Index                daiwa-am.co.jp CSV, full history
 *   simplex1579   1579      Nikkei 225 Bull 2x ETF                             simplexasset.com CSV, current only
 *   simplex1568   1568      TOPIX Bull 2x ETF                                  simplexasset.com CSV, current only
 *   ifree1367     1367      iFreeETF TOPIX Leveraged (2x) Index                daiwa-am.co.jp CSV, full history
 *   csop7262      7262.HK   CSOP Nikkei 225 Daily (2x) Leveraged Product       HKEXnews L&I workbook, full history
 *   ezj           EZJ       ProShares Ultra MSCI Japan                        Nasdaq quote API, current only (USD, FX'd to JPY)
 */
const XLSX = require('@e965/xlsx');
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'japanLeverageHistory.json');
const BLOB = 'japanLeverageHistory';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE_URL = 'https://www.jpx.co.jp/english/markets/statistics-equities/margin/06.html';
const CURRENT_PAGE_URL = 'https://www.jpx.co.jp/english/markets/statistics-equities/margin/04.html';

const iso = d => d.toISOString().slice(0, 10);
const compact = day => day.replace(/-/g, '');

function round2(v) { return Math.round(v * 100) / 100; }

// The row labeled "Current Outstanding Margin Trading (Negotiable/Standardized)"
// carries its .xls link right after it in the same <tr>.
async function findWorkbookUrl() {
  const res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`JPX margin page HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/Current Outstanding Margin Trading \(Negotiable\/Standardized\)[\s\S]*?<a href="([^"]+\.xls)"/);
  if (!match) throw new Error('JPX margin page: workbook link not found');
  return new URL(match[1], PAGE_URL).toString();
}

async function fetchWorkbook(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`JPX workbook HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Rows: [date, totalSellShares, totalSellValue, totalBuyShares, totalBuyValue, ...breakdown].
// Values are 千株 (thousand shares) / 百万円 (million yen). Header/footer rows have
// no real date in column 0 and are skipped by the instanceof Date check.
function parseWorkbook(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('JPX workbook: no sheet found');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const out = {};
  for (const row of rows) {
    const dateCell = row[0];
    if (!(dateCell instanceof Date) || !Number.isFinite(dateCell.getTime())) continue;
    const sellShares = Number(row[1]);
    const sellValue = Number(row[2]);
    const buyShares = Number(row[3]);
    const buyValue = Number(row[4]);
    if (![sellShares, sellValue, buyShares, buyValue].every(Number.isFinite)) continue;
    const day = dateCell.toISOString().slice(0, 10);
    out[day] = { sellShares, sellValue, buyShares, buyValue };
  }
  return out;
}

/* ── Recent weeks the historical archive hasn't caught up to yet ────── */

async function findCurrentWeeklyUrls() {
  const res = await fetch(CURRENT_PAGE_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`JPX current margin page HTTP ${res.status}`);
  const html = await res.text();
  const urls = [...html.matchAll(/href="([^"]+\/mtseisan\d+\.xls)"/g)]
    .map(m => new URL(m[1], CURRENT_PAGE_URL).toString());
  return [...new Set(urls)];
}

// Layout differs from the archive: title cell names the application date
// ("信用取引現在高（2026/7/10申込み現在）"), and the Tokyo+Nagoya Total row/
// value row (labeled "二市場計") carry Total Sell (col 11) / Total Buy
// (col 13) the same way the archive's own columns 1–4 do — cross-checked
// against the archive on 2026-06-26, which both sources cover.
function parseCurrentWeeklyWorkbook(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const dateMatch = String(rows[0]?.[0] ?? '').match(/（(\d{4})\/(\d{1,2})\/(\d{1,2})申込み現在）/);
  if (!dateMatch) return null;
  const day = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

  const totalIdx = rows.findIndex(row => String(row?.[1] ?? '').startsWith('二市場計'));
  if (totalIdx < 0) return null;
  const sharesRow = rows[totalIdx];
  const valueRow = rows[totalIdx + 1];
  const sellShares = Number(sharesRow?.[11]);
  const buyShares = Number(sharesRow?.[13]);
  const sellValue = Number(valueRow?.[11]);
  const buyValue = Number(valueRow?.[13]);
  if (![sellShares, buyShares, sellValue, buyValue].every(Number.isFinite)) return null;
  return { day, sellShares, sellValue, buyShares, buyValue };
}

async function scrapeCurrentWeeklies(history) {
  let urls;
  try {
    urls = await findCurrentWeeklyUrls();
  } catch (e) {
    console.warn(`[japanLeverage] JPX current margin page: ${e.message}`);
    return;
  }
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const parsed = parseCurrentWeeklyWorkbook(Buffer.from(await res.arrayBuffer()));
      if (parsed) {
        const { day, ...row } = parsed;
        history[day] = row;
      }
    } catch (e) {
      console.warn(`[japanLeverage] current weekly ${url}: ${e.message}`);
    }
  }
}

/* ── 2× ETF layer: net assets (AUM), official figures only ──────────── */

const ETF_PRODUCTS = [
  { key: 'next1570', label: 'NEXT FUNDS Nikkei 225 Leveraged Index ETF', code: '1570', market: 'Tokyo (TSE)', underlying: 'Nikkei 225' },
  { key: 'lif1358', label: 'Listed Index Fund Nikkei Leveraged Index', code: '1358', market: 'Tokyo (TSE)', underlying: 'Nikkei 225' },
  { key: 'rakuten1458', label: 'Rakuten ETF Nikkei 225 Leveraged Index', code: '1458', market: 'Tokyo (TSE)', underlying: 'Nikkei 225' },
  { key: 'ifree1365', label: 'iFreeETF Nikkei 225 Leveraged Index', code: '1365', market: 'Tokyo (TSE)', underlying: 'Nikkei 225' },
  { key: 'simplex1579', label: 'Nikkei 225 Bull 2x ETF', code: '1579', market: 'Tokyo (TSE)', underlying: 'Nikkei 225' },
  { key: 'simplex1568', label: 'TOPIX Bull 2x ETF', code: '1568', market: 'Tokyo (TSE)', underlying: 'TOPIX' },
  { key: 'ifree1367', label: 'iFreeETF TOPIX Leveraged (2x) Index', code: '1367', market: 'Tokyo (TSE)', underlying: 'TOPIX' },
  { key: 'csop7262', label: 'CSOP Nikkei 225 Daily (2x) Leveraged Product', code: '7262.HK', market: 'Hong Kong', underlying: 'Nikkei 225' },
  { key: 'ezj', label: 'ProShares Ultra MSCI Japan', code: 'EZJ', market: 'United States', underlying: 'MSCI Japan' },
];

// Fetched as raw bytes and decoded latin1 rather than Shift-JIS/UTF-8 — every
// issuer's DATA rows are plain ASCII (digits, commas, dashes); only their
// header/description rows carry Japanese text, which is never parsed below.
async function fetchCsvText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}

// Nomura (1570): date YYYYMMDD, col1 = "ETF Net Asset (Total)", raw yen.
function parseNomuraCsv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d{8}),(\d+),/);
    if (!m) continue;
    out[`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}`] = Number(m[2]);
  }
  return out;
}

// Amova (1358): date YYYY-MM-DD, col10 = "ETF Net Asset (Total)", raw yen.
function parseAmovaCsv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[0])) continue;
    const aum = Number(cols[10]);
    if (Number.isFinite(aum)) out[cols[0]] = aum;
  }
  return out;
}

// Rakuten (1458): date YYYY/MM/DD, col2 = 純資産総額 in 億円 (hundred-millions).
function parseRakutenCsv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',');
    const m = cols[0]?.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!m) continue;
    const oku = Number(cols[2]);
    if (Number.isFinite(oku)) out[`${m[1]}-${m[2]}-${m[3]}`] = oku * 1e8;
  }
  return out;
}

// Daiwa (1365, 1367 — same CSV shape, different fund `code`): date YYYYMMDD,
// col3 = 純資産総額, raw yen.
function parseDaiwaCsv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(',');
    if (!/^\d{8}$/.test(cols[0])) continue;
    const aum = Number(cols[3]);
    if (Number.isFinite(aum)) out[`${cols[0].slice(0, 4)}-${cols[0].slice(4, 6)}-${cols[0].slice(6)}`] = aum;
  }
  return out;
}

// Simplex (1579, 1568): one shared tab-delimited CSV, current day only, every
// row a different Simplex ETF. Row is matched by the ticker embedded in the
// "取引所コード" column's <a>code</a> anchor text rather than the fund name,
// since that's stable across any relabeling. 純資産総額 is in 億円.
async function simplexCurrentAum(code) {
  const res = await fetch('https://www.simplexasset.com/etf/ETFNAV.csv', {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Simplex ETFNAV HTTP ${res.status}`);
  const text = (await res.text()).replace(/^﻿/, '');
  const row = text.split(/\r?\n/).find(line => line.includes(`>${code}<`));
  if (!row) return null;
  const cols = row.split('\t');
  const aumM = cols[5]?.match(/^([\d,.]+)億円$/);
  if (!aumM) return null;
  return Number(aumM[1].replace(/,/g, '')) * 1e8;
}

/* HKEXnews: csop7262 (7262.HK) — a workbook CSOP files jointly for its whole
   L&I product family (HSI/HSTECH/HSCEI/Nikkei), unlike koreaLeverage.js's
   single-product CSOP workbooks. Every row repeats in 3-column groups; the
   group index is located once per file via the "Stock Code" row, then that
   same group index is applied to the date/AUM rows (whose groups start at a
   different column offset — verified against a real filing). */
const HKEX_HOST = 'https://www1.hkexnews.hk';
const HKEX_SEARCH = `${HKEX_HOST}/search/titleSearchServlet.do`;
const CSOP_7262_STOCK_ID = 1000224148; // resolved via HKEXnews' stock-code prefix resolver

async function hkexFilings(stockId, from, to) {
  const q = new URLSearchParams({
    sortDir: '0', sortByOptions: 'DateTime', category: '0', market: 'SEHK',
    stockId: String(stockId), documentType: '-1',
    fromDate: from, toDate: to,
    title: '', searchType: '1', t1code: '-2', t2Gcode: '-2', t2code: '-2',
    rowRange: '2000', lang: 'E',
  });
  const res = await fetch(`${HKEX_SEARCH}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HKEXnews search HTTP ${res.status}`);
  const json = await res.json();
  const rows = JSON.parse(json.result ?? '[]');
  return rows.filter(r => r.FILE_TYPE === 'XLSX' && r.FILE_LINK);
}

async function mapPool(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]); }
  }));
}

function parseHkexMultiProductWorkbook(buffer, code) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const codeRow = rows.find(r => String(r?.[0] ?? '').startsWith('Stock Code'));
  const dateRow = rows.find(r => String(r?.[0] ?? '').startsWith('Date ('));
  const aumRow = rows.find(r => String(r?.[0] ?? '').startsWith('Asset Under Management'));
  if (!codeRow || !dateRow || !aumRow) return null;
  const codeIdx = codeRow.findIndex(cell => String(cell ?? '').trim() === code);
  if (codeIdx < 2 || (codeIdx - 2) % 3 !== 0) return null;
  const group = (codeIdx - 2) / 3;
  const dateCell = dateRow[2 + 3 * group];
  const aum = Number(aumRow[2 + 3 * group]);
  const day = dateCell instanceof Date && Number.isFinite(dateCell.getTime())
    ? dateCell.toISOString().slice(0, 10) : null;
  if (!day || !Number.isFinite(aum)) return null;
  return { day, aum }; // already JPY — CSOP discloses this leg's AUM in the underlying's own currency
}

async function hkexCsop7262History(from, to) {
  const filings = await hkexFilings(CSOP_7262_STOCK_ID, from, to);
  const out = {};
  await mapPool(filings, 4, async row => {
    try {
      const res = await fetch(`${HKEX_HOST}${row.FILE_LINK}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return;
      const buffer = Buffer.from(await res.arrayBuffer());
      const parsed = parseHkexMultiProductWorkbook(buffer, '7262');
      if (parsed) out[parsed.day] = parsed;
    } catch (e) {
      console.warn(`[japanLeverage] HKEXnews 7262 workbook ${row.FILE_LINK}: ${e.message}`);
    }
  });
  return out;
}

/* Nasdaq: ezj (EZJ) current net assets, USD — same endpoint chinaLeverage.js
   uses for CHAU. FX'd to JPY via that day's USD/JPY close; no historical AUM
   is published for this fund, so unlike CHAU there is no back-projected
   estimate here — only today's genuinely official figure is ever recorded. */
async function nasdaqCurrentAumUsd(symbol) {
  const res = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/summary?assetclass=etf`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Nasdaq ${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const raw = json?.data?.summaryData?.AUM?.value; // e.g. "12,489" — thousands of USD
  const thousands = Number(String(raw ?? '').replace(/,/g, ''));
  if (!Number.isFinite(thousands)) throw new Error(`Nasdaq ${symbol} AUM missing`);
  return thousands * 1000;
}

async function yahooDailyClose(symbol, range) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol} returned no data`);
  const timestamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const tz = result.meta?.exchangeTimezoneName ?? 'America/New_York';
  const out = {};
  timestamps.forEach((ts, i) => {
    const close = closes[i];
    if (!Number.isFinite(close)) return;
    out[new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: tz })] = close;
  });
  return out;
}

/**
 * Scrape every product's official AUM and merge into history.etf, keyed by
 * product then day: { aum } in raw yen. `days` widens the HKEXnews date-range
 * fetch for a deep backfill; the issuer CSVs always return their full history
 * regardless, and the current-only sources (Simplex ×2, EZJ) only ever add
 * today's point.
 */
async function scrapeEtfHistory(history, days = 90) {
  history.etf = history.etf ?? {};
  const today = new Date();
  const from = compact(iso(new Date(today.getTime() - days * 86400000)));
  const to = compact(iso(today));

  const [nomura, amova, rakuten, daiwa1365, daiwa1367, simplex1579, simplex1568, hkex7262, ezjUsd, usdJpy] = await Promise.all([
    fetchCsvText('https://www.nomura-am.co.jp/fund/etf/history/ETF_1570.csv').then(parseNomuraCsv)
      .catch(e => { console.warn(`[japanLeverage] Nomura 1570: ${e.message}`); return {}; }),
    fetchCsvText('https://www.amova-am.com/products/etf/files/etf/dailydata/etf-funddata-613584.csv').then(parseAmovaCsv)
      .catch(e => { console.warn(`[japanLeverage] Amova 1358: ${e.message}`); return {}; }),
    fetchCsvText('https://www.rakuten-toushin.co.jp/assets/csv/chart_109001.csv').then(parseRakutenCsv)
      .catch(e => { console.warn(`[japanLeverage] Rakuten 1458: ${e.message}`); return {}; }),
    fetchCsvText('https://www.daiwa-am.co.jp/funds/detail/csv_out.php?code=3501&type=1').then(parseDaiwaCsv)
      .catch(e => { console.warn(`[japanLeverage] Daiwa 1365: ${e.message}`); return {}; }),
    fetchCsvText('https://www.daiwa-am.co.jp/funds/detail/csv_out.php?code=3503&type=1').then(parseDaiwaCsv)
      .catch(e => { console.warn(`[japanLeverage] Daiwa 1367: ${e.message}`); return {}; }),
    simplexCurrentAum('1579').catch(e => { console.warn(`[japanLeverage] Simplex 1579: ${e.message}`); return null; }),
    simplexCurrentAum('1568').catch(e => { console.warn(`[japanLeverage] Simplex 1568: ${e.message}`); return null; }),
    hkexCsop7262History(from, to).catch(e => { console.warn(`[japanLeverage] HKEXnews 7262: ${e.message}`); return {}; }),
    nasdaqCurrentAumUsd('EZJ').catch(e => { console.warn(`[japanLeverage] Nasdaq EZJ: ${e.message}`); return null; }),
    yahooDailyClose('JPY=X', '5d').catch(e => { console.warn(`[japanLeverage] Yahoo JPY=X: ${e.message}`); return {}; }),
  ]);

  const assign = (key, dayToYen) => {
    history.etf[key] = { ...(history.etf[key] ?? {}) };
    for (const [day, aum] of Object.entries(dayToYen)) {
      if (Number.isFinite(aum)) history.etf[key][day] = { aum: Math.round(aum) };
    }
  };

  assign('next1570', nomura);
  assign('lif1358', amova);
  assign('rakuten1458', rakuten);
  assign('ifree1365', daiwa1365);
  assign('ifree1367', daiwa1367);
  assign('csop7262', Object.fromEntries(Object.entries(hkex7262).map(([day, row]) => [day, row.aum])));

  const todayIso = iso(today);
  if (Number.isFinite(simplex1579)) assign('simplex1579', { [todayIso]: simplex1579 });
  if (Number.isFinite(simplex1568)) assign('simplex1568', { [todayIso]: simplex1568 });

  if (Number.isFinite(ezjUsd)) {
    const fxDays = Object.keys(usdJpy).sort();
    const rate = usdJpy[fxDays.at(-1)];
    if (Number.isFinite(rate)) assign('ezj', { [todayIso]: ezjUsd * rate });
  }
}

/**
 * Fold the nine products' JPY AUM into one billions-JPY total and a
 * latest-snapshot fund table, carrying each product forward through its own
 * reporting gaps so one product's lag doesn't dent the total — same shape as
 * chinaLeverage.js's assembleEtf.
 */
function assembleEtf(history) {
  const keys = ETF_PRODUCTS.map(p => p.key);
  const dates = [...new Set(keys.flatMap(key => Object.keys(history.etf?.[key] ?? {})))].sort();

  const lastAum = {};
  const totalByDay = {};
  for (const day of dates) {
    for (const key of keys) {
      const row = history.etf?.[key]?.[day];
      if (Number.isFinite(row?.aum)) lastAum[key] = row.aum;
    }
    const known = keys.filter(key => Number.isFinite(lastAum[key]));
    if (known.length) totalByDay[day] = known.reduce((sum, key) => sum + lastAum[key], 0);
  }

  let last = null;
  let carried = null;
  const total = [];
  for (const day of dates) {
    const v = totalByDay[day];
    if (Number.isFinite(v)) { last = v; carried = null; }
    else if (Number.isFinite(last) && carried == null) carried = day;
    total.push(Number.isFinite(last) ? round2(last / 1e9) : null); // yen -> billions
  }

  const fundsDate = [...dates].reverse().find(day => keys.some(key => history.etf?.[key]?.[day]));
  const funds = ETF_PRODUCTS
    .filter(p => Number.isFinite(lastAum[p.key]))
    .map(p => ({
      key: p.key,
      label: p.label,
      code: p.code,
      market: p.market,
      underlying: p.underlying,
      aum: round2(lastAum[p.key] / 1e9),
    }))
    .sort((a, b) => b.aum - a.aum);

  return {
    dates,
    total, // billions of JPY
    carriedFrom: carried,
    funds,
    fundsDate: fundsDate ?? null,
  };
}

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

/**
 * The margin workbook always serves its full weekly history (2002 → present)
 * in one file, so every run just re-parses the whole thing and merges it into
 * the stored history — cheap (one page fetch + one ~200KB xls), and
 * self-healing if a prior run's parse was ever incomplete. `days` is only
 * used to widen the ETF layer's HKEXnews backfill window (see
 * scrapeEtfHistory) — the backfill script passes a multi-year value.
 */
async function getJapanLeverage(days = 90) {
  const url = await findWorkbookUrl();
  const buffer = await fetchWorkbook(url);
  const rows = parseWorkbook(buffer);
  if (!Object.keys(rows).length) throw new Error('JPX margin workbook returned no rows');

  const history = loadHistory();
  for (const [day, row] of Object.entries(rows)) history[day] = row;

  // JPX's historical workbook can trail the separately published weekly
  // workbooks by several weeks. Merge those short-lived current files after
  // the archive so the newest application dates reach the API immediately.
  await scrapeCurrentWeeklies(history);

  await scrapeEtfHistory(history, days);

  saveHistory(history);
  return assemble(history);
}

/**
 * Both headline metrics and the ratio are built from the workbook's yen
 * "Value" columns (not the share-count columns) so all three stay in one
 * consistent unit — the ratio is purchases-value ÷ sales-value, computed
 * from the raw million-yen figures before rounding to display precision.
 */
function assemble(history) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const purchases = [];
  const sales = [];
  const ratio = [];

  for (const day of dates) {
    const row = history[day];
    const buyValue = Number(row?.buyValue);
    const sellValue = Number(row?.sellValue);
    const hasBoth = Number.isFinite(buyValue) && Number.isFinite(sellValue);
    purchases.push(hasBoth ? round2(buyValue / 1e6) : null); // million yen -> trillion yen
    sales.push(hasBoth ? round2(sellValue / 1e6) : null);
    ratio.push(hasBoth && sellValue !== 0 ? round2(buyValue / sellValue) : null);
  }

  const i = dates.length - 1;
  const latest = {
    date: dates[i] ?? null,
    purchases: purchases[i] ?? null,
    sales: sales[i] ?? null,
    ratio: ratio[i] ?? null,
  };

  return {
    dates, purchases, sales, ratio, latest,
    etf: assembleEtf(history),
    updatedAt: new Date().toISOString(),
  };
}

function readJapanLeverage() { return assemble(loadHistory()); }

module.exports = {
  getJapanLeverage,
  readJapanLeverage,
  _test: {
    assemble, parseWorkbook, parseCurrentWeeklyWorkbook, assembleEtf,
    parseNomuraCsv, parseAmovaCsv, parseRakutenCsv, parseDaiwaCsv, parseHkexMultiProductWorkbook,
  },
};
