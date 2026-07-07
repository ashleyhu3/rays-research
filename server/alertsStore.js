'use strict';
const path    = require('path');
const storage = require('./storage');

// Persists options-volume alert state:
//   • subscriptions — who wants to be alerted, for which tickers, at what
//     sensitivity. Keyed by (lowercased) email so re-subscribing updates in place.
//   • volumeHistory — a rolling per-ticker record of total call/put contract
//     volume, one entry per UTC day. The alert engine compares the freshly
//     fetched "today" totals against the most recent prior day's entry to detect
//     a large jump, and the email shows both days side by side.
//
// Shape:
//   { subscriptions: [ { email, tickers:[...], threshold, minVolume,
//                        createdAt, lastNotifiedAt } ],
//     volumeHistory: { [TICKER]: [ { date:'YYYY-MM-DD', callVol, putVol }, … ] } }
const FILE = path.join(__dirname, 'data', 'optionsAlerts.json');
const BLOB = 'optionsAlerts';

// How many days of per-ticker volume history to retain (plenty for a
// yesterday-vs-today comparison; keeps the blob small).
const HISTORY_CAP = 30;

let store = null;
function load() {
  if (!store) store = storage.read(BLOB, FILE);
  // Defensive defaults so a freshly-seeded/empty blob is well-formed.
  if (!store.subscriptions) store.subscriptions = [];
  if (!store.volumeHistory) store.volumeHistory = {};
  return store;
}
function persist() { storage.write(BLOB, FILE, load()); }
function today() { return new Date().toISOString().slice(0, 10); }

function normEmail(email) { return String(email || '').trim().toLowerCase(); }
function normTicker(t)    { return String(t || '').trim().toUpperCase(); }

// ── Subscriptions ──────────────────────────────────────────────────────────

// Add or update a subscription (upsert by email). Returns the stored record.
function upsertSubscription({ email, tickers, threshold, minVolume }) {
  const s   = load();
  const key = normEmail(email);
  const cleanTickers = [...new Set((tickers || []).map(normTicker).filter(Boolean))];
  const existing = s.subscriptions.find(sub => normEmail(sub.email) === key);
  if (existing) {
    existing.email     = key;
    existing.tickers   = cleanTickers;
    if (threshold != null) existing.threshold = threshold;
    if (minVolume != null) existing.minVolume = minVolume;
    existing.updatedAt = new Date().toISOString();
    persist();
    return existing;
  }
  const record = {
    email: key,
    tickers: cleanTickers,
    threshold: threshold != null ? threshold : 0.5,
    minVolume: minVolume != null ? minVolume : 1000,
    createdAt: new Date().toISOString(),
    lastNotifiedAt: null,
  };
  s.subscriptions.push(record);
  persist();
  return record;
}

function getSubscription(email) {
  const key = normEmail(email);
  return load().subscriptions.find(sub => normEmail(sub.email) === key) || null;
}

function removeSubscription(email) {
  const s   = load();
  const key = normEmail(email);
  const before = s.subscriptions.length;
  s.subscriptions = s.subscriptions.filter(sub => normEmail(sub.email) !== key);
  const removed = s.subscriptions.length < before;
  if (removed) persist();
  return removed;
}

function listSubscriptions() { return load().subscriptions.slice(); }

// Every ticker any subscriber is watching (de-duplicated).
function subscribedTickers() {
  const set = new Set();
  for (const sub of load().subscriptions) for (const t of sub.tickers) set.add(t);
  return [...set];
}

function markNotified(email, notificationKey = null) {
  const sub = getSubscription(email);
  if (sub) {
    sub.lastNotifiedAt = new Date().toISOString();
    sub.lastNotificationKey = notificationKey;
    persist();
  }
}

// ── Per-ticker daily volume history ─────────────────────────────────────────

// The most recent stored day strictly before `date` (default today). When an
// expiration is supplied, only compare the same option chain; this prevents a
// routine weekly expiration roll from looking like a volume surge.
function previousVolume(ticker, date = today(), expiration = null) {
  const hist = load().volumeHistory[normTicker(ticker)] || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].date < date && (!expiration || hist[i].expiration === expiration)) return hist[i];
  }
  return null;
}

// Record today's totals for a ticker (replacing any existing same-day entry so
// repeated runs in one day don't stack), capped at HISTORY_CAP days.
function recordVolume(ticker, { callVol, putVol, expiration = null }, date = today()) {
  const s   = load();
  const key = normTicker(ticker);
  const hist = s.volumeHistory[key] = s.volumeHistory[key] || [];
  const entry = { date, callVol, putVol, expiration };
  const idx = hist.findIndex(h => h.date === date);
  if (idx >= 0) hist[idx] = entry; else hist.push(entry);
  hist.sort((a, b) => a.date.localeCompare(b.date));
  if (hist.length > HISTORY_CAP) hist.splice(0, hist.length - HISTORY_CAP);
  persist();
  return entry;
}

module.exports = {
  upsertSubscription,
  getSubscription,
  removeSubscription,
  listSubscriptions,
  subscribedTickers,
  markNotified,
  previousVolume,
  recordVolume,
  today,
  normEmail,
  normTicker,
};
