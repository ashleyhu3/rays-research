'use strict';

const storage = require('../storage');
const {
  BLOB,
  generateAndStoreDailyOptions,
  readDailyReport,
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

  // storage.init() silently falls back to local-file mode on *any* Mongo problem
  // — a missing MONGODB_URI, a bad connection string, or (the classic one) the
  // runner's IP not being allowlisted in MongoDB Atlas — so that the web app can
  // still boot and serve last-known data. For this job that fallback is a trap:
  // it would generate the report, write it to the CI runner's ephemeral disk,
  // flush nothing to the shared database, and still exit 0. That is a green daily
  // run that persisted nothing — exactly why the stored report kept going stale
  // until someone hit "Refresh" on the live server. So when this job is meant to
  // persist (it's running in CI, or a MONGODB_URI was provided), refuse to
  // continue in file mode and fail loudly instead of reporting a false success.
  const mode = storage.status().mode;
  const mustPersist = process.env.GITHUB_ACTIONS === 'true' || !!process.env.MONGODB_URI;
  if (mustPersist && mode !== 'mongo') {
    throw new Error(
      `storage is in "${mode}" mode, not "mongo": the database is unreachable, so the daily `
      + 'report would be written to ephemeral disk and lost. Check that the MONGODB_URI secret '
      + 'is set and that the runner IP is allowlisted in MongoDB Atlas → Network Access '
      + '(GitHub-hosted runners have dynamic IPs, so this needs 0.0.0.0/0). Refusing to report '
      + 'a false success.',
    );
  }
  console.log(`[options-report:generate] storage mode: ${mode}`);

  const result = await generateAndStoreDailyOptions(parseArgs(process.argv));
  await storage.flush();

  // A last guard against a silent no-op: the report we just wrote must actually
  // be readable back from storage for today's date.
  const persisted = readDailyReport(result.date);
  if (mustPersist && persisted?.date !== result.date) {
    throw new Error(`daily report for ${result.date} did not persist to ${mode} storage`);
  }

  console.log(JSON.stringify({
    date: result.date,
    tickers: result.tickers,
    charts: result.charts,
    generatedAt: result.generatedAt,
    storageMode: mode,
  }, null, 2));
}

main()
  .catch(error => {
    console.error('[options-report:generate]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());
