'use strict';
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const storage = require('../storage');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DAY_MS = 86400000;
const DATA_DIR = path.join(__dirname, '..', 'data');

const CONFIGS = {
  nand: {
    key: 'nand',
    displayName: 'NAND Flash',
    url: 'https://www.trendforce.com/price/flash/flash_spot',
    blob: 'nandHistory',
    file: path.join(DATA_DIR, 'nandHistory.json'),
    precision: 3,
    tables: [
      { index: 0, section: 'NAND Flash Spot Price', category: 'flash', prefix: 'Flash', priceHeaders: ['Session Average'], changeHeaders: ['Session Change'], applyChange: true },
      { index: 2, section: 'Wafer Spot Price', category: 'wafer', prefix: 'Wafer', priceHeaders: ['Session Average'], changeHeaders: ['Session Change'], applyChange: true },
      { index: 3, section: 'Memory Card Spot Price', category: 'card', prefix: 'Card', priceHeaders: ['Session Average'], changeHeaders: ['Session Change'], applyChange: true },
    ],
    methodology: 'TrendForce NAND public spot tables. Session average is adjusted by session change and snapshotted once per UTC day; historical gaps are forward-filled from the last observed TrendForce price.',
  },
  tftLcd: {
    key: 'tftLcd',
    displayName: 'TFT-LCD',
    url: 'https://www.trendforce.com/price/lcd/panel',
    blob: 'tftLcdHistory',
    file: path.join(DATA_DIR, 'tftLcdHistory.json'),
    precision: 2,
    tables: [
      { index: 0, section: 'Large Size Panel Price', category: 'largePanel', prefix: 'Large', priceHeaders: ['Average'], changeHeaders: ['Change(HoH.)', 'Change(HoH./MoM.)'], preferLabelHeader: 'App. / Spec' },
      { index: 1, section: 'LCD Smartphone Panel Price', category: 'smartphonePanel', prefix: 'Phone', priceHeaders: ['Avg.', 'Average'], changeHeaders: ['Change'], priceFromEnd: 3, changeFromEnd: 1, labelCellCount: 3 },
    ],
    methodology: 'TrendForce TFT-LCD public panel-price tables. Average panel price is snapshotted once per UTC day; historical gaps are forward-filled from the last observed TrendForce price.',
  },
};

const ALIASES = {
  nand: 'nand',
  flash: 'nand',
  'tft-lcd': 'tftLcd',
  tftlcd: 'tftLcd',
  lcd: 'tftLcd',
};

