'use strict';

// Publish one earnings review written by the .claude/skills/earnings-review skill.
//
//   node --env-file=.env server/scripts/publishEarningsReview.js --ticker GOOGL --quarter Q2 --year 2026
//
// Reads research/{TICKER}/Earnings_Review/{TICKER}_FY{year}Q{q}_EarningReview.md, renders
// it to a self-contained HTML document (its own <style>, so the page can iframe it the
// same way the daily reports are embedded), prints that to PDF, and writes three blobs:
//
//   earningsReview:{TICKER}:{PERIOD}      gzip-json {ticker, period, title, md, html, ...}
//   earningsReviewPdf:{TICKER}:{PERIOD}   base64 PDF
//   earningsReviewIndex                   newest-first list, for the page's history rail
//
// Mongo-only, like us-tech-daily/publish.py — there is nothing to publish to without
// MONGODB_URI. The PDF step needs Python + Playwright; when that is missing the review
// still publishes and the UI falls back to printing the iframe.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { marked } = require('marked');

const storage = require('../storage');
const STORAGE_BLOBS = require('../storageBlobs');

const RESEARCH_ROOT = path.join(__dirname, '..', '..', 'research');
const INDEX_BLOB = STORAGE_BLOBS.find(blob => blob.name === 'earningsReviewIndex');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};

// The skill writes {TICKER}_FY{year}Q{q}_EarningReview.md. Glob the directory as a
// fallback so a small naming drift (FY2026Q2 vs 2026Q2, a trailing suffix) publishes
// rather than failing a 20-minute run on a filename.
function findReviewFile(ticker, year, quarter) {
  const directory = path.join(RESEARCH_ROOT, ticker, 'Earnings_Review');
  if (!fs.existsSync(directory)) {
    throw new Error(`No Earnings_Review directory at ${directory} — did the skill run?`);
  }
  const exact = path.join(directory, `${ticker}_FY${year}${quarter}_EarningReview.md`);
  if (fs.existsSync(exact)) return exact;

  const candidates = fs.readdirSync(directory)
    .filter(file => file.endsWith('.md'))
    .filter(file => file.includes(year) && file.toUpperCase().includes(quarter));
  if (!candidates.length) {
    throw new Error(`No review markdown for ${ticker} ${year}${quarter} in ${directory}`);
  }
  if (candidates.length > 1) {
    console.warn(`[publish] ${candidates.length} candidates matched; using ${candidates[0]}`);
  }
  return path.join(directory, candidates[0]);
}

// The review's header carries a "业绩定性判断" (Beat-and-Raise / In-line / Miss / Mixed)
// and a "股价反应" line inside a leading blockquote. Both are index metadata — the rail
// shows them next to the period so a quarter's verdict reads without opening it.
function extractHeadline(markdown) {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
  const line = label => markdown.match(new RegExp(`${label}[^\\n]*`))?.[0] || '';

  // Both fields are written as a full sentence; the index only wants the chip-sized
  // part — the verdict keyword and the headline move.
  const verdictLine = line('业绩定性判断');
  const verdict = verdictLine.match(/Beat[- ]and[- ]Raise|In[- ]line|Mixed|Miss/i)?.[0] || null;
  const priceReaction = line('股价反应').match(/[+-]?\d+(?:\.\d+)?\s*%/)?.[0]?.replace(/\s+/g, '') || null;

  return { title, verdict, priceReaction };
}

const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Self-contained on purpose: the page embeds this in an iframe, so nothing may depend on
// the dashboard's stylesheet, and the PDF print comes off this same document.
const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 40px 48px 72px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC",
    Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px; line-height: 1.75; color: #1c1f24; background: #fff;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 980px; margin: 0 auto; }
