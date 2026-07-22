'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const storage = require('./storage');
const {
  DEFAULT_TICKERS,
  buildStructuredReport,
  generateDailyOptionsReport,
} = require('./scripts/generateDailyOptionsReport');

const BLOB = {
  name: 'dailyOptionsReport',
  file: path.join(__dirname, 'data', 'dailyOptionsReport.json'),
};
const compressedId = field => `optionsReport:${field}`;
const DEFAULT_TIME_ZONE = 'Asia/Hong_Kong';
// Keep a rolling archive of past daily reports in Mongo so the daily job only
// scrapes today and prior days are reused/served straight from storage. Mongo
// caps a single document at 16MB, and one 80+-ticker report is ~6MB, so the
// archive is pruned by total serialized SIZE rather than a fixed day count — a
// day-count cap couldn't know that a few large days would blow past the limit.
const MAX_BLOB_BYTES = 14 * 1024 * 1024;

function dateInTimeZone(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeTickers(value) {
  if (Array.isArray(value)) return value.map(t => String(t).trim().toUpperCase()).filter(Boolean);
  if (!value) return DEFAULT_TICKERS;
  return String(value)
    .split(',')
    .map(ticker => ticker.trim().toUpperCase())
    .filter(Boolean);
}

function reportOutputDir() {
  return path.resolve(process.env.OPTIONS_REPORT_OUT_DIR || path.join(os.tmpdir(), 'rays-research-options-report'));
}

function readLatestDailyOptionsReport() {
  const blob = storage.read(BLOB.name, BLOB.file);
  return blob.latest || null;
}

function writeLatestDailyOptionsReport(report) {
  const current = storage.read(BLOB.name, BLOB.file);
  const next = {
    ...current,
    latest: report,
    updatedAt: report.generatedAt,
  };
  storage.write(BLOB.name, BLOB.file, next);
  storage.writeCompressed(compressedId('latest'), next.latest);
}

function blobSize(obj) {
  return Buffer.byteLength(JSON.stringify(obj));
}

// Store one day's structured report as `latest`, keeping prior days under
// `byDate`. `latest` already holds today's full report, so today is NOT also
// copied into byDate — doing that (as this used to) stored the largest day
// twice and, at 80+ tickers, pushed the whole document past Mongo's 16MB cap so
// every write silently failed. Reads already fall back to `latest` for today's
// date, so byDate only needs the *previous* days. The archive is then trimmed
// oldest-first until the whole document fits under MAX_BLOB_BYTES.
function writeDailyReport(payload) {
  const current = storage.read(BLOB.name, BLOB.file);
  const byDate = { ...(current.byDate || {}) };

  // Roll the outgoing day into the archive when the date advances, so history is
  // kept without ever holding the current day in two places.
  if (current.latest?.date && current.latest.date !== payload.date) {
    byDate[current.latest.date] = current.latest;
  }
  delete byDate[payload.date]; // current day is served from `latest`

  const next = { ...current, latest: payload, byDate, updatedAt: payload.generatedAt };

  const dates = Object.keys(next.byDate).sort(); // oldest first
  for (let i = 0; i < dates.length && blobSize(next) > MAX_BLOB_BYTES; i += 1) {
    delete next.byDate[dates[i]];
  }
  storage.write(BLOB.name, BLOB.file, next);
  storage.writeCompressed(compressedId('latest'), next.latest);
  for (const [date, report] of Object.entries(next.byDate)) {
    storage.writeCompressed(compressedId(`date:${date}`), report);
  }
  storage.writeCompressed(
    compressedId('availableDates'),
    [next.latest?.date, ...Object.keys(next.byDate)].filter(Boolean).sort().reverse(),
  );
}

// Read a specific date's archived report, or the latest when no date is given.
function readDailyReport(date) {
  const blob = storage.read(BLOB.name, BLOB.file);
  if (date) return blob.byDate?.[date] || (blob.latest?.date === date ? blob.latest : null);
  return blob.latest || null;
}

// Pick up whatever another process (a local script, a different instance)
// wrote to Mongo, without re-running the scrape — for a "Refresh" action that
// should be a cheap re-read, not another full generation.
async function reloadDailyReport(date) {
  await storage.reload(BLOB.name, BLOB.file);
  return readDailyReport(date);
}

// Newest-first list of dates we have a stored report for.
function readAvailableReportDates() {
  const blob = storage.read(BLOB.name, BLOB.file);
  const dates = new Set(Object.keys(blob.byDate || {}));
  if (blob.latest?.date) dates.add(blob.latest.date);
  return [...dates].sort().reverse();
}

function readLatestDailyOptionsPdf() {
  const blob = storage.read(BLOB.name, BLOB.file);
  return blob.latestPdf || null;
}

// Web routes use projected field reads so opening Alerts does not download the
// structured report, its archive, and the base64 PDF in one 12 MB document.
async function readDailyReportProjected(date, { refresh = false } = {}) {
  const latest = await readProjectedField('latest', { refresh });
  if (!date || latest?.date === date) return latest || null;
  const archived = await storage.readCompressed(compressedId(`date:${date}`), { refresh });
  if (archived != null) return archived;
  const byDate = await storage.readField(BLOB.name, BLOB.file, 'byDate', { refresh });
  return byDate?.[date] || null;
}

async function readAvailableReportDatesProjected({ refresh = false } = {}) {
  const dates = await storage.readCompressed(compressedId('availableDates'), { refresh });
  if (Array.isArray(dates)) return dates;
  const latest = await readProjectedField('latest', { refresh });
  return latest?.date ? [latest.date] : [];
}

async function readLatestDailyOptionsPdfProjected({ refresh = false } = {}) {
  return readProjectedField('latestPdf', { refresh });
}

async function readLatestDailyOptionsPdfMetaProjected({ refresh = false } = {}) {
  const stored = await storage.readCompressed(compressedId('latestPdfMeta'), { refresh });
  if (stored != null) return stored;
  const pdf = await readLatestDailyOptionsPdfProjected({ refresh });
  return pdfMeta(pdf);
}

async function readProjectedField(field, { refresh = false } = {}) {
  const compressed = await storage.readCompressed(compressedId(field), { refresh });
  if (compressed != null) return compressed;
  return storage.readField(BLOB.name, BLOB.file, field, { refresh });
}

function writeLatestDailyOptionsPdf(pdf) {
  const current = storage.read(BLOB.name, BLOB.file);
  const next = {
    ...current,
    latestPdf: pdf,
    updatedAt: pdf.generatedAt,
  };
  storage.write(BLOB.name, BLOB.file, next);
  storage.writeCompressed(compressedId('latestPdf'), pdf);
  storage.writeCompressed(compressedId('latestPdfMeta'), pdfMeta(pdf));
}

function buildReportPayload(markdown, markdownPath, report, { generatedAt = new Date().toISOString() } = {}) {
  const baseDir = path.dirname(markdownPath);
  const blocks = [];
  const charts = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const alt = image[1];
      const assetPath = path.resolve(baseDir, image[2]);
      if (!fs.existsSync(assetPath)) {
        blocks.push({ type: 'missing-chart', text: image[2] });
        continue;
      }
      const svg = fs.readFileSync(assetPath, 'utf8');
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      const chart = {
        type: 'chart',
        alt,
        filename: path.basename(assetPath),
        src: dataUri,
      };
      charts.push(chart);
      blocks.push(chart);
      continue;
    }

    if (line.startsWith('# ')) blocks.push({ type: 'h1', text: line.slice(2) });
    else if (line.startsWith('## ')) blocks.push({ type: 'h2', text: line.slice(3) });
    else if (line.startsWith('### ')) blocks.push({ type: 'h3', text: line.slice(4) });
    else blocks.push({ type: 'p', text: line });
  }

  return {
    date: report.date,
    generatedAt,
    timeZone: DEFAULT_TIME_ZONE,
    tickers: report.tickers.map(item => item.ticker),
    charts: charts.length,
    blocks,
  };
}

