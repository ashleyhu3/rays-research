import { useEffect, useState } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIME_LABELS = { bmo: 'before market open', amc: 'after market close' };
const DISPLAY_MONTHS = 2;

// Tooltip text for one event: ticker, market timing (FMP-sourced events only),
// and whether the date is FMP-confirmed vs. a projected/estimated anchor.
function eventTitle(ev) {
  const parts = [`${ev.ticker} earnings call`];
  if (ev.time && TIME_LABELS[ev.time]) parts.push(TIME_LABELS[ev.time]);
  if (ev.confirmed === false) parts.push('estimated date');
  return parts.join(' — ');
}

// Local YYYY-MM-DD, matching the ISO dates the earnings-calendar API returns.
function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Cells for a full calendar grid of the given month: null cells pad the first
// and last week out to a complete 7-day row.
function buildMonthGrid(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = new Date(year, month, 1).getDay();
  const cells = Array(startWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, iso: isoDate(new Date(year, month, day)) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function addMonths(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

// The earnings-call events scheduled during the display window, shown as
// month grids — one entry per tracked ticker on the day of its next call.
export default function EarningsCalendar() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/alerts/earnings-calendar');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (!cancelled) setEvents(json.events ?? []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const now = new Date();
  const today = isoDate(now);
  const months = Array.from({ length: DISPLAY_MONTHS }, (_, offset) => {
    const d = addMonths(now, offset);
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      cells: buildMonthGrid(d.getFullYear(), d.getMonth()),
    };
  });

  const eventsByDate = events.reduce((map, ev) => {
    (map[ev.date] ??= []).push(ev);
    return map;
  }, {});
  Object.values(eventsByDate).forEach(items => {
    items.sort((a, b) => `${a.time ?? ''}:${a.ticker}`.localeCompare(`${b.time ?? ''}:${b.ticker}`));
  });

  return (
    <section className="cal-page">
      <header className="cal-head">
        <h3>Earnings Calendar</h3>
        {loading && <span className="cal-status">Loading earnings dates…</span>}
        {error && <span className="cal-status err">{error}</span>}
      </header>
      <div className="cal-months">
        {months.map(({ year, month, cells }) => (
          <section className="cal-month" key={`${year}-${month}`}>
            <h4 className="cal-month-title">{MONTH_NAMES[month]} {year}</h4>
            <div className="cal-grid">
              {WEEKDAY_LABELS.map(label => (
                <div className="cal-weekday" key={label}>{label}</div>
              ))}
              {cells.map((cell, i) => (
                <div
                  className={`cal-cell${!cell ? ' empty' : ''}${cell?.iso === today ? ' today' : ''}`}
                  key={cell?.iso ?? `${year}-${month}-empty-${i}`}
                >
                  {cell && (
                    <>
                      <span className="cal-daynum">{cell.day}</span>
                      <div className="cal-events">
                        {(eventsByDate[cell.iso] ?? []).map(ev => (
                          <span
                            className={`cal-event${ev.confirmed === false ? ' estimated' : ''}`}
                            key={`${ev.date}-${ev.ticker}`}
                            title={eventTitle(ev)}
                          >
                            {ev.ticker}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!loading && !error && events.length === 0 && (
        <div className="or-status">No earnings calls found for the tracked tickers in this calendar window.</div>
      )}
    </section>
  );
}
