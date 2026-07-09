'use strict';

const storage = require('../storage');
const {
  BLOB,
  generateAndStoreDailyOptionsPdf,
} = require('../optionsReportStore');

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
  await storage.init([BLOB]);
  const result = await generateAndStoreDailyOptionsPdf(parseArgs(process.argv));
  await storage.flush();
  console.log(JSON.stringify({
    date: result.date,
    tickers: result.tickers,
    size: result.size,
    updatedAt: result.updatedAt,
    outPath: result.outPath,
  }, null, 2));
}

main()
  .catch(error => {
    console.error('[options-report:generate]', error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());
