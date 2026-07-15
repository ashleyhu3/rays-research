/**
 * Per-company margin & short-sale balances from the TWSE charts page, expressed
 * against the stock's own daily trading volume — the same two combo charts the
 * exchange draws at the bottom of its 個股融資融券 (per-stock margin) page.
 *
 * Two free, keyless JSON endpoints power it (both send
 * Access-Control-Allow-Origin: *, but we call them server-side so the browser
 * never touches TWSE directly and the result can be cached):
 *
 *   /rwd/IIH/company/margin?code=&start=&end=
 *     chart.purchase.series → 融資餘額張數 (margin balance, in 張/lots) and
 *       融資張數增減 (daily change, lots)
 *     chart.shortSale.series → 融券餘額張數 / 融券張數增減 (the short-sale pair)
 *     chart.*.categories → the trading-day labels ("YYYY/MM/DD")
 *
 *   /rwd/IIH/company/overview?code=&start=&end=
 *     chart.data → rows of [openTimestampMs, open, high, low, close, volume],
 *       where volume is in *shares*.
 *
 * The adjustment: 1 張 = 1,000 shares, so a balance of N lots is N×1,000 shares.
 * Divided by that day's traded shares, the line reads as "margin balance in days
 * of trading volume" — how many full sessions it would take to unwind the
 * borrowed position. A day with no volume (halt / missing bar) yields null so the
 * line gaps rather than dividing by zero.
 *
 * History is capped at ~1 year (≈242 trading days) by the source, an invalid or
 * TPEx/OTC code returns info.status "error" (查無相關資料！), and only TWSE-listed
 * codes resolve. Mirrors taiwanLeverage.js's UA/Referer/timeout conventions.
 */
const SHARES_PER_LOT = 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://wwwc.twse.com.tw/rwd/IIH/company';

async function fetchTwseJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://wwwc.twse.com.tw/' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
  return res.json();
}

const yyyymmdd = date => date.toISOString().slice(0, 10).replace(/-/g, '');

// "2026/07/14" → "2026-07-14"
function normalizeDate(label) {
  const text = String(label ?? '').trim().replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

// The overview bars are timestamped at the market session (13:30 Taipei = 05:30
// UTC), so shifting into Taipei time before taking the date is robust regardless
// of where the server runs.
function timestampToDate(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

const seriesData = (chart, name) => chart?.series?.find(s => s?.name === name)?.data ?? [];

/**
 * Pure transform: align the two margin/short series to the daily volume series
 * by calendar date, and compute balance-in-days-of-volume for each side.
 * Exported for tests; throws the exchange's own message on an error response.
 */
function buildCompanyMargin(code, margin, overview) {
  if (margin?.info?.status !== 'success') {
    throw new Error(margin?.info?.message || 'TWSE returned no data for this code');
  }

  // Day volume, keyed by calendar date (overview volume is in shares).
  const volumeByDate = {};
  for (const row of overview?.chart?.data ?? []) {
    const day = timestampToDate(row?.[0]);
    const volume = Number(row?.[5]);
    if (day && Number.isFinite(volume) && volume > 0) volumeByDate[day] = volume;
  }

  const build = chart => {
    const categories = chart?.categories ?? [];
    const balance = seriesData(chart, chart === margin.chart?.purchase ? '融資餘額張數' : '融券餘額張數');
    const change = seriesData(chart, chart === margin.chart?.purchase ? '融資張數增減' : '融券張數增減');
    const dates = [];
    const balanceLots = [];
    const changeLots = [];
    const dayVolume = [];
    const daysOfVolume = [];
    categories.forEach((label, i) => {
      const day = normalizeDate(label);
      if (!day) return;
      const bal = Number(balance[i]);
      const chg = Number(change[i]);
      const vol = volumeByDate[day] ?? null;
      dates.push(day);
      balanceLots.push(Number.isFinite(bal) ? bal : null);
      changeLots.push(Number.isFinite(chg) ? chg : null);
      dayVolume.push(vol);
      // Null when either component is missing so the line gaps instead of lying.
      daysOfVolume.push(
        Number.isFinite(bal) && Number.isFinite(vol) && vol > 0
          ? Math.round(((bal * SHARES_PER_LOT) / vol) * 1000) / 1000
          : null,
      );
    });
    return { dates, balanceLots, changeLots, dayVolume, daysOfVolume };
  };

  return {
    code: String(code),
    name: margin.info.data?.name ?? String(code),
    shortName: margin.info.data?.shortName ?? margin.info.data?.name ?? String(code),
    category: margin.info.data?.category ?? null,
    purchase: build(margin.chart?.purchase),   // 融資 margin
    shortSale: build(margin.chart?.shortSale),  // 融券 short
    updatedAt: new Date().toISOString(),
  };
}

async function getTwseCompanyMargin(code) {
  const clean = String(code ?? '').trim();
  if (!/^\d{4,6}[A-Z]?$/.test(clean)) throw new Error('Invalid TWSE stock code');

  const today = new Date();
  const end = yyyymmdd(today);
  const start = yyyymmdd(new Date(today.getTime() - 366 * 86400000));

  // Both must succeed: the volume ratio is the whole point of the chart, so a
  // failed overview fetch should surface as an error (and stay uncached) rather
  // than be baked into an hour-long cache as a ratio-less, degraded result.
  const [margin, overview] = await Promise.all([
    fetchTwseJson(`${BASE}/margin?code=${clean}&start=${start}&end=${end}`),
    fetchTwseJson(`${BASE}/overview?code=${clean}&start=${start}&end=${end}`),
  ]);

  return buildCompanyMargin(clean, margin, overview);
}

module.exports = {
  getTwseCompanyMargin,
  _test: { buildCompanyMargin },
};