h1 { font-size: 27px; line-height: 1.35; margin: 0 0 8px; letter-spacing: -0.01em; }
h2 {
  font-size: 21px; margin: 44px 0 14px; padding-bottom: 8px;
  border-bottom: 2px solid #e6e9ee; letter-spacing: -0.01em;
}
h3 { font-size: 17px; margin: 30px 0 10px; color: #17408b; }
h4 { font-size: 15px; margin: 22px 0 8px; color: #3d4450; }
p { margin: 0 0 13px; }
a { color: #17408b; text-decoration: none; border-bottom: 1px solid #c8d3e6; }
strong { font-weight: 650; }
ul, ol { margin: 0 0 14px; padding-left: 22px; }
li { margin: 4px 0; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em;
  background: #f2f4f8; padding: 1px 5px; border-radius: 4px;
}
blockquote {
  margin: 16px 0; padding: 12px 18px; background: #f6f8fc;
  border-left: 3px solid #17408b; border-radius: 0 6px 6px 0; color: #333a45;
}
blockquote p:last-child { margin-bottom: 0; }
.table-scroll { overflow-x: auto; margin: 0 0 18px; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { border: 1px solid #e2e6ec; padding: 7px 11px; text-align: left; vertical-align: top; }
th { background: #f4f6fa; font-weight: 620; white-space: nowrap; }
tbody tr:nth-child(even) { background: #fafbfd; }
hr { border: 0; border-top: 1px solid #e6e9ee; margin: 34px 0; }
em { color: #5b6472; }

@media print {
  body { padding: 0; font-size: 11.5px; }
  h2 { margin-top: 24px; page-break-after: avoid; }
  h3, h4 { page-break-after: avoid; }
  table, blockquote { page-break-inside: avoid; }
  .table-scroll { overflow: visible; }
}
`;

function renderHtml(markdown, { ticker, period, title }) {
  // Tables are the one thing that can overflow a phone-width iframe; wrapping each in its
  // own scroller keeps the document itself from scrolling sideways.
  const body = marked
    .parse(markdown, { gfm: true, breaks: false, async: false })
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || `${ticker} ${period} 财报复盘`)}</title>
<style>${CSS}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

// Print the rendered HTML with Playwright, the same set_content approach
// us-tech-daily/export_report.py uses — no temp file, and the PDF is the page as designed
// rather than a second layout implementation. Returns null when Playwright isn't there.
function renderPdf(html) {
  const python = process.env.EARNINGS_REVIEW_PYTHON || process.env.TRANSCRIPT_PYTHON || 'python3';
  const script = `
import sys
from playwright.sync_api import sync_playwright
html = sys.stdin.read()
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.set_content(html, wait_until="load")
    sys.stdout.buffer.write(page.pdf(format="A4", print_background=True,
                                     margin={"top": "14mm", "bottom": "16mm",
                                             "left": "12mm", "right": "12mm"}))
    browser.close()
`;
  // No `encoding` option: stdout must come back as a Buffer, since it is binary PDF.
  const result = spawnSync(python, ['-c', script], {
    input: html,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || String(result.stderr || '').trim().split('\n').pop();
    console.warn(`[publish] PDF skipped (${detail || 'playwright unavailable'}) — the page will print the iframe instead`);
    return null;
  }
  return result.stdout;
}

async function main() {
  const ticker = (argValue('--ticker') || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const quarter = (argValue('--quarter') || '').toUpperCase().replace(/[^0-9Q]/g, '');
  const year = (argValue('--year') || '').replace(/[^0-9]/g, '');
  if (!ticker || !/^Q[1-4]$/.test(quarter) || !/^\d{4}$/.test(year)) {
    throw new Error('Usage: publishEarningsReview.js --ticker GOOGL --quarter Q2 --year 2026');
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set — there is nothing to publish to');
  }
  const period = `${year}${quarter}`;

  const file = findReviewFile(ticker, year, quarter);
  const markdown = fs.readFileSync(file, 'utf8');
  const { title, verdict, priceReaction } = extractHeadline(markdown);
  const html = renderHtml(markdown, { ticker, period, title });
  console.log(`[publish] ${path.relative(path.join(__dirname, '..', '..'), file)} → ${markdown.length.toLocaleString('en-US')} chars, verdict: ${verdict || 'n/a'}`);

  const pdf = renderPdf(html);
  const generatedAt = new Date().toISOString();

  await storage.init(STORAGE_BLOBS, { preload: false });
  await storage.load(INDEX_BLOB.name, INDEX_BLOB.file);

  storage.writeCompressed(`earningsReview:${ticker}:${period}`, {
    ticker, period, title, verdict, priceReaction, generatedAt, md: markdown, html,
  });

  if (pdf) {
    storage.writeRaw(`earningsReviewPdf:${ticker}:${period}`, {
      ticker,
      period,
      filename: `${ticker}_${period}_EarningReview.pdf`,
      contentType: 'application/pdf',
      size: pdf.length,
      base64: pdf.toString('base64'),
    });
  }

  // The index is a flat newest-first list; the page groups it by ticker itself.
  const current = storage.read(INDEX_BLOB.name, INDEX_BLOB.file);
  const entries = Array.isArray(current?.entries) ? current.entries : [];
  const next = [
    { ticker, period, title, verdict, priceReaction, generatedAt, hasPdf: Boolean(pdf) },
    ...entries.filter(entry => !(entry.ticker === ticker && entry.period === period)),
  ].sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  storage.write(INDEX_BLOB.name, INDEX_BLOB.file, { entries: next });

  await storage.flush();
  await storage.close();
  console.log(`[publish] ✓ ${ticker} ${period} published${pdf ? ` (+${Math.round(pdf.length / 1024)} KB PDF)` : ''} — ${next.length} reviews in the index`);
}

main().catch(error => {
  console.error(`[publish] ${error.message}`);
  process.exit(1);
});
