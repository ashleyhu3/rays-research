'use strict';

const path = require('path');
const storage = require('../storage');
const { getSpxPutCallRatio } = require('../scrapers/spxPutCallRatio');

async function main() {
  const file = path.join(__dirname, '..', 'data', 'spxPutCallRatioHistory.json');
  try {
    await storage.init([{ name: 'spxPutCallRatioHistory', file }]);
    const result = await getSpxPutCallRatio();
    await storage.flush();
    console.log(`[spx-put-call-backfill] stored ${result.dates.length} daily observations `
      + `(${result.dates[0]} through ${result.dates.at(-1)})`);
  } finally {
    await storage.close();
  }
}

main().catch(error => {
  console.error('[spx-put-call-backfill] failed:', error);
  process.exitCode = 1;
});
