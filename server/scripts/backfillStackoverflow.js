/**
 * One-time backfill of Stack Overflow tag-activity history.
 *
 * The live `stackoverflow` scraper records, once per day, each tag's all-time
 * question count (`{tag}.questions`) and the number of new questions in the
 * trailing 7 days (`{tag}.newThisWeek`). That only starts a trend the day the
 * server first runs. The Stack Exchange API accepts `fromdate`/`todate`, so we
 * can reconstruct ~2 years: cumulative questions on or before each monthly
 * anchor, plus new questions in the week ending at that anchor.
 *
 * Points are written into server/data/metricsHistory.json under the same
 * `stackoverflow` source and metric keys the scheduler appends to, so live
 * snapshots continue seamlessly. Existing dates are never overwritten.
 *
 * No API key required, but the anonymous quota is ~300 requests/day — this run
 * makes ~240, paced to respect the API's backoff signals.
 *
 * Usage: node server/scripts/backfillStackoverflow.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Must match TAGS in server/scrapers/stackoverflow.js so keys align.
const TAGS = ['openai-api', 'claude', 'google-gemini', 'langchain', 'mistral-ai'];

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'metricsHistory.json');
const MONTHS = 24;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);
const epoch = isoDate => Math.floor(new Date(isoDate + 'T00:00:00Z').getTime() / 1000);

function monthlyAnchors(months) {
  const out = [];
  const now = new Date();
  for (let i = months; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 28));
    out.push(iso(d));
  }
  return out;
}

// Count questions for a tag in [fromdate, todate]; omit fromdate for cumulative.
async function countQuestions(tag, todate, fromdate, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const params = { tagged: tag, site: 'stackoverflow', todate, pagesize: 1, filter: 'total' };
      if (fromdate) params.fromdate = fromdate;
      const { data } = await axios.get('https://api.stackexchange.com/2.3/questions', { params, timeout: 25000 });
      if (data.backoff) await sleep((data.backoff + 1) * 1000);
      return data.total ?? 0;
    } catch (e) {
      const wait = e.response?.status === 429 ? 20000 : 4000 * i;
      if (i === tries) throw e;
      await sleep(wait);
    }
  }
}

async function main() {
  const anchors = monthlyAnchors(MONTHS);
  console.log(`Backfilling Stack Overflow activity for ${TAGS.length} tags × ${anchors.length} months…`);

  let store = {};
  try { store = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  if (!store.stackoverflow) store.stackoverflow = {};
  const so = store.stackoverflow;

  let added = 0, skipped = 0, failed = 0;
  for (const tag of TAGS) {
    const qKey = `${tag}.questions`;
    const wKey = `${tag}.newThisWeek`;
    if (!so[qKey]) so[qKey] = {};
    if (!so[wKey]) so[wKey] = {};
    for (const anchor of anchors) {
      const to = epoch(anchor);
      // cumulative all-time count up to the anchor
      if (so[qKey][anchor] == null) {
        try { so[qKey][anchor] = await countQuestions(tag, to); added++; }
        catch (e) { console.warn(`✗ ${qKey} @ ${anchor}: ${e.message}`); failed++; }
        await sleep(1400);
      } else skipped++;
      // new questions in the week ending at the anchor
      if (so[wKey][anchor] == null) {
        try { so[wKey][anchor] = await countQuestions(tag, to, to - 7 * 86400); added++; }
        catch (e) { console.warn(`✗ ${wKey} @ ${anchor}: ${e.message}`); failed++; }
        await sleep(1400);
      } else skipped++;
    }
    console.log(`✓ ${tag}: cumulative ${so[qKey][anchors.at(-1)]} by ${anchors.at(-1)}`);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(store)); // persist per-tag
  }

  console.log(`\nDone. ${added} added, ${skipped} already present, ${failed} failed.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
