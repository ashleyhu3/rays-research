/**
 * AAII Investor Sentiment Survey — weekly % Bullish / Neutral / Bearish,
 * published every Thursday since 1987.
 *
 * Primary source is AAII's own historical workbook (sentiment.xls), which
 * carries the full history in one file. That URL sits behind Incapsula
 * bot-management, so the direct fetch below is best-effort and, when it
 * fails, this falls back to scraping the rendered "Past Results" page
 * (~20 trailing weeks) via the same Apify content crawler usLeverage.js uses
 * for FINRA/Direxion — same shape as usLeverage's "full workbook, else
 * rendered HTML table" fallback. Every successful scrape (whichever path)
 * merges into the persisted history, so the trailing-window fallback still
 * accumulates full depth over time even when the workbook stays blocked.
 */
'use strict';
const cheerio = require('cheerio');
const XLSX = require('@e965/xlsx');
const path = require('path');
const storage = require('../storage');
const { crawlPages } = require('./apifyCrawler');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'aaiiSentimentHistory.json');
const BLOB = 'aaiiSentimentHistory';

const XLS_URL = 'https://www.aaii.com/files/surveys/sentiment.xls';
const RESULTS_PAGE_URL = 'https://www.aaii.com/sentimentsurvey/sent_results';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MONTH_ABBR = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const round2 = v => Math.round(v * 100) / 100;

