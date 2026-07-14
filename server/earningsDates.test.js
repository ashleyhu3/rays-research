'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUARTER_SHIFT_DAYS,
  YEAR_SHIFT_DAYS,
  addDays,
  calendarStale,
  historyStale,
  parseCalendarRows,
  pickAnchor,
} = require('./earningsDates');

const CALENDAR_HEADER = 'symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay';

const TODAY = new Date().toISOString().slice(0, 10);
const iso = date => `${date}T12:00:00.000Z`;

// Alpha Vantage's own history for TSM, which is what makes the cadence guard
// necessary: the Q2/Q3 2025 "reported" dates are 6-K filing dates, a month after
// the calls they claim to be (the Q2 2025 call was 2025-07-17).
const TSM_HISTORY = [
  { fiscalDateEnding: '2026-03-31', reportedDate: '2026-04-15' },
  { fiscalDateEnding: '2025-12-31', reportedDate: '2026-01-15' },
  { fiscalDateEnding: '2025-09-30', reportedDate: '2025-11-14' },
  { fiscalDateEnding: '2025-06-30', reportedDate: '2025-08-14' },
  { fiscalDateEnding: '2025-03-31', reportedDate: '2025-05-15' },
];

// Alphabet's, where every reported date is a real call date — including a 7-day
// drift between quarters, which must still be trusted.
const GOOG_HISTORY = [
  { fiscalDateEnding: '2026-03-31', reportedDate: '2026-04-29' },
  { fiscalDateEnding: '2025-12-31', reportedDate: '2026-02-04' },
  { fiscalDateEnding: '2025-09-30', reportedDate: '2025-10-29' },
  { fiscalDateEnding: '2025-06-30', reportedDate: '2025-07-23' },
];

test('a reported date the cadence corroborates is used as-is', () => {
  const next = '2026-07-16';
  const anchor = pickAnchor(TSM_HISTORY, addDays(next, -QUARTER_SHIFT_DAYS));
  assert.equal(anchor.date, '2026-04-15');
  assert.equal(anchor.source, 'reported');
});

test('a filing date masquerading as a call date is replaced by the cadence', () => {
  const next = '2026-07-16';
  const anchor = pickAnchor(TSM_HISTORY, addDays(next, -YEAR_SHIFT_DAYS));
  // Not 2025-08-14 (the 6-K), but TSM's actual Q2 2025 call.
  assert.equal(anchor.date, '2025-07-17');
  assert.equal(anchor.source, 'cadence');
});

test('real quarter-to-quarter drift is still trusted', () => {
  const next = '2026-07-22';
  // Alphabet reported a week later than a flat 13-week cadence would predict; that
  // is the company moving its call, not bad data, so the reported date wins.
  const quarter = pickAnchor(GOOG_HISTORY, addDays(next, -QUARTER_SHIFT_DAYS));
  assert.equal(quarter.date, '2026-04-29');
  assert.equal(quarter.source, 'reported');

  const year = pickAnchor(GOOG_HISTORY, addDays(next, -YEAR_SHIFT_DAYS));
  assert.equal(year.date, '2025-07-23');
  assert.equal(year.source, 'reported');
});

test('both shifts are whole weeks, so a projection keeps the call\'s weekday', () => {
  const next = '2026-07-16'; // Thursday
  const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
  assert.equal(weekday(addDays(next, -QUARTER_SHIFT_DAYS)), weekday(next));
  assert.equal(weekday(addDays(next, -YEAR_SHIFT_DAYS)), weekday(next));
});

test('an empty history falls back to the cadence rather than throwing', () => {
  const anchor = pickAnchor([], '2025-07-17');
  assert.equal(anchor.date, '2025-07-17');
  assert.equal(anchor.source, 'cadence');
});

// The free tier allows 25 requests/day across the whole key, so how often each
// endpoint is re-read is the difference between the chart working and the run
// blowing the cap. The two are deliberately on separate clocks.
test('settled history is not re-read while it is still current', () => {
  const entry = {
    upcoming: { reportDate: addDays(TODAY, 3) },
    history: [{ fiscalDateEnding: '2026-03-31', reportedDate: addDays(TODAY, -89) }],
    calendarFetchedAt: iso(TODAY),
    historyFetchedAt: iso(addDays(TODAY, -60)),
  };
  // Two months since it was fetched, but the newest call it knows about is still the
  // most recent one that happened — there is nothing new to learn.
  assert.equal(historyStale(entry), false);
  assert.equal(calendarStale(entry), false);
});

