'use strict';

const cheerio = require('cheerio');
const { decodeChartPayload } = require('./macro');

const TE_BASE = 'https://tradingeconomics.com';
const TE_DATA = 'https://d3ii0wo49og5mi.cloudfront.net';
const TE_KEY = 'tradingeconomics-charts-core-api-key';
const EASTMONEY_KLINE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

const GLOBAL = [
  ['globalGold', 'precious-rare', 'Gold', 'gold'],
  ['globalSilver', 'precious-rare', 'Silver', 'silver'],
  ['globalNeodymium', 'precious-rare', 'Rare Earth (Neodymium)', 'neodymium'],
  ['globalCopper', 'industrial', 'Copper', 'copper'],
  ['globalAluminum', 'industrial', 'Aluminum', 'aluminum'],
  ['globalLithium', 'industrial', 'Lithium', 'lithium'],
  ['globalNickel', 'industrial', 'Nickel', 'nickel'],
  ['globalWti', 'oil-gas', 'Crude Oil', 'crude-oil', 'WTI'],
  ['globalBrent', 'oil-gas', 'Crude Oil', 'brent-crude-oil', 'Brent'],
  ['globalNaturalGas', 'oil-gas', 'Natural Gas', 'natural-gas'],
  ['globalHeatingOil', 'oil-gas', 'Fuel Oil', 'heating-oil', 'Heating Oil'],
  ['globalPropane', 'oil-gas', 'LPG', 'propane', 'Propane'],
  ['globalCoal', 'ferrous', 'Coal', 'coal', 'Thermal Coal'],
  ['globalCokingCoal', 'ferrous', 'Coal', 'coking-coal', 'Coking Coal'],
  ['globalIronOre', 'ferrous', 'Iron Ore', 'iron-ore'],
  ['globalSteel', 'ferrous', 'Rebar', 'steel', 'Steel Rebar'],
  ['globalLeanHogs', 'agriculture', 'Hog', 'lean-hogs', 'Lean Hogs'],
  ['globalRubber', 'agriculture', 'Rubber', 'rubber'],
  ['globalPalmOil', 'agriculture', 'Palm Oil', 'palm-oil'],
  ['globalCorn', 'agriculture', 'Corn', 'corn'],
  ['globalSugar', 'agriculture', 'Sugar', 'sugar'],
  ['globalCoffee', 'agriculture', 'Coffee', 'coffee'],
  ['globalCocoa', 'agriculture', 'Cocoa', 'cocoa'],
  ['globalSilicon', 'chemical', 'Silicon', 'silicon'],
  ['globalMethanol', 'chemical', 'Methanol', 'methanol'],
  ['globalPp', 'chemical', 'PP', 'polypropylene', 'Polypropylene'],
  ['globalPvc', 'chemical', 'PVC', 'polyvinyl', 'Polyvinyl Chloride'],
  ['globalSodaAsh', 'chemical', 'Soda Ash', 'soda-ash'],
  ['globalUrea', 'chemical', 'Urea', 'urea'],
].map(([id, section, commodity, slug, name = commodity]) => ({ id, section, commodity, slug, name }));