function excelSerialToIso(serial) {
  if (!Number.isFinite(serial)) return null;
  const utcDays = Math.floor(serial - 25569); // Excel epoch -> Unix epoch, days
  const d = new Date(utcDays * 86400 * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/** Full historical workbook (weekly, back to 1987). Column positions are
 *  located by header text, same approach as usLeverage's FINRA parser,
 *  since AAII has reshuffled this sheet's layout before. */
function parseAaiiXlsx(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = book.SheetNames.find(name => /sentiment/i.test(name)) ?? book.SheetNames[0];
  const sheet = book.Sheets[sheetName];
  if (!sheet) return {};
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  let dateCol = -1, bullCol = -1, neutCol = -1, bearCol = -1;
  for (const row of rows) {
    const cellText = i => String(row[i] ?? '').trim();
    const d = row.findIndex((_, i) => /^date$/i.test(cellText(i)));
    const b = row.findIndex((_, i) => /^bullish$/i.test(cellText(i)));
    const n = row.findIndex((_, i) => /^neutral$/i.test(cellText(i)));
    const be = row.findIndex((_, i) => /^bearish$/i.test(cellText(i)));
    if (d >= 0 && b >= 0 && be >= 0) { dateCol = d; bullCol = b; neutCol = n; bearCol = be; break; }
  }
  if (dateCol < 0) return {};

  // The workbook stores these as decimal fractions (0.449) in some releases
  // and as already-scaled percentages (44.9) in others — detect the scale
  // from the first valid reading rather than assuming either.
  let scale = null;
  const out = {};
  for (const row of rows) {
    const dateCell = row[dateCol];
    let iso = null;
    if (dateCell instanceof Date && Number.isFinite(dateCell.getTime())) {
      iso = `${dateCell.getUTCFullYear()}-${String(dateCell.getUTCMonth() + 1).padStart(2, '0')}-${String(dateCell.getUTCDate()).padStart(2, '0')}`;
    } else if (typeof dateCell === 'number') {
      iso = excelSerialToIso(dateCell);
    }
    if (!iso) continue;

    const rawBull = Number(row[bullCol]);
    const rawBear = Number(row[bearCol]);
    if (!Number.isFinite(rawBull) || !Number.isFinite(rawBear)) continue;
    if (scale == null) scale = Math.abs(rawBull) <= 1.5 ? 100 : 1;

    const rawNeut = neutCol >= 0 ? Number(row[neutCol]) : null;
    out[iso] = {
      bullish: round2(rawBull * scale),
      neutral: Number.isFinite(rawNeut) ? round2(rawNeut * scale) : null,
      bearish: round2(rawBear * scale),
    };
  }
  return out;
}

/** "Mon D" (no year, as shown on the trailing Past Results table) resolved
 *  against a running anchor date — pick whichever of the 3 nearby years
 *  lands closest to the anchor, which correctly resolves the Dec→Jan
 *  wraparound since a full year is far larger than the ~7-day step between
 *  neighboring weekly rows. `anchor` is advanced to each resolved date as
 *  the table is walked, in whatever order it's rendered. */
function resolveYearlessDate(monthName, day, anchor) {
  const mi = MONTH_ABBR[String(monthName ?? '').slice(0, 3).toLowerCase()];
  if (mi == null || !Number.isFinite(day)) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const y of [anchor.getUTCFullYear() - 1, anchor.getUTCFullYear(), anchor.getUTCFullYear() + 1]) {
    const candidate = new Date(Date.UTC(y, mi, day));
    const diff = Math.abs(candidate.getTime() - anchor.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = candidate; }
  }
  return best ? best.toISOString().slice(0, 10) : null;
}

function parseFlexibleDate(text, anchor) {
  const cleaned = String(text ?? '').trim();

  const slash = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const withYear = cleaned.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (withYear) {
    const mi = MONTH_ABBR[withYear[1].slice(0, 3).toLowerCase()];
    if (mi == null) return null;
    return `${withYear[3]}-${String(mi + 1).padStart(2, '0')}-${String(withYear[2]).padStart(2, '0')}`;
  }

  const noYear = cleaned.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (noYear) return resolveYearlessDate(noYear[1], Number(noYear[2]), anchor);

  return null;
}

function parsePercentCell(text) {
  const n = Number(String(text ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? round2(n) : null;
}

/** Trailing-window fallback: the "Past Results" page renders a plain HTML
 *  table (Reported Date | Bullish | Neutral | Bearish) with values already
 *  percent-scaled — no extra Apify permission needed, same as usLeverage's
 *  FINRA HTML-table fallback. */
function parseAaiiHtmlTable(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('table').each((_, table) => {
    const headers = $(table).find('tr').first().find('th,td')
      .map((__, el) => $(el).text().trim().toLowerCase()).get();
    const dateCol = headers.findIndex(h => /date/.test(h));
    const bullCol = headers.findIndex(h => /bullish/.test(h));
    const neutCol = headers.findIndex(h => /neutral/.test(h));
    const bearCol = headers.findIndex(h => /bearish/.test(h));
    if (dateCol < 0 || bullCol < 0 || bearCol < 0) return;

    let anchor = new Date();
    $(table).find('tr').slice(1).each((__, tr) => {
      const cells = $(tr).find('td');
      if (!cells.length) return;
      const bullish = parsePercentCell($(cells[bullCol]).text());
      const bearish = parsePercentCell($(cells[bearCol]).text());
      if (bullish == null || bearish == null) return;
      const iso = parseFlexibleDate($(cells[dateCol]).text(), anchor);
      if (!iso) return;
      anchor = new Date(`${iso}T00:00:00Z`);
      const neutral = neutCol >= 0 ? parsePercentCell($(cells[neutCol]).text()) : null;
      out[iso] = { bullish, neutral, bearish };
    });
  });
  return out;
}

async function scrapeAaiiSentiment(history) {
  history.weekly = history.weekly ?? {};

  try {
    const res = await fetch(XLS_URL, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`AAII workbook HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const rows = parseAaiiXlsx(buffer);
    if (!Object.keys(rows).length) throw new Error('AAII workbook returned no rows');
    Object.assign(history.weekly, rows);
    return;
  } catch (e) {
    console.warn(`[aaiiSentiment] workbook: ${e.message}`);
  }

  const [page] = await crawlPages([RESULTS_PAGE_URL]).catch(e => {
    console.warn(`[aaiiSentiment] results page crawl: ${e.message}`);
    return [null];
  });
  if (page?.html) {
    const rows = parseAaiiHtmlTable(page.html);
    if (Object.keys(rows).length) Object.assign(history.weekly, rows);
    else console.warn('[aaiiSentiment] results page: no rows parsed');
  }
}

function assemble(history) {
  const byDate = history.weekly ?? {};
  const dates = Object.keys(byDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const latestDate = dates.at(-1) ?? null;
  return {
    dates,
    bullish: dates.map(d => byDate[d]?.bullish ?? null),
    neutral: dates.map(d => byDate[d]?.neutral ?? null),
    bearish: dates.map(d => byDate[d]?.bearish ?? null),
    latest: latestDate ? { date: latestDate, ...byDate[latestDate] } : null,
    updatedAt: new Date().toISOString(),
  };
}

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

async function getAaiiSentiment() {
  const history = loadHistory();
  await scrapeAaiiSentiment(history);
  saveHistory(history);
  return assemble(history);
}

function readAaiiSentiment() { return assemble(loadHistory()); }

module.exports = {
  getAaiiSentiment,
  readAaiiSentiment,
  _test: {
    assemble, parseAaiiXlsx, parseAaiiHtmlTable, parseFlexibleDate, resolveYearlessDate, excelSerialToIso,
  },
};
