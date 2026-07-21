import { useEffect, useState } from 'react';
import { useOptionsReport } from '../../context/OptionsReportContext';
import EarningsCalendar from './Calendar';

// Sentinel `selected` value for the Calendar nav item — distinct from any
// ticker symbol so it can share the same sidebar list and selection state.
const CALENDAR_ID = '__calendar__';
const FLOW_DOT_COUNT = 3;
const CURRENT_BAR_COLORS = { call: '#059669', put: '#dc2626' };

const volumeFmt = new Intl.NumberFormat('en-US');

function textAttrs(raw) {
  return Object.fromEntries(
    [...raw.matchAll(/([:\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
  );
}

function parseShortVolume(text) {
  const match = String(text || '').trim().toLowerCase().match(/^([\d.]+)([km])?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === 'm') return Math.round(value * 1_000_000);
  if (match[2] === 'k') return Math.round(value * 1_000);
  return value;
}

function xKey(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : null;
}

function currentBarRowsFromSvg(svg, side) {
  const rows = [];
  const valuesByX = new Map();
  const chartColor = CURRENT_BAR_COLORS[side];

  for (const match of String(svg || '').matchAll(/<text\s+([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = textAttrs(match[1]);
    const text = match[2].trim();
    const key = xKey(attrs.x);
    if (!key) continue;

    if (!attrs['paint-order'] && /^\d{1,2}\/\d{1,2}$/.test(text)) {
      rows.push({ key, label: text });
      continue;
    }

    const volume = parseShortVolume(text);
    if (volume == null || attrs['paint-order'] !== 'stroke') continue;

    const isCurrentBarLabel = String(attrs.class || '').includes('vc-muted')
      || String(attrs.fill || '').toLowerCase() === chartColor;
    if (isCurrentBarLabel) valuesByX.set(key, volume);
  }

  return rows
    .map(row => ({ label: row.label, volume: valuesByX.get(row.key) }))
    .filter(row => row.volume != null);
}

// Call-put spread (calls minus puts) for a single day; null if volumes are missing.
function flowDiff(day) {
  const callVolume = Number(day?.callVolume);
  const putVolume = Number(day?.putVolume);
  if (!Number.isFinite(callVolume) || !Number.isFinite(putVolume)) return null;
  return callVolume - putVolume;
}

// Dot color reflects day-over-day change in the call-put spread, not the
// spread's sign: green if the spread widened toward calls since the prior
// day, red if it narrowed / flipped toward puts.
function flowDotSide(day) {
  if (!day || day.empty) return 'flat';
  const diff = flowDiff(day);
  const prevDiff = flowDiff(day.prevDay);
  if (diff == null) return 'flat';
  // Older reports sometimes have only rounded SVG labels available for the
  // fallback series. If the comparison is missing or rounds to unchanged, keep
  // the dot colored by the actual call/put skew instead of making a real data
  // point look like a no-data placeholder.
  if (prevDiff == null && diff !== 0) return diff > 0 ? 'call' : 'put';
  if (diff > prevDiff) return 'call';
  if (diff < prevDiff) return 'put';
  if (diff > 0) return 'call';
  if (diff < 0) return 'put';
  return day.leader === 'call' || day.leader === 'put' ? day.leader : 'flat';
}

function legacyFlowDays(flow) {
  if (!flow) return [];
  const days = [];
  if (flow.callYesterday != null || flow.putYesterday != null) {
    days.push({
      label: 'Prior day',
      callVolume: flow.callYesterday ?? 0,
      putVolume: flow.putYesterday ?? 0,
    });
  }
  if (flow.callToday != null || flow.putToday != null) {
    days.push({
      label: 'Latest day',
      callVolume: flow.callToday ?? 0,
      putVolume: flow.putToday ?? 0,
    });
  }
  return days;
}

function svgFlowDays(t) {
  const nearest = t.expirations?.[0];
  const callRows = currentBarRowsFromSvg(nearest?.callChartSvg, 'call');
  const putRows = currentBarRowsFromSvg(nearest?.putChartSvg, 'put');
  // Pull one extra day beyond what's shown so the earliest visible dot has a
  // prior day to diff against too — the chart itself has far more history
  // than FLOW_DOT_COUNT, we're just not displaying all of it.
  const count = Math.min(FLOW_DOT_COUNT + 1, callRows.length, putRows.length);
  if (!count) return [];

  const calls = callRows.slice(-count);
  const puts = putRows.slice(-count);
  return calls.map((call, index) => ({
    label: call.label || puts[index]?.label,
    callVolume: call.volume,
    putVolume: puts[index]?.volume ?? 0,
  }));
}

function navFlowDays(t) {
  // We show FLOW_DOT_COUNT sessions, but each dot is coloured by its day-over-day
  // change, so the earliest shown session needs the session before it as a buffer
  // — i.e. FLOW_DOT_COUNT + 1 days of source. Reports generated before that was
  // understood stored only FLOW_DOT_COUNT flowDays (no buffer), which left the
  // leftmost dot grey. The rendered chart SVG carries ~10 sessions of bars, so
  // parse it as an alternate series and use whichever source is longest: that
  // restores the buffer for older reports without needing them re-generated,
  // while still preferring the server's flowDays whenever it already has enough.
  const fromFlowDays = Array.isArray(t.flowDays) && t.flowDays.length
    ? [...t.flowDays].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    : [];
  const fromSvg = svgFlowDays(t);
  const source = fromFlowDays.length >= FLOW_DOT_COUNT + 1
    ? fromFlowDays
    : [fromSvg, fromFlowDays, legacyFlowDays(t.flow)]
      .reduce((best, cur) => (cur.length > best.length ? cur : best), []);

  const days = source.slice(-FLOW_DOT_COUNT);
  // Each day needs the session before it (which may fall outside the visible
  // window) so its dot can compare spreads across the day-over-day change.
  const startIndex = source.length - days.length;
  const withPrev = days.map((day, i) => ({ ...day, prevDay: source[startIndex + i - 1] }));
  return [
    ...Array.from({ length: Math.max(0, FLOW_DOT_COUNT - days.length) }, () => ({ empty: true })),
    ...withPrev,
  ];
}

function formatFlowDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function flowDotText(day, expiry) {
  if (day.empty) return 'No call/put flow data';
  const date = formatFlowDate(day.date) || day.label || 'Flow day';
  const callVolume = volumeFmt.format(Number(day.callVolume ?? 0));
  const putVolume = volumeFmt.format(Number(day.putVolume ?? 0));
  const expiryText = expiry ? `, ${expiry} expiry` : '';
  const diff = flowDiff(day);
  const prevDiff = flowDiff(day.prevDay);
  if (diff == null || prevDiff == null) {
    return `${date}${expiryText}: ${callVolume} calls vs ${putVolume} puts (no prior day to compare)`;
  }
  const change = diff > prevDiff
    ? 'spread widened toward calls'
    : diff < prevDiff
      ? 'spread narrowed toward puts'
      : 'spread unchanged';
  const prevCallVolume = volumeFmt.format(Number(day.prevDay.callVolume ?? 0));
  const prevPutVolume = volumeFmt.format(Number(day.prevDay.putVolume ?? 0));
  return `${date}${expiryText}: ${change} — ${callVolume} calls vs ${putVolume} puts `
    + `(prior day: ${prevCallVolume} vs ${prevPutVolume})`;
}

// One contract table (calls or puts). The side (CALL/PUT) and strike price get
// their own columns; all cells arrive pre-formatted from the server payload.
function ContractTable({ rows }) {
  return (
    <div className="or-table-wrap">
      <table className="or-table">
        <thead>
          <tr>
            <th>Side</th>
            <th>Price</th>
            <th>Today</th>
            <th>Yest.</th>
            <th>Δ DoD</th>
            <th>×5D</th>
            <th>Vol/OI</th>
            <th>IV</th>
            <th>Money</th>
          </tr>
        </thead>
        <tbody>
          {rows?.length ? rows.map((r, i) => {
            // Tolerate the older payload shape ({ contract: "CALL $435.00" })
            // until a fresh scrape replaces it with { side, strike }.
            const side = r.side || (/^\s*put/i.test(r.contract || '') ? 'put' : 'call');
            const strike = r.strike || (r.contract ? r.contract.replace(/^\s*(CALL|PUT)\s+/i, '') : '—');
            return (
            <tr key={`${strike}-${i}`}>
              <td className={`or-side-cell ${side === 'call' ? 'or-c-call' : 'or-c-put'}`}>{side.toUpperCase()}</td>
              <td className="or-strike">{strike}</td>
              <td>{r.today}</td>
              <td>{r.yesterday}</td>
              <td>{r.dod}</td>
              <td>{r.fiveDay}</td>
              <td>{r.volOi}</td>
              <td>{r.iv}</td>
              <td>{r.money}</td>
            </tr>
            );
          }) : (
            <tr><td className="or-empty" colSpan={9}>—</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Human-friendly report date: "2026-07-08" → "July 8, 2026".
function formatReportDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// The report date is the prominent heading in the Topbar; "Daily Options
// Report" sits beside it as a small label.
export function OptionsReportTitle() {
  const { report } = useOptionsReport();
  const dateLabel = report?.date ? formatReportDate(report.date) : null;
  return (
    <div className="or-title">
      <h1 className="or-title-date">{dateLabel || 'Daily Options Report'}</h1>
      {dateLabel && <span className="or-title-label">Daily Options Report</span>}
    </div>
  );
}

// Refresh / Download controls that replace the time-toggle buttons in the Topbar.
export function OptionsReportControls() {
  const { report, busy, refresh, download } = useOptionsReport();
  return (
    <>
      <button type="button" className="rbtn" onClick={refresh} disabled={busy}>
        {busy ? 'Refreshing…' : 'Refresh now'}
      </button>
      <button type="button" className="rbtn" onClick={download} disabled={!report}>
        Download PDF
      </button>
    </>
  );
}

// One ticker's full report body: price header plus a call/put block per tracked
// expiration. Shown one ticker at a time, selected from the sidebar.
function TickerReport({ t }) {
  return (
    <section className="or-ticker" key={t.ticker}>
      <header className="or-ticker-head">
        <h3>{t.ticker}</h3>
        <div className="or-ticker-price">
          <span>{t.priceText}</span>
          {t.change && <span className={t.priceChange >= 0 ? 'up' : 'down'}>{t.change}</span>}
        </div>
      </header>
      {t.expirations?.map(exp => (
        <div className="or-expiry" key={exp.selectedDate}>
          <div className="or-expiry-label">{exp.expiryLabel}</div>
          <div className="or-cols">
            <div className="or-col">
              <div className="or-chart" dangerouslySetInnerHTML={{ __html: exp.callChartSvg }} />
              <ContractTable rows={exp.tableCalls} />
            </div>
            <div className="or-col">
              <div className="or-chart" dangerouslySetInnerHTML={{ __html: exp.putChartSvg }} />
              <ContractTable rows={exp.tablePuts} />
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

// Sidebar entry for one ticker. The three dots show the last three sessions in
// the front expiration, left-to-right from earliest to latest. Each dot's
// color is the day-over-day change in the call-put volume spread: green if
// the spread grew more call-heavy than the prior day, red if it grew more
// put-heavy.
function TickerNavItem({ t, active, onSelect }) {
  const dots = navFlowDays(t);
  return (
    <button
      className={`or-nav-item${active ? ' active' : ''}`}
      onClick={() => onSelect(t.ticker)}
    >
      <span className="or-nav-name">{t.ticker}</span>
      <span className="or-nav-dots">
        {dots.map((day, index) => {
          const side = flowDotSide(day);
          const text = flowDotText(day, t.flowExpiration);
          return (
            <span
              key={`${day.date || day.label || 'empty'}-${index}`}
              className={`or-dot ${side}`}
              title={text}
              aria-label={text}
            />
          );
        })}
      </span>
    </button>
  );
}

// The Alerts view is the daily options report. Each ticker gets its own page,
// switched via the left sidebar. Title, date and action buttons live in the
// Topbar (see App.jsx). Data is scraped from Massive and stored in Mongo once a
// day at 6:00 AM Hong Kong time.
// SOXX is the semiconductor index ETF, not a company — it has no earnings
// call to rank by, so it's pinned above the date-sorted list rather than
// competing for a slot in it.
const PINNED_TICKER = 'SOXX';

export default function Alerts() {
  const { report, loading, msg, load } = useOptionsReport();
  const [selected, setSelected] = useState(null);
  const [calEvents, setCalEvents] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/alerts/earnings-calendar')
      .then(res => res.json())
      .then(json => { if (!cancelled) setCalEvents(json.events ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Sidebar order: SOXX pinned first, then every other ticker by how soon its
  // next earnings call is (today counts as the closest). Tickers whose call
  // already passed or isn't dated yet fall to the end, ranked by today's
  // total option volume — the previous default ordering — as a fallback.
  const tickers = (() => {
    const all = report?.tickers ?? [];
    const dateByTicker = new Map(calEvents.map(ev => [ev.ticker, ev.date]));
    const today = new Date().toISOString().slice(0, 10);
    const totalVolume = t => (t.flow?.callToday ?? 0) + (t.flow?.putToday ?? 0);

    const pinned = all.filter(t => t.ticker === PINNED_TICKER);
    const rest = all.filter(t => t.ticker !== PINNED_TICKER);
    rest.sort((a, b) => {
      const dateA = dateByTicker.get(a.ticker);
      const dateB = dateByTicker.get(b.ticker);
      const upcomingA = dateA >= today;
      const upcomingB = dateB >= today;
      if (upcomingA && upcomingB) return dateA < dateB ? -1 : dateA > dateB ? 1 : totalVolume(b) - totalVolume(a);
      if (upcomingA) return -1;
      if (upcomingB) return 1;
      return totalVolume(b) - totalVolume(a);
    });
    return [...pinned, ...rest];
  })();
  const query = search.trim().toUpperCase();
  const filteredTickers = query ? tickers.filter(t => t.ticker.includes(query)) : tickers;
  const showCalendar = selected === CALENDAR_ID;
  const active = showCalendar ? null : (tickers.find(t => t.ticker === selected) ?? tickers[0] ?? null);

  const searchToFirstMatch = () => {
    if (filteredTickers.length) setSelected(filteredTickers[0].ticker);
  };

  return (
    <div className="alerts-page">
      {msg?.kind === 'err' && (
        <div className="alerts-note err" style={{ marginBottom: 14, maxWidth: 'none' }}>{msg.text}</div>
      )}

      <div className="or-layout">
        <nav className="or-nav" aria-label="Tickers">
          <input
            type="text"
            className="or-nav-search"
            placeholder="Search ticker…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') searchToFirstMatch(); }}
            aria-label="Search tickers"
          />
          <button
            type="button"
            className={`or-nav-item or-nav-item--calendar${showCalendar ? ' active' : ''}`}
            onClick={() => setSelected(CALENDAR_ID)}
          >
            <span className="or-nav-name">Calendar</span>
          </button>
          {filteredTickers.length ? filteredTickers.map(t => (
            <TickerNavItem
              key={t.ticker}
              t={t}
              active={!showCalendar && t.ticker === active?.ticker}
              onSelect={setSelected}
            />
          )) : (
            <div className="or-nav-empty">No match for "{search.trim()}"</div>
          )}
        </nav>
        <div className="or-report">
          {showCalendar ? (
            <EarningsCalendar />
          ) : loading && !report ? (
            <div className="or-status">Loading the latest report…</div>
          ) : !active ? (
            <div className="or-status">
              No report has been generated yet. It builds automatically at 6:00 AM Hong Kong time — or click “Refresh now”.
            </div>
          ) : (
            <TickerReport t={active} />
          )}
        </div>
      </div>
    </div>
  );
}
