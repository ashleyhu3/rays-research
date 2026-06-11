/**
 * One-time backfill of GPU spot price history from Wayback Machine snapshots
 * of Lambda Labs' retired pricing page (lambdalabs.com/service/gpu-cloud).
 *
 * Archived pages list on-demand per-GPU pricing as table rows like
 * "$2.49 / GPU / hr On-demand 1x NVIDIA H100 SXM 80 GB …". We take the 1x
 * on-demand price per GPU and store it in server/data/gpuHistory.json keyed by
 * the snapshot date. Existing dates (live vast.ai scrapes) are never touched.
 *
 * Note the source difference: backfilled points are Lambda on-demand prices;
 * points from 2026-06-11 onward are vast.ai spot medians. The chart subtitle
 * discloses this.
 *
 * Usage: node server/scripts/backfillGpu.js
 */
const axios = require('axios');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const PAGE = 'https://lambdalabs.com/service/gpu-cloud';
const UA   = 'signal-dashboard-backfill/1.0 (one-time historical backfill)';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'gpuHistory.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWithRetry(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const { data } = await axios.get(url, {
        headers: { 'User-Agent': UA },
        timeout: 60000,
        responseType: 'arraybuffer',
      });
      const buf = Buffer.from(data);
      // id_ captures replay the original body, which may still be gzipped
      const html = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
      return html.toString('utf8');
    } catch (e) {
      if (i === tries) throw e;
      console.warn(`  retry ${i}/${tries - 1}: ${e.message}`);
      await sleep(5000 * i);
    }
  }
}

async function listSnapshots() {
  const url = 'https://web.archive.org/cdx/search/cdx'
    + `?url=${encodeURIComponent('lambdalabs.com/service/gpu-cloud')}`
    + '&output=json&filter=statuscode:200&collapse=timestamp:8&from=20240101';
  const html = await getWithRetry(url);
  const rows = JSON.parse(html);
  return rows.slice(1).map(r => r[1]);
}

// "$1.49 / GPU / hr On-demand 1x NVIDIA H100 SXM 80 GB" → { H100_SXM: 1.49 }
function parsePrices(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const prices = {};
  const re = /\$\s*([\d.]+)\s*\/\s*GPU\s*\/\s*hr\s*On-demand\s*1x\s*NVIDIA\s*([A-Za-z0-9 ]+?)\s*\d+\s*GB/g;
  for (const m of text.matchAll(re)) {
    const price = parseFloat(m[1]);
    const name  = m[2].trim().replace(/\s+/g, '_');
    if (Number.isFinite(price) && price > 0 && !(name in prices)) prices[name] = price;
  }
  return prices;
}

async function main() {
  console.log(`Listing Wayback snapshots of ${PAGE}…`);
  const timestamps = await listSnapshots();
  console.log(`${timestamps.length} snapshots found`);

  let history = {};
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}

  let added = 0, skipped = 0, failed = 0;
  for (const ts of timestamps) {
    const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    if (history[date]) { skipped++; continue; }
    try {
      const html   = await getWithRetry(`https://web.archive.org/web/${ts}id_/${PAGE}`);
      const prices = parsePrices(html);
      if (Object.keys(prices).length === 0) {
        console.warn(`✗ ${date}: no 1x on-demand prices found`);
        failed++;
      } else {
        history[date] = prices;
        added++;
        console.log(`✓ ${date}:`, prices);
      }
    } catch (e) {
      console.warn(`✗ ${date}: ${e.message}`);
      failed++;
    }
    await sleep(2000);
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  const dates = Object.keys(history).sort();
  console.log(`\nDone. ${added} added, ${skipped} already present, ${failed} failed.`);
  console.log(`GPU history spans ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} dates).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
