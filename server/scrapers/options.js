'use strict';

let _yf;
function getYF() {
  if (!_yf) {
    const YahooFinance = require('yahoo-finance2').default;
    _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
  }
  return _yf;
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

async function getOptionsData(ticker, dateStr) {
  const yf     = getYF();
  const symbol = ticker.trim().toUpperCase();

  // v3 API: yf.options(symbol, { date? }, moduleOpts)
  // Response: { expirationDates, quote, options: [{ expirationDate, calls, puts }] }
  const queryOpts = dateStr ? { date: dateStr } : {};
  const chain = await yf.options(symbol, queryOpts, { validateResult: false });

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
