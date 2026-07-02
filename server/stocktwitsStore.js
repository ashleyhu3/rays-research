'use strict';
const fs = require('fs');
const path = require('path');

/**
 * StockTwits message store — MongoDB-backed, with a local-CSV fallback.
 *
 * Historically the StockTwits messages lived as ~50 MB of per-ticker CSVs
 * committed straight into the git repo, which the daily collector appended to
 * and pushed back — bloating git history without bound. This module moves that
 * data into MongoDB and gives the rest of the app a single, source-agnostic API:
 *
 *   getDailyBuckets(ticker) → Map<'YYYY-MM-DD', {count,bull,bear}>   (chart data)
 *   keywordRolling(query)    → { q, total, months[], counts[] }      (keyword search)
 *
 * Two collections, two retention policies:
 *   • `stocktwits_messages` — one document per message (raw text + metadata),
 *     keyed by message_id. RETAINED FOR 18 MONTHS — old messages are pruned to
 *     keep the free-tier (512 MB) Atlas cluster bounded. A `$text` index on the
 *     body powers fast whole-word keyword search.
 *   • `stocktwits_daily` — one tiny document per (ticker, UTC-day) holding
 *     {count, bull, bear}. KEPT FOREVER. This is the pre-aggregated chart data,
 *     so the posting-volume / sentiment charts keep their full history even
 *     after the underlying raw messages are pruned.
 *
 * Mode is chosen by environment, mirroring server/storage.js:
 *   • MONGODB_URI set → Mongo (production, and the collector workflow).
 *   • no MONGODB_URI  → read the committed CSVs in stocktwits/.../data (dev).
 *
 * The data-mutating helpers (migrateCsvDir, ingestCsv, prune, writeResumeStubs)
 * are used by the one-off migration script and the scheduled collector; the
 * read helpers are used by server/scrapers/sentiment.js.
 */

const DATA_DIR = path.join(__dirname, '..', 'stocktwits', 'Stocktwits-Scraper-main', 'data');
const MSG_COLL   = 'stocktwits_messages';
const DAILY_COLL = 'stocktwits_daily';
const RETENTION_MONTHS = 18;
const KW_WINDOW_DAYS = 30;
const KW_MONTHS = 12;

// ── Small date helpers (all UTC) ────────────────────────────────────────────
const isoAddDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// 12 monthly anchor dates ('YYYY-MM-DD'), oldest first, ending today (UTC).
function monthlyAnchors(now = new Date()) {
  const out = [];
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  for (let i = KW_MONTHS - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(y, m - i, d)).toISOString().slice(0, 10));
  }
  return out;
}

// First retained day ('YYYY-MM-DD') given the retention window.
function retentionCutoff(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RETENTION_MONTHS, now.getUTCDate()))
    .toISOString().slice(0, 10);
}

// Roll up per-day match counts into 12 monthly trailing-30-day windows.
function rollingFromDayCounts(dayCounts) {
  const anchors = monthlyAnchors();
  const counts = anchors.map(a => {
    const start = isoAddDays(a, -(KW_WINDOW_DAYS - 1));
    let c = 0;
    for (const [day, n] of dayCounts) if (day >= start && day <= a) c += n;
    return c;
  });
  // Distinct mentions across the charted year (windows overlap, so sum the
  // per-day counts, not the overlapping monthly points).
  const total = [...dayCounts.values()].reduce((a, b) => a + b, 0);
  return { months: anchors, counts, total };
}

// ── Dependency-free streaming RFC4180 CSV parser ────────────────────────────
// The `text` column carries embedded commas, quotes and newlines, so a
// line-based split would mis-parse. Yields one array of fields per record.
function parseCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    let field = '';
    let row = [];
    let inQuotes = false;
    let prevQuote = false;
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    stream.on('data', chunk => {
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (inQuotes) {
          if (c === '"') { prevQuote = true; inQuotes = false; }
          else field += c;
        } else if (prevQuote) {
          prevQuote = false;
          if (c === '"') { field += '"'; inQuotes = true; }
          else if (c === ',') { row.push(field); field = ''; }
          else if (c === '\n') { row.push(field); onRow(row); row = []; field = ''; }
          else if (c === '\r') { /* skip */ }
          else field += c;
        } else if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); onRow(row); row = []; field = ''; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    });
    stream.on('end', () => {
      if (field.length || row.length) { row.push(field); onRow(row); }
      resolve();
    });
    stream.on('error', reject);
  });
}

