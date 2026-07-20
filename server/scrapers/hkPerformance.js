'use strict';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function yyyymmdd(d) {
  return isoDate(d).replace(/-/g, '');
}

// Bounded-concurrency map, same pattern as hkChinaPerformance.js.
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

// Hang Seng Composite Index series — no coverage on Yahoo Finance for these
// sub-indices, fetched from East Money's public kline API instead (secid
// market "124" = Hang Seng indices). Same flaky-under-load endpoint as
// hkChinaPerformance.js's ChiNext/STAR50 fallback, so same retry/backoff.
const TICKERS = [
  { ticker: '800701', eastmoneyCode: 'HSCI',   label: '800701', name: 'HSCI' },

  // Sector
  { ticker: '800706', eastmoneyCode: 'HSCIIT', label: '800706', name: 'Information Tech' },
  { ticker: '800704', eastmoneyCode: 'HSCICH', label: '800704', name: 'Healthcare' },
  { ticker: '800702', eastmoneyCode: 'HSCICD', label: '800702', name: 'Consumer Discretionary' },
  { ticker: '800703', eastmoneyCode: 'HSCICS', label: '800703', name: 'Consumer Staples' },
  { ticker: '800712', eastmoneyCode: 'HSCIMT', label: '800712', name: 'Materials' },
  { ticker: '800713', eastmoneyCode: 'HSCIEN', label: '800713', name: 'Energy' },
  { ticker: '800708', eastmoneyCode: 'HSCIFN', label: '800708', name: 'Financials' },
  { ticker: '800711', eastmoneyCode: 'HSCIIN', label: '800711', name: 'Industrials' },
  { ticker: '800710', eastmoneyCode: 'HSCITC', label: '800710', name: 'Telecom' },
  { ticker: '800709', eastmoneyCode: 'HSCIUT', label: '800709', name: 'Utilities' },
  { ticker: '800705', eastmoneyCode: 'HSCICO', label: '800705', name: 'Conglomerates' },

  // Scale
  { ticker: '800714', eastmoneyCode: 'HSLI',   label: '800714', name: 'Large Cap' },
  { ticker: '800715', eastmoneyCode: 'HSMI',   label: '800715', name: 'Mid Cap' },
  { ticker: '800716', eastmoneyCode: 'HSSI',   label: '800716', name: 'Small Cap' },
];

async function fetchEastmoneyIndexSeries(eastmoneyCode, start, end, tries = 4) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=124.${eastmoneyCode}`
    + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
    + `&klt=101&fqt=0&beg=${yyyymmdd(start)}&end=${yyyymmdd(end)}`;

  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const json = await res.json();
      const klines = json?.data?.klines ?? [];
      if (klines.length) {
        // Each line: date,open,close,high,low,volume,amount,amplitude,pctChg,change,turnover
        return klines.map(line => {
          const [date, , close] = line.split(',');
          return { date, close: Number(close) };
        });
      }
    } catch { /* retry below */ }
    if (i < tries) await sleep(2000 + i * 2000);
  }
  throw new Error(`East Money kline request failed after retries for ${eastmoneyCode}`);
}

function inclusiveEndDate(endDate) {
  const end = new Date(endDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function getHkPerformance(startDate, endDate = new Date()) {
  const end = inclusiveEndDate(endDate);
  const start = new Date(startDate);

  const results = await mapLimit(TICKERS, 4, async meta => {
    try {
      const points = await fetchEastmoneyIndexSeries(meta.eastmoneyCode, start, end);
      return { ...meta, points, error: null };
    } catch (e) {
      return { ...meta, points: [], error: e.message };
    }
  });

  // Union of all trading dates — a single feed momentarily short a day
  // shouldn't truncate everyone else's.
  const dateSet = new Set();
  for (const r of results) for (const p of r.points) dateSet.add(p.date);
  const dates = [...dateSet].sort();

  const series = results.map(r => {
    const byDate = new Map(r.points.map(p => [p.date, p.close]));
    return {
      ticker: r.ticker,
      label: r.label,
      name: r.name,
      closes: dates.map(d => byDate.get(d) ?? null),
      error: r.error,
    };
  });

  return { start: dates[0] ?? isoDate(start), end: dates[dates.length - 1] ?? isoDate(endDate), dates, series };
}

module.exports = { getHkPerformance, TICKERS };