const CHINA = [
  ['chinaGold', 'precious-rare', 'Gold', '113.aum', '沪金主连', 'CNY/gram'],
  ['chinaSilver', 'precious-rare', 'Silver', '113.agm', '沪银主连', 'CNY/kilogram'],
  ['chinaCopper', 'industrial', 'Copper', '113.cum', '沪铜主连', 'CNY/metric ton'],
  ['chinaAluminum', 'industrial', 'Aluminum', '113.alm', '沪铝主连', 'CNY/metric ton'],
  ['chinaAlumina', 'industrial', 'Aluminum', '113.aom', '氧化铝主连', 'CNY/metric ton'],
  ['chinaLithium', 'industrial', 'Lithium', '225.lcm', '碳酸锂主连', 'CNY/metric ton'],
  ['chinaNickel', 'industrial', 'Nickel', '113.nim', '沪镍主连', 'CNY/metric ton'],
  ['chinaFuelOil', 'oil-gas', 'Fuel Oil', '113.fum', '燃油主连', 'CNY/metric ton'],
  ['chinaLpg', 'oil-gas', 'LPG', '114.pgm', 'LPG主连', 'CNY/metric ton'],
  ['chinaThermalCoal', 'ferrous', 'Coal', '115.ZCM', '动力煤主连', 'CNY/metric ton'],
  ['chinaCokingCoal', 'ferrous', 'Coal', '114.jmm', '焦煤主连', 'CNY/metric ton'],
  ['chinaGlass', 'ferrous', 'Glass', '115.FGM', '玻璃主连', 'CNY/metric ton'],
  ['chinaIronOre', 'ferrous', 'Iron Ore', '114.im', '铁矿石主连', 'CNY/metric ton'],
  ['chinaRebar', 'ferrous', 'Rebar', '113.rbm', '螺纹钢主连', 'CNY/metric ton'],
  ['chinaHog', 'agriculture', 'Hog', '114.lhm', '生猪主连', 'CNY/metric ton'],
  ['chinaSoybeanMeal', 'agriculture', 'Soybean Meal', '114.mm', '豆粕主连', 'CNY/metric ton'],
  ['chinaRubber', 'agriculture', 'Rubber', '113.rum', '橡胶主连', 'CNY/metric ton'],
  ['chinaPalmOil', 'agriculture', 'Palm Oil', '114.pm', '棕榈油主连', 'CNY/metric ton'],
  ['chinaCorn', 'agriculture', 'Corn', '114.cm', '玉米主连', 'CNY/metric ton'],
  ['chinaSugar', 'agriculture', 'Sugar', '115.SRM', '白糖主连', 'CNY/metric ton'],
  ['chinaPolysilicon', 'chemical', 'Silicon', '225.psm', '多晶硅主连', 'CNY/metric ton'],
  ['chinaIndustrialSilicon', 'chemical', 'Silicon', '225.sim', '工业硅主连', 'CNY/metric ton'],
  ['chinaMethanol', 'chemical', 'Methanol', '115.MAM', '甲醇主连', 'CNY/metric ton'],
  ['chinaPta', 'chemical', 'PTA', '115.TAM', 'PTA主连', 'CNY/metric ton'],
  ['chinaPp', 'chemical', 'PP', '114.ppm', '聚丙烯主连', 'CNY/metric ton'],
  ['chinaPvc', 'chemical', 'PVC', '114.vFm', 'PVC月均主连', 'CNY/metric ton'],
  ['chinaSodaAsh', 'chemical', 'Soda Ash', '115.SAM', '纯碱主连', 'CNY/metric ton'],
  ['chinaUrea', 'chemical', 'Urea', '115.URM', '尿素主连', 'CNY/metric ton'],
].map(([id, section, commodity, secid, name, unit]) => ({ id, section, commodity, secid, name, unit }));

const MYSTEEL = [
  {
    id: 'chinaNeodymium', section: 'precious-rare', commodity: 'Rare Earth (Neodymium)',
    name: '氧化钕 Nd₂O₃ ≥99.5%', url: 'https://www.mysteel.com/zta/yanghuapunv/',
    match: ['氧化钕'], unit: 'CNY/metric ton',
  },
  {
    id: 'chinaTungsten', section: 'precious-rare', commodity: 'Tungsten',
    name: '黑钨精矿 WO₃ 65%', url: 'https://list1.mysteel.com/zhishi/wujiageribao.html',
    match: ['黑钨精矿', '65%'], unit: 'CNY 10k/metric ton',
  },
];

function match(html, pattern, fallback = '') {
  return html.match(pattern)?.[1]?.replace(/&amp;/g, '&') ?? fallback;
}

async function fetchText(url, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 Signal Commodity Dashboard' },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function finite(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parseTeOhlc(rows = []) {
  return rows.flatMap(row => {
    const [open, high, low, close] = [row[4], row[5], row[6], row[7]].map(finite);
    if (![open, high, low, close].every(Number.isFinite)) return [];
    return [{ date: new Date(row[0] * 1000).toISOString().slice(0, 10), open, high, low, close }];
  });
}

function inferFrequency(data) {
  if (data.length < 2) return 'Daily';
  const gaps = data.slice(1).map((point, index) =>
    (new Date(point.date).getTime() - new Date(data[index].date).getTime()) / 86400000)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] || 1;
  return medianGap >= 20 ? 'Monthly OHLC' : medianGap >= 4 ? 'Weekly OHLC' : 'Daily OHLC';
}

async function fetchGlobal(meta) {
  const sourceUrl = `${TE_BASE}/commodity/${meta.slug}`;
  const html = await fetchText(sourceUrl);
  const symbol = match(html, /var TESymbol = '([^']+)'/);
  const ticker = match(html, /symbol\s*=\s*'([^']+:[^']+)'/, symbol ? `${symbol}:com` : '');
  if (!ticker) throw new Error(`No market ticker at ${sourceUrl}`);
  const token = match(html, /var TEChartsToken = '([^']+)'/);
  const key = match(html, /var TEObfuscationkey = '([^']+)'/, TE_KEY);
  const dataSource = match(html, /var TEChartsDatasource = '([^']+)'/, TE_DATA);
  const chartUrl = `${dataSource}/markets/${encodeURIComponent(ticker.toLowerCase())}?span=5y&ohlc=1`;
  const raw = await fetchTextWithHeaders(chartUrl, token ? { 'x-api-key': token } : {});
  const decoded = decodeChartPayload(JSON.parse(raw), key);
  const serie = decoded?.series?.[0];
  const data = parseTeOhlc(serie?.data);
  if (!data.length) throw new Error(`No OHLC history returned for ${meta.name}`);
  return {
    ...meta, market: 'Global', name: meta.name, unit: serie.unit || 'source units',
    frequency: inferFrequency(data), source: 'Trading Economics', sourceUrl, data,
  };
}

