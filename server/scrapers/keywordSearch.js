'use strict';
const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'stocktwits', 'Stocktwits-Scraper-main', 'data');

const TICKERS = [
  'aaoi','aehr','amat','cien','cohr','glw','keys','klac',
  'lite','lrcx','mu','sndk','stx','ter','tsem','viav','wdc',
];

// RFC4180-compliant streaming CSV parser (copied from sentiment.js — text
// column has embedded commas/newlines so line-split is not safe).
function parseCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    let field = '', row = [], inQuotes = false, prevQuote = false;
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

/**
 * Count twits containing `keyword` as a whole word (case-insensitive) per
 * calendar month across all tracked tickers, for the past 12 months.
 *
 * Returns { keyword, months: ['YYYY-MM', ...], counts: [n, ...], total }.
 */
async function searchKeyword(keyword) {
  // Escape regex metacharacters, then add word-boundary anchors.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`\\b${escaped}\\b`, 'i');

  // Earliest month to include (12 months back from today).
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1))
    .toISOString().slice(0, 7);  // 'YYYY-MM'

  const counts = new Map(); // 'YYYY-MM' -> number

  for (const ticker of TICKERS) {
    const file = path.join(DATA_DIR, `api_tweets_${ticker}.csv`);
    if (!fs.existsSync(file)) continue;

    let textIdx = -1, tsIdx = -1, isHeader = true;

    await parseCsv(file, row => {
      if (isHeader) {
        textIdx  = row.indexOf('text');
        tsIdx    = row.indexOf('timestamp');
        isHeader = false;
        return;
      }
      const ts = row[tsIdx] ?? '';
      if (ts.length < 7) return;
      const month = ts.slice(0, 7);     // 'YYYY-MM'
      if (month < cutoff) return;        // outside the 12-month window

      const text = row[textIdx] ?? '';
      if (!rx.test(text)) return;

      counts.set(month, (counts.get(month) ?? 0) + 1);
    });
  }

  // Build a complete month list (including months with zero matches).
  const months = [];
  const cursor = new Date(Date.UTC(
    parseInt(cutoff.slice(0, 4)),
    parseInt(cutoff.slice(5, 7)) - 1,
    1,
  ));
  const endMonth = now.toISOString().slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= endMonth) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const countsArr = months.map(m => counts.get(m) ?? 0);
  const total     = countsArr.reduce((a, b) => a + b, 0);

  return { keyword, months, counts: countsArr, total };
}

module.exports = { searchKeyword };
