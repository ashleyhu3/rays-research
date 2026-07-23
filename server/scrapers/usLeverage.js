/**
 * US leverage — three official metrics, each kept at its own native reporting
 * frequency (no interpolation between points, nothing converted from monthly
 * to daily):
 *
 *   marginDebt      FINRA Rule 4521(d) "Debit Balances in Customers' Securities
 *                   Margin Accounts", monthly, $ millions, from FINRA's public
 *                   workbook back to 1997.
 *   cftc            CFTC Traders in Financial Futures, weekly, per equity-index
 *                   contract — leveraged-fund gross positions (long + short +
 *                   2 × spreading) in contracts.
 *   leveragedEtf    Net assets (AUM) of nine leveraged-long equity ETFs, as
 *                   published by their own issuer (ProShares, Direxion) — never
 *                   AUM × leverage factor.
 *
 * OCC's Open Interest and Stock Loan Balance by Security reports were dropped
 * entirely (not shipped as empty/loading charts): both are single-page apps
 * whose data comes from a JSON API on marketdata.theocc.com behind the same
 * Cloudflare bot-management as the page itself, so reaching them needs a
 * permission-gated Apify actor (apify/puppeteer-scraper) this account has
 * never approved — confirmed dead end, not a temporary gap. No equivalent
 * exists on this project's other integrated sources either: Massive (Polygon-
 * shaped) returns per-symbol options chains, not OCC's market-wide aggregate
 * by category, and Yahoo Finance has neither an options-OI aggregate nor any
 * securities-lending data (its "short interest" field is a different metric
 * this project deliberately keeps separate from stock-loan balances). If the
 * actor is approved later, or another official source turns up, these can be
 * re-added the same way margin debt / CFTC / the ETF panel work below.
 *
 * The old CME Volume & Open Interest pages were removed from the shipped API:
 * the public pages only expose a very short trailing window. CFTC's TFF files
 * are official, free, weekly, and carry a named "Leveraged Funds" class, so
 * they are a more direct leverage signal with durable backfill.
 */
'use strict';
const cheerio = require('cheerio');
const XLSX = require('@e965/xlsx');
const path = require('path');
const { inflateRawSync } = require('zlib');
const storage = require('../storage');
const { crawlPages } = require('./apifyCrawler');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'usLeverageHistory.json');
const BLOB = 'usLeverageHistory';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const round2 = v => Math.round(v * 100) / 100;

/* ── 1. FINRA margin debt (monthly, $ millions) ──────────────────── */

const FINRA_PAGE_URL = 'https://www.finra.org/rules-guidance/key-topics/margin-accounts/margin-statistics';
const FINRA_XLSX_URL = 'https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx';
const FINRA_XLSX_UA = 'curl/8.7.1';

const MONTH_NUM = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// FINRA's rendered table uses "Jun-26"; the workbook uses "2026-06".
function monthYearToIso(str) {
  const cleaned = String(str ?? '').trim();
  const ym = cleaned.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}-01`;

  const m = cleaned.match(/^([A-Za-z]{3})-(\d{2})$/);
  if (!m || !MONTH_NUM[m[1]]) return null;
  const yy = Number(m[2]);
  return `${yy >= 50 ? 1900 + yy : 2000 + yy}-${MONTH_NUM[m[1]]}-01`;
}

/** The page itself embeds ~13 trailing months in a plain HTML table — this needs
 *  no extra Apify permission, unlike the full 1997+ workbook below. */
function parseFinraHtmlTable(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('table').each((_, table) => {
    const headText = $(table).find('th').first().text();
    if (!/month\/year/i.test(headText)) return;
    $(table).find('tbody tr').each((__, tr) => {
      const tds = $(tr).find('td');
      const iso = monthYearToIso($(tds[0]).text());
      const debit = Number($(tds[1]).text().replace(/[^0-9.-]/g, ''));
      if (iso && Number.isFinite(debit)) out[iso] = debit;
    });
  });
  return out;
}

/** Full workbook back to Jan 1997. Locate the "Debit" column by text match
 *  rather than a fixed index, and accept Date, YYYY-MM, or Mon-YY row labels. */
function parseFinraXlsx(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return {};
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  let debitCol = -1;
  for (const row of rows) {
    const idx = row.findIndex(cell => /debit/i.test(String(cell ?? '')));
    if (idx >= 0) { debitCol = idx; break; }
  }
  if (debitCol < 0) return {};

  const out = {};
  for (const row of rows) {
    const dateCell = row[0];
    let iso = null;
    if (dateCell instanceof Date && Number.isFinite(dateCell.getTime())) {
      iso = `${dateCell.getUTCFullYear()}-${String(dateCell.getUTCMonth() + 1).padStart(2, '0')}-01`;
    } else {
      iso = monthYearToIso(dateCell);
    }
    const debit = Number(row[debitCol]);
    if (iso && Number.isFinite(debit)) out[iso] = debit;
  }
  return out;
}

async function fetchFinraXlsx() {
  const res = await fetch(FINRA_XLSX_URL, {
    headers: { 'User-Agent': FINRA_XLSX_UA, 'Accept': '*/*' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`FINRA workbook HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const rows = parseFinraXlsx(buffer);
  if (!Object.keys(rows).length) throw new Error('FINRA workbook returned no debit rows');
  return rows;
}

