/**
 * Announced share buybacks — US, China A-share, and Taiwan.
 *
 * This tracks buybacks at the moment they are *announced*, not when the shares
 * are actually bought. Announcements are lumpy and event-driven (a board
 * authorizes a program, the market learns about it that day), so every market
 * is aggregated to calendar months of announced value in its own native
 * currency. No FX conversion happens anywhere — each market's panel is read
 * against its own history, the same way the leverage panels keep Korea in
 * KRW trillions and Taiwan in NT$ billions.
 *
 * Each market states "announced value" differently, so each needs its own
 * convention. All three are documented on the chart footnotes:
 *
 *   us   SEC EDGAR full-text search over 8-K filings mentioning a repurchase
 *        program, with the authorized dollar amount parsed out of the filing
 *        text. No free API publishes announced US buyback dollars, so this is
 *        the only route to the series. Deliberately conservative: a filing only
 *        counts when an amount is syntactically bound to a NEW authorization
 *        ("an additional $3 billion", "up to $500 million"), which drops both
 *        cumulative since-inception totals and unrelated balance-sheet figures
 *        that merely sit near the word "repurchase". Programs authorized as a
 *        share count rather than a dollar amount carry no dollar value at all;
 *        they are counted separately in `sharesOnly` and excluded from the
 *        total rather than guessed at via a share price.
 *
 *   cn   East Money's buyback-plan table (data.eastmoney.com/gphg). One row per
 *        announced plan, dated by DIM_DATE — the plan's announcement date,
 *        which stays fixed as the plan later progresses (UPDATEDATE tracks
 *        that). A-share plans state an explicit ¥ range, so the announced value
 *        is the ceiling, with the floor kept alongside it.
 *
 *   tw   MOPS treasury-stock summary (公開資訊觀測站 t35sc09), both the TWSE
 *        (sii) and TPEx (otc) boards. Taiwan filings state a planned share
 *        count and a price band rather than a total, so announced value is
 *        planned shares × the top of the band — the "up to" figure. Dated by
 *        董事會決議日期, the board-resolution date the announcement refers to.
 *
 * A market is counted at announcement regardless of what happens later: a plan
 * that is subsequently cancelled, or only partly executed, still announced the
 * amount it announced on the day it announced it. That keeps the series a clean
 * measure of announced intent rather than a revision-prone execution estimate.
 */
'use strict';

const path = require('path');
const storage = require('../storage');

const BLOB = 'buybackHistory';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'buybackHistory.json');

const MARKETS = ['us', 'cn', 'tw'];

const SEC_UA = 'signal-dashboard/1.0 research contact: ashley_hu1@brown.edu';
const SEC_CONCURRENCY = 4;
const EASTMONEY_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
const EASTMONEY_SOURCE = 'https://data.eastmoney.com/gphg/';
const MOPS_URL = 'https://mopsov.twse.com.tw/mops/web/ajax_t35sc09';
const MOPS_SOURCE = 'https://mopsov.twse.com.tw/mops/web/t35sc09';

// Scales every retry/pacing delay. Tests set it to 0 so the throttle-handling
// paths can be exercised without actually waiting out the backoff.
let delayScale = 1;
const sleep = ms => (ms * delayScale <= 0
  ? Promise.resolve()
  : new Promise(resolve => setTimeout(resolve, ms * delayScale)));
const monthOf = iso => String(iso ?? '').slice(0, 7);
const round = (value, places) => {
  const k = 10 ** places;
  return Math.round(value * k) / k;
};

/** Run `worker` over `items` with at most `limit` in flight. Order is preserved. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); }
      catch { results[index] = null; }
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchWithRetry(url, options = {}, tries = 3, timeoutMs = 30000) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), ...options });
      if (response.status === 429 || response.status === 503) {
        // SEC throttles hard and stays throttled: a 1.5s bump is not enough to
        // clear it, and giving up here is worse than waiting, because the caller
        // would record the resulting gap as a real zero.
        const retryAfter = Number(response.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(60000, 5000 * 2 ** (attempt - 1));
        if (attempt < tries) { await sleep(wait); continue; }
        throw new Error(`HTTP ${response.status} (rate limited)`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < tries) await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

/* ── 1. US — SEC EDGAR 8-K repurchase announcements ───────────────── */

