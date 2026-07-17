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

// Bounded-concurrency map, same pattern as generateDailyOptionsReport.js —
// fetching every ticker fully in parallel is the main source of Yahoo 429s.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return out;
}

const TICKERS = [
  // Sector rotation (overview chart + per-sector ratio vs SPX)
  { ticker: 'XLC',   label: 'XLC',  name: 'Communication Services' },
  { ticker: 'XLY',   label: 'XLY',  name: 'Consumer Discretionary' },
  { ticker: 'XLP',   label: 'XLP',  name: 'Consumer Staples' },
  { ticker: 'XLE',   label: 'XLE',  name: 'Energy' },
  { ticker: 'XLF',   label: 'XLF',  name: 'Financial' },
  { ticker: 'XLV',   label: 'XLV',  name: 'Health Care' },
  { ticker: 'XLI',   label: 'XLI',  name: 'Industrial' },
  { ticker: 'XLB',   label: 'XLB',  name: 'Materials' },
  { ticker: 'XLRE',  label: 'XLRE', name: 'Real Estate' },
  { ticker: 'XLK',   label: 'XLK',  name: 'Technology' },
  { ticker: 'XLU',   label: 'XLU',  name: 'Utilities' },
  { ticker: '^GSPC', label: 'SPX',  name: 'S&P 500' },

  // Tech ratio pairs (SOX/SPX, SOX/IGV, SOX/MAGS, MAGS/SPX, IGV/SPX, CIBR/IGV)
  { ticker: '^SOX', label: 'SOX',  name: 'Semiconductors' },
  { ticker: 'IGV',  label: 'IGV',  name: 'Software' },
  { ticker: 'MAGS', label: 'MAGS', name: 'Magnificent Seven' },
  { ticker: 'CIBR', label: 'CIBR', name: 'Cybersecurity' },

  // Correlation section (SOX/KWEB cross-correlations)
  { ticker: '^NDX', label: 'NDX',  name: 'Nasdaq 100' },
  { ticker: 'KWEB', label: 'KWEB', name: 'China Internet (KWEB)' },

  // Theme ETFs vs SPX
  { ticker: 'XBI',  label: 'XBI',  name: 'Biotechnology' },
  { ticker: 'IHI',  label: 'IHI',  name: 'Medical Devices' },
  { ticker: 'ITA',  label: 'ITA',  name: 'Aerospace & Defense' },
  { ticker: 'GDX',  label: 'GDX',  name: 'Gold Miners' },
  { ticker: 'COPX', label: 'COPX', name: 'Copper Miners' },
  { ticker: 'XHB',  label: 'XHB',  name: 'Homebuilders' },
  { ticker: 'XRT',  label: 'XRT',  name: 'Retail' },
  { ticker: 'OIH',  label: 'OIH',  name: 'Oil Services' },
  { ticker: 'KBE',  label: 'KBE',  name: 'Banks' },
  { ticker: 'MOO',  label: 'MOO',  name: 'Agribusiness' },
  { ticker: 'BOTZ', label: 'BOTZ', name: 'Robotics & AI' },

  // Factor ETFs vs SPX
  { ticker: 'MTUM', label: 'MTUM', name: 'Momentum Factor' },
  { ticker: 'VLUE', label: 'VLUE', name: 'Value Factor' },
  { ticker: 'QUAL', label: 'QUAL', name: 'Quality Factor' },
  { ticker: 'USMV', label: 'USMV', name: 'Min Volatility Factor' },
];

async function fetchSeries(yf, ticker, start, end) {
  const chart = await withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1d' }));
  const quotes = (chart?.quotes ?? []).filter(q => q.date && q.close != null);
  // adjclose is absent for indices (no dividends to adjust for) — fall back to close.
  return quotes.map(q => ({ date: isoDate(q.date), close: q.close, adjClose: q.adjclose ?? q.close }));
}

function inclusiveEndDate(endDate) {
  const end = new Date(endDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function getUsPerformance(startDate, endDate = new Date()) {
  const yf  = getYF();
  const end = inclusiveEndDate(endDate);
  const start = new Date(startDate);

  const results = await mapLimit(TICKERS, 4, async meta => {
    try {
      const points = await fetchSeries(yf, meta.ticker, start, end);
      return { ...meta, points, error: null };
    } catch (e) {
      return { ...meta, points: [], error: e.message };
    }
  });

  // Union of all trading dates across every series (all trade on NYSE hours,
  // but several tickers here — e.g. MAGS, BOTZ — listed well after SPX, and
  // any single feed can be momentarily short a day, so union — not intersect
  // — keeps a late-listed or partially-failed series from truncating everyone
  // else's).
  const dateSet = new Set();
  for (const r of results) for (const p of r.points) dateSet.add(p.date);
  const dates = [...dateSet].sort();

  const series = results.map(r => {
    const byDate = new Map(r.points.map(p => [p.date, p.close]));
    const byDateAdj = new Map(r.points.map(p => [p.date, p.adjClose]));
    return {
      ticker: r.ticker,
      label: r.label,
      name: r.name,
      closes: dates.map(d => byDate.get(d) ?? null),
      adjCloses: dates.map(d => byDateAdj.get(d) ?? null),
      error: r.error,
    };
  });

  return { start: dates[0] ?? isoDate(start), end: dates[dates.length - 1] ?? isoDate(endDate), dates, series };
}

module.exports = { getUsPerformance, TICKERS };
