/** China market-liquidity history. Page reads are storage-only; scheduled
 * collection owns all upstream API calls and persists through storage.js. */
'use strict';

const path = require('path');
const storage = require('../storage');
const { fetchSeries } = require('./macro');

const BLOB = 'chinaLiquidityHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'chinaLiquidityHistory.json');
const EASTMONEY_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EASTMONEY_SOURCE = 'https://quote.eastmoney.com/choicezs/47.800004.html?jump_to_web=true';
const STOCK_CONNECT_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const STOCK_CONNECT_SOURCE = 'https://data.eastmoney.com/hsgt/hsgtV2.html';
const TUSHARE_URL = 'https://api.tushare.pro';
const TUSHARE_SOURCE = 'https://tushare.pro/document/2?doc_id=32';
// daily_basic caps a single response at 6000 rows and the A-share universe is
// already ~5,900 names, so page rather than assume one call covers the market.
const TUSHARE_PAGE = 5000;
// Newest-first budget of trade dates priced per run. The scheduled daily job only
// ever needs one; the backfill script raises this to walk the whole window.
const FREE_FLOAT_DAYS_PER_RUN = 30;
// Tushare throttles by account points — the lowest tier that can reach daily_basic
// allows well under 100 calls/min, so pace requests rather than rely on the retry.
const TUSHARE_SPACING_MS = 1500;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const yyyymmdd = date => date.toISOString().slice(0, 10).replace(/-/g, '');

function loadHistory() {
  const history = storage.read(BLOB, HISTORY_FILE);
  history.turnover = history.turnover ?? {};
  history.m2Yoy = history.m2Yoy ?? {};
  history.southboundNetFlow = history.southboundNetFlow ?? {};
  history.northboundTurnover = history.northboundTurnover ?? {};
  history.freeFloatCap = history.freeFloatCap ?? {};
  return history;
}

function parseStockConnectRows(rows, field) {
  const out = {};
  for (const row of rows ?? []) {
    const date = String(row?.TRADE_DATE ?? '').slice(0, 10);
    const sourceValue = row?.[field];
    const raw = Number(sourceValue);
    // Eastmoney's history endpoint expresses these fields in RMB millions.
    // Divide by 100 to display RMB 100m (亿元).
    if (sourceValue != null && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(raw)) {
      out[date] = Math.round((raw / 100) * 10000) / 10000;
    }
  }
  return out;
}

async function fetchStockConnect(mutualType, field, startDate, tries = 4) {
  const params = new URLSearchParams({
    sortColumns: 'TRADE_DATE', sortTypes: '-1', pageSize: '1000', pageNumber: '1',
    reportName: 'RPT_MUTUAL_DEAL_HISTORY', columns: 'ALL', source: 'WEB', client: 'WEB',
    filter: `(MUTUAL_TYPE="${mutualType}")(TRADE_DATE>='${startDate.toISOString().slice(0, 10)}')`,
  });
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(`${STOCK_CONNECT_URL}?${params}`, {
        headers: {
          referer: STOCK_CONNECT_SOURCE,
          'user-agent': 'Mozilla/5.0 Signal Liquidity Dashboard',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`East Money HTTP ${response.status}`);
      const json = await response.json();
      const parsed = parseStockConnectRows(json?.result?.data, field);
      if (!Object.keys(parsed).length) throw new Error(`East Money returned no Stock Connect ${field} history`);
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < tries) await sleep(attempt * 2500);
    }
  }
  throw lastError ?? new Error('East Money Stock Connect request failed');
}

function parseTurnoverKlines(klines) {
  const out = {};
  for (const line of klines ?? []) {
    // date,open,close,high,low,volume,amount,amplitude,pctChange,change,turnoverRate
    const [date, , , , , , amount] = String(line).split(',');
    const value = Number(amount);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) out[date] = value;
  }
  return out;
}

async function fetchTurnover(startDate, endDate, tries = 4) {
  const params = new URLSearchParams({
    secid: '47.800004', ut: '7eea3edcaed734bea9cbfc24409ed989',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101', fqt: '0', beg: yyyymmdd(startDate), end: yyyymmdd(endDate),
  });
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(`${EASTMONEY_URL}?${params}`, {
        headers: { 'user-agent': 'Mozilla/5.0 Signal Liquidity Dashboard' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`East Money HTTP ${response.status}`);
      const json = await response.json();
      const parsed = parseTurnoverKlines(json?.data?.klines);
      if (!Object.keys(parsed).length) throw new Error('East Money returned no turnover history');
      return parsed;
    } catch (error) {
      lastError = error;
      if (attempt < tries) await sleep(attempt * 2500);
    }
  }
  throw lastError ?? new Error('East Money turnover request failed');
}

