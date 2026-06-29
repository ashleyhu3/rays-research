'use strict';
const path = require('path');
const storage = require('./storage');

// Persists timestamped short-interest snapshots per ticker.
// Yahoo Finance's shortPercentOfFloat is a point-in-time stat that can be
// absent on any given request (rate limits, bi-monthly publication cadence).
// We record a snapshot whenever we receive a real value and interpolate across
// the stored history to build a genuine time series instead of simulated data.
//
// Shape: { [TICKER]: [{ date: 'YYYY-MM-DD', shortPct: 0.0087, shortRatio: 1.82, sharesShort: 142000000 }] }
//   Sorted ascending by date. One entry per UTC day; extra writes within the same
//   day overwrite the existing entry. History is capped at MAX_POINTS per ticker.

const FILE = path.join(__dirname, 'data', 'shortInterestHistory.json');
const BLOB = 'shortInterestHistory';
const MAX_POINTS = 156; // ~3 years of bi-weekly snapshots

let store = null;
function load() { if (!store) store = storage.read(BLOB, FILE); return store; }
function today() { return new Date().toISOString().slice(0, 10); }

// Record a snapshot. No-op when shortPct is null. Overwrites today's entry if
// already present (in case a later request returned a better value).
function record(ticker, shortPct, shortRatio, sharesShort) {
  if (!ticker || shortPct == null) return;
  const s = load();
  const arr = s[ticker] = s[ticker] || [];
  const td = today();
  const entry = { date: td, shortPct, shortRatio: shortRatio ?? null, sharesShort: sharesShort ?? null };
  if (arr.length && arr[arr.length - 1].date === td) {
    arr[arr.length - 1] = entry;
  } else {
    arr.push(entry);
    if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
  }
  storage.write(BLOB, FILE, s);
}

// Return stored snapshots for a ticker sorted ascending by date.
function getHistory(ticker) {
  const arr = load()[ticker];
  if (!arr || !arr.length) return [];
  return [...arr].sort((a, b) => a.date.localeCompare(b.date));
}

// Build a short-ratio series aligned to the provided ISO date strings.
// Interpolates linearly between adjacent snapshots; holds the boundary value
// outside the stored range. Returns null for dates when no history exists at all.
function buildSeries(ticker, dates) {
  const history = getHistory(ticker);
  if (!history.length) return dates.map(() => null);

  return dates.map(date => {
    let before = null;
    let after = null;
    for (const p of history) {
      if (p.date <= date) before = p;
      else if (!after) { after = p; break; }
    }

    if (before && after) {
      const ms0 = new Date(before.date).getTime();
      const ms1 = new Date(after.date).getTime();
      const ms  = new Date(date).getTime();
      const frac = ms1 > ms0 ? (ms - ms0) / (ms1 - ms0) : 0;
      const v0 = before.shortPct * 100;
      const v1 = after.shortPct * 100;
      return +((v0 + frac * (v1 - v0)).toFixed(2));
    }
    if (before) return +(before.shortPct * 100).toFixed(2);
    if (after)  return +(after.shortPct * 100).toFixed(2);
    return null;
  });
}

module.exports = { record, getHistory, buildSeries };