function nandModelKey(item) {
  return item
    .replace(/\b\d+(?:MB|GB|M|G)x\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const table of CONFIGS.nand.tables) table.modelKey = nandModelKey;

function configFor(key) {
  const canonical = ALIASES[String(key || '').trim()] ?? key;
  const cfg = CONFIGS[canonical];
  if (!cfg) throw new Error(`unknown TrendForce price config: ${key}`);
  return cfg;
}

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseNumber(value) {
  const m = compact(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function parseChange(text) {
  const raw = compact(text);
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return 0;
  let v = Number(m[0]);
  if (raw.includes('▼') && v > 0) v = -v;
  return Number.isFinite(v) ? v : 0;
}

function findHeader(headers, names) {
  const wanted = names.map(compact);
  return headers.findIndex(h => wanted.includes(h));
}

function rowCells($, tr) {
  return $(tr).find('td').map((_, c) => compact($(c).text())).get();
}

function tableHeaders($, table) {
  return $(table).find('tr').first().find('th,td').map((_, c) => compact($(c).text())).get();
}

function firstNumericIndex(cells) {
  return cells.findIndex(c => Number.isFinite(parseNumber(c)));
}

function labelFor(cells, headers, tableDef) {
  if (tableDef.labelCellCount) return compact(cells.slice(0, tableDef.labelCellCount).join(' '));

  const preferred = tableDef.preferLabelHeader ? findHeader(headers, [tableDef.preferLabelHeader]) : -1;
  if (preferred >= 0 && cells[preferred]) return compact(cells[preferred]);

  const item = findHeader(headers, ['Item']);
  if (item >= 0 && cells[item]) return compact(cells[item]);

  const firstNum = firstNumericIndex(cells);
  const prefix = firstNum > 0 ? cells.slice(0, firstNum) : cells.slice(0, 2);
  return compact(prefix.join(' '));
}

function priceFor(cells, headers, tableDef) {
  if (tableDef.priceFromEnd && cells.length !== headers.length) {
    const v = parseNumber(cells[cells.length - tableDef.priceFromEnd]);
    if (Number.isFinite(v)) return v;
  }
  const idx = findHeader(headers, tableDef.priceHeaders ?? ['Session Average', 'Average', 'Avg.']);
  return idx >= 0 ? parseNumber(cells[idx]) : NaN;
}

function changeFor(cells, headers, tableDef) {
  if (tableDef.changeFromEnd && cells.length !== headers.length) {
    return parseChange(cells[cells.length - tableDef.changeFromEnd]);
  }
  const idx = findHeader(headers, tableDef.changeHeaders ?? ['Session Change', 'Average Change', 'Change']);
  if (idx >= 0 && cells[idx]) return parseChange(cells[idx]);
  return parseChange(cells[cells.length - 1]);
}

function productKey(prefix, label) {
  return compact(`${prefix ? `${prefix} ` : ''}${label}`);
}

function parseProducts(html, key) {
  const cfg = configFor(key);
  const $ = cheerio.load(html);
  const tables = $('table').toArray();
  const rows = [];

  for (const tableDef of cfg.tables) {
    const table = tables[tableDef.index];
    if (!table) continue;
    const headers = tableHeaders($, table);

    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = rowCells($, tr);
      if (cells.length < 3) return;

      const rawLabel = labelFor(cells, headers, tableDef);
      const label = tableDef.modelKey ? tableDef.modelKey(rawLabel) : rawLabel;
      const average = priceFor(cells, headers, tableDef);
      if (!label || !Number.isFinite(average) || average <= 0) return;

      const changePct = changeFor(cells, headers, tableDef);
      const price = tableDef.applyChange
        ? average * (1 + changePct / 100)
        : average;
      if (!Number.isFinite(price) || price <= 0) return;

      rows.push({
        product: productKey(tableDef.prefix, label),
        item: label,
        sourceItem: rawLabel,
        section: tableDef.section,
        category: tableDef.category,
        price: Number(price.toFixed(cfg.precision)),
        average,
        changePct: Number(changePct.toFixed(2)),
      });
    });
  }

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.product)) grouped.set(row.product, []);
    grouped.get(row.product).push(row);
  }

  return [...grouped.entries()].map(([product, items]) => {
    const avg = field => items.reduce((sum, item) => sum + item[field], 0) / items.length;
    const first = items[0];
    return {
      product,
      item: first.item,
      section: first.section,
      category: first.category,
      price: Number(avg('price').toFixed(cfg.precision)),
      average: Number(avg('average').toFixed(cfg.precision)),
      changePct: Number(avg('changePct').toFixed(2)),
      variants: items.length,
      items: items.map(({ sourceItem, average, changePct, price }) => ({ item: sourceItem, average, changePct, price })),
    };
  });
}

function isoDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dailyDates(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(isoDay(t));
  return out;
}

function dayKeys(history) {
  return Object.keys(history ?? {}).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
}

function buildHistory(history, through = isoDay()) {
  const days = dayKeys(history);
  if (days.length === 0) return { dates: [], series: {} };

  const dates = dailyDates(days[0], through);
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const products = [...new Set(days.flatMap(d => Object.keys(history[d] ?? {})))].sort();
  const series = {};

  for (const product of products) {
    const anchors = days
      .filter(d => idx[d] != null && Number.isFinite(history[d]?.[product]))
      .map(d => ({ i: idx[d], v: history[d][product] }));
    const vals = new Array(dates.length).fill(null);
    for (let k = 0; k < anchors.length; k++) {
      const cur = anchors[k];
      const next = anchors[k + 1];
      vals[cur.i] = cur.v;
      const end = next ? next.i : dates.length;
      for (let i = cur.i + 1; i < end; i++) vals[i] = cur.v;
    }
    series[product] = vals;
  }

  return { dates, series };
}

function loadHistory(key) {
  const cfg = configFor(key);
  return storage.read(cfg.blob, cfg.file) ?? {};
}

function saveHistory(key, history) {
  const cfg = configFor(key);
  storage.write(cfg.blob, cfg.file, history);
}

async function getTrendforcePriceData(key) {
  const cfg = configFor(key);
  const { data: html } = await axios.get(cfg.url, { headers: { 'User-Agent': UA }, timeout: 20000 });
  const products = parseProducts(html, cfg.key);
  if (products.length === 0) return null;

  const today = isoDay();
  const history = loadHistory(cfg.key);
  history[today] = Object.fromEntries(products.map(p => [p.product, p.price]));
  saveHistory(cfg.key, history);

  return {
    products,
    history: buildHistory(history, today),
    asOf: today,
    sourceUrl: cfg.url,
    methodology: cfg.methodology,
  };
}

module.exports = {
  CONFIGS,
  UA,
  buildHistory,
  configFor,
  getTrendforcePriceData,
  loadHistory,
  parseProducts,
  saveHistory,
};
