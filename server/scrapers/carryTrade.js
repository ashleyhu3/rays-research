/** Weekly CFTC non-commercial net positions for two common carry currencies.
 * Reads are storage-only; the scheduled collector owns upstream downloads. */
'use strict';

const path = require('path');
const { inflateRawSync } = require('zlib');
const storage = require('../storage');

const BLOB = 'carryTradeHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'carryTradeHistory.json');
const CURRENT_URL = 'https://www.cftc.gov/dea/newcot/deafut.txt';
const HISTORY_URL = year => `https://www.cftc.gov/files/dea/history/deacot${year}.zip`;
const BACKFILL_YEARS = 6;
const UA = 'Mozilla/5.0 Signal Liquidity Dashboard';

const MARKETS = [
  {
    key: 'jpy', label: 'CFTC JPY Speculative Net Positions', cftcCode: '097741',
    sourceUrl: 'https://www.investing.com/economic-calendar/cftc-jpy-speculative-positions-1614',
  },
  {
    key: 'chf', label: 'CFTC CHF Speculative Net Positions', cftcCode: '092741',
    sourceUrl: 'https://www.investing.com/economic-calendar/cftc-chf-speculative-positions-1617',
  },
];
const BY_CODE = new Map(MARKETS.map(market => [market.cftcCode, market]));

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else current += char;
  }
  result.push(current);
  return result;
}

function cftcNumber(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLegacyCftc(text) {
  const out = Object.fromEntries(MARKETS.map(market => [market.key, {}]));
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = splitCsvLine(line);
    const market = BY_CODE.get(String(columns[3] ?? '').trim());
    if (!market) continue;
    const date = String(columns[2] ?? '').trim();
    const long = cftcNumber(columns[8]);
    const short = cftcNumber(columns[9]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(long) && Number.isFinite(short)) {
      out[market.key][date] = long - short;
    }
  }
  return out;
}

function unzipFirstFile(archive, label) {
  if (archive.length < 30 || archive.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${label} download is not a ZIP archive`);
  }
  const flags = archive.readUInt16LE(6);
  const method = archive.readUInt16LE(8);
  const compressedSize = archive.readUInt32LE(18);
  const rawSize = archive.readUInt32LE(22);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  if (flags & 0x01) throw new Error(`${label} ZIP is encrypted`);
  if (flags & 0x08) throw new Error(`${label} ZIP uses an unsupported data descriptor`);
  if (rawSize > 25_000_000) throw new Error(`${label} file is unexpectedly large`);
  const start = 30 + nameLength + extraLength;
  const end = start + compressedSize;
  if (end > archive.length) throw new Error(`${label} ZIP is truncated`);
  const compressed = archive.subarray(start, end);
  const file = method === 0 ? Buffer.from(compressed)
    : method === 8 ? inflateRawSync(compressed)
      : null;
  if (!file) throw new Error(`${label} ZIP compression method ${method} is unsupported`);
  return file;
}

async function fetchText(url, label, zipped = false) {
  const response = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  if (!zipped) return response.text();
  const archive = Buffer.from(await response.arrayBuffer());
  return unzipFirstFile(archive, label).toString('utf8');
}

function merge(history, parsed) {
  for (const market of MARKETS) {
    history[market.key] = { ...(history[market.key] ?? {}), ...(parsed[market.key] ?? {}) };
  }
}

function hasBackfill(history) {
  return MARKETS.every(market => {
    const dates = Object.keys(history[market.key] ?? {}).sort();
    if (dates.length < 200) return false;
    const span = new Date(`${dates.at(-1)}T00:00:00Z`) - new Date(`${dates[0]}T00:00:00Z`);
    return Number.isFinite(span) && span >= 4 * 365 * 86400000;
  });
}

function assemble(history) {
  return {
    series: Object.fromEntries(MARKETS.map(market => {
      const values = history[market.key] ?? {};
      const data = Object.keys(values).sort().map(date => ({ date, value: values[date] }));
      return [market.key, {
        name: market.label, unit: 'contracts', frequency: 'Weekly',
        source: 'Investing.com / CFTC', sourceUrl: market.sourceUrl,
        cftcCode: market.cftcCode, data,
      }];
    })),
    updatedAt: history.updatedAt ?? null,
    errors: history.errors ?? {},
  };
}

function loadHistory() {
  const history = storage.read(BLOB, HISTORY_FILE);
  for (const market of MARKETS) history[market.key] = history[market.key] ?? {};
  return history;
}

async function updateCarryTrade() {
  const history = loadHistory();
  const currentYear = new Date().getUTCFullYear();
  const years = hasBackfill(history)
    ? [currentYear]
    : Array.from({ length: BACKFILL_YEARS + 1 }, (_, index) => currentYear - BACKFILL_YEARS + index);
  const errors = {};

  for (const year of years) {
    try {
      merge(history, parseLegacyCftc(await fetchText(HISTORY_URL(year), `CFTC ${year}`, true)));
    } catch (error) {
      errors[year] = error.message;
    }
  }
  try {
    merge(history, parseLegacyCftc(await fetchText(CURRENT_URL, 'CFTC current report')));
  } catch (error) {
    errors.current = error.message;
  }
  if (MARKETS.every(market => !Object.keys(history[market.key]).length)) {
    throw new Error(`CFTC carry-trade refresh failed: ${Object.values(errors).join('; ')}`);
  }
  history.updatedAt = new Date().toISOString();
  history.errors = errors;
  storage.write(BLOB, HISTORY_FILE, history);
  return assemble(history);
}

function readCarryTrade() { return assemble(loadHistory()); }

module.exports = {
  updateCarryTrade,
  readCarryTrade,
  _test: { parseLegacyCftc, assemble, splitCsvLine, MARKETS },
};
