'use strict';

/**
 * Backfill the latest four available earnings-call transcripts for Alphabet
 * and Microsoft through the normalized transcript pipeline.
 *
 * Usage:
 *   node --env-file=.env server/scripts/backfillAlphaVantageTranscripts.js
 *   node --env-file=.env server/scripts/backfillAlphaVantageTranscripts.js --force
 */

const { collectFromAlphaVantage } = require('../transcripts/alphavantage');
const { readLocalLibrary, saveTranscript } = require('../transcripts/store');

const TARGETS = [
  {
    ticker: 'GOOGL',
    periods: ['2026Q1', '2025Q4', '2025Q3', '2025Q2'],
  },
  {
    ticker: 'MSFT',
    periods: ['2026Q3', '2026Q2', '2026Q1', '2025Q4'],
  },
];

const FORCE = process.argv.includes('--force');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function splitPeriod(fiscalPeriod) {
  return {
    year: Number(fiscalPeriod.slice(0, 4)),
    quarter: fiscalPeriod.slice(4),
  };
}

async function main() {
  const existing = new Set(
    readLocalLibrary()
      .filter(item => item.metadata?.provider === 'alphavantage')
      .map(item => `${item.ticker}:${item.fiscal_period}`),
  );
  let savedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const target of TARGETS) {
    for (const fiscalPeriod of target.periods) {
      const key = `${target.ticker}:${fiscalPeriod}`;
      if (!FORCE && existing.has(key)) {
        console.log(`[alpha-vantage] skip ${key} (already stored)`);
        skippedCount += 1;
        continue;
      }

      try {
        console.log(`[alpha-vantage] fetch ${key}`);
        const transcript = await collectFromAlphaVantage({
          ticker: target.ticker,
          ...splitPeriod(fiscalPeriod),
        });
        const storage = await saveTranscript(transcript);
        console.log(
          `[alpha-vantage] saved ${key}: ${transcript.stats.totalBlocks} blocks, `
          + `${transcript.stats.wordCount} words, mongo=${storage.mongoStored}`,
        );
        savedCount += 1;
      } catch (error) {
        console.error(`[alpha-vantage] failed ${key}: ${error.message}`);
        failedCount += 1;
        if (error.status === 429) break;
      }

      await wait(350);
    }
  }

  console.log(
    `[alpha-vantage] complete: ${savedCount} saved, ${skippedCount} skipped, ${failedCount} failed`,
  );
  if (failedCount) process.exitCode = 1;
}

main().catch(error => {
  console.error('[alpha-vantage] fatal:', error.message);
  process.exit(1);
});