/** Sum 自由流通市值 across one daily_basic page. Tushare returns a column-oriented
 * payload: `fields` names the columns, `items` holds one row per listing. Its
 * `free_share` is 自由流通股本 in 万股 and `close` is in 元, so the product is 万元 —
 * scale to plain CNY so the series shares units with the turnover numerator. */
function sumFreeFloatCap(payload) {
  const fields = payload?.fields ?? [];
  const closeAt = fields.indexOf('close');
  const shareAt = fields.indexOf('free_share');
  if (closeAt < 0 || shareAt < 0) throw new Error('Tushare daily_basic is missing close/free_share');
  let total = 0;
  let counted = 0;
  for (const row of payload?.items ?? []) {
    // Number(null) is 0, so nullish cells have to be rejected before coercion or a
    // suspended name would count toward the universe while contributing no cap.
    const close = row?.[closeAt] == null ? NaN : Number(row[closeAt]);
    const freeShare = row?.[shareAt] == null ? NaN : Number(row[shareAt]);
    // Suspended names report a null close and pre-IPO rows a null float; both are
    // genuinely absent from the day's tradable base rather than zero.
    if (Number.isFinite(close) && close > 0 && Number.isFinite(freeShare) && freeShare > 0) {
      total += close * freeShare * 1e4;
      counted += 1;
    }
  }
  return { total, counted };
}

