'use strict';

// Yahoo aggressively rate-limits (429) the library's default
// "yahoo-finance2/x.y.z" User-Agent from datacenter IPs — which is why the
// crumb fetch fails in production but works from a laptop. Presenting a real
// browser User-Agent makes the crumb/cookie handshake look like an ordinary
// page load and clears the 429s.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

// Retry the crumb/quote fetch on transient rate limits. A 429 on the crumb
// handshake often clears on a second attempt once a cookie is seeded.
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
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function fmtContract(c) {
  return {
    contractSymbol:    c.contractSymbol    ?? '',
    strike:            c.strike            ?? null,
    lastPrice:         c.lastPrice         ?? null,
    bid:               c.bid               ?? null,
    ask:               c.ask               ?? null,
    volume:            c.volume            ?? 0,
    openInterest:      c.openInterest      ?? null,
    // IV comes as a decimal (0.2547 = 25.47%); round to 1 decimal
    impliedVolatility: c.impliedVolatility != null
      ? Math.round(c.impliedVolatility * 1000) / 10
      : null,
    inTheMoney: c.inTheMoney ?? false,
    expiration: isoDate(c.expiration),
  };
}

// Fetch the raw options chain. In production OPTIONS_PROXY_URL points at the
// serverless proxy (see proxy/api/options.js): Yahoo rate-limits Render's
// shared egress IPs, so we let the proxy do the Yahoo handshake from a clean IP
// and return the raw chain. Unset locally → call Yahoo directly (works fine
// from a laptop / Codespace).
async function fetchChain(symbol, queryOpts, dateStr) {
  const proxy = process.env.OPTIONS_PROXY_URL;
  if (!proxy) {
    return withRetry(() => getYF().options(symbol, queryOpts, { validateResult: false }));
  }
  const url = new URL(proxy);
  url.searchParams.set('ticker', symbol);
  if (dateStr) url.searchParams.set('date', dateStr);
  const headers = {};
  if (process.env.PROXY_SECRET) headers['x-proxy-key'] = process.env.PROXY_SECRET;

  const r = await fetch(url, { headers });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    // Prefix 429 on the proxy's rate-limit status so server.js maps it to the
    // friendly "try again in a moment" 503 just like a direct Yahoo 429.
    const tag = r.status === 503 ? '429 ' : '';
    throw new Error(`${tag}options proxy ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.json();
}

async function getOptionsData(ticker, dateStr) {
  const symbol = ticker.trim().toUpperCase();

  // v3 API: yf.options(symbol, { date? }, moduleOpts)
  // Response: { expirationDates, quote, options: [{ expirationDate, calls, puts }] }
  const queryOpts = dateStr ? { date: dateStr } : {};
  const chain = await fetchChain(symbol, queryOpts, dateStr);

  // Limit expirations to ≤ 2 months from today
  const now    = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() + 2, now.getDate() + 1);
  const expirations = (chain.expirationDates ?? [])
    .map(isoDate)
    .filter(d => d != null && new Date(d) <= cutoff);

  // calls/puts live in chain.options[0] in v3
  const contracts = chain.options?.[0] ?? {};
  const quote     = chain.quote ?? {};

  return {
    ticker:       symbol,
    price:        quote.regularMarketPrice          ?? null,
    priceChange:  quote.regularMarketChange         ?? null,
    changePct:    quote.regularMarketChangePercent  ?? null,
    expirations,
    selectedDate: isoDate(contracts.expirationDate) ?? expirations[0] ?? null,
    calls: (contracts.calls ?? []).map(fmtContract),
    puts:  (contracts.puts  ?? []).map(fmtContract),
  };
}

module.exports = { getOptionsData };
