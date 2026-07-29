/**
 * KOSPI net buying by investor type — who bought and who sold each session, in
 * 조원 (trillion won), one point per trading day.
 *
 *   individual   개인      retail
 *   foreign      외국인    foreign investors
 *   institution  기관계    institutions (brokers' prop desks, insurers,
 *                         investment trusts, banks, other financials, pensions)
 *   otherCorp    기타법인  non-financial corporates — the small residual
 *
 * Net buying is zero-sum by construction: every won bought is a won sold, so
 * the four groups above sum to exactly zero on every session. That identity is
 * asserted per row at parse time (see ROW_TOLERANCE) — it is the strongest
 * available check that a row was read off the right columns, which matters
 * because the source is an HTML table with a two-level header.
 *
 * Source — KRX publishes this series itself, but its statistics API
 * (data.krx.co.kr .../getJsonData.cmd, bld dbms/MDC/STAT/standard/MDCSTAT022xx)
 * now answers "LOGOUT" to anonymous callers; only the login-free main-page blds
 * still respond, and those carry the current session only, with no history.
 * Naver Finance republishes the identical daily table with ~8 years of
 * pagination and no key or login. Cross-checked against KRX's own main-page
 * figures (MDCMAIN00103_en) for 2026-07-29: individuals −1.970조, foreigners
 * −1.234조, institutions +3.160조 — exact agreement.
 *
 * Naver serves 억원 (hundred-million won) and EUC-KR bytes; both are normalized
 * here so callers only ever see 조원 and UTF-8. Ten sessions per page, newest
 * first, so a `days` window costs about days/14 requests.
 */
const path = require('path');
const storage = require('../storage');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'koreaInvestorFlowHistory.json');
const BLOB = 'koreaInvestorFlowHistory';

const URL = 'https://finance.naver.com/sise/investorDealTrendDay.naver';
const KOSPI = '01';   // sosok: 01 = KOSPI, 02 = KOSDAQ
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const OKU_PER_JO = 1e4;   // 1조원 = 10,000억원
// ~8 years of sessions at ten per page, well past the deepest backfill anyone
// would ask for, so fetchWindow stays bounded even if a parse break makes every
// page look non-empty.
const MAX_PAGES = 260;
// Rounding of each published column is the only reason a row should miss zero.
// Columns are whole 억원, four of them, so ±4억 (0.0004조) is the honest bound;
// allow a hair more and treat anything past it as a misread row.
const ROW_TOLERANCE = 0.001;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── Naver ─────────────────────────────────────────────────────────── */

// bizdate anchors the listing to the newest session on or before it; without it
// the table comes back structurally intact but with zero data rows, so it is
// required, not optional. A date past the last session clamps down to it, which
// makes "today in Seoul" always safe — including before the session has posted.
// It is resolved once per crawl so page numbers stay stable while paging back.
async function fetchPage(page, bizdate) {
  const res = await fetch(`${URL}?bizdate=${bizdate}&sosok=${KOSPI}&page=${page}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://finance.naver.com/sise/' },
  });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status} (page ${page})`);
  return new TextDecoder('euc-kr').decode(await res.arrayBuffer());
}

/** Today's date in Seoul (KST = UTC+9), as yyyymmdd. */
function seoulToday() {
  const kst = new Date(Date.now() + 9 * 3600000);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

// The table's header is two rows deep — 기관계 is followed by six 기관 subcolumns
// before 기타법인 closes the row — so columns are taken by position off the date
// cell rather than by matching header text.
const ROW_RE = /<td class="date2">\s*(\d{2})\.(\d{2})\.(\d{2})\s*<\/td>((?:\s*<td[^>]*>[^<]*<\/td>)+)/g;
const CELL_RE = /<td[^>]*>([^<]*)<\/td>/g;

const COLUMNS = ['individual', 'foreign', 'institution', null, null, null, null, null, null, 'otherCorp'];

function parseRows(html) {
  const rows = [];
  for (const match of html.matchAll(ROW_RE)) {
    const [, yy, mm, dd] = match;
    const cells = [...match[4].matchAll(CELL_RE)]
      .map(cell => Number(cell[1].replace(/[,\s]/g, '')));
    if (cells.length !== COLUMNS.length) continue;
    if (cells.some(value => !Number.isFinite(value))) continue;

    const row = { date: `20${yy}-${mm}-${dd}` };
    COLUMNS.forEach((key, index) => {
      if (key) row[key] = round(cells[index] / OKU_PER_JO);
    });

    // Zero-sum identity — see the header note.
    const residual = row.individual + row.foreign + row.institution + row.otherCorp;
    if (Math.abs(residual) > ROW_TOLERANCE) {
      console.warn(`[koreaInvestorFlow] ${row.date} net buying sums to ${residual.toFixed(4)}조, not 0 — skipping row`);
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Page back through Naver until the oldest row on a page predates `from`.
 *
 * Pages are fixed-size and ordered newest-first with no date parameter, so the
 * window is walked rather than queried. A page that yields no parsable rows
 * means the history has run out (or the markup moved) — stop rather than page
 * forever.
 */
async function fetchWindow(from) {
  const bizdate = seoulToday();
  const byDate = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = parseRows(await fetchPage(page, bizdate));
    if (!rows.length) break;
    for (const row of rows) byDate.set(row.date, row);
    if (rows[rows.length - 1].date <= from) break;
    await sleep(120);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function round(v) { return Math.round(v * 1e4) / 1e4; }

function iso(d) { return d.toISOString().slice(0, 10); }

/* ── History ───────────────────────────────────────────────────────── */

function loadHistory() { return storage.read(BLOB, HISTORY_FILE); }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

const SERIES = ['individual', 'foreign', 'institution', 'otherCorp'];

/** Turn the history blob into the payload the page draws. */
function assemble(history) {
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const series = Object.fromEntries(SERIES.map(key => [
    key,
    dates.map(day => (Number.isFinite(history[day]?.[key]) ? history[day][key] : null)),
  ]));
  const last = dates[dates.length - 1] ?? null;

  return {
    dates,
    ...series,
    latest: {
      date: last,
      ...Object.fromEntries(SERIES.map(key => [key, last ? history[last]?.[key] ?? null : null])),
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Scrape the last `days` calendar days, merge into history, and return the
 * assembled series.
 *
 * days defaults to a month: enough to repair a gap after the site was asleep,
 * small enough to stay a light daily poll (~3 requests). The backfill script
 * passes ~1830.
 */
async function getKoreaInvestorFlow(days = 30) {
  const from = iso(new Date(Date.now() - days * 86400000));
  const rows = await fetchWindow(from);
  if (!rows.length) throw new Error('Naver returned no parsable investor-flow rows');

  const history = loadHistory();
  for (const { date, ...values } of rows) history[date] = { ...history[date], ...values };
  saveHistory(history);

  return assemble(history);
}

// Read-only view of the stored history (no scrape) — used by the API route, so
// a cold or partial cache can never truncate the chart to the poll window.
function readKoreaInvestorFlow() {
  return assemble(loadHistory());
}

module.exports = {
  getKoreaInvestorFlow,
  readKoreaInvestorFlow,
  _test: { parseRows, assemble },
};