function tickerFromFile(file) {
  const m = /^api_tweets_(.+)\.csv$/.exec(path.basename(file));
  return m ? m[1].toUpperCase() : null;
}
function csvFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter(f => /^api_tweets_.+\.csv$/.test(f)).map(f => path.join(DATA_DIR, f));
}

// ── Lazy Mongo connection ───────────────────────────────────────────────────
let _client = null;
let _colls = null; // { messages, daily } once connected, or false if file-mode
async function getColls() {
  if (_colls !== null) return _colls || null;
  const uri = process.env.MONGODB_URI;
  if (!uri) { _colls = false; return null; }
  try {
    const { MongoClient } = require('mongodb');
    _client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await _client.connect();
    const db = _client.db(process.env.MONGODB_DB || undefined);
    _colls = { messages: db.collection(MSG_COLL), daily: db.collection(DAILY_COLL) };
    return _colls;
  } catch (e) {
    console.warn('[stocktwitsStore] Mongo connect failed, using CSV fallback:', e.message);
    _colls = false;
    if (_client) { try { await _client.close(); } catch {} _client = null; }
    return null;
  }
}
async function ensureIndexes() {
  const c = await getColls();
  if (!c) throw new Error('MONGODB_URI not set');
  await c.messages.createIndex({ symbol: 1, ts: 1 });
  await c.messages.createIndex({ ts: 1 });                 // prune by age
  await c.messages.createIndex({ text: 'text' });          // keyword search
  await c.daily.createIndex({ symbol: 1, date: 1 });
}
async function close() {
  if (_client) { try { await _client.close(); } catch {} _client = null; }
  _colls = null;
}

// ── Reads: daily chart buckets ──────────────────────────────────────────────
async function mongoDailyBuckets(ticker, c) {
  const days = new Map();
  const cur = c.daily.find({ symbol: ticker.toUpperCase() }, { projection: { _id: 0, date: 1, count: 1, bull: 1, bear: 1 } });
  for await (const d of cur) days.set(d.date, { count: d.count, bull: d.bull, bear: d.bear });
  return days.size ? days : null;
}
async function csvDailyBuckets(ticker) {
  const file = path.join(DATA_DIR, `api_tweets_${ticker.toLowerCase()}.csv`);
  if (!fs.existsSync(file)) return null;
  let tsIdx = -1, sentIdx = -1, header = true;
  const days = new Map();
  await parseCsv(file, row => {
    if (header) { tsIdx = row.indexOf('timestamp'); sentIdx = row.indexOf('sentiment'); header = false; return; }
    const ts = row[tsIdx];
    if (!ts || ts.length < 10) return;
    const day = ts.slice(0, 10);
    if (day < '2000-01-01' || day > '2100-01-01') return;
    let d = days.get(day);
    if (!d) { d = { count: 0, bull: 0, bear: 0 }; days.set(day, d); }
    d.count++;
    const s = row[sentIdx];
    if (s === 'Bullish') d.bull++;
    else if (s === 'Bearish') d.bear++;
  });
  return days.size ? days : null;
}
async function getDailyBuckets(ticker) {
  const c = await getColls();
  return c ? mongoDailyBuckets(ticker, c) : csvDailyBuckets(ticker);
}

// ── Reads: keyword rolling counts ───────────────────────────────────────────
async function mongoKeywordRolling(term, c) {
  const anchors = monthlyAnchors();
  const earliest = isoAddDays(anchors[0], -(KW_WINDOW_DAYS - 1));
  const today = anchors[anchors.length - 1];
  const rows = await c.messages.aggregate([
    { $match: {
        $text: { $search: `"${term}"` },           // quoted ⇒ whole-word, case-insensitive
        ts: { $gte: new Date(earliest + 'T00:00:00Z'), $lt: new Date(isoAddDays(today, 1) + 'T00:00:00Z') },
      } },
    { $project: { day: { $dateToString: { format: '%Y-%m-%d', date: '$ts', timezone: 'UTC' } } } },
    { $group: { _id: '$day', n: { $sum: 1 } } },
  ]).toArray();
  const dayCounts = new Map(rows.map(r => [r._id, r.n]));
  const { months, counts, total } = rollingFromDayCounts(dayCounts);
  return { q: term, total, months, counts };
}
async function csvKeywordRolling(term) {
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
  const anchors = monthlyAnchors();
  const earliest = isoAddDays(anchors[0], -(KW_WINDOW_DAYS - 1));
  const today = anchors[anchors.length - 1];
  const dayCounts = new Map();
  for (const file of csvFiles()) {
    let tsIdx = -1, textIdx = -1, header = true;
    await parseCsv(file, row => {
      if (header) { tsIdx = row.indexOf('timestamp'); textIdx = row.indexOf('text'); header = false; return; }
      const ts = row[tsIdx];
      if (!ts || ts.length < 10) return;
      const day = ts.slice(0, 10);
      if (day < earliest || day > today) return;
      const text = row[textIdx];
      if (text && re.test(text)) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    });
  }
  const { months, counts, total } = rollingFromDayCounts(dayCounts);
  return { q: term, total, months, counts };
}
async function keywordRolling(query) {
  const term = String(query ?? '').trim().toLowerCase();
  if (!term) return { q: '', total: 0, months: monthlyAnchors(), counts: new Array(KW_MONTHS).fill(0) };
  const c = await getColls();
  return c ? mongoKeywordRolling(term, c) : csvKeywordRolling(term);
}