const SCALE = { billion: 1e9, bn: 1e9, million: 1e6, mm: 1e6, thousand: 1e3 };
const NUM = String.raw`\$\s?([\d][\d,]*(?:\.\d+)?)\s*(billion|million|bn|mm|thousand)?`;

// Ordered by specificity. The amount has to be syntactically bound to a new
// authorization; a bare dollar figure sitting near the word "repurchase" is not
// enough, because 8-K press releases routinely quote assets, revenue, and
// lifetime buyback totals in the same paragraph.
const PATTERNS = [
  [1, new RegExp(String.raw`additional\s+${NUM}`, 'i')],
  [1, new RegExp(String.raw`increas\w+\s+(?:[^.]{0,80}?\s)?by\s+${NUM}`, 'i')],
  [1, new RegExp(String.raw`${NUM}\s+(?:increase|addition)\s+(?:to|in)\b`, 'i')],
  [2, new RegExp(String.raw`(?:repurchase|buy\s?back)[^.]{0,80}?up\s+to\s+${NUM}`, 'i')],
  [2, new RegExp(String.raw`up\s+to\s+${NUM}[^.]{0,80}?(?:repurchase|buy\s?back|common stock|ordinary shares|class\s+[ab]\s+)`, 'i')],
  [3, new RegExp(String.raw`${NUM}\s+(?:share\s+|stock\s+|common\s+stock\s+|securities\s+)?(?:repurchase|buy\s?back)\s+(?:program|plan|authoriz\w+)`, 'i')],
  [3, new RegExp(String.raw`(?:repurchase|buy\s?back)\s+(?:program|plan|authoriz\w+)[^.]{0,60}?(?:of|for|totaling|totalling|in an aggregate amount of)\s+(?:up to\s+)?${NUM}`, 'i')],
  [4, new RegExp(String.raw`aggregate\s+(?:purchase\s+)?(?:price|amount|value)\s+of\s+(?:up\s+to\s+)?${NUM}`, 'i')],
];

// A cumulative total or balance-sheet figure is rejected only when the marker is
// bound to *this* amount, so "an additional $1.5 billion ... bringing the total
// to $42.2 billion since 1998" keeps the $1.5bn increment and drops the $42.2bn.
const REJECT_AFTER = new RegExp(
  String.raw`^\W{0,12}(?:since\s+(?:19|20)\d{2}|in\s+(?:total\s+)?assets|of\s+total\s+assets`
  + String.raw`|in\s+(?:annual\s+)?(?:revenue|sales)|in\s+market\s+cap)`, 'i');
const REJECT_BEFORE = new RegExp(
  String.raw`(?:bringing|brings|raising)\s+the\s+total\s+(?:to|authorization to)?\s*$`
  + String.raw`|to\s+a\s+total\s+of\s*$|cumulativ\w*\s+(?:total\s+)?(?:of\s+)?$`
  + String.raw`|since\s+inception[^.]{0,20}$`, 'i');
const NEW_AUTH = /\b(announc|approv|authoriz|adopt|initiat|increas|expand|establish|renew)/i;
const REPURCHASE = /repurchas|buy\s?back/i;
const SHARES_ONLY = /up\s+to\s+[\d,]{5,}\s+shares/i;

