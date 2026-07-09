'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const storage = require('./storage');
const {
  DEFAULT_TICKERS,
  generateDailyOptionsReport,
} = require('./scripts/generateDailyOptionsReport');

const BLOB = {
  name: 'dailyOptionsReport',
  file: path.join(__dirname, 'data', 'dailyOptionsReport.json'),
};
const DEFAULT_TIME_ZONE = 'Asia/Hong_Kong';

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
  storage.write(BLOB.name, BLOB.file, {
    ...current,
    latest: report,
    updatedAt: report.generatedAt,
  });
}

function readLatestDailyOptionsPdf() {
  const blob = storage.read(BLOB.name, BLOB.file);
  return blob.latestPdf || null;
}

function writeLatestDailyOptionsPdf(pdf) {
  const current = storage.read(BLOB.name, BLOB.file);
  storage.write(BLOB.name, BLOB.file, {
    ...current,
    latestPdf: pdf,
    updatedAt: pdf.generatedAt,
  });
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
  generateAndStoreDailyOptionsReport,
  generateAndStoreDailyOptionsPdf,
  normalizeTickers,
  pdfMeta,
  readLatestDailyOptionsReport,
  readLatestDailyOptionsPdf,
  renderHtmlToPdf,
};
