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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const yyyymmdd = date => date.toISOString().slice(0, 10).replace(/-/g, '');

function loadHistory() {
  const history = storage.read(BLOB, HISTORY_FILE);
  history.turnover = history.turnover ?? {};
  history.m2Yoy = history.m2Yoy ?? {};
  history.southboundNetFlow = history.southboundNetFlow ?? {};
  history.northboundTurnover = history.northboundTurnover ?? {};
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

async function updateChinaLiquidity(days = 730) {
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
  history.updatedAt = new Date().toISOString();
  history.errors = errors;
  storage.write(BLOB, HISTORY_FILE, history);
  return assemble(history);
}

function readChinaLiquidity() { return assemble(loadHistory()); }

module.exports = {
  updateChinaLiquidity,
  readChinaLiquidity,
  _test: { parseTurnoverKlines, parseStockConnectRows, deriveM2Yoy, assemble },
};
