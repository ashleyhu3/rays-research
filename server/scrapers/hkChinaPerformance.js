'use strict';

const path = require('path');
const { createPersistedSeries, isoDaysAgo } = require('./persistedSeries');

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
  // Broad indices (overview chart + per-index ratio vs CSI300)
  { ticker: '800000', yahooTicker: '^HSI', label: 'HSI', name: 'HSI' },
  // Yahoo exposes only intraday quotes for the raw HSTECH, ChiNext and STAR50
  // instruments. Use one fixed tracking ETF for each history. Do not switch
  // between raw indices and ETFs: their different nominal scales create false
  // ~1,000x moves when persisted refresh windows overlap.
  { ticker: '800700', yahooTicker: '3032.HK', label: 'HSTECH', name: 'HSTECH' },
  { ticker: '000001.SS', label: '000001', name: 'SSE Composite' },
  { ticker: '399006.SZ', yahooTicker: '159915.SZ', label: '399006', name: 'ChiNext' },
  { ticker: '000688.SS', yahooTicker: '588000.SS', label: '000688', name: 'STAR50 (科创50)' },
  { ticker: '000300.SS', label: 'CSI300', name: 'CSI 300' },

  // TMT & AI
  { ticker: '512480.SS', label: '512480', name: '全产业链半导体' },
  { ticker: '159995.SZ', label: '159995', name: '芯片' },
  { ticker: '562590.SS', label: '562590', name: '半导体设备' },
  { ticker: '515880.SS', label: '515880', name: '通信' },
  { ticker: '515050.SS', label: '515050', name: '5G' },
  { ticker: '159819.SZ', label: '159819', name: 'AI 人工智能' },
  { ticker: '159852.SZ', label: '159852', name: '软件' },
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
  { ticker: '516110.SS', label: '516110', name: '美容护理' },
  { ticker: '516680.SS', label: '516680', name: '516680' },

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
  { ticker: '512200.SS', label: '512200', name: '房地产' },

  // 机械军工
  { ticker: '512680.SS', label: '512680', name: '军工' },
  { ticker: '562500.SS', label: '562500', name: '机器人' },
  { ticker: '159663.SZ', label: '159663', name: '机床' },
  { ticker: '159616.SZ', label: '159616', name: '工程机械' },

  // Factor
  { ticker: '512890.SS', label: '512890', name: '红利低波' },
];

const HISTORY = createPersistedSeries({
  blob: 'hkChinaPerformanceHistory',
  file: path.join(__dirname, '..', 'data', 'hkChinaPerformanceHistory.json'),
  tickers: TICKERS,
  fields: ['closes', 'volumes'],
});

// Many China A-share fund tickers here (leveraged/thematic ETFs — 512480,
// 515050, etc.) periodically do a "unit split" to bring per-share NAV back
// down. Yahoo's adjclose is identical to close for these lightly-covered
// .SS/.SZ tickers (confirmed: no dividend/split events reported), so a raw
// close series shows a permanent cliff at the split date. It also has
// occasional single-day bad ticks that briefly re-report the pre-split
// price. Both distort the rebased/ratio charts, so we detect and correct
// for them here rather than trusting Yahoo's fields as-is.
const GLITCH_MOVE_THRESHOLD = 1.15;   // >15% single-day move away from neighbors
const GLITCH_REVERT_TOLERANCE = 0.12; // round-trip back within 12% counts as a revert
const SPLIT_PRICE_THRESHOLD = 1.5;    // >50% single-day move
const SPLIT_VOLUME_THRESHOLD = 1.5;   // paired with a >50% volume swing

// Repairs isolated single-day bad ticks (a spike that fully reverts the very
// next day), then back-adjusts history for genuine, volume-confirmed splits
// so the whole series is continuous — the same idea as dividend-adjusted
// close, applied to unit splits Yahoo isn't tracking for these tickers.
function adjustForSplits(points) {
  const n = points.length;
  if (n < 3) return points;
  const closes = points.map(p => p.close);
  const volumes = points.map(p => p.volume);

  for (let i = 1; i < n - 1; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    const next = closes[i + 1];
    if (prev == null || cur == null || next == null) continue;
    const moveIn = cur / prev;
    const roundTrip = next / prev;
    const isBigMove = moveIn > GLITCH_MOVE_THRESHOLD || moveIn < 1 / GLITCH_MOVE_THRESHOLD;
    const revertsBack = Math.abs(roundTrip - 1) < GLITCH_REVERT_TOLERANCE;
    if (isBigMove && revertsBack) closes[i] = Math.sqrt(prev * next);
  }

  const adjusted = new Array(n);
  adjusted[n - 1] = closes[n - 1];
  let cumFactor = 1;
  for (let i = n - 1; i > 0; i -= 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev != null && cur != null) {
      const priceRatio = cur / prev;
      const volPrev = volumes[i - 1];
      const volCur = volumes[i];
      const volRatio = volPrev && volCur ? volCur / volPrev : null;
      const isBigPriceMove = priceRatio > SPLIT_PRICE_THRESHOLD || priceRatio < 1 / SPLIT_PRICE_THRESHOLD;
      const isVolumeConfirmed = volRatio != null
        && (volRatio > SPLIT_VOLUME_THRESHOLD || volRatio < 1 / SPLIT_VOLUME_THRESHOLD);
      if (isBigPriceMove && isVolumeConfirmed) cumFactor *= priceRatio;
    }
    adjusted[i - 1] = closes[i - 1] != null ? closes[i - 1] * cumFactor : null;
  }

  return points.map((p, i) => ({ ...p, close: adjusted[i] }));
}

async function fetchSeries(yf, ticker, start, end) {
  const chart = await withRetry(() => yf.chart(ticker, { period1: start, period2: end, interval: '1d' }));
  const quotes = (chart?.quotes ?? []).filter(q => q.date && q.close != null);
  const points = quotes.map(q => ({ date: isoDate(q.date), close: q.close, volume: q.volume ?? null }));
  return adjustForSplits(points);
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
    try {
      return { ...meta, points: await fetchSeries(yf, meta.yahooTicker ?? meta.ticker, start, end), error: null };
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
    const byDateVolume = new Map(r.points.map(p => [p.date, p.volume]));
    return {
      ticker: r.ticker,
      label: r.label,
      name: r.name,
      closes: dates.map(d => byDate.get(d) ?? null),
      volumes: dates.map(d => byDateVolume.get(d) ?? null),
      error: r.error,
    };
  });

  return { start: dates[0] ?? isoDate(start), end: dates[dates.length - 1] ?? isoDate(endDate), dates, series };
}

async function updateHkChinaPerformance(days = 45) {
  const end = new Date().toISOString().slice(0, 10);
  HISTORY.merge(await getHkChinaPerformance(isoDaysAgo(days), end));
  return HISTORY.assemble();
}

function readHkChinaPerformance(startDate, endDate) {
  return HISTORY.assemble(startDate, endDate);
}

module.exports = { getHkChinaPerformance, updateHkChinaPerformance, readHkChinaPerformance, TICKERS };
