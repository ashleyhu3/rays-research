'use strict';
const path    = require('path');
const storage = require('./storage');

// Persists the most-recent NONZERO open interest for each options contract.
// Yahoo's options feed frequently returns openInterest: 0 for an entire chain
// (OI is published once daily post-settlement, so it's blank intraday/pre-market).
// We capture OI whenever it IS populated and serve the last-known nonzero value,
// so the "Open Interest by Strike" chart never collapses to a flat zero line.
//
// Shape: { [TICKER]: { [expirationISO]: { asOf: 'YYYY-MM-DD',
//                       calls: { [contractSymbol]: oi }, puts: { ... } } } }
// Matching is by contractSymbol (OCC symbology is deterministic per
// ticker/expiration/strike, so it's stable across days).
const FILE = path.join(__dirname, 'data', 'optionsOI.json');
const BLOB = 'optionsOI';

let store = null;
function load() { if (!store) store = storage.read(BLOB, FILE); return store; }
function today() { return new Date().toISOString().slice(0, 10); }

// Capture nonzero OI from a freshly-fetched chain and prune past expirations.
function record(ticker, data) {
  if (!ticker || !data?.selectedDate) return;
  const s   = load();
  const t   = s[ticker] = s[ticker] || {};
  const exp = data.selectedDate;
  const slot = t[exp] = t[exp] || { asOf: null, calls: {}, puts: {} };

  let changed = false;
  for (const side of ['calls', 'puts']) {
    for (const c of data[side] ?? []) {
      if (c.contractSymbol && (c.openInterest ?? 0) > 0) {
        slot[side][c.contractSymbol] = c.openInterest;
        changed = true;
      }
    }
  }
  if (changed) slot.asOf = today();

  // Drop expirations that have already passed (keeps the blob small).
  const td = today();
  for (const k of Object.keys(t)) if (k < td) { delete t[k]; changed = true; }

  if (changed) storage.write(BLOB, FILE, s);
}

// Fill zero/missing OI in a result from the stored most-recent nonzero values.
// Mutates `data` in place. Returns the as-of date of the values used, or null.
function backfill(ticker, data) {
  const slot = load()[ticker]?.[data?.selectedDate];
  if (!slot) return null;
  let filled = 0;
  for (const side of ['calls', 'puts']) {
    const map = slot[side] ?? {};
    for (const c of data[side] ?? []) {
      if ((c.openInterest ?? 0) === 0 && map[c.contractSymbol] > 0) {
        c.openInterest = map[c.contractSymbol];
        filled++;
      }
    }
  }
  return filled > 0 ? (slot.asOf ?? null) : null;
}

module.exports = { record, backfill };
