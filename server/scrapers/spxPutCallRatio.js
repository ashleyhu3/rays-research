/**
 * S&P 500 (SPX) Put/Call Ratio — Volume and Open Interest, from Barchart's
 * quote page and the same options-historical request that powers its chart.
 *
 * Barchart's lower chart requests the latest 200 daily observations from its
 * first-party JSON proxy. The proxy requires the anonymous session cookies
 * and anti-forgery tokens established by loading the quote page first, so the
 * scraper performs that handshake before requesting the chart data.
 */
'use strict';
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'spxPutCallRatioHistory.json');
const BLOB = 'spxPutCallRatioHistory';

const PAGE_URL = 'https://www.barchart.com/stocks/quotes/$SPX/put-call-ratios';
const HISTORY_URL = 'https://www.barchart.com/proxies/core-api/v1/options-historical/get';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

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

function parseBarchartHistory(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data
    .map(item => ({
      date: typeof item?.date === 'string' ? item.date : '',
      volumeRatio: Number(item?.putCallVolumeRatio),
      oiRatio: Number(item?.putCallOpenInterestRatio),
    }))
    .filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date)
      && (Number.isFinite(item.volumeRatio) || Number.isFinite(item.oiRatio)));
}

function sessionHeaders(response, html) {
  const setCookies = response.headers?.['set-cookie'] ?? [];
  const cookies = setCookies.map(value => value.split(';', 1)[0]);
  const xsrf = cookies.find(value => value.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length);
  const csrf = cheerio.load(html)('meta[name="csrf-token"]').attr('content');
  if (!cookies.length || !xsrf || !csrf) {
    throw new Error('Barchart session did not include the cookies and anti-forgery tokens required by its chart feed');
  }
  return {
    Accept: 'application/json',
    Cookie: cookies.join('; '),
    Referer: PAGE_URL.replace('$', '%24'),
    'User-Agent': USER_AGENT,
    'X-CSRF-TOKEN': csrf,
    'X-XSRF-TOKEN': xsrf,
  };
}

function mergeHistoricalRows(history, rows) {
  history.daily = history.daily ?? {};
  for (const row of rows) {
    history.daily[row.date] = {
      ...history.daily[row.date],
      ...(Number.isFinite(row.volumeRatio) ? { volumeRatio: row.volumeRatio } : {}),
      ...(Number.isFinite(row.oiRatio) ? { oiRatio: row.oiRatio } : {}),
    };
  }
}

async function scrapeSpxPutCallRatio(history) {
  const page = await axios.get(PAGE_URL, {
    timeout: 30_000,
    headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
  });
  const html = String(page.data ?? '');
  const response = await axios.get(HISTORY_URL, {
    timeout: 30_000,
    headers: sessionHeaders(page, html),
    params: {
      symbol: '$SPX',
      fields: 'putCallVolumeRatio,putCallOpenInterestRatio,date',
      limit: 200,
      orderBy: 'date',
      orderDir: 'desc',
    },
  });
  const rows = parseBarchartHistory(response.data);
  if (!rows.length) {
    throw new Error('Barchart SPX put/call chart feed returned no historical ratio values');
  }
  mergeHistoricalRows(history, rows);
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
  _test: {
    assemble,
    mergeHistoricalRows,
    parseBarchartHistory,
    parseBarchartSpxPutCall,
    sessionHeaders,
  },
};
