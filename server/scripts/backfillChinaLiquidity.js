'use strict';
const path = require('path');
const storage = require('../storage');
const { updateChinaLiquidity } = require('../scrapers/chinaLiquidity');

const DAYS = Math.max(366, Number(process.argv[2]) || 730);
// One Tushare daily_basic call per trade date, so the whole window is ~240 calls a
// year. Override with a smaller number to fill the free-float series in chunks.
const FREE_FLOAT_DAYS = Number(process.argv[3]) || DAYS;
const BLOBS = [{ name: 'chinaLiquidityHistory', file: path.join(__dirname, '..', 'data', 'chinaLiquidityHistory.json') }];

async function main() {
  await storage.init(BLOBS);
  if (process.env.MONGODB_URI && storage.status().mode !== 'mongo') {
    throw new Error('MongoDB was configured but unavailable; refusing to write the backfill to a local fallback');
  }
  console.log(`[china-liquidity] storage mode: ${storage.status().mode} — backfilling ${DAYS} days…`);
  const data = await updateChinaLiquidity(DAYS, FREE_FLOAT_DAYS);
  await storage.flush();
  await storage.close();
  const series = {
    turnover: data.turnover.data,
    turnoverRate: data.turnoverRate.data,
    m1Yoy: data.m1Yoy.data,
    m2Yoy: data.m2Yoy.data,
    m1M2Spread: data.m1M2Spread.data,
    southboundNetFlow: data.stockConnect.southboundNetFlow.data,
    northboundTurnover: data.stockConnect.northboundTurnover.data,
  };
  for (const [key, points] of Object.entries(series)) {
    console.log(`[china-liquidity] ${key}: ${points.length} points, ${points[0]?.date ?? '—'} → ${points.at(-1)?.date ?? '—'}`);
  }
  if (Object.keys(data.errors).length) console.warn('[china-liquidity] partial refresh:', data.errors);
}

main().then(() => process.exit(0)).catch(error => { console.error('[china-liquidity] failed:', error); process.exit(1); });
