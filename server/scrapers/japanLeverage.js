/**
 * Japan market-wide margin trading balance — JPX's official "Outstanding
 * Margin Trading (Negotiable/Standardized)" report, Tokyo + Nagoya combined,
 * one point per week (application-date basis; JPX updates this end-of-week,
 * not daily). This is deliberately weekly, not daily: JPX does not publish a
 * market-wide margin balance more often than that, and JSF's own daily feed
 * is per-security only — there is no official daily market aggregate to
 * chart, and summing individual issues would be a derived total, not an
 * official one.
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
 */
const XLSX = require('@e965/xlsx');
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'japanLeverageHistory.json');
const BLOB = 'japanLeverageHistory';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE_URL = 'https://www.jpx.co.jp/english/markets/statistics-equities/margin/06.html';

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

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

/**
 * The workbook always serves its full weekly history (2002 → present) in one
 * file, so every run just re-parses the whole thing and merges it into the
 * stored history — cheap (one page fetch + one ~200KB xls), and self-healing
 * if a prior run's parse was ever incomplete.
 */
async function getJapanLeverage() {
  const url = await findWorkbookUrl();
  const buffer = await fetchWorkbook(url);
  const rows = parseWorkbook(buffer);
  if (!Object.keys(rows).length) throw new Error('JPX margin workbook returned no rows');

  const history = loadHistory();
  for (const [day, row] of Object.entries(rows)) history[day] = row;
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

  return { dates, purchases, sales, ratio, latest, updatedAt: new Date().toISOString() };
}

function readJapanLeverage() { return assemble(loadHistory()); }

module.exports = { getJapanLeverage, readJapanLeverage, _test: { assemble, parseWorkbook } };
