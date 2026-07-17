/**
 * Korean retail firepower — the leveraged layers of household money in the
 * KOSPI/KOSDAQ, in trillions of won (조원), one point per trading day.
 *
 *   margin      신용거래융자        broker margin loans
 *   collateral  예탁증권 담보융자    loans against pledged securities — the quieter
 *                                  cousin of margin: same borrowing, but the
 *                                  cash can leave the account
 *   etf         레버리지 ETF 순자산  the 2× ETF/ETP funds sized to this trade: KODEX's
 *                                  KOSPI200 2× fund, KODEX and TIGER's
 *                                  single-stock 2× notes (SK Hynix, Samsung
 *                                  Electronics) above 1조원, and the two Hong
 *                                  Kong-listed CSOP single-stock notes for the
 *                                  same pair — HKEX's regulatory disclosure
 *                                  makes those exactly measurable too
 *
 * Only borrowed money is charted. The cash layers KOFIA also publishes
 * (투자자예탁금 broker deposits, CMA sweep balances) are not leverage — they are
 * dry powder — and were removed from the stack.
 *
 * All sources are anonymous JSON/XLSX endpoints — no key, no login.
 *
 * KOFIA (freesis.kofia.or.kr) — the industry body's free statistics portal. Its
 * eXBuilder front-end posts every table through one endpoint,
 * /meta/getMetaDataList.do, keyed by OBJ_NM. Two traps:
 *   • tmpV40/tmpV41 is the unit divisor, and the backend divides the raw won
 *     figure by the *literal code value*, not by the power of ten the code
 *     labels (code "12" = 조 divides by 12, not 1e12). Passing "01" divides by
 *     one, i.e. returns raw won — the only value we can reason about.
 *   • omit the divisor entirely and every money column comes back null while
 *     the percentage columns still populate, so the response looks healthy.
 * KOFIA publishes with a 1–3 day lag; the ETF layer is same-day.
 *
 * Daum Finance — /api/quote/{code}/days carries listedSharesCount per day, so
 * KODEX's fund AUM on any past day is price × shares that day, with no
 * estimation. /api/exchanges/FRX.KRWUSD/days carries the same for the daily
 * USD/KRW rate, needed to bring the two HK legs into won.
 *
 * HKEXnews (hkexnews.hk) — CSOP's regulatory obligation as an L&I product
 * issuer is to file a same-day "Trading Information of Leveraged & Inverse
 * Products" workbook disclosing each product's exact Asset Under Management,
 * not an estimate. /search/titleSearchServlet.do lists every filing for a
 * given internal stockId (itself resolved once via /search/prefix.do); one
 * workbook usually carries every CSOP L&I product live that day, so a single
 * stockId's filing history covers both 7709 and 7747. Cells are read by their
 * row label rather than a fixed position, since a note suffix ("(Note 7(b))")
 * gets appended to labels without warning between filings.
 */
const path = require('path');
const XLSX = require('@e965/xlsx');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'koreaLeverageHistory.json');
const BLOB = 'koreaLeverageHistory';

const TRILLION = 1e12;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ── KOFIA ─────────────────────────────────────────────────────────── */

const KOFIA_URL = 'https://freesis.kofia.or.kr/meta/getMetaDataList.do';

// Both credit layers come out of one table (신용공여 잔고 추이) — its columns are
// 신용거래융자(전체) and, at the far right, 예탁증권 담보융자.
const KOFIA_MARGIN_TABLE = {
  obj: 'STATSCU0100000070BO',
  cols: { margin: 'TMPV2', collateral: 'TMPV9' },
};

