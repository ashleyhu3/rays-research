'use strict';
/**
 * One-shot refresh of the US liquidity blob. The scheduled collector runs the
 * same update daily; this exists to populate a newly added series (e.g. the
 * HYG / MSCI World / S&P 500 closes the Credit view compares) without waiting
 * for the next scheduled run. Both FRED and Yahoo return their full history
 * per call, so a single run is a complete backfill.
 */
const path = require('path');
const storage = require('../storage');
const { updateUsLiquidity } = require('../scrapers/usLiquidity');

async function main() {
  await storage.init([{
    name: 'usLiquidityHistory',
    file: path.join(__dirname, '..', 'data', 'usLiquidityHistory.json'),
  }]);
  if (process.env.MONGODB_URI && storage.status().mode !== 'mongo') {
    throw new Error('MongoDB was configured but unavailable; refusing to write to a local fallback');
  }
  const data = await updateUsLiquidity();
  await storage.flush();
  await storage.close();
  for (const [key, series] of Object.entries(data.series)) {
    console.log(`[us-liquidity] ${key}: ${series.data.length} points, ${series.data[0]?.date ?? '—'} → ${series.data.at(-1)?.date ?? '—'}`);
  }
  const errors = Object.entries(data.errors ?? {});
  if (errors.length) for (const [key, message] of errors) console.warn(`[us-liquidity] ${key} failed: ${message}`);
}

main().then(() => process.exit(0)).catch(error => { console.error('[us-liquidity] failed:', error); process.exit(1); });