// ── Writes: ingest, migrate, prune (collector + migration scripts) ──────────
function msgDocFromRow(row, idx) {
  const id = row[idx.message_id];
  const tsRaw = row[idx.timestamp];
  if (!id || !tsRaw) return null;
  const ts = new Date(tsRaw);
  if (isNaN(ts)) return null;
  const followers = Number(row[idx.user_followers]);
  const reshared = Number(row[idx.reshared_count]);
  return {
    _id: String(id),
    symbol: (row[idx.symbol] || '').toUpperCase(),
    username: row[idx.username] || '',
    user_followers: Number.isFinite(followers) ? followers : 0,
    text: row[idx.text] || '',
    ts,
    sentiment: row[idx.sentiment] || 'Neutral',
    reshared_count: Number.isFinite(reshared) ? reshared : 0,
    link: row[idx.link] || '',
  };
}

// Recompute the daily rollup for one (symbol, date) from the messages
// collection. Idempotent — safe to call after re-ingesting overlapping windows.
async function recomputeDaily(c, symbol, date) {
  const start = new Date(date + 'T00:00:00Z');
  const end = new Date(isoAddDays(date, 1) + 'T00:00:00Z');
  const [agg] = await c.messages.aggregate([
    { $match: { symbol, ts: { $gte: start, $lt: end } } },
    { $group: {
        _id: null,
        count: { $sum: 1 },
        bull: { $sum: { $cond: [{ $eq: ['$sentiment', 'Bullish'] }, 1, 0] } },
        bear: { $sum: { $cond: [{ $eq: ['$sentiment', 'Bearish'] }, 1, 0] } },
      } },
  ]).toArray();
  if (!agg) return;
  await c.daily.updateOne(
    { _id: `${symbol}|${date}` },
    { $set: { symbol, date, count: agg.count, bull: agg.bull, bear: agg.bear } },
    { upsert: true },
  );
}

// Ingest one CSV into Mongo: upsert recent (within-retention) messages, then
// recompute the daily rollups for the days this file touched. Returns counts.
async function ingestCsv(file) {
  const c = await getColls();
  if (!c) throw new Error('MONGODB_URI not set');
  const cutoff = retentionCutoff();
  let idx = null, header = true;
  let batch = [];
  let inserted = 0;
  const touched = new Map(); // symbol -> Set(date)
  const flush = async () => {
    if (!batch.length) return;
    const ops = batch.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true } }));
    const r = await c.messages.bulkWrite(ops, { ordered: false });
    inserted += (r.upsertedCount || 0);
    batch = [];
  };
  await parseCsv(file, row => {
    if (header) {
      idx = Object.fromEntries(['symbol', 'username', 'user_followers', 'text', 'timestamp', 'sentiment', 'reshared_count', 'link', 'message_id'].map(k => [k, row.indexOf(k)]));
      header = false;
      return;
    }
    const doc = msgDocFromRow(row, idx);
    if (!doc) return;
    const day = doc.ts.toISOString().slice(0, 10);
    if (day < cutoff) return; // beyond retention — rollup already holds its count
    if (!touched.has(doc.symbol)) touched.set(doc.symbol, new Set());
    touched.get(doc.symbol).add(day);
    batch.push(doc);
    if (batch.length >= 1000) return flush();
  });
  await flush();
  let days = 0;
  for (const [symbol, dates] of touched) for (const date of dates) { await recomputeDaily(c, symbol, date); days++; }
  return { file: path.basename(file), upserted: inserted, daysRecomputed: days };
}