async function kofiaCredit(from, to) {
  const spec = KOFIA_MARGIN_TABLE;
  const res = await fetch(KOFIA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Referer': 'https://freesis.kofia.or.kr/',
      'User-Agent': UA,
    },
    body: JSON.stringify({
      dmSearch: {
        OBJ_NM: spec.obj,
        tmpV1: 'D',          // 자료주기: daily
        tmpV45: from,        // yyyyMMdd
        tmpV46: to,
        tmpV40: '01',        // unit divisor — "01" → divide by 1 → raw won
        tmpV41: '01',
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`KOFIA credit HTTP ${res.status}`);
  const json = await res.json();
  const out = { margin: {}, collateral: {} };
  for (const row of json.ds1 ?? []) {
    const raw = String(row.TMPV1 ?? '');
    if (!/^\d{8}$/.test(raw)) continue;
    const day = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
    for (const [key, col] of Object.entries(spec.cols)) {
      const won = row[col];
      if (Number.isFinite(won)) out[key][day] = won / TRILLION;
    }
  }
  if (!Object.keys(out.margin).length) throw new Error('KOFIA credit returned no rows');
  return out;
}

/* ── Daum: leveraged ETF net assets ────────────────────────────────── */

const DAUM_HEADERS = { 'User-Agent': UA, 'Referer': 'https://finance.daum.net/domestic/all_etfs' };

// The domestic half of the layer: KODEX's plain KOSPI200 2× fund, plus the
// four single-stock 2× notes (KODEX and TIGER's SK Hynix / Samsung
// Electronics funds, opened 2026-05-27) whose net assets clear 1조원 — the
// smaller single-stock funds from ACE/RISE/SOL/1Q/KIWOOM/PLUS, and TIGER's own
// KOSPI200 2×, stay out. Hong Kong's single-stock exposure is measured
// through the CSOP notes instead (HKEX_FUNDS below).
const DOMESTIC_INDEX_CODE = 'A122630';   // KODEX 레버리지
const DOMESTIC_SINGLE_CODES = new Set([
  'A0193T0',   // KODEX 단일종목레버리지 SK하이닉스
  'A0193W0',   // KODEX 단일종목레버리지 삼성전자
  'A0195S0',   // TIGER 단일종목레버리지 SK하이닉스
  'A0195R0',   // TIGER 단일종목레버리지 삼성전자
]);
const DOMESTIC_CODES = new Set([DOMESTIC_INDEX_CODE, ...DOMESTIC_SINGLE_CODES]);
const DOMESTIC_REVERSE_INDEX_CODES = new Set([
  'A252670',   // KODEX 200 Futures Inverse 2×
  'A252710',   // TIGER 200 Futures Inverse 2×
]);
// Single-stock inverse 2× is a much thinner field than single-stock leverage:
// of the issuers running long single-stock 2× funds (KODEX/TIGER/ACE/RISE/SOL/
// KIWOOM/1Q), only PLUS and SOL each brought out one inverse counterpart —
// confirmed against both Daum's ETF list and KRX's own finder
// (dbms/comm/finder/finder_secuprodisu). KODEX/TIGER/ACE/HANARO have none, and
// "KBSTAR" no longer exists as a brand — KB Asset Management renamed it RISE
// in 2024, and RISE's single-stock lineup is long-only too.
const DOMESTIC_REVERSE_SINGLE_CODES = new Set([
  'A0193L0',   // PLUS 삼성전자선물단일종목인버스2X — the only Samsung Electronics inverse 2× in Korea
  'A0197X0',   // SOL SK하이닉스선물단일종목인버스2X — the only SK Hynix inverse 2× in Korea
]);
const DOMESTIC_REVERSE_CODES = new Set([
  ...DOMESTIC_REVERSE_INDEX_CODES,
  ...DOMESTIC_REVERSE_SINGLE_CODES,
]);

async function daumJson(url) {
  const res = await fetch(url, { headers: DAUM_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Daum HTTP ${res.status} for ${url}`);
  return res.json();
}

// Daum only publishes the Korean fund name. The dashboard reads in English —
// the issuer brand (KODEX/TIGER) is left as-is, not a Korean word.
const TERMS = [
  [/SK하이닉스/g, 'SK Hynix'],
  [/삼성전자/g, 'Samsung Electronics'],
  [/200선물인버스2X/g, 'KOSPI200 Futures Inverse 2×'],
  [/선물단일종목인버스2X/g, 'Futures Single-Stock Inverse 2×'],
  [/단일종목레버리지/g, 'Single-Stock 2×'],
  [/레버리지/g, 'KOSPI200 2×'],
];

function englishName(name) {
  let out = name;
  for (const [re, en] of TERMS) out = out.replace(re, ` ${en} `);
  return out.replace(/\s+/g, ' ').trim();
}

async function leverageUniverse() {
  const json = await daumJson('https://finance.daum.net/api/etfs?page=1&perPage=1000&fieldName=marketCap&order=desc&pagination=true');
  const listed = json.data ?? [];
  const describe = (r, kind) => ({
      code: r.symbolCode,
      name: englishName(r.name),
      nameKo: r.name,
      kind,
    });
  const funds = listed
    .filter(r => DOMESTIC_CODES.has(r.symbolCode))
    .map(r => describe(r, r.symbolCode === DOMESTIC_INDEX_CODE ? 'index' : 'single'));
  const reverseFunds = listed
    .filter(r => DOMESTIC_REVERSE_CODES.has(r.symbolCode))
    .map(r => describe(r, DOMESTIC_REVERSE_INDEX_CODES.has(r.symbolCode) ? 'reverse-index' : 'reverse-single'));
  if (!funds.length) throw new Error('Daum ETF list returned no leveraged funds');
  if (!reverseFunds.length) throw new Error('Daum ETF list returned no reverse 2× funds');
  return { funds, reverseFunds };
}

// Daily AUM (조원) for one fund back to `from`, straight from price × shares.
// Daum pages 100 trading days at a time and keeps serving shares counts many
// years deep, so the cap is only a runaway guard: 40 pages ≈ 16 years, far past
// the oldest fund here (KODEX 레버리지, listed 2010).
async function fundHistory(code, from) {
  const out = {};
  for (let page = 1; page <= 40; page++) {
    const json = await daumJson(`https://finance.daum.net/api/quote/${code}/days?symbolCode=${code}&page=${page}&perPage=100&pagination=true`);
    const rows = json.data ?? [];
    for (const r of rows) {
      const day = String(r.date ?? '').slice(0, 10);
      if (!day || day < from) continue;
      if (!Number.isFinite(r.tradePrice) || !Number.isFinite(r.listedSharesCount)) continue;
      out[day] = (r.tradePrice * r.listedSharesCount) / TRILLION;
    }
    const oldest = String(rows[rows.length - 1]?.date ?? '').slice(0, 10);
    if (rows.length < 100 || (oldest && oldest < from)) break;
  }
  return out;
}

// Small pool — Daum tolerates this comfortably, but a 16-fund × 3-page burst
// with no lid is exactly the shape that gets an IP throttled.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/* ── Daum: USD/KRW ─────────────────────────────────────────────────── */

// Same page-of-100 pattern as fundHistory, over the FX quote instead of a
// fund. Needed to bring the two HKEX legs (reported in USD) into won.
async function usdKrwHistory(from) {
  const out = {};
  for (let page = 1; page <= 40; page++) {
    const json = await daumJson(`https://finance.daum.net/api/exchanges/FRX.KRWUSD/days?symbolCode=FRX.KRWUSD&page=${page}&perPage=100&pagination=true`);
    const rows = json.data ?? [];
    for (const r of rows) {
      const day = String(r.date ?? '').slice(0, 10);
      if (!day || day < from) continue;
      if (Number.isFinite(r.basePrice)) out[day] = r.basePrice;
    }
    const oldest = String(rows[rows.length - 1]?.date ?? '').slice(0, 10);
    if (rows.length < 100 || (oldest && oldest < from)) break;
  }
  return out;
}

/* ── HKEXnews: CSOP single-stock 2× notes (7709, 7747) ────────────────── */

// stockId is HKEXnews' internal identifier, not the ticker — resolved once via
// GET /search/prefix.do?type=A&name=07709&market=SEHK and stable thereafter.
const HKEX_FUNDS = [
  { code: '7709', stockId: 1000276797, name: 'CSOP SK Hynix 2× (HK)' },
  { code: '7747', stockId: 1000260078, name: 'CSOP Samsung Electronics 2× (HK)' },
];
// CSOP's daily workbook is filed once per issuer, not once per product — the
// filing found under 7709/7747's stockIds is titled "7747, 7347, 7709 NEWS"
// and already carries a 7347 column, so the inverse leg needs no stockId of
// its own to search by (HKEXnews' /search/prefix.do lookup used to resolve
// stockId is Akamai-gated to real browser sessions; reusing an existing
// stockId sidesteps that entirely).
const HKEX_REVERSE_FUNDS = [
  { code: '7347', name: 'CSOP Samsung Electronics -2× (HK)' },
];
const HKEX_HOST = 'https://www1.hkexnews.hk';
const HKEX_SEARCH = `${HKEX_HOST}/search/titleSearchServlet.do`;

// Only the daily "Trading Information of Leveraged & Inverse Products"
// workbook carries AUM; everything else this search turns up (prospectuses,
// monthly returns, listing announcements) is a PDF.
async function hkexFilings(stockId, from, to) {
  const q = new URLSearchParams({
    sortDir: '0', sortByOptions: 'DateTime', category: '0', market: 'SEHK',
    stockId: String(stockId), documentType: '-1',
    fromDate: compact(from), toDate: compact(to),
    title: '', searchType: '1', t1code: '-2', t2Gcode: '-2', t2code: '-2',
    rowRange: '2000', lang: 'E',
  });
  const res = await fetch(`${HKEX_SEARCH}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HKEXnews search HTTP ${res.status}`);
  const json = await res.json();
  const rows = JSON.parse(json.result ?? '[]');
  return rows.filter(r => r.FILE_TYPE === 'XLSX' && r.FILE_LINK);
}

// One workbook carries every CSOP L&I product live that day, laid out as a
// label-keyed grid — read rows by their label rather than a fixed position,
// since HKEX appends footnote markers ("(Note 7(b))") to labels without
// warning between filings. The AUM figure sits in the same column as the
// stock code it belongs to; the currency it's quoted in is one column left.
function parseHkexWorkbook(buffer, codes) {
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return {};
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  const findRow = label => rows.find(r => String(r?.[0] ?? '').trim().startsWith(label));
  const codeRow = findRow('Stock Code');
  const dateRow = findRow('Date (ddmmmyyyy)');
  const aumRow = findRow('Asset Under Management (L&I Product Total)');
  if (!codeRow || !dateRow || !aumRow) return {};

  const out = {};
  codeRow.forEach((cell, i) => {
    const code = String(cell ?? '').trim();
    if (!codes.has(code)) return;
    const dateCell = dateRow[i];
    const day = dateCell instanceof Date && Number.isFinite(dateCell.getTime())
      ? dateCell.toISOString().slice(0, 10) : null;
    const currency = aumRow[i - 1];
    const aum = Number(aumRow[i]);
    if (day && currency === 'USD' && Number.isFinite(aum) && aum > 0) out[code] = { day, aumUsd: aum };
  });
  return out;
}

// Daily AUM in USD for all three HK legs (both long funds plus the reverse
// leg) back to `from`. They share one workbook per issuer, but are searched
// by whichever stockIds are known and the results de-duped by filing, so a
// fund with no stockId of its own (the reverse leg) still gets picked up as
// long as its column shows up in a filing found via the others.
async function hkexFundHistory(from) {
  const to = iso(new Date());
  const allFunds = [...HKEX_FUNDS, ...HKEX_REVERSE_FUNDS];
  const codes = new Set(allFunds.map(f => f.code));
  const stockIds = [...new Set(allFunds.map(f => f.stockId).filter(Boolean))];

  const filingLists = await Promise.all(stockIds.map(id => hkexFilings(id, from, to).catch(e => {
    console.warn(`[koreaLeverage] HKEXnews search ${id}: ${e.message}`);
    return [];
  })));
  const filings = new Map();
  filingLists.flat().forEach(r => filings.set(r.FILE_LINK, r));

  const out = {};
  allFunds.forEach(f => { out[f.code] = {}; });

  await mapPool([...filings.values()], 4, async row => {
    try {
      const res = await fetch(`${HKEX_HOST}${row.FILE_LINK}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return;
      const buffer = Buffer.from(await res.arrayBuffer());
      const parsed = parseHkexWorkbook(buffer, codes);
      for (const [code, { day, aumUsd }] of Object.entries(parsed)) out[code][day] = aumUsd;
    } catch (e) {
      console.warn(`[koreaLeverage] HKEXnews workbook ${row.FILE_LINK}: ${e.message}`);
    }
  });
  return out;   // { '7709': { day: aumUsd }, '7747': { day: aumUsd }, '7347': { day: aumUsd } }
}

/* ── GraniteShares: SKDD (US-listed, SK Hynix ADR inverse 2×) ─────────── */

const SKDD_PAGE = 'https://graniteshares.com/etfs/skdd/';

// GraniteShares publishes each day's holdings workbook at a CMS-assigned path
// that isn't predictable from the date alone (e.g. /media/khapjiqj/skdd_holdings_
// file_20260715.xls) — the only stable way to find today's file is to scrape the
// fund page for its current "Download Holdings" link. The file itself follows a
// standard administrator layout (Position Date / Shares Outstanding / NAV per
// Share repeated on every holding row), so net assets = shares outstanding ×
// NAV per share, read off whichever row has both populated.
async function skddFundHistory() {
  const res = await fetch(SKDD_PAGE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GraniteShares HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/href="(\/media\/[^"]*skdd_holdings_file_\d{8}\.xls)"/i);
  if (!match) throw new Error('GraniteShares holdings link not found');

  const fileRes = await fetch(`https://graniteshares.com${match[1]}`, {
    headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000),
  });
  if (!fileRes.ok) throw new Error(`GraniteShares holdings file HTTP ${fileRes.status}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error('GraniteShares holdings file has no sheet');
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const header = rows[0] ?? [];
  const dateCol = header.indexOf('Position Date');
  const sharesCol = header.indexOf('Shares Outstanding');
  const navCol = header.indexOf('NAV/Share');
  if (dateCol < 0 || sharesCol < 0 || navCol < 0) throw new Error('GraniteShares holdings file layout changed');

  const dataRow = rows.slice(1).find(r => Number(r[sharesCol]) > 0 && Number(r[navCol]) > 0);
  if (!dataRow) throw new Error('GraniteShares holdings file has no shares/NAV row');

  const dateCell = dataRow[dateCol];
  const day = dateCell instanceof Date && Number.isFinite(dateCell.getTime())
    ? dateCell.toISOString().slice(0, 10) : null;
  const aumUsd = Number(dataRow[sharesCol]) * Number(dataRow[navCol]);
  if (!day || !Number.isFinite(aumUsd)) throw new Error('GraniteShares holdings file unparseable');
  return { [day]: aumUsd };
}

/* ── History blob ──────────────────────────────────────────────────── */

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

const iso = d => d.toISOString().slice(0, 10);
const compact = day => day.replace(/-/g, '');

/**
 * Scrape the last `days` calendar days of all layers, merge into history, and
 * return the assembled series.
 *
 * days defaults to a month: enough to repair a gap after the site was asleep,
 * small enough to stay a light daily poll. The backfill script passes ~400.
 */
async function getKoreaLeverage(days = 30) {
  const today = new Date();
  const start = new Date(today.getTime() - days * 86400000);
  const from = iso(start);

  const [credit, domesticUniverse, hkexAum, usdKrw, skddAumUsd] = await Promise.all([
    kofiaCredit(compact(from), compact(iso(today))),
    leverageUniverse(),
    hkexFundHistory(from).catch(e => {
      console.warn(`[koreaLeverage] HKEXnews unavailable (${e.message}) — HK legs will carry forward`);
      return {};
    }),
    usdKrwHistory(from).catch(e => {
      console.warn(`[koreaLeverage] USD/KRW unavailable (${e.message}) — HK legs will carry forward`);
      return {};
    }),
    skddFundHistory().catch(e => {
      console.warn(`[koreaLeverage] GraniteShares SKDD unavailable (${e.message}) — SKDD will carry forward`);
      return {};
    }),
  ]);

  const { funds: domesticFunds, reverseFunds: domesticReverseFunds } = domesticUniverse;
  const domesticSeries = await mapPool(domesticFunds, 4, f => fundHistory(f.code, from));
  const domesticReverseSeries = await mapPool(domesticReverseFunds, 4, f => fundHistory(f.code, from));

  // Fold the HK and US legs into the same shape as the domestic funds: USD AUM
  // × that day's USD/KRW rate (or the last known rate, if their trading
  // calendars don't line up with Korea's on a given day), in 조원 like
  // everything else in the layer.
  const fxDays = Object.keys(usdKrw).sort();
  const fxOnOrBefore = day => {
    let rate = null;
    for (const d of fxDays) {
      if (d > day) break;
      rate = usdKrw[d];
    }
    return rate;
  };
  const toKrwSeries = byDay => {
    const out = {};
    for (const [day, aumUsd] of Object.entries(byDay)) {
      const rate = fxOnOrBefore(day);
      if (Number.isFinite(rate)) out[day] = (aumUsd * rate) / TRILLION;
    }
    return out;
  };
  const hkexSeries = HKEX_FUNDS.map(f => toKrwSeries(hkexAum[f.code] ?? {}));
  const hkexReverseSeries = HKEX_REVERSE_FUNDS.map(f => toKrwSeries(hkexAum[f.code] ?? {}));
  const skddSeries = toKrwSeries(skddAumUsd);

  const funds = [...domesticFunds, ...HKEX_FUNDS.map(f => ({ code: f.code, name: f.name, kind: 'hk' }))];
  const fundSeries = [...domesticSeries, ...hkexSeries];

  const reverseFunds = [
    ...domesticReverseFunds,
    ...HKEX_REVERSE_FUNDS.map(f => ({ code: f.code, name: f.name, kind: 'hk-reverse' })),
    { code: 'SKDD', name: 'GraniteShares SK Hynix -2× (US)', kind: 'us-reverse' },
  ];
  const reverseSeries = [...domesticReverseSeries, ...hkexReverseSeries, skddSeries];

  const history = loadHistory();
  const days_ = new Set([
    ...Object.keys(credit.margin), ...Object.keys(credit.collateral),
    ...fundSeries.flatMap(s => Object.keys(s)),
    ...reverseSeries.flatMap(s => Object.keys(s)),
  ]);

  for (const day of days_) {
    const prev = history[day] ?? {};
    const perFund = {};
    funds.forEach((f, i) => {
      const aum = fundSeries[i][day];
      if (Number.isFinite(aum)) perFund[f.code] = round(aum);
    });
    const perReverseFund = {};
    reverseFunds.forEach((f, i) => {
      const aum = reverseSeries[i][day];
      if (Number.isFinite(aum)) perReverseFund[f.code] = round(aum);
    });
    const etfDay = Object.keys(perFund).length
      ? round(Object.values(perFund).reduce((a, b) => a + b, 0))
      : prev.etf;
    const reverseEtfDay = Object.keys(perReverseFund).length
      ? round(Object.values(perReverseFund).reduce((a, b) => a + b, 0))
      : prev.reverseEtf;

    history[day] = {
      ...prev,
      ...(Number.isFinite(credit.margin[day])     ? { margin:     round(credit.margin[day])     } : {}),
      ...(Number.isFinite(credit.collateral[day]) ? { collateral: round(credit.collateral[day]) } : {}),
      ...(Number.isFinite(etfDay) ? { etf: etfDay, funds: { ...(prev.funds ?? {}), ...perFund } } : {}),
      ...(Number.isFinite(reverseEtfDay) ? {
        reverseEtf: reverseEtfDay,
        reverseFunds: { ...(prev.reverseFunds ?? {}), ...perReverseFund },
      } : {}),
    };
  }
  // Names live alongside the series so a read-only assemble (no scrape) can
  // still label the fund table.
  history.names = Object.fromEntries(funds.map(f => [f.code, { name: f.name, kind: f.kind }]));
  history.reverseNames = Object.fromEntries(
    reverseFunds.map(f => [f.code, { name: f.name, kind: f.kind }]),
  );
  saveHistory(history);

  return assemble(history, funds);
}

function round(v) { return Math.round(v * 100) / 100; }

// The scraper's current universe — see DOMESTIC_CODES and HKEX_FUNDS above.
// Stored history can still carry fund codes an earlier version of this
// scraper wrote (TIGER's KOSPI200 2×, the smaller single-stock funds);
// carrying those forward alongside today's universe would double-count the
// layer against the redefinition, so assemble() ignores anything outside it.
const ETF_UNIVERSE = new Set([...DOMESTIC_CODES, ...HKEX_FUNDS.map(f => f.code)]);
const REVERSE_ETF_UNIVERSE = new Set([
  ...DOMESTIC_REVERSE_CODES,
  ...HKEX_REVERSE_FUNDS.map(f => f.code),
  'SKDD',
]);

function carriedFundTotals(history, dates, field, universe) {
  const totals = {};
  const lastAum = {};
  for (const day of dates) {
    for (const [code, aum] of Object.entries(history[day]?.[field] ?? {})) {
      if (universe.has(code) && Number.isFinite(aum)) lastAum[code] = aum;
    }
    const codes = Object.keys(lastAum);
    if (codes.length) totals[day] = round(codes.reduce((sum, code) => sum + lastAum[code], 0));
  }
  return { totals, lastAum };
}

/**
 * Turn the history blob into the payload the Leverage page draws.
 *
 * KOFIA lags the ETF layer by 1–3 days, so the newest days would otherwise show
 * a stack that collapses to just the ETF layer. Those trailing days carry the
 * last published value forward and are named in `carriedFrom` so the page can
 * say so rather than quietly implying the money moved.
 */
function assemble(history, funds = []) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const layers = { collateral: [], margin: [], etf: [] };
  const last = {};
  const carried = { collateral: null, margin: null, etf: null };

  // Rebuild the ETF layer fund-by-fund rather than trusting the stored daily
  // total: if a fund is missing from a day's scrape, summing only the funds that
  // did report invents a drop in the layer that is really a data gap. Carry each
  // fund's own last value, and count a fund only from the day it first appears —
  // so a fund that hasn't listed yet reads as absent, not as zero.
  const { totals: etfByDay, lastAum } = carriedFundTotals(history, dates, 'funds', ETF_UNIVERSE);
  const { totals: reverseEtfByDay, lastAum: lastReverseAum } = carriedFundTotals(
    history,
    dates,
    'reverseFunds',
    REVERSE_ETF_UNIVERSE,
  );

  for (const day of dates) {
    for (const key of Object.keys(layers)) {
      const v = key === 'etf' ? etfByDay[day] : history[day]?.[key];
      if (Number.isFinite(v)) { last[key] = v; carried[key] = null; }
      else if (Number.isFinite(last[key]) && carried[key] == null) carried[key] = day;
      layers[key].push(Number.isFinite(last[key]) ? last[key] : null);
    }
  }

  const total = dates.map((_, i) =>
    ['collateral', 'margin', 'etf'].reduce((s, k) => s + (layers[k][i] ?? 0), 0));
  const reverseEtf = dates.map(day => reverseEtfByDay[day] ?? null);

  // Latest per-fund breakdown, biggest first — the tiles above the chart. Uses
  // each fund's last known value, matching how the layer itself is summed.
  const lastDay = [...dates].reverse().find(d => history[d]?.funds);
  const byName = { ...(history.names ?? {}), ...Object.fromEntries(funds.map(f => [f.code, f])) };
  const fundRows = Object.entries(lastAum)
    .map(([code, aum]) => ({ code, name: byName[code]?.name ?? code, kind: byName[code]?.kind ?? 'single', aum: round(aum) }))
    .sort((a, b) => b.aum - a.aum);
  const lastReverseDay = [...dates].reverse().find(d => history[d]?.reverseFunds);
  const byReverseName = {
    ...(history.reverseNames ?? {}),
    ...Object.fromEntries(funds.filter(f => REVERSE_ETF_UNIVERSE.has(f.code)).map(f => [f.code, f])),
  };
  const reverseFundRows = Object.entries(lastReverseAum)
    .map(([code, aum]) => ({
      code,
      name: byReverseName[code]?.name ?? code,
      kind: byReverseName[code]?.kind ?? 'reverse-index',
      aum: round(aum),
    }))
    .sort((a, b) => b.aum - a.aum);

  return {
    dates,
    ...layers,
    reverseEtf,
    total: total.map(round),
    funds: fundRows,
    fundsDate: lastDay ?? null,
    reverseFunds: reverseFundRows,
    reverseFundsDate: lastReverseDay ?? null,
    // Days whose layer value is the previous publication carried forward.
    carriedFrom: carried,
    latest: {
      date: dates[dates.length - 1] ?? null,
      ...Object.fromEntries(Object.keys(layers).map(k => [k, layers[k][dates.length - 1] ?? null])),
      reverseEtf: reverseEtf[dates.length - 1] ?? null,
      total: round(total[total.length - 1] ?? 0),
    },
    updatedAt: new Date().toISOString(),
  };
}

// Read-only view of the stored history (no scrape) — used by the API route when
// the cache is warm and by anything that just wants the series.
function readKoreaLeverage() {
  return assemble(loadHistory());
}

module.exports = { getKoreaLeverage, readKoreaLeverage, _test: { assemble } };