async function callTushare(token, apiName, params, fields, tries = 4) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(TUSHARE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ api_name: apiName, token, params, fields }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Tushare HTTP ${response.status}`);
      const json = await response.json();
      // Tushare signals quota, permission and argument errors in-band with HTTP 200.
      if (json?.code !== 0) throw new Error(`Tushare ${apiName}: ${json?.msg || `code ${json?.code}`}`);
      return json.data;
    } catch (error) {
      lastError = error;
      if (attempt < tries) await sleep(attempt * 3000);
    }
  }
  throw lastError ?? new Error(`Tushare ${apiName} request failed`);
}

/** Whole-market 自由流通市值 for one trade date, paged over the A-share universe. */
async function fetchFreeFloatCapForDate(token, date) {
  let total = 0;
  let counted = 0;
  for (let offset = 0; ; offset += TUSHARE_PAGE) {
    if (offset) await sleep(TUSHARE_SPACING_MS);
    const page = await callTushare(token, 'daily_basic', {
      trade_date: date.replace(/-/g, ''), limit: TUSHARE_PAGE, offset,
    }, 'ts_code,close,free_share');
    const rows = page?.items?.length ?? 0;
    const sum = sumFreeFloatCap(page);
    total += sum.total;
    counted += sum.counted;
    if (rows < TUSHARE_PAGE) break;
  }
  // A day that priced only a handful of names means the universe query came back
  // truncated; storing it would put a fake spike in the turnover-rate series.
  if (counted < 1000) throw new Error(`Tushare priced only ${counted} A-shares on ${date}`);
  return total;
}

/** Fills gaps in the stored free-float series, newest first, for the trade dates
 * East Money already gave us turnover on. Returns the count actually fetched. */
async function updateFreeFloatCap(history, limit = FREE_FLOAT_DAYS_PER_RUN) {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error('TUSHARE_TOKEN is not set — free-float market cap unavailable');
  const missing = Object.keys(history.turnover)
    .filter(date => !Number.isFinite(history.freeFloatCap[date]))
    .sort().reverse().slice(0, Math.max(0, limit));
  let added = 0;
  let lastError;
  for (const [index, date] of missing.entries()) {
    if (index) await sleep(TUSHARE_SPACING_MS);
    try {
      history.freeFloatCap[date] = await fetchFreeFloatCapForDate(token, date);
      added += 1;
    } catch (error) {
      lastError = error;
    }
  }
  if (!added && lastError) throw lastError;
  return added;
}

/** Turnover rate = daily 成交额 ÷ 自由流通市值, in percent. Only dates carrying both
 * halves produce a point, so a partial free-float backfill leaves gaps instead of
 * fabricating a ratio against a stale denominator. */
function deriveTurnoverRate(turnover, freeFloatCap) {
  const out = {};
  for (const [date, amount] of Object.entries(turnover ?? {})) {
    const cap = Number(freeFloatCap?.[date]);
    const value = Number(amount);
    if (Number.isFinite(cap) && cap > 0 && Number.isFinite(value)) {
      out[date] = Math.round((value / cap) * 1e6) / 1e4;
    }
  }
  return out;
}

function deriveM2Yoy(points) {
  const levels = new Map();
  for (const point of points ?? []) {
    const value = Number(point.value);
    if (/^\d{4}-\d{2}/.test(point.date ?? '') && Number.isFinite(value)) {
      levels.set(String(point.date).slice(0, 7), { date: point.date, value });
    }
  }
  const out = {};
  for (const [month, current] of levels) {
    const yearAgo = `${Number(month.slice(0, 4)) - 1}-${month.slice(5)}`;
    const prior = levels.get(yearAgo)?.value;
    if (Number.isFinite(prior) && prior !== 0) {
      out[current.date] = Math.round(((current.value / prior) - 1) * 10000) / 100;
    }
  }
  return out;
}

async function fetchM2Yoy() {
  const series = await fetchSeries('cnM2', ['china', 'money-supply-m2']);
  const values = deriveM2Yoy(series.data);
  if (!Object.keys(values).length) throw new Error('Could not derive China M2 YoY history');
  return { values, sourceUrl: series.sourceUrl, source: series.source, frequency: series.frequency };
}

function assemble(history) {
  const toPoints = values => Object.keys(values ?? {}).sort().map(date => ({ date, value: values[date] }));
  return {
    turnover: {
      name: 'A-share turnover – 成交额', unit: 'CNY', frequency: 'Daily',
      source: 'East Money', sourceUrl: EASTMONEY_SOURCE, data: toPoints(history.turnover),
    },
    turnoverRate: {
      name: 'A-share turnover rate – 自由流通换手率', unit: '%', frequency: 'Daily',
      source: 'East Money · Tushare', sourceUrl: TUSHARE_SOURCE,
      data: toPoints(deriveTurnoverRate(history.turnover, history.freeFloatCap)),
    },
    m2Yoy: {
      name: 'M2 Money Supply YoY', unit: '%', frequency: 'Monthly',
      source: history.m2Meta?.source || 'People’s Bank of China via Trading Economics',
      sourceUrl: history.m2Meta?.sourceUrl || 'https://tradingeconomics.com/china/money-supply-m2',
      data: toPoints(history.m2Yoy),
    },
    stockConnect: {
      source: 'East Money', sourceUrl: STOCK_CONNECT_SOURCE, frequency: 'Daily',
      southboundNetFlow: {
        name: 'Southbound Net Flow', unit: 'RMB 100m',
        data: toPoints(history.southboundNetFlow),
      },
      northboundTurnover: {
        name: 'Northbound Turnover', unit: 'RMB 100m',
        data: toPoints(history.northboundTurnover),
      },
    },
    updatedAt: history.updatedAt ?? null,
    errors: history.errors ?? {},
  };
}

async function updateChinaLiquidity(days = 730, freeFloatDays = FREE_FLOAT_DAYS_PER_RUN) {
  const history = loadHistory();
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(366, days) * 86400000);
  const settled = await Promise.allSettled([
    fetchTurnover(start, end),
    fetchM2Yoy(),
    fetchStockConnect('006', 'NET_DEAL_AMT', start),
    fetchStockConnect('005', 'DEAL_AMT', start),
  ]);
  const errors = {};
  if (settled[0].status === 'fulfilled') Object.assign(history.turnover, settled[0].value);
  else errors.turnover = settled[0].reason?.message || 'Turnover fetch failed';
  if (settled[1].status === 'fulfilled') {
    Object.assign(history.m2Yoy, settled[1].value.values);
    const { values: _values, ...meta } = settled[1].value;
    history.m2Meta = meta;
  } else errors.m2Yoy = settled[1].reason?.message || 'M2 fetch failed';
  if (settled[2].status === 'fulfilled') Object.assign(history.southboundNetFlow, settled[2].value);
  else errors.southboundNetFlow = settled[2].reason?.message || 'Southbound net flow fetch failed';
  if (settled[3].status === 'fulfilled') Object.assign(history.northboundTurnover, settled[3].value);
  else errors.northboundTurnover = settled[3].reason?.message || 'Northbound turnover fetch failed';
  if (settled.every(result => result.status === 'rejected')) {
    throw new Error(`China liquidity refresh failed: ${Object.values(errors).join('; ')}`);
  }
  // Runs after the merge above because it prices exactly the trade dates East Money
  // reported turnover for. A missing token or exhausted Tushare quota only costs us
  // the derived turnover-rate series — the rest of the payload still refreshes.
  try {
    await updateFreeFloatCap(history, freeFloatDays);
  } catch (error) {
    errors.turnoverRate = error?.message || 'Free-float market cap fetch failed';
  }
  history.updatedAt = new Date().toISOString();
  history.errors = errors;
  storage.write(BLOB, HISTORY_FILE, history);
  return assemble(history);
}

function readChinaLiquidity() { return assemble(loadHistory()); }

module.exports = {
  updateChinaLiquidity,
  readChinaLiquidity,
  _test: {
    parseTurnoverKlines, parseStockConnectRows, deriveM2Yoy, assemble,
    sumFreeFloatCap, deriveTurnoverRate, updateFreeFloatCap,
  },
};
