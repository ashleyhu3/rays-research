const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const storage = require('../storage');

const URL = 'https://www.trendforce.com/price/dram/dram_spot';

// TrendForce's per-item history charts are members-only, so we accumulate our
// own daily history of computed model averages: { 'YYYY-MM-DD': { model: price } }
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'dramHistory.json');
const BLOB = 'dramHistory';

function loadHistory() {
  return storage.read(BLOB, HISTORY_FILE);
}

function saveHistory(history) {
  storage.write(BLOB, HISTORY_FILE, history);
}
const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Collapse item variants into one model key:
//   "DDR5 16Gb (2Gx8) 4800/5600" / "DDR5 16Gb (2Gx8) eTT" → "DDR5 16Gb"
//   "DDR3 4Gb 512Mx8 1600/1866"                            → "DDR3 4Gb"
//   "DDR5 UDIMM 16GB 4800/5600"                            → "DDR5 UDIMM 16GB"
function modelKey(item) {
  return item
    .replace(/\(.*?\)/g, ' ')               // organization in parens, e.g. (2Gx8)
    .replace(/\b\d+(?:M|G)x\d+\b/gi, ' ')   // bare organization, e.g. 512Mx8
    .replace(/\b\d{4}(?:\/\d{4})?\b/g, ' ') // speed grades, e.g. 3200, 4800/5600
    .replace(/\beTT\b/gi, ' ')              // effectively-tested grade
    .replace(/\s+/g, ' ')
    .trim();
}

function categoryOf(model) {
  if (/DIMM/i.test(model))    return 'module';
  if (/^GDDR/i.test(model))   return 'graphics';
  return 'chip';
}

// "▲ 1.14 %" → 1.14, "▼ -0.71 %" → -0.71, "0.00 %" → 0
function parseChange(text) {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  let v = parseFloat(m[0]);
  if (text.includes('▼') && v > 0) v = -v;
  return v;
}

// Parse a dram_spot page (live or archived) into per-model averages.
// Returns [] when the page has no recognizable spot tables.
function parseModels(html) {
  const $ = cheerio.load(html);

  // Collect every priced row across the spot tables. A usable table has an
  // "Item" column, a "Session Average" column, and a change column
  // ("Session Change" on the chip table, "Average Change" on module/GDDR).
  const rows = [];
  $('table').each((_, table) => {
    const headers = $(table).find('tr').first().find('th,td')
      .map((_, c) => $(c).text().trim()).get();
    const iItem   = headers.indexOf('Item');
    const iAvg    = headers.indexOf('Session Average');
    const iChange = headers.findIndex(h => h === 'Session Change' || h === 'Average Change');
    if (iItem < 0 || iAvg < 0 || iChange < 0) return;

    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td').map((_, c) => $(c).text().trim()).get();
      if (cells.length < headers.length - 1) return;
      const item = cells[iItem];
      const avg  = parseFloat((cells[iAvg] ?? '').replace(/,/g, ''));
      if (!item || !Number.isFinite(avg) || avg <= 0) return;
      const changePct = parseChange(cells[iChange] ?? '');
      rows.push({
        item,
        model: modelKey(item),
        sessionAverage: avg,
        changePct,
        // session average with the session change applied
        adjusted: avg * (1 + changePct / 100),
      });
    });
  });

  // Average the adjusted prices of all variants of each model
  const byModel = new Map();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model).push(r);
  }

  return [...byModel.entries()].map(([model, items]) => ({
    model,
    category:  categoryOf(model),
    price:     +(items.reduce((s, r) => s + r.adjusted, 0) / items.length).toFixed(3),
    changePct: +(items.reduce((s, r) => s + r.changePct, 0) / items.length).toFixed(2),
    variants:  items.length,
    items:     items.map(({ item, sessionAverage, changePct }) => ({ item, sessionAverage, changePct })),
  }));
}

// TrendForce DataTrack "Mainstream DRAM Spot Price" — the public JSON feed
// behind https://datatrack.trendforce.com/Chart/content/4694/mainstream-dram-spot-price
const INDEX_URL = 'https://datatrack-finwhale.trendforce.com:8000/api/v1/data/column?fields=6105';

async function getDramIndex() {
  const { data } = await axios.get(INDEX_URL, { headers: { 'User-Agent': UA }, timeout: 20000 });
  const name  = Object.keys(data)[0];
  const entry = data[name];
  if (!entry?.data) return null;
  // Timestamps are month-end; label each point by its UTC month
  const points = Object.entries(entry.data)
    .map(([ts, v]) => [ts.slice(0, 10), parseFloat(v)])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => a[0].localeCompare(b[0]));
  return {
    name,
    unit:   entry.unit ?? 'USD',
    freq:   entry.freq ?? 'M',
    source: entry.data_source ?? 'TrendForce',
    dates:  points.map(p => p[0]),
    values: points.map(p => p[1]),
  };
}

async function getDramSpot() {
  const [{ data: html }, indexRes] = await Promise.all([
    axios.get(URL, { headers: { 'User-Agent': UA }, timeout: 20000 }),
    getDramIndex().catch(e => { console.warn('[dram] index fetch failed:', e.message); return null; }),
  ]);

  const models = parseModels(html);
  if (models.length === 0) return null;

  // Append today's snapshot (re-scrapes the same day overwrite with the latest session)
  const asOf = new Date().toISOString().slice(0, 10);
  const history = loadHistory();
  history[asOf] = Object.fromEntries(models.map(m => [m.model, m.price]));
  saveHistory(history);

  // Chart-ready series: one price per date per model, null where a model wasn't listed
  const dates  = Object.keys(history).sort();
  const series = {};
  for (const m of models) {
    series[m.model] = dates.map(d => history[d]?.[m.model] ?? null);
  }

  return { models, history: { dates, series }, index: indexRes, asOf };
}

module.exports = { getDramSpot, parseModels, loadHistory, saveHistory };
