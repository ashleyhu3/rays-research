'use strict';

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

// Fetch bi-monthly FINRA short interest from Massive for the past year.
async function massiveShortInterest(ticker, from) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return [];
  const url = `https://api.massive.com/stocks/v1/short-interest?ticker=${encodeURIComponent(ticker)}&settlement_date.gte=${from}&order=asc&limit=50`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

// Interpolate bi-monthly days_to_cover values onto weekly price dates.
function interpolateShortRatios(siRows, dates) {
  if (!siRows.length) return dates.map(() => null);
  return dates.map(date => {
    let before = null, after = null;
    for (const p of siRows) {
      if (p.settlement_date <= date) before = p;
      else if (!after) { after = p; break; }
    }
    const dtc = p => p?.days_to_cover ?? null;
    if (before && after && dtc(before) != null && dtc(after) != null) {
      const ms0  = new Date(before.settlement_date).getTime();
      const ms1  = new Date(after.settlement_date).getTime();
      const ms   = new Date(date).getTime();
      const frac = ms1 > ms0 ? (ms - ms0) / (ms1 - ms0) : 0;
      return +((dtc(before) + frac * (dtc(after) - dtc(before))).toFixed(2));
    }
    if (before && dtc(before) != null) return +dtc(before).toFixed(2);
    if (after  && dtc(after)  != null) return +dtc(after).toFixed(2);
    return null;
  });
}

async function getStockHistory(ticker) {
  const yf  = getYF();
  const end  = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  const yrAgo = start.toISOString().slice(0, 10);

  const [chartRes, statsRes, siRows] = await Promise.allSettled([
    withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1wk' })),
    withRetry(() => yf.quoteSummary(ticker, { modules: ['price'] })),
    massiveShortInterest(ticker.toUpperCase(), yrAgo),
  ]);

  if (chartRes.status === 'rejected') throw new Error(chartRes.reason?.message ?? 'Chart fetch failed');

  const quotes = (chartRes.value?.quotes ?? []).filter(q => q.date && q.close != null);
  if (!quotes.length) throw new Error(`No price history found for ${ticker}`);

  const dates   = quotes.map(q => isoDate(q.date));
  const labels  = dates.map(fmtLabel);
  const prices  = quotes.map(q => q.close ?? null);
  const volumes = quotes.map(q => q.volume ?? null);

  const pr = statsRes.status === 'fulfilled' ? (statsRes.value?.price ?? {}) : {};

  const rows        = siRows.status === 'fulfilled' ? siRows.value : [];
  const latest      = rows[rows.length - 1] ?? null;
  const shortRatio  = latest?.days_to_cover  ?? null;
  const sharesShort = latest?.short_interest  ?? null;
  const shortRatios = interpolateShortRatios(rows, dates);

  return {
    ticker: ticker.toUpperCase(),
    name: pr.longName ?? pr.shortName ?? ticker,
    dates,
    labels,
    prices,
    volumes,
    shortRatios,
    shortRatio,
    sharesShort,
  };
}

module.exports = { getStockHistory };
