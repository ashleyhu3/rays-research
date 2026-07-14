/**
 * Scrape the front expiration for a few tickers and dump the structured report
 * payload (the Alerts-shaped JSON, embedded SVGs and all) to a file.
 *
 * The export script needs charts whose bars are the whole expiration's volume.
 * The stored daily report predates that change — its bars are the summed volume
 * of each day's top three contracts, and the SVGs are baked in, so the only way
 * to get honest bars is to regenerate them. That means fetching 45 days of daily
 * volume for every contract in the chain, which is slow the first time and cheap
 * afterwards (the totals persist in the prior-chain cache).
 *
 * Usage: node --env-file=.env server/scripts/fetchOptionsChartPayload.js <out.json> [TICKER...]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../storage');
const {
  PRIOR_BLOB, buildStructuredReport, generateDailyOptionsReport, today,
} = require('./generateDailyOptionsReport');

const OUT = path.resolve(process.argv[2] ?? path.join(__dirname, '..', 'data', 'optionsChartPayload.json'));
const TICKERS = process.argv.slice(3).length ? process.argv.slice(3) : ['TSM', 'SOXX', 'ASML'];

async function main() {
  await storage.init([PRIOR_BLOB]);

  const { report } = await generateDailyOptionsReport({
    date: today(),
    tickers: TICKERS,
    maxExpirations: 1,
    // The HTML render is a by-product here; only the structured payload is kept.
    out: path.join(os.tmpdir(), `options-${Date.now()}.html`),
  });

  const structured = buildStructuredReport(report);
  fs.writeFileSync(OUT, JSON.stringify(structured, null, 2));
  await storage.close();

  for (const t of structured.tickers) {
    const exp = t.expirations[0];
    console.log(`[options-payload] ${t.ticker} — ${exp?.expiryLabel ?? 'no expiration'}`);
  }
  console.log(`[options-payload] wrote ${OUT}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[options-payload] failed:', e); process.exit(1); });
