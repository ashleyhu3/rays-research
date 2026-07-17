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

// ChiNext and STAR50 raw indices have no daily history on Yahoo Finance
// (only a 1-5 day range is exposed there) — fetched from East Money's public
// kline API instead, which carries full history for both. East Money's
// endpoint is itself flaky (see fetchEastmoneyIndexSeries), so each also
// carries a Yahoo-tradeable tracking-ETF fallback rather than risk an empty,
// hour-cached series on a bad request.
const EASTMONEY_SECID = {
  '399006.SZ': '0.399006', // ChiNext
  '000688.SS': '1.000688', // STAR50 (科创50)
};
const EASTMONEY_FALLBACK_TICKER = {
  '399006.SZ': '159915.SZ', // E Fund ChiNext ETF
  '000688.SS': '588000.SS', // China AMC STAR50 ETF
};

const TICKERS = [
  // Broad indices (overview chart + per-index ratio vs CSI300)
  { ticker: '000001.SS', label: '000001', name: 'SSE Composite' },
  { ticker: '399006.SZ', label: '399006', name: 'ChiNext' },
  { ticker: '000688.SS', label: '000688', name: 'STAR50 (科创50)' },
  { ticker: '000300.SS', label: 'CSI300', name: 'CSI 300' },

  // TMT & AI
  { ticker: '512480.SS', label: '512480', name: '全产业链半导体' },
  { ticker: '159995.SZ', label: '159995', name: '芯片' },
  { ticker: '562590.SS', label: '562590', name: '半导体设备' },
  { ticker: '515880.SS', label: '515880', name: '通信' },
  { ticker: '515050.SS', label: '515050', name: '5G' },
  { ticker: '159819.SZ', label: '159819', name: 'AI 人工智能' },
  { ticker: '159336.SZ', label: '159336', name: '软件' },
  { ticker: '516860.SS', label: '516860', name: '金融科技' },
  { ticker: '159732.SZ', label: '159732', name: '消费电子' },

  // 新能源
  { ticker: '159796.SZ', label: '159796', name: '电池' },
  { ticker: '515790.SS', label: '515790', name: '光伏' },
  { ticker: '159806.SZ', label: '159806', name: '新能源车' },
  { ticker: '159613.SZ', label: '159613', name: '储能' },
  { ticker: '159615.SZ', label: '159615', name: '绿色电力' },
  { ticker: '159326.SZ', label: '159326', name: '电网设备' },

  // 医药
  { ticker: '512170.SS', label: '512170', name: '医疗' },
  { ticker: '159992.SZ', label: '159992', name: '创新药' },
  { ticker: '562390.SS', label: '562390', name: '中药' },
  { ticker: '159883.SZ', label: '159883', name: '医疗器械' },

  // 大消费
  { ticker: '512690.SS', label: '512690', name: '白酒' },
  { ticker: '159843.SZ', label: '159843', name: '食品饮料' },
  { ticker: '159766.SZ', label: '159766', name: '旅游' },

  // 金融 & 周期
  { ticker: '512880.SS', label: '512880', name: '证券' },
  { ticker: '512800.SS', label: '512800', name: '银行' },
  { ticker: '512160.SS', label: '512160', name: '保险' },
  { ticker: '512400.SS', label: '512400', name: '有色金属' },
  { ticker: '159608.SZ', label: '159608', name: '稀有金属/稀土' },
  { ticker: '515220.SS', label: '515220', name: '煤炭' },
  { ticker: '561360.SS', label: '561360', name: '石油' },
  { ticker: '159865.SZ', label: '159865', name: '农业/畜牧' },
  { ticker: '159607.SZ', label: '159607', name: '化工' },

  // 机械军工
  { ticker: '512680.SS', label: '512680', name: '军工' },
  { ticker: '562500.SS', label: '562500', name: '机器人' },
  { ticker: '159663.SZ', label: '159663', name: '机床' },
  { ticker: '159616.SZ', label: '159616', name: '工程机械' },

  // Factor
  { ticker: '512890.SS', label: '512890', name: '红利低波' },
];

async function fetchSeries(yf, ticker, start, end) {
  const chart = await withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1d' }));
  const quotes = (chart?.quotes ?? []).filter(q => q.date && q.close != null);
  return quotes.map(q => ({ date: isoDate(q.date), close: q.close }));
}

function yyyymmdd(d) {
  return isoDate(d).replace(/-/g, '');
}

// East Money's kline endpoint is flaky under back-to-back requests (frequent
// mid-response connection resets, unrelated to headers/UA) — needs retries
// with backoff, unlike Yahoo's rate-limit-shaped 429s. Kept short enough
// overall (~45s worst case) that a bad run still falls through to the Yahoo
// ETF fallback quickly rather than stalling the page load.
async function fetchEastmoneyIndexSeries(secid, start, end, tries = 4) {
  const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
    + `?secid=${secid}&ut=7eea3edcaed734bea9cbfc24409ed989`
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
  throw new Error('East Money kline request failed after retries');
}

function inclusiveEndDate(endDate) {
  const end = new Date(endDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function getHkChinaPerformance(startDate, endDate = new Date()) {
  const yf  = getYF();
  const end = inclusiveEndDate(endDate);
  const start = new Date(startDate);

  const results = await mapLimit(TICKERS, 4, async meta => {
    const eastmoneySecid = EASTMONEY_SECID[meta.ticker];
    if (eastmoneySecid) {
      try {
        return { ...meta, points: await fetchEastmoneyIndexSeries(eastmoneySecid, start, end), error: null };
      } catch (e) {
        try {
          const points = await fetchSeries(yf, EASTMONEY_FALLBACK_TICKER[meta.ticker], start, end);
          return { ...meta, points, error: null };
        } catch (fallbackError) {
          return { ...meta, points: [], error: `${e.message} (fallback: ${fallbackError.message})` };
        }
      }
    }
    try {
      return { ...meta, points: await fetchSeries(yf, meta.ticker, start, end), error: null };
    } catch (e) {
      return { ...meta, points: [], error: e.message };
    }
  });

  // Union of all trading dates across every series — SSE/SZSE and CSI300
  // share the same trading calendar, but any single feed can be momentarily
  // short a day, so union — not intersect — keeps a partially-failed series
  // from truncating everyone else's.
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

module.exports = { getHkChinaPerformance, TICKERS };