function stripHtml(html) {
  let text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (const [entity, replacement] of [
    [/&#x201C;|&#x201D;|&#8220;|&#8221;/g, '"'],
    [/&nbsp;|&#160;/g, ' '],
    [/&amp;/g, '&'],
  ]) text = text.replace(entity, replacement);
  return text.replace(/\s+/g, ' ');
}

/** Dollar value of a newly announced repurchase authorization, if the filing states one. */
function extractAmount(text) {
  let best = null; // [priority, position, value]
  for (const [priority, pattern] of PATTERNS) {
    const global = new RegExp(pattern.source, 'gi');
    let match;
    while ((match = global.exec(text)) !== null) {
      const unit = (match[2] ?? '').toLowerCase();
      if (!unit) continue;                        // a bare "$500" is a price, not a program
      const value = Number(match[1].replace(/,/g, '')) * SCALE[unit];
      if (!Number.isFinite(value) || value < 1e6 || value > 2e11) continue;

      const start = match.index;
      const end = start + match[0].length;
      const window = text.slice(Math.max(0, start - 220), Math.min(text.length, end + 220));
      if (!REPURCHASE.test(window)) continue;
      if (!NEW_AUTH.test(window)) continue;
      if (REJECT_AFTER.test(text.slice(end, end + 40))) continue;
      if (REJECT_BEFORE.test(text.slice(Math.max(0, start - 45), start))) continue;

      if (!best || priority < best[0] || (priority === best[0] && start < best[1])) {
        best = [priority, start, value];
      }
    }
  }
  if (best) return { amount: best[2], sharesOnly: false };
  return { amount: null, sharesOnly: SHARES_ONLY.test(text) && REPURCHASE.test(text) };
}

const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

async function searchEdgar(start, end) {
  const query = encodeURIComponent('"repurchase program"');
  const hits = [];
  // Busy months (post-Q4 and post-Q1 earnings) run 600–750 matched documents;
  // the ceiling is well clear of that so a heavy month is never silently cut.
  for (let from = 0; from < 2000; from += 100) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${query}&forms=8-K`
      + `&startdt=${start}&enddt=${end}&from=${from}`;
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': SEC_UA } });
    const json = await response.json();
    const page = json?.hits?.hits ?? [];
    hits.push(...page);
    const total = json?.hits?.total?.value ?? 0;
    if (from + 100 >= total || !page.length) break;
    await sleep(120);
  }
  return hits;
}

/**
 * One month of US announced buybacks. Amounts are taken per company (the same
 * announcement is filed both as the 8-K body and as an exhibited press release,
 * and EDGAR indexes each document separately), so the month sums one figure per
 * announcing company rather than one per matched document.
 */
async function fetchUsMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const end = `${month}-${String(lastDayOf(year, monthNumber)).padStart(2, '0')}`;
  const hits = await searchEdgar(`${month}-01`, end);

  const seen = new Set();
  const documents = [];
  for (const hit of hits) {
    const [accession, document] = String(hit?._id ?? '').split(':');
    const cik = hit?._source?.ciks?.[0];
    if (!accession || !document || !cik || seen.has(hit._id)) continue;
    seen.add(hit._id);
    documents.push({ cik, accession, document });
  }

  // SEC asks for 10 requests/second and throttles the whole client once that is
  // crossed. Four workers each pausing 250ms lands near 6/s, leaving headroom.
  const parsed = await pool(documents, SEC_CONCURRENCY, async ({ cik, accession, document }) => {
    const url = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}`
      + `/${accession.replace(/-/g, '')}/${document}`;
    const response = await fetchWithRetry(url, { headers: { 'User-Agent': SEC_UA } }, 4);
    const result = extractAmount(stripHtml(await response.text()));
    await sleep(250);
    return { cik, ...result };
  });

  // A throttled month returns nothing but looks exactly like a quiet month, and
  // the backfill would store that zero and then skip the month as "already
  // done". Refuse to report a total that was built on missing documents.
  const failed = parsed.filter(row => !row).length;
  if (documents.length && failed / documents.length > 0.02) {
    throw new Error(`${failed}/${documents.length} filings could not be fetched `
      + `(likely rate limited) — refusing to record a partial ${month}`);
  }

  const byCompany = new Map();
  const sharesOnlyCompanies = new Set();
  for (const row of parsed) {
    if (!row) continue;
    if (row.amount) byCompany.set(row.cik, Math.max(byCompany.get(row.cik) ?? 0, row.amount));
    else if (row.sharesOnly) sharesOnlyCompanies.add(row.cik);
  }
  for (const cik of byCompany.keys()) sharesOnlyCompanies.delete(cik);

  let amount = 0;
  for (const value of byCompany.values()) amount += value;
  return { amount, count: byCompany.size, sharesOnly: sharesOnlyCompanies.size };
}

