'use strict';

const { CATEGORIES } = require('./scrapers/sentiment');
const { DEFAULT_TICKERS } = require('./scripts/generateDailyOptionsReport');

// Large-cap tech/software/semis not already covered by sentiment.js's supply-chain
// groups. Every symbol here was checked against FMP's own /stable/profile `sector`
// field and confirmed "Technology" — GOOGL/GOOG and META come back "Communication
// Services" and AMZN/TSLA come back "Consumer Cyclical" under FMP's taxonomy, so
// they're deliberately left out here (GOOG is added back separately in
// techEarningsCalendar.js, for continuity with the options report's own list).
const MEGA_CAP_TECH_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'ADBE', 'AMD', 'CSCO', 'IBM', 'QCOM', 'NOW',
  'INTU', 'PANW', 'ANET', 'SNPS', 'CDNS', 'MRVL', 'ON', 'MCHP', 'SWKS', 'QRVO', 'HPQ', 'DELL',
  'WDAY', 'ADI', 'NXPI', 'MPWR', 'FTNT', 'CRWD', 'DDOG', 'NET', 'ZS', 'TEAM', 'SHOP', 'PLTR',
  'SNOW', 'UBER',
];

// DEFAULT_TICKERS minus the ones that aren't Technology sector: GOOG
// (Communication Services) and SOXX (an ETF, has no sector at all).
const NOT_TECH_SECTOR = new Set(['GOOG', 'SOXX']);
const OPTIONS_REPORT_TECH_TICKERS = DEFAULT_TICKERS.filter(t => !NOT_TECH_SECTOR.has(t));

const TECH_SECTOR_TICKERS = [...new Set([
  ...Object.values(CATEGORIES).flat(),
  ...MEGA_CAP_TECH_TICKERS,
  ...OPTIONS_REPORT_TECH_TICKERS,
])];

const FMP_URL = 'https://financialmodelingprep.com/stable/earnings-calendar';
const FMP_PROFILE_URL = 'https://financialmodelingprep.com/stable/profile';

function apiKey() {
  return process.env.FMP_API_KEY || '';
}

// FMP's earnings-calendar takes a date range only — no `symbol` filter (it's
// silently ignored if passed). Testing against the live endpoint showed it's
// capped by plan tier to a "highlights" subset rather than the full market: a
// 90-day pull returns ~80 companies total, not the thousands that actually
// report in that window. So the tech-sector watchlist is applied client-side
// against whatever the feed does return, rather than queried per symbol.
async function fetchCalendar(from, to) {
  const key = apiKey();
  if (!key) throw new Error('FMP_API_KEY is not set');

  const url = new URL(FMP_URL);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('includeReportTimes', 'true');
  url.searchParams.set('apikey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  const payload = await res.json();
  if (!Array.isArray(payload)) throw new Error(payload?.['Error Message'] || 'FMP returned an unexpected response');
  return payload;
}

const profileCache = new Map();

async function fetchProfile(symbol) {
  const ticker = String(symbol || '').toUpperCase();
  if (!ticker) return null;
  if (profileCache.has(ticker)) return profileCache.get(ticker);

  const key = apiKey();
  if (!key) throw new Error('FMP_API_KEY is not set');

  const url = new URL(FMP_PROFILE_URL);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('apikey', key);

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`FMP profile HTTP ${res.status}`);
  const payload = await res.json();
  if (payload?.['Error Message']) throw new Error(payload['Error Message']);

  const row = Array.isArray(payload) ? payload[0] : payload;
  const profile = row ? {
    symbol: ticker,
    companyName: row.companyName ?? row.name ?? null,
    sector: row.sector ?? null,
  } : null;
  profileCache.set(ticker, profile);
  return profile;
}

async function fetchProfiles(symbols) {
  const profiles = new Map();
  for (const symbol of symbols) {
    try {
      profiles.set(symbol, await fetchProfile(symbol));
    } catch (e) {
      console.warn(`[fmp-earnings-calendar] ${symbol} profile failed: ${e.message}`);
      profiles.set(symbol, null);
    }
  }
  return profiles;
}

async function techSectorEvents(from, to) {
  const rows = await fetchCalendar(from, to);
  const wanted = new Set(TECH_SECTOR_TICKERS);
  const profiles = await fetchProfiles([...new Set(rows.map(row => row.symbol).filter(Boolean))]);
  return rows
    .filter(row => wanted.has(row.symbol) || profiles.get(row.symbol)?.sector === 'Technology')
    .map(row => ({
      ticker: row.symbol,
      date: row.date,
      time: row.time ?? null,               // 'bmo' | 'amc' | null
      epsEstimated: row.epsEstimated ?? null,
      confirmed: row.confirmed ?? false,
      companyName: profiles.get(row.symbol)?.companyName ?? null,
      source: 'fmp',
    }));
}

module.exports = { TECH_SECTOR_TICKERS, fetchCalendar, fetchProfile, techSectorEvents };