test('history is re-read once a newer call must exist', () => {
  const entry = {
    upcoming: { reportDate: addDays(TODAY, 3) },
    history: [{ fiscalDateEnding: '2026-03-31', reportedDate: addDays(TODAY, -105) }],
    historyFetchedAt: iso(addDays(TODAY, -105)),
  };
  assert.equal(historyStale(entry), true);
});

test('a just-fetched history is not re-asked for daily while the vendor catches up', () => {
  const entry = {
    history: [{ fiscalDateEnding: '2026-03-31', reportedDate: addDays(TODAY, -105) }],
    historyFetchedAt: iso(TODAY),
  };
  // The call has happened but the vendor has not published it yet. Asking again
  // tomorrow, and every day after, is how a 25/day budget disappears.
  assert.equal(historyStale(entry), false);
});

test('the calendar estimate is re-read weekly, and at once when its date has passed', () => {
  const fresh = { upcoming: { reportDate: addDays(TODAY, 30) }, calendarFetchedAt: iso(addDays(TODAY, -3)) };
  assert.equal(calendarStale(fresh), false);

  const old = { upcoming: { reportDate: addDays(TODAY, 30) }, calendarFetchedAt: iso(addDays(TODAY, -8)) };
  assert.equal(calendarStale(old), true);

  const past = { upcoming: { reportDate: addDays(TODAY, -1) }, calendarFetchedAt: iso(TODAY) };
  assert.equal(calendarStale(past), true);
});

// Alpha Vantage has no error shape for its CSV endpoint: when rate-limited it mangles
// the JSON note into the CSV itself, emitting the real header plus the word
// "Information" chopped to one character per column. This is a verbatim throttled
// body. It parses as valid CSV with no matching symbol, so unless it is rejected it
// reads as "TXN has no upcoming earnings" — and gets cached as that for a week.
test('a throttled CSV body is rejected, not read as "no upcoming call"', () => {
  const throttled = `${CALENDAR_HEADER}\r\nI,n,f,o,r,m,a\r\n`;
  assert.throws(
    () => parseCalendarRows(throttled, 'TXN'),
    /rate limit/i,
    'the throttle row must not be mistaken for an empty calendar',
  );
});

test('a genuinely empty calendar is believed', () => {
  // Header and nothing else: the ticker really has no call inside the horizon.
  assert.deepEqual(parseCalendarRows(`${CALENDAR_HEADER}\r\n`, 'TXN'), []);
});

test('a real calendar row survives commas in the company name', () => {
  const body = `${CALENDAR_HEADER}\r\n`
    + 'TXN,TEXAS INSTRUMENTS, INCORPORATED,2026-07-22,2026-06-30,1.9,USD,post-market\r\n';
  const [row] = parseCalendarRows(body, 'TXN');
  // The name splits into two cells, so the date columns are only findable from the end.
  assert.equal(row.reportDate, '2026-07-22');
  assert.equal(row.fiscalDateEnding, '2026-06-30');
});

test('the API key is never repeated into an error message', () => {
  // Alpha Vantage echoes the key back inside its throttle note; it must not travel on
  // into a thrown error, which gets logged.
  const throttled = `${CALENDAR_HEADER}\r\nI,n,f,o,r,m,a\r\n`;
  try {
    parseCalendarRows(throttled, 'TXN');
    assert.fail('expected a throw');
  } catch (error) {
    assert.ok(!/[A-Z0-9]{16}/.test(error.message), `error text looks like it carries a key: ${error.message}`);
  }
});

test('nothing is fetched for a ticker whose cache is current on both clocks', () => {
  const entry = {
    upcoming: { reportDate: addDays(TODAY, 3) },
    history: [{ fiscalDateEnding: '2026-03-31', reportedDate: addDays(TODAY, -89) }],
    calendarFetchedAt: iso(addDays(TODAY, -2)),
    historyFetchedAt: iso(addDays(TODAY, -40)),
  };
  assert.equal(calendarStale(entry) || historyStale(entry), false);
});
