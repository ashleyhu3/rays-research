'use strict';

const shortInterestStore = require('../shortInterestStore');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    });
  }
  return _yf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      const rateLimited = e.message?.includes('429') || /Too Many Requests|crumb/i.test(e.message ?? '');
      if (i === tries || !rateLimited) throw e;
      await sleep(1500 * i);
    }
  }
}

function isoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function fmtLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

async function getStockHistory(ticker) {
  const yf = getYF();
  const end   = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);

  const [chartRes, statsRes] = await Promise.allSettled([
    withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1wk' })),
    withRetry(() => yf.quoteSummary(ticker, { modules: ['defaultKeyStatistics', 'price'] })),
  ]);

  if (chartRes.status === 'rejected') throw new Error(chartRes.reason?.message ?? 'Chart fetch failed');

  const quotes = (chartRes.value?.quotes ?? []).filter(q => q.date && q.close != null);
  if (!quotes.length) throw new Error(`No price history found for ${ticker}`);

  const dates   = quotes.map(q => isoDate(q.date));
  const labels  = dates.map(fmtLabel);
  const prices  = quotes.map(q => q.close ?? null);
  const volumes = quotes.map(q => q.volume ?? null);

  const stats = statsRes.status === 'fulfilled' ? statsRes.value : {};
  const ks    = stats.defaultKeyStatistics ?? {};
  const pr    = stats.price ?? {};

  const shortPercentOfFloat = ks.shortPercentOfFloat ?? null;
  const shortRatio          = ks.shortRatio          ?? null;
  const sharesShort         = ks.sharesShort         ?? null;

  // Persist snapshot whenever Yahoo Finance delivers real data, then build the
  // time series from accumulated history instead of synthetic simulation.
  shortInterestStore.record(ticker, shortPercentOfFloat, shortRatio, sharesShort);
  const shortRatios = shortInterestStore.buildSeries(ticker, dates);

  return {
    ticker: ticker.toUpperCase(),
    name: pr.longName ?? pr.shortName ?? ticker,
    dates,
    labels,
    prices,
    volumes,
    shortRatios,
    shortPercentOfFloat,
    shortRatio,
    sharesShort,
  };
}

module.exports = { getStockHistory };
