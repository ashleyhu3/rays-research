/**
 * Seed the announced-buyback history for the US, China A-share, and Taiwan.
 *
 * China and Taiwan come back whole in a handful of requests, so both are
 * rebuilt from their full upstream tables every run. The US series is the
 * expensive one: every 8-K that mentions a repurchase program has to be fetched
 * and parsed, so it is walked one month at a time (~300 filings per month) and
 * checkpointed to storage after each month. Re-running resumes — months already
 * present are skipped unless --force is passed.
 *
 * Usage: npm run backfill:buybacks -- [months] [--force]   (default 60 ≈ 5y)
 */
const path = require('path');
const storage = require('../storage');
const { _test, readBuybacks } = require('../scrapers/buybacks');

const {
  fetchUsMonth, fetchChinaPlans, fetchTaiwanBoard,
  aggregateChina, aggregateTaiwan, mergeMonths, loadHistory, BLOB, HISTORY_FILE,
} = _test;

const MONTHS = Number(process.argv.find(a => /^\d+$/.test(a))) || 60;
const FORCE = process.argv.includes('--force');
const BLOBS = [{ name: BLOB, file: HISTORY_FILE }];

function monthsAgo(count) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 7);
}

async function main() {
  await storage.init(BLOBS);
  console.log(`[buybacks] storage mode: ${storage.status().mode} — backfilling ${MONTHS} months…`);

  const history = loadHistory();

  // ── China: one paginated walk over every announced plan ──
  try {
    const since = monthsAgo(MONTHS - 1);
    const rows = await fetchChinaPlans(since);
    const months = aggregateChina(rows, since);
    mergeMonths(history, 'cn', months);
    storage.write(BLOB, HISTORY_FILE, history);
    console.log(`[buybacks] cn: ${rows.length} plans → ${Object.keys(months).length} months`);
  } catch (error) {
    console.warn('[buybacks] cn failed:', error.message);
  }

  // ── Taiwan: the MOPS summary table is served whole, both boards ──
  try {
    const rows = (await Promise.all(['sii', 'otc'].map(fetchTaiwanBoard))).flat();
    const months = aggregateTaiwan(rows);
    mergeMonths(history, 'tw', months);
    storage.write(BLOB, HISTORY_FILE, history);
    console.log(`[buybacks] tw: ${rows.length} filings → ${Object.keys(months).length} months`);
  } catch (error) {
    console.warn('[buybacks] tw failed:', error.message);
  }

  // ── US: month by month, checkpointed, resumable ──
  const targets = [];
  for (let back = MONTHS - 1; back >= 0; back -= 1) targets.push(monthsAgo(back));
  for (const month of targets) {
    if (!FORCE && history.us?.[month]) {
      console.log(`[buybacks] us ${month}: already stored, skipping`);
      continue;
    }
    try {
      const result = await fetchUsMonth(month);
      mergeMonths(history, 'us', { [month]: result });
      storage.write(BLOB, HISTORY_FILE, history);
      await storage.flush();
      console.log(`[buybacks] us ${month}: $${(result.amount / 1e9).toFixed(1)}bn `
        + `from ${result.count} companies (+${result.sharesOnly} share-count-only)`);
    } catch (error) {
      console.warn(`[buybacks] us ${month} failed:`, error.message);
    }
  }

  await storage.flush();

  const data = readBuybacks();
  for (const market of ['us', 'cn', 'tw']) {
    const series = data[market];
    if (!series?.months?.length) { console.log(`[buybacks] ${market}: no data`); continue; }
    const { months, amount, latest, symbol } = series;
    console.log(`[buybacks] ${market}: ${months.length} months ${months[0]} → ${months[months.length - 1]}`
      + ` · latest ${latest.month} ${symbol}${latest.amount.toFixed(1)}bn`
      + ` from ${latest.count} announcements · TTM ${symbol}${latest.trailing12.toFixed(1)}bn`);
    const peak = amount.indexOf(Math.max(...amount));
    console.log(`[buybacks] ${market}: peak ${months[peak]} ${symbol}${amount[peak].toFixed(1)}bn`);
  }

  await storage.close();
}

main().then(() => process.exit(0)).catch(e => { console.error('[buybacks] failed:', e); process.exit(1); });
