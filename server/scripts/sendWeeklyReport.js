'use strict';

// Email + PDF wrapper for the AI weekly report. Generates the Markdown report
// (with its SVG chart assets), turns it into an inline-image HTML email, renders
// a PDF via headless Chrome when available, and sends it through the configured
// mailer. Mirrors sendDailyOptionsReport.js.
//
//   node server/scripts/sendWeeklyReport.js --to you@example.com
//   node server/scripts/sendWeeklyReport.js --dry-run          # build only, no send
//   node server/scripts/sendWeeklyReport.js --snapshot --dry-run

const fs = require('fs');
const path = require('path');
const mailer = require('../mailer');
const { generateWeeklyReport, today } = require('./generateWeeklyReport');

let renderPdf = null;
try { ({ renderPdf } = require('./renderPdf')); } catch { /* optional */ }

const DEFAULT_TIME_ZONE = process.env.WEEKLY_REPORT_TIMEZONE || 'Asia/Hong_Kong';

function parseArgs(argv) {
  const args = {
    date: process.env.WEEKLY_REPORT_DATE || null,
    to: process.env.WEEKLY_REPORT_TO || process.env.SMTP_USER || null,
    outDir: process.env.WEEKLY_REPORT_OUT_DIR || process.cwd(),
    baseUrl: process.env.WEEKLY_REPORT_BASE_URL || undefined,
    snapshot: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date' && argv[i + 1]) { args.date = argv[i + 1]; i += 1; }
    else if (arg === '--to' && argv[i + 1]) { args.to = argv[i + 1]; i += 1; }
    else if (arg === '--out-dir' && argv[i + 1]) { args.outDir = argv[i + 1]; i += 1; }
    else if (arg === '--base-url' && argv[i + 1]) { args.baseUrl = argv[i + 1]; i += 1; }
    else if (arg === '--snapshot') { args.snapshot = true; }
    else if (arg === '--dry-run') { args.dryRun = true; }
  }
  return args;
}

