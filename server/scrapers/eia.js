'use strict';

// Free API key (higher rate limits) at: https://www.eia.gov/opendata/register.php
// DEMO_KEY allows ~30 req/day — sufficient for daily scheduling.
const EIA_KEY = process.env.EIA_API_KEY || 'DEMO_KEY';

async function get(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`EIA HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`EIA: ${JSON.stringify(json.error)}`);
  return json;
}

/**
 * Fetches annual residential retail electricity rates (¢/kWh) for all US states/territories.
 * One API call returns ~370 rows (6 years × 62 entries). Computes a simple US average per year.
 *
 * Returns:
 *   { rates: { VA: { '2024': 14.41, '2023': 14.26, ... }, TX: {...}, US: {...} } }
 */
async function getEiaRates() {
  const url =
    `https://api.eia.gov/v2/electricity/retail-sales/data/` +
    `?api_key=${EIA_KEY}` +
    `&frequency=annual&data[0]=price` +
    `&facets[sectorid][]=RES` +
    `&start=2018` +
    `&sort[0][column]=period&sort[0][direction]=desc` +
    `&length=600`;

  const json = await get(url);
  const rows = json?.response?.data ?? [];

  const byState = {};
  const yearSums = {};

  rows.forEach(({ stateid, period, price }) => {
    const p = parseFloat(price);
    if (!stateid || isNaN(p) || p <= 0) return;
    if (!byState[stateid]) byState[stateid] = {};
    byState[stateid][period] = p;
    if (!yearSums[period]) yearSums[period] = { sum: 0, n: 0 };
    yearSums[period].sum += p;
    yearSums[period].n++;
  });

  // Simple average across all returned entries (50 states + DC + territories)
  byState.US = {};
  Object.entries(yearSums).forEach(([yr, { sum, n }]) => {
    byState.US[yr] = parseFloat((sum / n).toFixed(2));
  });

  return { rates: byState };
}

module.exports = { getEiaRates };
