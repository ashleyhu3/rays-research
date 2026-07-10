'use strict';

// Taiwan customs monthly export/import value by HS commodity code.
//
// Source: Bureau of Foreign Trade "International Trade Administration — Trade
// Statistics" (publicinfo.trade.gov.tw), which republishes the Ministry of
// Finance Customs Administration clearance data. The interactive "by Product"
// table CAPTCHA-gates its data endpoint, but the "by Country" table's chart
// endpoint (FSCE3010F/GetData) returns the same monthly series as plain JSON
// with no CAPTCHA and no session cookie — one POST per query.
//
// Why not UN Comtrade: Comtrade has no Taiwan data at all (Taiwan reports as
// "Other Asia, nes" / code 490, which returns zero rows for these HS codes),
// and it lags many months — useless for a chart that tracks the latest month.
//
// The endpoint's "Month Comparison" mode (rdoType=1) returns a base year vs a
// comparison year for each month; we take the comparison-year value, which is
// the actual month's value. Values are requested in millions of US$ (US100).

const ENDPOINT = 'https://publicinfo.trade.gov.tw/cuswebo/FSCE3010F/GetData';
// Human-facing page for the "Source:" link on the card.
const SRC_URL  = 'https://publicinfo.trade.gov.tw/cuswebo/FSCE000F/FSCE000F';

// How many trailing months of history to request. The API caps rows at `ddlTop`
// and silently truncates at 10 if it is too small, so we set ddlTop above the
// window length.
const WINDOW_MONTHS = 30;

function ymMinus(date, months) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * Fetch a monthly trade-value series for one HS code.
 * @param {object} opts
 * @param {string} opts.hsCode  2/4/6/8/11-digit CCC/HS code, e.g. '8806'.
 * @param {'E'|'I'} [opts.flow='E']  Export ('E') or import ('I').
 * @returns {Promise<Array<{period:string, value:number}>>} oldest→newest,
 *          period = 'YYYY-MM', value in US$ millions.
 */
async function fetchCustomsMonthly({ hsCode, flow = 'E' }) {
  const now   = new Date();
  const start = ymMinus(now, WINDOW_MONTHS);

  const params = new URLSearchParams({
    ddlYearS: String(start.year),
    ddlMonS:  String(start.month).padStart(2, '0'),
    ddlYearE: String(now.getUTCFullYear()),
    ddlMonE:  String(now.getUTCMonth() + 1).padStart(2, '0'),
    rdoIE_CODE: flow,          // E = export, I = import
    rdoReportCode: 'All',      // include re-exports/re-imports
    txtHS_CODE_S: hsCode,
    txtHS_CODE_E: '',
    ddlCNTRY: 'AD', ddlCONTINENTAL: '0', ddlAREA: '018', // ignored when rdoCAC=1
    rdoCAC: '1',               // World (all trading partners)
    rdoType: '1',              // Month Comparison → monthly time series
    rdoMON: '2',               // monthly (1 = annual)
    chkVALUE_P: 'false', chkVALUE_R: 'false', chkVALUE_L: 'false',
    rdoUnit: '1',              // value (2=weight, 3=quantity)
    rdoUS100: 'US100',         // millions of US$
    ddlTop: String(WINDOW_MONTHS + 6),
  });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const months = json.Month;
  const values = json.Expences; // comparison-year value = the actual month
  if (!Array.isArray(months) || !Array.isArray(values) || months.length === 0) {
    throw new Error('empty response (source may be rate-limiting or format changed)');
  }

  const series = [];
  for (let i = 0; i < months.length; i++) {
    // Label form: "2025/2026 (04月)" → base/comparison year (month). The real
    // period is the comparison (2nd) year + month.
    const m = String(months[i]).match(/(\d{4})\/(\d{4})\s*\((\d{1,2})/);
    if (!m) continue;
    const period = `${m[2]}-${m[3].padStart(2, '0')}`;
    const value  = parseFloat(values[i]);
    if (!Number.isFinite(value)) continue;
    series.push({ period, value: parseFloat(value.toFixed(2)) });
  }

  series.sort((a, b) => a.period.localeCompare(b.period));

  // Trailing zero-value months are months the customs data hasn't reported yet
  // (the request window runs to the current month, but publication lags ~1–2
  // months). Drop them so the series ends at the latest actually-reported month.
  while (series.length && series[series.length - 1].value === 0) series.pop();

  if (series.length === 0) throw new Error('no parseable months in response');
  return series;
}

/**
 * Taiwan UAV/drone exports — HS 8806 ("unmanned aircraft"), applied by Taiwan
 * customs since 2023-06-23. Monthly export value in US$ millions, World total.
 */
async function getDroneExports() {
  const series = await fetchCustomsMonthly({ hsCode: '8806', flow: 'E' });
  return {
    hsCode: '8806',
    flow: 'export',
    unit: 'US$m',
    srcUrl: SRC_URL,
    updated: new Date().toISOString(),
    series,
  };
}

module.exports = { getDroneExports, fetchCustomsMonthly };