async function fetchTextWithHeaders(url, headers, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseEastmoneyKlines(lines = []) {
  return lines.flatMap(line => {
    const fields = String(line).split(',');
    const [open, close, high, low] = [fields[1], fields[2], fields[3], fields[4]].map(finite);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields[0]) || ![open, high, low, close].every(Number.isFinite)) return [];
    return [{ date: fields[0], open, high, low, close }];
  });
}

async function fetchChina(meta) {
  const params = new URLSearchParams({
    secid: meta.secid, klt: '101', fqt: '1', lmt: '1500', end: '20500000', iscca: '1',
    fields1: 'f1,f2,f3,f4,f5,f6,f7,f8',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64',
    ut: '7eea3edcaed734bea9cbfc24409ed989', forcect: '1',
  });
  const raw = await fetchText(`${EASTMONEY_KLINE}?${params}`);
  const json = JSON.parse(raw);
  const data = parseEastmoneyKlines(json?.data?.klines);
  if (!data.length) throw new Error(`No Eastmoney OHLC history returned for ${meta.name}`);
  return {
    ...meta, market: 'China', frequency: 'Daily', source: '东方财富',
    sourceUrl: `https://quote.eastmoney.com/qihuo/${meta.secid.split('.')[1]}.html`, data,
  };
}

function parseMysteelRange(html, meta) {
  const ch = cheerio.load(html);
  let values = null;
  ch('tr').each((_index, row) => {
    if (values) return;
    const cells = ch(row).find('th,td').map((_i, cell) => ch(cell).text().replace(/\s+/g, ' ').trim()).get();
    const joined = cells.join(' ');
    if (!meta.match.every(term => joined.includes(term))) return;
    const numbers = cells.slice(1).map(finite).filter(Number.isFinite);
    if (numbers.length >= 3) values = { low: numbers[0], high: numbers[1], close: numbers[2] };
    else if (numbers.length) values = { low: numbers[0], high: numbers[0], close: numbers[0] };
  });
  if (!values) return null;
  const date = html.match(/20\d{2}[-/]\d{2}[-/]\d{2}/)?.[0]?.replaceAll('/', '-')
    || new Date().toISOString().slice(0, 10);
  return { date, open: values.close, high: Math.max(values.high, values.close), low: Math.min(values.low, values.close), close: values.close };
}

async function fetchMysteel(meta) {
  const html = await fetchText(meta.url);
  const candle = parseMysteelRange(html, meta);
  if (!candle) throw new Error(`No Mysteel quote found for ${meta.name}`);
  return { ...meta, market: 'China', frequency: 'Daily range', source: 'Mysteel', sourceUrl: meta.url, data: [candle] };
}

async function retry(worker, tries = 2) {
  let error;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { return await worker(); }
    catch (caught) { error = caught; }
  }
  throw error;
}

async function mapLimited(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await retry(() => worker(items[index])) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function mergeSeries(fresh, previous) {
  if (!previous?.data?.length) return fresh;
  const byDate = new Map(previous.data.map(point => [point.date, point]));
  fresh.data.forEach(point => byDate.set(point.date, point));
  return { ...fresh, data: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-1500) };
}

async function getCommodityData(previous = null) {
  const jobs = [
    ...GLOBAL.map(meta => ({ meta, fetcher: fetchGlobal })),
    ...CHINA.map(meta => ({ meta, fetcher: fetchChina })),
    ...MYSTEEL.map(meta => ({ meta, fetcher: fetchMysteel })),
  ];
  const settled = await mapLimited(jobs, 4, job => job.fetcher(job.meta));
  const series = {};
  const errors = {};
  settled.forEach((result, index) => {
    const id = jobs[index].meta.id;
    if (result.status === 'fulfilled') series[id] = mergeSeries(result.value, previous?.series?.[id]);
    else if (previous?.series?.[id]) {
      series[id] = previous.series[id];
      errors[id] = result.reason?.message || 'Refresh failed; retained previous history';
    } else errors[id] = result.reason?.message || 'Unknown error';
  });
  if (!Object.keys(series).length) throw new Error('Commodity sources returned no price series');
  return { fetchedAt: new Date().toISOString(), series, errors };
}

module.exports = {
  getCommodityData, parseTeOhlc, parseEastmoneyKlines, parseMysteelRange, inferFrequency,
  GLOBAL, CHINA, MYSTEEL,
};