async function scrapeMarginDebt(history) {
  history.marginDebt = history.marginDebt ?? {};

  try {
    Object.assign(history.marginDebt, await fetchFinraXlsx());
    return;
  } catch (e) {
    console.warn(`[usLeverage] FINRA workbook: ${e.message}`);
  }

  const [page] = await crawlPages([FINRA_PAGE_URL]).catch(e => {
    console.warn(`[usLeverage] FINRA page crawl: ${e.message}`);
    return [null];
  });
  if (page?.html) {
    Object.assign(history.marginDebt, parseFinraHtmlTable(page.html));
  }
}

/* ── 2. CFTC TFF leveraged-fund equity-index futures (weekly) ─────── */

const CFTC_TFF_CURRENT_URL = 'https://www.cftc.gov/dea/newcot/FinFutWk.txt';
const CFTC_TFF_HISTORY_URL = year => `https://www.cftc.gov/files/dea/history/fut_fin_txt_${year}.zip`;
const CFTC_MIN_COVERAGE_DAYS = 548; // 18 months
const CFTC_MIN_POINTS = 70;         // weekly data, allowing holiday gaps
const CFTC_BACKFILL_YEARS = 6;

const CFTC_MARKETS = [
  { key: 'ES', label: 'E-mini S&P 500', cftcCode: '13874A' },
  { key: 'NQ', label: 'E-mini Nasdaq-100', cftcCode: '209742' },
  { key: 'RTY', label: 'E-mini Russell 2000', cftcCode: '239742' },
  { key: 'YM', label: 'Dow Jones $5 Index', cftcCode: '124603' },
];

const CFTC_BY_CODE = new Map(CFTC_MARKETS.map(market => [market.cftcCode, market]));