function dateInTimeZone(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function cssCid(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function markdownText(markdown) {
  return markdown
    .replace(/^!\[([^\]]*)\]\([^)]+\)$/gm, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Render an inline table row (the report's Markdown pipe tables) as an HTML row.
function renderMdTableRow(cells, isHeader) {
  const tag = isHeader ? 'th' : 'td';
  const tds = cells.map(c => `<${tag}>${escapeHtml(c.replace(/\\\|/g, '|'))}</${tag}>`).join('');
  return `<tr>${tds}</tr>`;
}

// Convert the report Markdown into an email: headings, tables and paragraphs
// become HTML; each chart image becomes an inline (cid) SVG attachment.
function buildEmailFromMarkdown(markdown, markdownPath) {
  const baseDir = path.dirname(markdownPath);
  const attachments = [];
  const body = [];
  let tableRows = [];

  const flushTable = () => {
    if (!tableRows.length) return;
    const [head, , ...rest] = tableRows; // row[1] is the |---| separator
    const rows = [renderMdTableRow(head, true), ...rest.map(r => renderMdTableRow(r, false))];
    body.push(`<table class="tbl">${rows.join('')}</table>`);
    tableRows = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { flushTable(); continue; }

    if (/^\|(.+)\|$/.test(line)) {
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) { tableRows.push(cells); continue; }
      tableRows.push(cells);
      continue;
    }
    flushTable();

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const alt = image[1];
      const assetPath = path.resolve(baseDir, image[2]);
      if (!fs.existsSync(assetPath)) {
        body.push(`<p class="missing">Missing chart asset: ${escapeHtml(image[2])}</p>`);
        continue;
      }
      const cid = cssCid(`${String(attachments.length + 1).padStart(2, '0')}-${path.basename(assetPath)}`);
      attachments.push({
        filename: path.basename(assetPath),
        path: assetPath,
        cid,
        contentType: 'image/svg+xml',
        contentDisposition: 'inline',
      });
      body.push(`<figure class="chart"><img src="cid:${cid}" alt="${escapeHtml(alt)}"></figure>`);
      continue;
    }

    if (line.startsWith('# ')) body.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    else if (line.startsWith('## ')) body.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line.startsWith('### ')) body.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    else body.push(`<p>${escapeHtml(line.replace(/^_(.*)_$/, '$1').replace(/\*\*/g, ''))}</p>`);
  }
  flushTable();

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin:0; padding:0; background:#f3f4f6; color:#111827; font-family:Arial, Helvetica, sans-serif; }
  .wrap { max-width:980px; margin:0 auto; padding:20px 14px 36px; background:#fff; }
  h1 { margin:0 0 16px; padding-bottom:12px; border-bottom:2px solid #111827; font-size:24px; }
  h2 { margin:28px 0 8px; font-size:18px; letter-spacing:.04em; text-transform:uppercase; }
  h3 { margin:18px 0 6px; color:#4b5563; font-size:14px; }
  p { margin:0 0 12px; color:#4b5563; font-size:13px; line-height:1.5; }
  .chart { margin:6px 0 18px; padding:0; }
  .chart img { display:block; width:100%; max-width:920px; height:auto; border:1px solid #e5e7eb; border-radius:8px; }
  table.tbl { width:100%; border-collapse:collapse; font-size:13px; margin:6px 0 16px; }
  table.tbl th, table.tbl td { border-bottom:1px solid #e5e7eb; padding:8px 10px; text-align:left; }
  table.tbl th { background:#f9fafb; font-size:11px; text-transform:uppercase; color:#6b7280; }
  .missing { color:#b91c1c; }
</style></head>
<body><div class="wrap">${body.join('\n')}</div></body></html>`;

  return { html, text: markdownText(markdown), attachments };
}

async function tryBuildPdf(outDir, date, baseUrl, snapshot) {
  if (!renderPdf) return null;
  try {
    const htmlPath = path.join(outDir, `ai-weekly-report-${date}.html`);
    const pdfPath = path.join(outDir, `ai-weekly-report-${date}.pdf`);
    await generateWeeklyReport({ date, out: htmlPath, format: 'html', baseUrl, snapshot });
    await renderPdf({ htmlPath, pdfPath });
    return pdfPath;
  } catch (error) {
    console.warn(`[weekly-report] PDF skipped: ${error.message}`);
    return null;
  }
}

async function sendWeeklyReport(options = {}) {
  const args = { ...parseArgs(process.argv), ...options };
  const date = args.date || dateInTimeZone(new Date());
  const outDir = path.resolve(args.outDir);
  const to = args.to;

  if (!to && !args.dryRun) throw new Error('WEEKLY_REPORT_TO or SMTP_USER is required.');

  fs.mkdirSync(outDir, { recursive: true });
  const mdPath = path.join(outDir, `ai-weekly-report-${date}.md`);
  const generated = await generateWeeklyReport({
    date, out: mdPath, format: 'md', baseUrl: args.baseUrl, snapshot: args.snapshot,
  });

  const email = buildEmailFromMarkdown(generated.content, generated.outPath);
  const pdfPath = await tryBuildPdf(outDir, date, args.baseUrl, args.snapshot);
  const attachments = [...email.attachments];
  if (pdfPath) {
    attachments.push({ filename: path.basename(pdfPath), path: pdfPath, contentType: 'application/pdf' });
  }
  const subject = `AI Weekly Report ${date}`;

  if (args.dryRun) {
    return { sent: false, dryRun: true, date, outPath: generated.outPath, pdfPath, charts: email.attachments.length };
  }

  const verification = await mailer.verify({ force: true });
  if (!verification.verified) {
    throw new Error(`${verification.provider} verification failed: ${verification.error}`);
  }
  const delivery = await mailer.sendMail({
    to, subject, text: email.text, html: email.html, attachments,
  });

  return { sent: true, date, to, pdfPath, charts: email.attachments.length, messageId: delivery?.messageId ?? null };
}

async function main() {
  const result = await sendWeeklyReport();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { sendWeeklyReport, buildEmailFromMarkdown, today };
