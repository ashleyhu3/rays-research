'use strict';

const storage = require('../storage');
const {
  BLOB,
  generateAndStoreDailyOptions,
} = require('../optionsReportStore');
const { PRIOR_BLOB } = require('../scripts/generateDailyOptionsReport');
const { BLOB: EARNINGS_BLOB } = require('../earningsDates');

// Every blob the report touches has to be preloaded, not just the one it writes. An
// unlisted blob falls back to the local JSON file on read — which in a fresh CI
// checkout does not exist — so the run would rebuild both caches from empty every
// time: re-scraping every full current/prior chain from Massive, and spending 16
// Alpha Vantage calls a day against a 25/day key. The equivalent list for the
// in-process (Render) path is STORAGE_BLOBS in server.js; keep the two in step.
const BLOBS = [BLOB, PRIOR_BLOB, EARNINGS_BLOB];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date' && argv[i + 1]) {
      args.date = argv[i + 1];
      i += 1;
    } else if (arg === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1];
      i += 1;
    } else if (arg === '--out-dir' && argv[i + 1]) {
      args.outDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  await storage.init(BLOBS);
  const result = await generateAndStoreDailyOptions(parseArgs(process.argv));
  await storage.flush();
  console.log(JSON.stringify({
    date: result.date,
    tickers: result.tickers,
    charts: result.charts,
    generatedAt: result.generatedAt,
  }, null, 2));
}

main()
  .catch(error => {
    console.error('[options-report:generate]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());
