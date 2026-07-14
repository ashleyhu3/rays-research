'use strict';

const BASE = 'https://api.massive.com';

function getKey() {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error('MASSIVE_API_KEY is not set');
  return key;
}

async function mGet(path, params = {}) {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(String(k), String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getKey()}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Massive ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Paginate /v3/snapshot/options for a specific expiration date.
async function fetchChain(symbol, expDate) {
  const results = [];
  let resp = await mGet(`/v3/snapshot/options/${symbol}`, {
    expiration_date: expDate,
    order: 'asc',
    sort: 'strike_price',
    limit: 250,
  });
  results.push(...(resp.results ?? []));
  while (resp.next_url) {
    const next = new URL(resp.next_url);
    next.searchParams.delete('apiKey');
    // Route every page through the checked request helper. A page-two 429/5xx must
    // fail the report; treating its error body as an empty final page would silently
    // cache a truncated chain as "all contracts".
    resp = await mGet(next.toString());
    results.push(...(resp.results ?? []));
  }
  return results;
}

function fmtContract(r, spotPrice) {
  const d      = r.details ?? {};
  const strike = d.strike_price ?? null;
  // IV comes as a decimal (0.2547 = 25.47%)
  const iv     = r.implied_volatility;
  const inTheMoney = d.contract_type === 'call'
    ? (spotPrice != null && strike != null && spotPrice > strike)
    : (spotPrice != null && strike != null && spotPrice < strike);

  return {
    contractSymbol:    d.ticker           ?? '',
    strike,
    lastPrice:         r.last_trade?.price ?? null,
    bid:               r.last_quote?.bid   ?? null,
    ask:               r.last_quote?.ask   ?? null,
    volume:            r.day?.volume       ?? 0,
    openInterest:      r.open_interest     ?? null,
    // IV is a decimal (0.195 = 19.5%). Deep-ITM same-day-expiry contracts can
    // return a raw integer (e.g. 20) when Black-Scholes breaks down — cap at
    // 500% so those artifacts don't surface in the UI.
    impliedVolatility: iv != null ? (iv * 100 <= 500 ? Math.round(iv * 1000) / 10 : null) : null,
    inTheMoney,
    expiration:        d.expiration_date   ?? null,
    greeks:            r.greeks            ?? null,
  };
}

// Collect all unique expiration dates within the next 2 months via the
// reference/contracts endpoint. It's metadata-only (no market data), so it
// pages quickly. We stop as soon as the last-seen expiration exceeds the cutoff.
async function fetchExpirations(symbol) {
  const now    = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate() + 1);
  const seen   = new Set();
  let resp = await mGet(`/v3/reference/options/contracts`, {
    underlying_ticker: symbol,
    order: 'asc',
    sort: 'expiration_date',
    limit: 250,
  });
  while (true) {
    let pastCutoff = false;
    for (const r of resp.results ?? []) {
      const d = r.expiration_date;
      if (!d) continue;
      if (new Date(d) > cutoff) { pastCutoff = true; break; }
      seen.add(d);
    }
    if (pastCutoff || !resp.next_url) break;
    const next = new URL(resp.next_url);
    next.searchParams.delete('apiKey');
    resp = await mGet(next.toString());
  }
  return [...seen].sort();
}

async function getOptionsData(ticker, dateStr) {
  const symbol = ticker.trim().toUpperCase();

  // Fetch expirations list and spot price in parallel.
  // The snapshot call (limit=1) is just to get the current spot price cheaply.
  const [expirations, spotResp] = await Promise.all([
    fetchExpirations(symbol),
    mGet(`/v3/snapshot/options/${symbol}`, { limit: 1 }),
  ]);

  if (!expirations.length) throw new Error(`No near-term expirations for ${symbol}`);
  const spotPrice = spotResp.results?.[0]?.underlying_asset?.price ?? null;

  const selectedDate = (dateStr && expirations.includes(dateStr)) ? dateStr : expirations[0];

  // Fetch full chain for selected expiration + prev-day close in parallel.
  // /v2/snapshot is not available on the options plan; use prev-day aggs instead.
  const [chainRows, prevResp] = await Promise.all([
    fetchChain(symbol, selectedDate),
    mGet(`/v2/aggs/ticker/${symbol}/prev`).catch(() => null),
  ]);

  const prevClose   = prevResp?.results?.[0]?.c ?? null;
  const priceChange = (spotPrice != null && prevClose != null) ? spotPrice - prevClose : null;
  const changePct   = (priceChange != null && prevClose)       ? (priceChange / prevClose) * 100 : null;

  const calls = chainRows.filter(r => r.details?.contract_type === 'call').map(r => fmtContract(r, spotPrice));
  const puts  = chainRows.filter(r => r.details?.contract_type === 'put').map(r => fmtContract(r, spotPrice));

  return {
    ticker: symbol,
    price: spotPrice,
    priceChange,
    changePct,
    expirations,
    selectedDate,
    calls,
    puts,
  };
}

module.exports = { fetchChain, getOptionsData };
