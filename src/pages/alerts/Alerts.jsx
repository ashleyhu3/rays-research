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

function flowDotSide(day) {
  if (day?.leader === 'call' || day?.leader === 'put' || day?.leader === 'flat') return day.leader;
  const callVolume = Number(day?.callVolume);
  const putVolume = Number(day?.putVolume);
  if (!Number.isFinite(callVolume) || !Number.isFinite(putVolume)) return 'flat';
  if (callVolume > putVolume) return 'call';
  if (putVolume > callVolume) return 'put';
  return 'flat';
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
  const count = Math.min(FLOW_DOT_COUNT, callRows.length, putRows.length);
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
  let source;
  if (Array.isArray(t.flowDays) && t.flowDays.length) {
    source = [...t.flowDays].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  } else {
    const fromSvg = svgFlowDays(t);
    source = fromSvg.length ? fromSvg : legacyFlowDays(t.flow);
  }
  const days = source.slice(-FLOW_DOT_COUNT);
  return [
    ...Array.from({ length: Math.max(0, FLOW_DOT_COUNT - days.length) }, () => ({ empty: true })),
    ...days,
  ];
}

function formatFlowDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return `${Number(m[2])}/${Number(m[3])}`;
}

function flowDotText(day, expiry) {
  if (day.empty) return 'No call/put flow data';
  const side = flowDotSide(day);
  const date = formatFlowDate(day.date) || day.label || 'Flow day';
  const callVolume = volumeFmt.format(Number(day.callVolume ?? 0));
  const putVolume = volumeFmt.format(Number(day.putVolume ?? 0));
  const direction = side === 'call'
    ? 'calls above puts'
    : side === 'put'
      ? 'puts above calls'
      : 'calls equal puts';
  const expiryText = expiry ? `, ${expiry} expiry` : '';
  return `${date}${expiryText}: ${direction} (${callVolume} calls vs ${putVolume} puts)`;
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
// the front expiration, left-to-right from earliest to latest.
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
// day at 7:45 AM Hong Kong time.
export default function Alerts() {
  const { report, loading, msg, load } = useOptionsReport();
  const [selected, setSelected] = useState(null);

  useEffect(() => { load(); }, [load]);

  // Sidebar order: today's total option volume (calls + puts, summed across
  // all three tracked expirations) from highest to lowest.
  const tickers = [...(report?.tickers ?? [])].sort((a, b) => {
    const total = t => (t.flow?.callToday ?? 0) + (t.flow?.putToday ?? 0);
    return total(b) - total(a);
  });
  const showCalendar = selected === CALENDAR_ID;
  const active = showCalendar ? null : (tickers.find(t => t.ticker === selected) ?? tickers[0] ?? null);

  return (
    <div className="alerts-page">
      {msg?.kind === 'err' && (
        <div className="alerts-note err" style={{ marginBottom: 14, maxWidth: 'none' }}>{msg.text}</div>
      )}

      <div className="or-layout">
        <nav className="or-nav" aria-label="Tickers">
          <button
            type="button"
            className={`or-nav-item or-nav-item--calendar${showCalendar ? ' active' : ''}`}
            onClick={() => setSelected(CALENDAR_ID)}
          >
            <span className="or-nav-name">Calendar</span>
          </button>
          {tickers.map(t => (
            <TickerNavItem
              key={t.ticker}
              t={t}
              active={!showCalendar && t.ticker === active?.ticker}
              onSelect={setSelected}
            />
          ))}
        </nav>
        <div className="or-report">
          {showCalendar ? (
            <EarningsCalendar />
          ) : loading && !report ? (
            <div className="or-status">Loading the latest report…</div>
          ) : !active ? (
            <div className="or-status">
              No report has been generated yet. It builds automatically at 7:45 AM Hong Kong time — or click “Refresh now”.
            </div>
          ) : (
            <TickerReport t={active} />
          )}
        </div>
      </div>
    </div>
  );
}
