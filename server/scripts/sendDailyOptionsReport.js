'use strict';

const fs = require('fs');
const path = require('path');
const mailer = require('../mailer');
const {
  DEFAULT_TICKERS,
  generateDailyOptionsReport,
} = require('./generateDailyOptionsReport');

const DEFAULT_TIME_ZONE = 'Asia/Hong_Kong';

function parseArgs(argv) {
  const args = {
    date: process.env.OPTIONS_REPORT_DATE || null,
    tickers: process.env.OPTIONS_REPORT_TICKERS || null,
    to: process.env.OPTIONS_REPORT_TO || process.env.SMTP_USER || null,
    outDir: process.env.OPTIONS_REPORT_OUT_DIR || process.cwd(),
    timeZone: process.env.OPTIONS_REPORT_TIMEZONE || DEFAULT_TIME_ZONE,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date' && argv[i + 1]) {
      args.date = argv[i + 1];
      i += 1;
    } else if (arg === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1];
      i += 1;
    } else if (arg === '--to' && argv[i + 1]) {
      args.to = argv[i + 1];
      i += 1;
    } else if (arg === '--out-dir' && argv[i + 1]) {
      args.outDir = argv[i + 1];
      i += 1;
    } else if (arg === '--timezone' && argv[i + 1]) {
      args.timeZone = argv[i + 1];
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }

  return args;
}

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
  if (Array.isArray(value)) return value;
  if (!value) return DEFAULT_TICKERS;
  return String(value)
    .split(',')
    .map(ticker => ticker.trim().toUpperCase())
    .filter(Boolean);
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
  return String(value)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function markdownText(markdown) {
  return markdown
    .replace(/^!\[([^\]]*)\]\([^)]+\)$/gm, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildEmailFromMarkdown(markdown, markdownPath) {
  const baseDir = path.dirname(markdownPath);
  const attachments = [];
  const body = [];

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

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
      body.push(`
        <figure class="chart">
          <img src="cid:${cid}" alt="${escapeHtml(alt)}">
        </figure>
      `);
      continue;
    }

    if (line.startsWith('# ')) {
      body.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      body.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith('### ')) {
      body.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    } else {
      body.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f3f4f6;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
    }
    .wrap {
      max-width: 980px;
      margin: 0 auto;
      padding: 20px 14px 36px;
      background: #ffffff;
    }
    h1 {
      margin: 0 0 18px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 24px;
      line-height: 1.25;
    }
    h2 {
      margin: 28px 0 8px;
      font-size: 20px;
      line-height: 1.3;
    }
    h3 {
      margin: 22px 0 8px;
      color: #4b5563;
      font-size: 14px;
      line-height: 1.4;
    }
    p {
      margin: 0 0 12px;
      color: #4b5563;
      font-size: 13px;
      line-height: 1.5;
    }
    .chart {
      margin: 0 0 14px;
      padding: 0;
    }
    .chart img {
      display: block;
      width: 100%;
      max-width: 900px;
      height: auto;
      border: 1px solid #e5e7eb;
    }
    .missing {
      color: #b91c1c;
    }
  </style>
</head>
<body>
  <div class="wrap">
    ${body.join('\n')}
  </div>
</body>
</html>`;

  return {
    html,
    text: markdownText(markdown),
    attachments,
  };
}

async function sendDailyOptionsReport(options = {}) {
  const args = {
    ...parseArgs(process.argv),
    ...options,
  };
  const date = args.date || dateInTimeZone(new Date(), args.timeZone);
  const tickers = normalizeTickers(args.tickers);
  const outDir = path.resolve(args.outDir);
  const to = args.to;

  if (!to && !args.dryRun) {
    throw new Error('OPTIONS_REPORT_TO or SMTP_USER is required.');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `daily-options-data-${date}.md`);
  const generated = await generateDailyOptionsReport({
    date,
    tickers,
    out: outPath,
    format: 'md',
  });
  const email = buildEmailFromMarkdown(generated.content, generated.outPath);
  const subject = `Daily Options Data ${date} (${tickers.join(', ')})`;

  if (args.dryRun) {
    return {
      sent: false,
      dryRun: true,
      date,
      tickers,
      outPath: generated.outPath,
      charts: email.attachments.length,
    };
  }

  const verification = await mailer.verify({ force: true });
  if (!verification.verified) {
    throw new Error(`${verification.provider} verification failed: ${verification.error}`);
  }

  const delivery = await mailer.sendMail({
    to,
    subject,
    text: email.text,
    html: email.html,
    attachments: email.attachments,
  });

  return {
    ...delivery,
    date,
    tickers,
    outPath: generated.outPath,
    charts: email.attachments.length,
  };
}

async function main() {
  const result = await sendDailyOptionsReport();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error('[options-report:send]', error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_TIME_ZONE,
  buildEmailFromMarkdown,
  dateInTimeZone,
  normalizeTickers,
  sendDailyOptionsReport,
};
