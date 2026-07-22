'use strict';
const path = require('path');
const storage = require('../storage');
const { updateCarryTrade } = require('../scrapers/carryTrade');

async function main() {
  await storage.init([{
    name: 'carryTradeHistory',
    file: path.join(__dirname, '..', 'data', 'carryTradeHistory.json'),
  }]);
  if (process.env.MONGODB_URI && storage.status().mode !== 'mongo') {
    throw new Error('MongoDB was configured but unavailable; refusing to write to a local fallback');
  }
  const data = await updateCarryTrade();
  await storage.flush();
  await storage.close();
  for (const [key, series] of Object.entries(data.series)) {
    console.log(`[carry-trade] ${key}: ${series.data.length} points, ${series.data[0]?.date ?? '—'} → ${series.data.at(-1)?.date ?? '—'}`);
  }
}

main().then(() => process.exit(0)).catch(error => { console.error('[carry-trade] failed:', error); process.exit(1); });
