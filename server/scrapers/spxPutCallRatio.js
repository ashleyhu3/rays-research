/**
 * S&P 500 (SPX) Put/Call Ratio — Volume and Open Interest, from Barchart's
 * live quote page (https://www.barchart.com/stocks/quotes/$SPX/put-call-ratios).
 *
 * This is a current-day snapshot only — Barchart shows no historical time
 * series, and CBOE stopped publishing free historical put/call data in Oct
 * 2019 (confirmed directly: their CSV archives are frozen there). There is
 * no full-history backfill available for this metric from any free source.
 * So, same shape as usLeverage/aaiiSentiment's rendered-page fallback: this
 * scrapes today's totals via the Apify content crawler (the page's real
 * numbers are populated client-side after render, not present in the raw
 * HTML — confirmed directly, so there is no plain-fetch path worth
 * attempting first) and persists one point per calendar date, accumulating
 * real history from here forward rather than backfilling.
 */
'use strict';
const cheerio = require('cheerio');
const path = require('path');
const storage = require('../storage');
const { crawlPages } = require('./apifyCrawler');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'spxPutCallRatioHistory.json');
const BLOB = 'spxPutCallRatioHistory';

const PAGE_URL = 'https://www.barchart.com/stocks/quotes/$SPX/put-call-ratios';

function round2(v) { return Math.round(v * 100) / 100; }

/** Barchart renders each figure as a labelled row:
 *  <div class="bc-futures-options-quotes-totals__data-row">
 *    Put Volume Total <strong class="right">814,875</strong>
 *  </div>
 *  — matched by label text rather than position, since row order isn't
 *  guaranteed to stay fixed. */
function parseBarchartSpxPutCall(html) {
  const $ = cheerio.load(html);
  const out = {};
  $('.bc-futures-options-quotes-totals__data-row').each((_, el) => {
    const $el = $(el);
    const valueText = $el.find('strong').first().text().trim();
    const label = $el.clone().children('strong').remove().end().text().replace(/\s+/g, ' ').trim();
    const value = Number(valueText.replace(/,/g, ''));
    if (!Number.isFinite(value)) return;

    if (/^Put Volume Total$/i.test(label)) out.putVolume = value;
    else if (/^Call Volume Total$/i.test(label)) out.callVolume = value;
    else if (/^Put\/Call Volume Ratio$/i.test(label)) out.volumeRatio = value;
    else if (/^Put Open Interest Total$/i.test(label)) out.putOpenInterest = value;
    else if (/^Call Open Interest Total$/i.test(label)) out.callOpenInterest = value;
    else if (/^Put\/Call Open Interest Ratio$/i.test(label)) out.oiRatio = value;
  });

  // Recompute the ratios from the raw totals when both are present — more
  // precise than Barchart's own 2-decimal display value — falling back to
  // their displayed ratio only if a raw total is missing.
  const volumeRatio = out.callVolume ? round2(out.putVolume / out.callVolume) : out.volumeRatio;
  const oiRatio = out.callOpenInterest ? round2(out.putOpenInterest / out.callOpenInterest) : out.oiRatio;
  return { ...out, volumeRatio, oiRatio };
}

async function scrapeSpxPutCallRatio(history) {
  history.daily = history.daily ?? {};

  const [page] = await crawlPages([PAGE_URL]);
  if (!page?.html) throw new Error('Barchart SPX put/call page crawl returned no content');

  const row = parseBarchartSpxPutCall(page.html);
  if (!Number.isFinite(row.volumeRatio) && !Number.isFinite(row.oiRatio)) {
    throw new Error('Barchart SPX put/call page: no ratio values parsed');
  }

  // One point per calendar date — a same-day re-scrape (this only runs a few
  // times a day) just overwrites today's entry with the latest intraday read.
  const today = new Date().toISOString().slice(0, 10);
  history.daily[today] = row;
}

function assemble(history) {
  const byDate = history.daily ?? {};
  const dates = Object.keys(byDate).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const latestDate = dates.at(-1) ?? null;
  return {
    dates,
    volumeRatio: dates.map(d => byDate[d]?.volumeRatio ?? null),
    oiRatio: dates.map(d => byDate[d]?.oiRatio ?? null),
    putVolume: dates.map(d => byDate[d]?.putVolume ?? null),
    callVolume: dates.map(d => byDate[d]?.callVolume ?? null),
    putOpenInterest: dates.map(d => byDate[d]?.putOpenInterest ?? null),
    callOpenInterest: dates.map(d => byDate[d]?.callOpenInterest ?? null),
    latest: latestDate ? { date: latestDate, ...byDate[latestDate] } : null,
    updatedAt: new Date().toISOString(),
  };
}

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

async function getSpxPutCallRatio() {
  const history = loadHistory();
  await scrapeSpxPutCallRatio(history);
  saveHistory(history);
  return assemble(history);
}

function readSpxPutCallRatio() { return assemble(loadHistory()); }

module.exports = {
  getSpxPutCallRatio,
  readSpxPutCallRatio,
  _test: { assemble, parseBarchartSpxPutCall },
};