async function generateAndStoreDailyOptionsReport(options = {}) {
  const timeZone = options.timeZone || process.env.OPTIONS_REPORT_TIMEZONE || DEFAULT_TIME_ZONE;
  const date = options.date || process.env.OPTIONS_REPORT_DATE || dateInTimeZone(new Date(), timeZone);
  const tickers = normalizeTickers(options.tickers || process.env.OPTIONS_REPORT_TICKERS);
  const outDir = path.resolve(options.outDir || reportOutputDir());
  fs.mkdirSync(outDir, { recursive: true });

  const generated = await generateDailyOptionsReport({
    date,
    tickers,
    out: path.join(outDir, `daily-options-data-${date}.md`),
    format: 'md',
  });
  const payload = buildReportPayload(generated.content, generated.outPath, generated.report);
  writeLatestDailyOptionsReport(payload);

  return {
    ...payload,
    outPath: generated.outPath,
  };
}

// The daily job: scrape today's options data from Massive once, build the
// self-contained structured payload, and persist it (latest + per-date archive)
// in Mongo. No PDF/Chrome — the web app renders the payload natively.
async function generateAndStoreDailyOptions(options = {}) {
  const timeZone = options.timeZone || process.env.OPTIONS_REPORT_TIMEZONE || DEFAULT_TIME_ZONE;
  const date = options.date || process.env.OPTIONS_REPORT_DATE || dateInTimeZone(new Date(), timeZone);
  const tickers = normalizeTickers(options.tickers || process.env.OPTIONS_REPORT_TICKERS);
  const outDir = path.resolve(options.outDir || reportOutputDir());
  fs.mkdirSync(outDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const generated = await generateDailyOptionsReport({
    date,
    tickers,
    out: path.join(outDir, `daily-options-data-${date}.html`),
    format: 'html',
    // Write what's done so far after every ticker, so a long scrape (or one that
    // fails partway) leaves the site with the growing partial report instead of
    // nothing until the very end.
    onTickerDone: partial => writeDailyReport(buildStructuredReport(partial, { generatedAt, timeZone })),
  });
  const payload = buildStructuredReport(generated.report, { generatedAt, timeZone });
  writeDailyReport(payload);

  return {
    date: payload.date,
    generatedAt,
    timeZone,
    tickers: payload.tickers.map(item => item.ticker),
    charts: payload.tickers.reduce((sum, item) => sum + item.expirations.length * 2, 0),
  };
}

function findChromeExecutable() {
  const candidates = [
    process.env.PDF_CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }

  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

function renderHtmlToPdf({ htmlPath, pdfPath }) {
  const chrome = findChromeExecutable();
  if (!chrome) {
    throw new Error('No Chrome/Chromium executable found. Set PDF_CHROME_PATH or run in GitHub Actions with Chrome installed.');
  }

  const args = [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0 && fs.existsSync(pdfPath)) return resolve();
      reject(new Error(`Chrome PDF render failed (${code}): ${stderr.trim() || 'no stderr'}`));
    });
  });
}