function splitCsvLine(line) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCftcNumber(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseCftcTffText(text) {
  const out = Object.fromEntries(CFTC_MARKETS.map(market => [market.key, {}]));
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    const market = CFTC_BY_CODE.get(String(cols[3] ?? '').trim());
    if (!market) continue;

    const date = String(cols[2] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const point = {
      totalOpenInterest: parseCftcNumber(cols[7]),
      long: parseCftcNumber(cols[14]),
      short: parseCftcNumber(cols[15]),
      spreading: parseCftcNumber(cols[16]),
    };
    if (Object.values(point).every(Number.isFinite)) out[market.key][date] = point;
  }
  return out;
}

function unzipFirstFile(archive, label = 'CFTC TFF') {
  if (archive.length < 30 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${label} download is not a ZIP archive`);
  }
  const flags = archive.readUInt16LE(6);
  const method = archive.readUInt16LE(8);
  const compressedSize = archive.readUInt32LE(18);
  const rawSize = archive.readUInt32LE(22);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  if (flags & 0x01) throw new Error(`${label} ZIP is encrypted`);
  if (flags & 0x08) throw new Error(`${label} ZIP uses an unsupported data descriptor`);
  if (rawSize > 20_000_000) throw new Error(`${label} file is unexpectedly large`);

  const start = 30 + nameLength + extraLength;
  const end = start + compressedSize;
  if (end > archive.length) throw new Error(`${label} ZIP is truncated`);
  const compressed = archive.subarray(start, end);
  const file = method === 0 ? Buffer.from(compressed)
    : method === 8 ? inflateRawSync(compressed)
      : null;
  if (!file) throw new Error(`${label} ZIP compression method ${method} is unsupported`);
  if (rawSize && file.length !== rawSize) throw new Error(`${label} file size does not match ZIP header`);
  return file;
}

function mergeCftc(history, parsed) {
  history.cftc = history.cftc ?? {};
  for (const market of CFTC_MARKETS) {
    history.cftc[market.key] = {
      ...(history.cftc[market.key] ?? {}),
      ...(parsed[market.key] ?? {}),
    };
  }
}

async function fetchCftcTffYear(year) {
  const res = await fetch(CFTC_TFF_HISTORY_URL(year), {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`CFTC TFF ${year} HTTP ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const text = unzipFirstFile(archive, `CFTC TFF ${year}`).toString('utf8');
  return parseCftcTffText(text);
}

async function fetchCftcCurrentTff() {
  const res = await fetch(CFTC_TFF_CURRENT_URL, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`CFTC current TFF HTTP ${res.status}`);
  return parseCftcTffText(await res.text());
}

function hasCftcBackfill(byDate) {
  const dates = Object.keys(byDate ?? {}).sort();
  if (dates.length < CFTC_MIN_POINTS) return false;
  const first = new Date(`${dates[0]}T00:00:00Z`).getTime();
  const last = new Date(`${dates.at(-1)}T00:00:00Z`).getTime();
  return Number.isFinite(first) && Number.isFinite(last)
    && (last - first) / 86400000 >= CFTC_MIN_COVERAGE_DAYS;
}

function cftcYearsToFetch(history) {
  const currentYear = new Date().getUTCFullYear();
  const needsBackfill = CFTC_MARKETS.some(market => !hasCftcBackfill(history.cftc?.[market.key]));
  if (!needsBackfill) return [currentYear];
  return Array.from({ length: CFTC_BACKFILL_YEARS + 1 }, (_, i) => currentYear - CFTC_BACKFILL_YEARS + i);
}

async function scrapeCftcLeveragedFunds(history) {
  history.cftc = history.cftc ?? {};

  for (const year of cftcYearsToFetch(history)) {
    try {
      mergeCftc(history, await fetchCftcTffYear(year));
    } catch (e) {
      console.warn(`[usLeverage] CFTC TFF ${year}: ${e.message}`);
    }
  }

  try {
    mergeCftc(history, await fetchCftcCurrentTff());
  } catch (e) {
    console.warn(`[usLeverage] CFTC current TFF: ${e.message}`);
  }
}

/* ── 3. Leveraged ETF net assets (daily when available) ────────────── */

const PROSHARES_FUNDS = [
  { key: 'TQQQ', label: 'ProShares UltraPro QQQ', leverage: '3x', underlying: 'Nasdaq-100', issuer: 'ProShares', slug: 'tqqq' },
  { key: 'UPRO', label: 'ProShares UltraPro S&P500', leverage: '3x', underlying: 'S&P 500', issuer: 'ProShares', slug: 'upro' },
  { key: 'SSO', label: 'ProShares Ultra S&P500', leverage: '2x', underlying: 'S&P 500', issuer: 'ProShares', slug: 'sso' },
  { key: 'QLD', label: 'ProShares Ultra QQQ', leverage: '2x', underlying: 'Nasdaq-100', issuer: 'ProShares', slug: 'qld' },
  { key: 'ROM', label: 'ProShares Ultra Technology', leverage: '2x', underlying: 'Technology Select Sector', issuer: 'ProShares', slug: 'rom' },
  { key: 'USD', label: 'ProShares Ultra Semiconductors', leverage: '2x', underlying: 'Semiconductors', issuer: 'ProShares', slug: 'usd' },
];

// Direxion's fund pages are Cloudflare-gated like FINRA/OCC, but (verified) the
// page itself is server-rendered, so the no-extra-permission content crawler
// reaches it — unlike OCC's JSON API. Its net-assets figure has not yet been
// located in the rendered DOM (likely a client widget), so this stays
// best-effort: a miss just leaves that fund out of the table, same as Japan's
// current-only-snapshot funds (Simplex/EZJ).
const DIREXION_FUNDS = [
  { key: 'SPXL', label: 'Direxion Daily S&P 500 Bull 3X', leverage: '3x', underlying: 'S&P 500', issuer: 'Direxion', url: 'https://www.direxion.com/product/daily-sp-500-bull-bear-3x-etfs' },
  { key: 'SOXL', label: 'Direxion Daily Semiconductor Bull 3X', leverage: '3x', underlying: 'Semiconductors', issuer: 'Direxion', url: 'https://www.direxion.com/product/daily-semiconductor-bull-bear-3x-etfs' },
  { key: 'TNA', label: 'Direxion Daily Small Cap Bull 3X', leverage: '3x', underlying: 'Russell 2000', issuer: 'Direxion', url: 'https://www.direxion.com/product/daily-small-cap-bull-bear-3x-etfs' },
];

const ETF_FUNDS = [...PROSHARES_FUNDS, ...DIREXION_FUNDS];

// ProShares' own fund page links a "NAV History" download (visible in its
// rendered HTML as a plain <a href> — no widget/JS needed) serving each
// fund's complete daily history back to inception, with net assets (labelled
// "Assets Under Management") as its own column — not the current-day-only
// snapshot this used to scrape from the page itself.
function parseProSharesNavHistoryCsv(text) {
  const out = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const m = cols[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    const aum = Number(cols[8]);
    if (Number.isFinite(aum)) out[`${m[3]}-${m[1]}-${m[2]}`] = aum;
  }
  return out;
}

async function fetchProSharesNavHistory(fund) {
  const url = `https://accounts.profunds.com/etfdata/ByFund/${fund.key}-historical_nav.csv`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`ProShares ${fund.key} NAV history HTTP ${res.status}`);
  const rows = parseProSharesNavHistoryCsv(await res.text());
  if (!Object.keys(rows).length) throw new Error(`ProShares ${fund.key}: NAV history returned no rows`);
  return rows;
}

/** A ticker-labelled dollar figure near a "net asset"/"fund size" heading —
 *  best-effort text search since Direxion's actual DOM layout for this figure
 *  hasn't been directly observed (see DIREXION_FUNDS note above). */
function parseDirexionNetAssets(html, ticker) {
  const $ = cheerio.load(html);
  const text = $.text();
  const idx = text.search(new RegExp(`${ticker}[\\s\\S]{0,400}?(?:net assets|fund size|assets under management)`, 'i'));
  if (idx < 0) return null;
  const window = text.slice(idx, idx + 500);
  const m = window.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s?(million|billion|M|B)?/i);
  if (!m) return null;
  let value = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] ?? '').toLowerCase();
  if (unit.startsWith('b')) value *= 1e9;
  else if (unit.startsWith('m')) value *= 1e6;
  return Number.isFinite(value) ? value : null;
}