/* ── 2. China A-share — East Money buyback plans ──────────────────── */

async function fetchChinaPlans(sinceMonth) {
  const rows = [];
  for (let page = 1; page <= 40; page += 1) {
    const params = new URLSearchParams({
      reportName: 'RPTA_WEB_GETHGLIST_NEW', columns: 'ALL',
      pageNumber: String(page), pageSize: '500',
      sortColumns: 'DIM_DATE', sortTypes: '-1', source: 'WEB', client: 'WEB',
    });
    const response = await fetchWithRetry(`${EASTMONEY_URL}?${params}`, {
      headers: { referer: EASTMONEY_SOURCE, 'user-agent': 'Mozilla/5.0 Signal Buyback Dashboard' },
    });
    const json = await response.json();
    const page_rows = json?.result?.data ?? [];
    if (!page_rows.length) break;
    rows.push(...page_rows);
    const oldest = monthOf(page_rows[page_rows.length - 1]?.DIM_DATE);
    if (sinceMonth && oldest && oldest < sinceMonth) break;
    if (page >= (json?.result?.pages ?? 1)) break;
    await sleep(250);
  }
  return rows;
}

/**
 * Announced ¥ per month. A plan's headline number is its ceiling; when a plan
 * states only a share cap and a price cap, the two are multiplied to get the
 * same "up to" figure.
 */
function aggregateChina(rows, sinceMonth) {
  const months = {};
  const seen = new Set();
  for (const row of rows ?? []) {
    const month = monthOf(row?.DIM_DATE);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (sinceMonth && month < sinceMonth) continue;

    const key = `${row?.DIM_SCODE}:${String(row?.DIM_DATE).slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ceiling = Number(row?.REPURAMOUNTLIMIT);
    const shareCap = Number(row?.REPURNUMCAP);
    const priceCap = Number(row?.REPURPRICECAP);
    const amount = Number.isFinite(ceiling) && ceiling > 0
      ? ceiling
      : (Number.isFinite(shareCap) && Number.isFinite(priceCap) ? shareCap * priceCap : null);
    const floor = Number(row?.REPURAMOUNTLOWER);

    const bucket = months[month] ?? (months[month] = { amount: 0, floor: 0, count: 0 });
    bucket.count += 1;
    if (Number.isFinite(amount) && amount > 0) bucket.amount += amount;
    if (Number.isFinite(floor) && floor > 0) bucket.floor += floor;
  }
  return fillQuietMonths(months);
}

/* ── 3. Taiwan — MOPS treasury-stock filings ──────────────────────── */

const BOARDS = ['sii', 'otc'];

function rocToIso(value) {
  const match = String(value ?? '').trim().match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  return `${String(Number(match[1]) + 1911).padStart(4, '0')}-${match[2]}-${match[3]}`;
}

function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[,\s]|&nbsp;|&#160;/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Rows of the MOPS summary table. Columns are, in order: 序號, 公司代號,
 * 公司名稱, 董事會決議日期, 買回目的, 買回股份總金額上限(法定上限), 預定買回股數,
 * 價格區間最低, 價格區間最高, … The per-company 累計 subtotal rows are skipped so
 * each announcement is counted once.
 */
function parseTaiwanRows(html) {
  const rows = [];
  for (const block of String(html).match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (block.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [])
      .map(cell => cell.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim());
    if (cells.length < 10 || cells[0] === '累計') continue;

    const date = rocToIso(cells[3]);
    if (!date) continue;
    rows.push({
      date,
      code: cells[1],
      shares: toNumber(cells[6]),
      priceLow: toNumber(cells[7]),
      priceHigh: toNumber(cells[8]),
    });
  }
  return rows;
}

async function fetchTaiwanBoard(board) {
  const now = new Date();
  const yearMonth = `${now.getUTCFullYear() - 1911}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const response = await fetchWithRetry(MOPS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 Signal Buyback Dashboard',
      Referer: MOPS_SOURCE,
    },
    body: new URLSearchParams({
      encodeURIComponent: '1', step: '1', firstin: '1', off: '1',
      TYPEK: board, yearmonth: yearMonth,
    }).toString(),
    // MOPS has no per-month filter on this report — it returns every treasury-stock
    // filing since 1997 as one ~4 MB HTML table, which routinely takes over a
    // minute to render server-side.
  }, 3, 180000);
  return parseTaiwanRows(await response.text());
}