function pdfMeta(pdf) {
  if (!pdf) return null;
  return {
    date: pdf.date,
    filename: pdf.filename,
    size: pdf.size,
    generatedAt: pdf.generatedAt,
    updatedAt: pdf.generatedAt,
    tickers: pdf.tickers,
    url: `/api/alerts/daily-options-report/pdf?date=${encodeURIComponent(pdf.date)}`,
  };
}

async function generateAndStoreDailyOptionsPdf(options = {}) {
  const timeZone = options.timeZone || process.env.OPTIONS_REPORT_TIMEZONE || DEFAULT_TIME_ZONE;
  const date = options.date || process.env.OPTIONS_REPORT_DATE || dateInTimeZone(new Date(), timeZone);
  const tickers = normalizeTickers(options.tickers || process.env.OPTIONS_REPORT_TICKERS);
  const outDir = path.resolve(options.outDir || reportOutputDir());
  fs.mkdirSync(outDir, { recursive: true });

  const htmlPath = path.join(outDir, `daily-options-data-${date}.html`);
  const pdfPath = path.join(outDir, `daily-options-data-${date}.pdf`);
  const generated = await generateDailyOptionsReport({
    date,
    tickers,
    out: htmlPath,
    format: 'html',
  });
  await renderHtmlToPdf({ htmlPath: generated.outPath, pdfPath });

  const buffer = fs.readFileSync(pdfPath);
  const pdf = {
    date,
    generatedAt: new Date().toISOString(),
    timeZone,
    tickers: generated.report.tickers.map(item => item.ticker),
    filename: `daily-options-data-${date}.pdf`,
    contentType: 'application/pdf',
    base64: buffer.toString('base64'),
    size: buffer.length,
  };
  writeLatestDailyOptionsPdf(pdf);

  return {
    ...pdfMeta(pdf),
    outPath: pdfPath,
  };
}

module.exports = {
  BLOB,
  DEFAULT_TIME_ZONE,
  buildReportPayload,
  dateInTimeZone,
  generateAndStoreDailyOptions,
  generateAndStoreDailyOptionsReport,
  generateAndStoreDailyOptionsPdf,
  normalizeTickers,
  pdfMeta,
  readAvailableReportDates,
  readAvailableReportDatesProjected,
  readDailyReport,
  readDailyReportProjected,
  reloadDailyReport,
  readLatestDailyOptionsReport,
  readLatestDailyOptionsPdf,
  readLatestDailyOptionsPdfMetaProjected,
  readLatestDailyOptionsPdfProjected,
  renderHtmlToPdf,
  writeDailyReport,
};