async function scrapeEtfNetAssets(history) {
  history.etf = history.etf ?? {};
  const today = new Date().toISOString().slice(0, 10);

  // The CSV always serves the fund's complete history in one request, so —
  // same as japanLeverage's issuer CSVs — every run just re-merges the whole
  // thing rather than tracking an incremental cursor.
  const proSharesResults = await Promise.allSettled(PROSHARES_FUNDS.map(fund => fetchProSharesNavHistory(fund)));
  proSharesResults.forEach((result, i) => {
    const fund = PROSHARES_FUNDS[i];
    if (result.status === 'fulfilled') {
      history.etf[fund.key] = { ...(history.etf[fund.key] ?? {}), ...result.value };
    } else {
      console.warn(`[usLeverage] ${fund.key}: ${result.reason.message}`);
    }
  });

  const direxionPages = await crawlPages(DIREXION_FUNDS.map(f => f.url)).catch(e => {
    console.warn(`[usLeverage] Direxion crawl: ${e.message}`);
    return DIREXION_FUNDS.map(() => null);
  });
  DIREXION_FUNDS.forEach((fund, i) => {
    const page = direxionPages[i];
    if (!page?.html) return;
    const aum = parseDirexionNetAssets(page.html, fund.key);
    if (Number.isFinite(aum)) history.etf[fund.key] = { ...(history.etf[fund.key] ?? {}), [today]: aum };
    else console.warn(`[usLeverage] Direxion ${fund.key}: net assets not found in page`);
  });
}