/** Announced NT$ per month: planned shares × the top of the announced price band. */
function aggregateTaiwan(rows, sinceMonth) {
  const months = {};
  const seen = new Set();
  for (const row of rows ?? []) {
    const month = monthOf(row?.date);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    if (sinceMonth && month < sinceMonth) continue;

    const key = `${row.code}:${row.date}:${row.shares}:${row.priceHigh}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const bucket = months[month] ?? (months[month] = { amount: 0, floor: 0, count: 0 });
    bucket.count += 1;
    if (row.shares > 0 && row.priceHigh > 0) bucket.amount += row.shares * row.priceHigh;
    if (row.shares > 0 && row.priceLow > 0) bucket.floor += row.shares * row.priceLow;
  }
  return fillQuietMonths(months);
}

/**
 * Write an explicit zero for every month inside the covered range that produced
 * no announcements. China and Taiwan come from complete filing tables, so a
 * month with no rows genuinely saw no buybacks announced — quiet, not missing.
 * Recording that as a real zero keeps "absent from storage" meaning exactly one
 * thing everywhere: never collected. (Taiwan has two such months since 2000:
 * 2010-01 and 2023-04.)
 */
function fillQuietMonths(months) {
  const keys = Object.keys(months).sort();
  if (!keys.length) return months;
  for (let month = keys[0]; month <= keys[keys.length - 1]; month = shiftMonth(month, 1)) {
    if (!months[month]) months[month] = { amount: 0, floor: 0, count: 0 };
  }
  return months;
}

/* ── History, refresh, and assembly ───────────────────────────────── */

function loadHistory() {
  const history = storage.read(BLOB, HISTORY_FILE);
  for (const market of MARKETS) history[market] = history[market] ?? {};
  return history;
}

/** Merge freshly computed months over stored ones; a month is replaced wholesale. */
function mergeMonths(history, market, months) {
  const target = history[market] ?? (history[market] = {});
  for (const [month, value] of Object.entries(months ?? {})) {
    if (!Number.isFinite(value?.amount)) continue;
    target[month] = {
      amount: round(value.amount, 0),
      count: value.count ?? 0,
      ...(value.floor ? { floor: round(value.floor, 0) } : {}),
      ...(value.sharesOnly ? { sharesOnly: value.sharesOnly } : {}),
    };
  }
  return history;
}

/** Shift a 'YYYY-MM' key by `delta` months. */
function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

function monthsAgo(count) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - count);
  return date.toISOString().slice(0, 7);
}

const MARKET_META = {
  us: {
    label: 'US', currency: 'USD', symbol: '$', unit: 'bn',
    srcLabel: 'SEC EDGAR 8-K filings',
    srcUrl: 'https://efts.sec.gov/LATEST/search-index',
  },
  cn: {
    label: 'China A-share', currency: 'CNY', symbol: '¥', unit: 'bn',
    srcLabel: 'East Money buyback plans',
    srcUrl: EASTMONEY_SOURCE,
  },
  tw: {
    label: 'Taiwan', currency: 'TWD', symbol: 'NT$', unit: 'bn',
    srcLabel: 'MOPS treasury-stock filings',
    srcUrl: MOPS_SOURCE,
  },
};

/** Shape one market's stored months into the arrays the chart consumes (values in billions). */
function assembleMarket(stored, market) {
  const present = Object.keys(stored ?? {}).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();

  // Emit a continuous month axis rather than only the months that happen to be
  // stored. A month that was never collected is a hole, not a zero, and letting
  // the axis silently close over it would draw two non-adjacent months side by
  // side as if nothing were missing. Holes carry null so the bar is absent and
  // the trailing line breaks, which is visible; a real zero stays zero.
  const months = [];
  for (let month = present[0]; month && month <= present[present.length - 1]; month = shiftMonth(month, 1)) {
    months.push(month);
  }

  const value = (m, field) => (stored?.[m] == null ? null : stored[m][field] ?? 0);
  const amount = months.map(m => (stored?.[m] == null ? null : round((stored[m].amount ?? 0) / 1e9, 4)));
  const floor = months.map(m => (stored?.[m]?.floor == null ? null : round(stored[m].floor / 1e9, 4)));
  const count = months.map(m => value(m, 'count'));
  const sharesOnly = months.map(m => value(m, 'sharesOnly'));

  // Trailing 12 *calendar* months, not the last 12 stored entries — a market
  // with a quiet month that recorded no announcements would otherwise reach an
  // extra month further back and overstate the running total.
  const lastIndex = months.length - 1;
  const cutoff = lastIndex < 0 ? null : shiftMonth(months[lastIndex], -11);
  const trailing12 = lastIndex < 0 ? 0 : months.reduce(
    (sum, month, index) => (month >= cutoff ? sum + (amount[index] ?? 0) : sum), 0,
  );
  return {
    ...MARKET_META[market],
    months, amount, floor, count, sharesOnly,
    latest: lastIndex < 0 ? null : {
      month: months[lastIndex],
      amount: amount[lastIndex],
      count: count[lastIndex],
      trailing12: round(trailing12, 4),
    },
  };
}

function assemble(history) {
  const payload = { updatedAt: new Date().toISOString() };
  for (const market of MARKETS) payload[market] = assembleMarket(history?.[market], market);
  return payload;
}

/** Storage-only read for the API route — never touches an upstream source. */
function readBuybacks() {
  return assemble(loadHistory());
}

/**
 * Scheduled refresh. China and Taiwan are cheap enough to re-derive over a wide
 * trailing window (Taiwan's endpoint only serves the whole table anyway), while
 * the US path fetches every matching 8-K document and so is held to the two
 * months that can still be moving.
 */
async function getBuybacks({ usMonths = 2, cnMonths = 6 } = {}) {
  const history = loadHistory();
  const failures = [];

  const usTargets = [];
  for (let back = usMonths - 1; back >= 0; back -= 1) usTargets.push(monthsAgo(back));
  for (const month of usTargets) {
    try { mergeMonths(history, 'us', { [month]: await fetchUsMonth(month) }); }
    catch (error) { failures.push(`us ${month}: ${error.message}`); }
  }

  try {
    const since = monthsAgo(cnMonths - 1);
    mergeMonths(history, 'cn', aggregateChina(await fetchChinaPlans(since), since));
  } catch (error) { failures.push(`cn: ${error.message}`); }

  try {
    const rows = (await Promise.all(BOARDS.map(fetchTaiwanBoard))).flat();
    if (!rows.length) throw new Error('MOPS returned no rows');
    mergeMonths(history, 'tw', aggregateTaiwan(rows));
  } catch (error) { failures.push(`tw: ${error.message}`); }

  storage.write(BLOB, HISTORY_FILE, history);
  // One market going down shouldn't blank the other two — the scheduler treats a
  // throw as a failed scrape and would leave the whole payload stale. Only a
  // total wipeout is worth failing the run.
  const attempts = usTargets.length + 2;
  if (failures.length >= attempts) {
    throw new Error(`all buyback sources failed: ${failures.join('; ')}`);
  }
  if (failures.length) console.warn('[buybacks] partial refresh:', failures.join('; '));
  return assemble(history);
}

module.exports = {
  getBuybacks,
  readBuybacks,
  _test: {
    extractAmount, stripHtml, aggregateChina, aggregateTaiwan, parseTaiwanRows,
    rocToIso, assembleMarket, mergeMonths, fetchUsMonth, fetchChinaPlans, fetchTaiwanBoard,
    loadHistory, BLOB, HISTORY_FILE,
    setDelayScale: scale => { delayScale = scale; },
  },
};
