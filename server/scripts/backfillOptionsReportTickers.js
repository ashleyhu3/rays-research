'use strict';

/**
 * One-off backfill: add extra tickers to a day's already-stored daily options
 * report (the payload the Alerts page reads from Mongo), without touching the
 * recurring daily scraper's ticker list.
 *
 * Two stages, matching how expensive each half of a ticker's charts is:
 *   • Stage 1 (default) — bars + tables only. Scrapes the current option chain
 *     from Massive and backfills its ~10-session history, then merges the ticker
 *     into the stored report. No Alpha Vantage, no prior-cycle scrape. This is
 *     what puts a new ticker on the website.
 *   • Stage 2 (--stage 2) — the prior-quarter / prior-year comparison LINES.
 *     Needs the ticker's earnings dates to align the cycles; those are read from
 *     the earningsDates Mongo blob when already cached, and otherwise seeded by
 *     the companion `seedEarningsDatesFromWeb.js` script (web scrape) so the
 *     25/day Alpha Vantage cap is never spent here. Re-runs the full generation
 *     (priors included) and re-merges.
 *
 * The merge is read-modify-write on the dailyOptionsReport blob and runs once
 * per ticker, so a long run persists incrementally and can be resumed. Already
 * present tickers are skipped unless --force.
 *
 * Usage:
 *   node --env-file=.env server/scripts/backfillOptionsReportTickers.js [options]
 *
 * Options:
 *   --tickers A,B,C   Comma list to process (default: the built-in EXTRA list).
 *   --date YYYY-MM-DD Report date to edit (default: the latest stored report).
 *   --stage 1|2       1 = bars + tables (default), 2 = add prior-cycle lines.
 *   --limit N         Process at most N of the still-missing tickers this run.
 *   --force           Re-generate even tickers already in the report.
 *   --dry-run         Generate and summarise, but do not write to Mongo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../storage');
const { BLOB } = require('../optionsReportStore');
const {
  PRIOR_BLOB,
  generateDailyOptionsReport,
  buildStructuredReport,
} = require('./generateDailyOptionsReport');
const { BLOB: EARNINGS_BLOB } = require('../earningsDates');

// The tickers this backfill was written for. Overridable with --tickers.
// (2026-08 batch — the 2026-07 batch above it is already merged into
// DEFAULT_TICKERS in generateDailyOptionsReport.js, so Stage 1 skips it.)
const EXTRA_TICKERS = [
  'AAPL', 'AMD', 'SWKS', 'QCOM', 'NVDA', 'MRVL', 'AVGO', 'TSEM', 'GFS', 'WDC',
  'SNDK', 'MU', 'ONTO', 'AMAT', 'KEYS', 'VIAV', 'CAMT', 'NVMI', 'ALGM', 'MCHP',
  'MPWR', 'POWI', 'ON', 'ADI', 'IFNNY', 'VRT', 'TTMI', 'FN', 'LITE', 'COHR',
  'MTSI', 'ALAB', 'CSCO', 'ANET', 'CRDO', 'AXTI', 'CIEN', 'ASX', 'SMCI', 'DELL',
  'HPQ', 'HPE', 'JBL', 'SNPS', 'ARW', 'AVT', 'ORCL', 'PLTR', 'AMZN', 'NFLX',
  'APP', 'T', 'VZ', 'TMUS', 'ERIC', 'CALX',
];

function parseArgs(argv) {
  const args = { stage: 1, force: false, dryRun: false, limit: null, date: null, tickers: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1].split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      i += 1;
    } else if (arg === '--date' && argv[i + 1]) {
      args.date = argv[i + 1];
      i += 1;
    } else if (arg === '--stage' && argv[i + 1]) {
      args.stage = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--limit' && argv[i + 1]) {
      args.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

// Whether a chart SVG already carries a prior-cycle line (a stroked <path>). The
// bars are <rect>s, so this distinguishes a Stage-2 chart from a Stage-1 one.
function hasPriorLines(svg) {
  return /<path[^>]*\bstroke=/.test(svg || '');
}

// Replace or append one ticker's structured entry in a stored day payload. The
// Alerts page re-sorts by volume, so insertion order does not matter.
function upsertTicker(payload, entry) {
  const index = payload.tickers.findIndex(t => t.ticker === entry.ticker);
  if (index === -1) payload.tickers.push(entry);
  else payload.tickers[index] = entry;
}

async function main() {
  const args = parseArgs(process.argv);
  await storage.init([BLOB, PRIOR_BLOB, EARNINGS_BLOB]);

  const blob = storage.read(BLOB.name, BLOB.file);
  const date = args.date || blob.latest?.date;
  if (!date) throw new Error('No stored report found and no --date given');

  const payload = blob.byDate?.[date] || (blob.latest?.date === date ? blob.latest : null);
  if (!payload) throw new Error(`No stored report for ${date} (available: ${Object.keys(blob.byDate || {}).sort().join(', ')})`);

  const present = new Set((payload.tickers || []).map(t => t.ticker));
  const requested = args.tickers || EXTRA_TICKERS;

  // Stage 1 skips tickers already on the report; Stage 2 targets tickers that
  // are present but whose charts still have no prior-cycle line.
  const byTicker = new Map((payload.tickers || []).map(t => [t.ticker, t]));
  let targets = requested.filter(t => {
    if (args.force) return true;
    if (args.stage === 1) return !present.has(t);
    const entry = byTicker.get(t);
    if (!entry) return false; // Stage 2 only augments tickers Stage 1 already added
    return !(entry.expirations || []).some(e => hasPriorLines(e.callChartSvg) || hasPriorLines(e.putChartSvg));
  });
  if (args.limit) targets = targets.slice(0, args.limit);

  const skipPriors = args.stage === 1;
  console.log(`[backfill] date=${date} stage=${args.stage} skipPriors=${skipPriors} dryRun=${args.dryRun}`);
  console.log(`[backfill] ${payload.tickers.length} tickers already stored; ${targets.length} to process: ${targets.join(', ') || '(none)'}`);

  const outDir = path.join(os.tmpdir(), 'rays-options-backfill');
  fs.mkdirSync(outDir, { recursive: true });

  let done = 0;
  for (const ticker of targets) {
    const started = Date.now();
    console.log(`[backfill] ${ticker} (stage ${args.stage})…`);
    let gen;
    try {
      gen = await generateDailyOptionsReport({
        date,
        tickers: [ticker],
        out: path.join(outDir, `${ticker}-${date}.html`),
        format: 'html',
        skipPriors,
      });
    } catch (e) {
      console.error(`[backfill] ${ticker} FAILED: ${e.message}`);
      continue;
    }

    const structured = buildStructuredReport(gen.report, {
      generatedAt: new Date().toISOString(),
      timeZone: payload.timeZone || null,
    });
    const entry = structured.tickers[0];
    if (!entry) {
      console.warn(`[backfill] ${ticker} produced no ticker data — skipping`);
      continue;
    }

    const exp0 = entry.expirations[0];
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      `[backfill] ${ticker} price=${entry.priceText} exps=${entry.expirations.length} `
      + `bars/side=${(exp0?.tableCalls?.length ?? 0) >= 0 ? 'yes' : 'no'} `
      + `priorLines=${exp0 ? hasPriorLines(exp0.callChartSvg) : false} (${secs}s)`,
    );

    if (args.dryRun) continue;

    // Re-read the blob so incremental progress from earlier tickers is preserved,
    // then update both the per-date archive and `latest` when they are this date.
    const cur = storage.read(BLOB.name, BLOB.file);
    if (cur.byDate?.[date]) upsertTicker(cur.byDate[date], entry);
    if (cur.latest?.date === date) upsertTicker(cur.latest, entry);
    cur.updatedAt = new Date().toISOString();
    storage.write(BLOB.name, BLOB.file, cur);
    await storage.flush();
    done += 1;
    console.log(`[backfill] merged ${ticker} into ${date} (${done}/${targets.length})`);
  }

  await storage.flush();
  console.log(`[backfill] complete — ${done} ticker(s) written to ${date}`);
}

main()
  .catch(error => {
    console.error('[backfill]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());