// One-time migration: seed Mongo from every committed CSV. Builds the daily
// rollups from ALL history (so chart data survives), but only inserts raw
// messages within the retention window.
async function migrateCsvDir() {
  const c = await getColls();
  if (!c) throw new Error('MONGODB_URI not set');
  await ensureIndexes();
  const cutoff = retentionCutoff();
  const files = csvFiles();
  const summary = [];
  for (const file of files) {
    const ticker = tickerFromFile(file);
    let idx = null, header = true, batch = [], inserted = 0, rawRows = 0;
    const rollup = new Map(); // date -> {count,bull,bear}  (ALL history)
    const flush = async () => {
      if (!batch.length) return;
      const ops = batch.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true } }));
      const r = await c.messages.bulkWrite(ops, { ordered: false });
      inserted += (r.upsertedCount || 0);
      batch = [];
    };
    await parseCsv(file, row => {
      if (header) {
        idx = Object.fromEntries(['symbol', 'username', 'user_followers', 'text', 'timestamp', 'sentiment', 'reshared_count', 'link', 'message_id'].map(k => [k, row.indexOf(k)]));
        header = false;
        return;
      }
      const doc = msgDocFromRow(row, idx);
      if (!doc) return;
      rawRows++;
      const day = doc.ts.toISOString().slice(0, 10);
      // rollup over full history
      let r = rollup.get(day);
      if (!r) { r = { count: 0, bull: 0, bear: 0 }; rollup.set(day, r); }
      r.count++;
      if (doc.sentiment === 'Bullish') r.bull++;
      else if (doc.sentiment === 'Bearish') r.bear++;
      // raw messages only within retention
      if (day >= cutoff) { batch.push(doc); if (batch.length >= 1000) return flush(); }
    });
    await flush();
    // Upsert rollups for this ticker.
    if (rollup.size) {
      const ops = [...rollup].map(([date, r]) => ({
        updateOne: { filter: { _id: `${ticker}|${date}` }, update: { $set: { symbol: ticker, date, ...r } }, upsert: true },
      }));
      for (let i = 0; i < ops.length; i += 1000) await c.daily.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }
    summary.push({ ticker, rawRows, messagesInserted: inserted, dailyDocs: rollup.size });
    console.log(`[migrate] ${ticker}: ${rawRows.toLocaleString()} rows → ${inserted.toLocaleString()} messages (<=18mo) + ${rollup.size} daily docs`);
  }
  return summary;
}

// Delete raw messages older than the retention window (rollups are untouched).
async function prune() {
  const c = await getColls();
  if (!c) throw new Error('MONGODB_URI not set');
  const cutoff = new Date(retentionCutoff() + 'T00:00:00Z');
  const r = await c.messages.deleteMany({ ts: { $lt: cutoff } });
  return r.deletedCount || 0;
}

// Write minimal one-row "resume stub" CSVs (latest message per ticker) into a
// directory, so the Python collector's incremental logic — which reads the
// newest committed timestamp to know where to resume — works without the full
// CSVs living in the repo. Tickers with no Mongo data are skipped (the Python
// collector then full-scrapes them from its default start).
async function writeResumeStubs(outDir, tickers) {
  const c = await getColls();
  if (!c) throw new Error('MONGODB_URI not set');
  fs.mkdirSync(outDir, { recursive: true });
  const header = 'symbol,username,user_followers,text,timestamp,sentiment,reshared_count,link,message_id,scraped_at\n';
  const written = [];
  for (const t of tickers) {
    const symbol = t.toUpperCase();
    const [latest] = await c.messages.find({ symbol }).sort({ ts: -1 }).limit(1).toArray();
    if (!latest) continue;
    const iso = latest.ts.toISOString().replace(/\.\d+Z$/, 'Z');
    const row = [symbol, '', 0, '', iso, latest.sentiment || 'Neutral', 0, '', latest._id, ''].join(',');
    fs.writeFileSync(path.join(outDir, `api_tweets_${symbol.toLowerCase()}.csv`), header + row + '\n');
    written.push(symbol);
  }
  return written;
}

module.exports = {
  // reads
  getDailyBuckets, keywordRolling,
  // writes / ops
  ensureIndexes, ingestCsv, migrateCsvDir, prune, writeResumeStubs, close,
  // constants / helpers (for scripts/tests)
  DATA_DIR, RETENTION_MONTHS, retentionCutoff, csvFiles, tickerFromFile,
};