/** Sums all nine funds' AUM into one bull-leveraged-ETF total (same "carry
 *  forward through gaps" shape as japanLeverage's assembleEtf), plus a
 *  latest-snapshot fund table. All nine funds are long/bull leveraged
 *  products, so summing them is a like-for-like total, unlike stock-loan
 *  balances (which the OCC's own report keeps per-security). */
function assembleEtf(history) {
  const keys = ETF_FUNDS.map(f => f.key);
  const dates = [...new Set(keys.flatMap(key => Object.keys(history.etf?.[key] ?? {})))].sort();

  const lastAum = {};
  const totalByDay = {};
  for (const day of dates) {
    for (const key of keys) {
      const aum = history.etf?.[key]?.[day];
      if (Number.isFinite(aum)) lastAum[key] = aum;
    }
    const known = keys.filter(key => Number.isFinite(lastAum[key]));
    if (known.length) totalByDay[day] = known.reduce((sum, key) => sum + lastAum[key], 0);
  }

  let last = null;
  const total = dates.map(day => {
    const v = totalByDay[day];
    if (Number.isFinite(v)) last = v;
    return Number.isFinite(last) ? round2(last / 1e9) : null; // -> billions
  });

  const fundsDate = [...dates].reverse().find(day => keys.some(key => history.etf?.[key]?.[day] != null)) ?? null;
  const funds = ETF_FUNDS
    .filter(f => Number.isFinite(lastAum[f.key]))
    .map(f => ({ ...f, aum: round2(lastAum[f.key] / 1e9) }))
    .sort((a, b) => b.aum - a.aum);

  return { dates, total, funds, fundsDate };
}

/* ── Assemble + top-level entry points ─────────────────────────────── */

function assembleSeries(byDate, scale = 1) {
  const dates = Object.keys(byDate ?? {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const values = dates.map(d => (Number.isFinite(byDate[d]) ? round2(byDate[d] * scale) : null));
  return { dates, values, latest: { date: dates.at(-1) ?? null, value: values.at(-1) ?? null } };
}

function assembleCftcMarket(byDate) {
  const dates = Object.keys(byDate ?? {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const series = key => dates.map(d => (Number.isFinite(byDate[d]?.[key]) ? byDate[d][key] : null));
  const latestDate = dates.at(-1) ?? null;
  const latestPoint = latestDate ? byDate[latestDate] : null;
  return {
    dates,
    long: series('long'),
    short: series('short'),
    spreading: series('spreading'),
    totalOpenInterest: series('totalOpenInterest'),
    latest: {
      date: latestDate,
      long: latestPoint?.long ?? null,
      short: latestPoint?.short ?? null,
      spreading: latestPoint?.spreading ?? null,
      totalOpenInterest: latestPoint?.totalOpenInterest ?? null,
    },
  };
}

function assemble(history) {
  return {
    marginDebt: assembleSeries(history.marginDebt, 1 / 1000), // $M -> $B
    cftc: {
      contracts: Object.fromEntries(CFTC_MARKETS.map(market => [
        market.key,
        { label: market.label, cftcCode: market.cftcCode, ...assembleCftcMarket(history.cftc?.[market.key]) },
      ])),
    },
    leveragedEtf: assembleEtf(history),
    updatedAt: new Date().toISOString(),
  };
}

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

async function getUsLeverage() {
  const history = loadHistory();

  await Promise.allSettled([
    scrapeMarginDebt(history),
    scrapeCftcLeveragedFunds(history),
    scrapeEtfNetAssets(history),
  ]);

  saveHistory(history);
  return assemble(history);
}

function readUsLeverage() { return assemble(loadHistory()); }

module.exports = {
  getUsLeverage,
  readUsLeverage,
  _test: {
    assemble, assembleCftcMarket, assembleEtf, assembleSeries,
    monthYearToIso, parseFinraHtmlTable, parseFinraXlsx,
    parseCftcTffText, splitCsvLine, unzipFirstFile,
    parseProSharesNavHistoryCsv, parseDirexionNetAssets,
    CFTC_MARKETS, ETF_FUNDS, PROSHARES_FUNDS, DIREXION_FUNDS,
  },
};
