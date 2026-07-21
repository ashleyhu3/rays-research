'use strict';

const storage = require('../storage');

function createPersistedSeries({ blob, file, tickers, fields }) {
  function load() { return storage.read(blob, file); }

  function merge(payload) {
    const history = load();
    for (let dateIndex = 0; dateIndex < (payload.dates ?? []).length; dateIndex += 1) {
      const date = payload.dates[dateIndex];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const row = { ...(history[date] ?? {}) };
      for (const series of payload.series ?? []) {
        const values = { ...(row[series.ticker] ?? {}) };
        let hasValue = false;
        for (const field of fields) {
          const value = series[field]?.[dateIndex];
          if (value != null && Number.isFinite(Number(value))) {
            values[field] = Number(value);
            hasValue = true;
          }
        }
        if (hasValue) row[series.ticker] = values;
      }
      if (Object.keys(row).length) history[date] = row;
    }
    storage.write(blob, file, history);
    return history;
  }

  function assemble(startDate = null, endDate = null) {
    const history = load();
    const dates = Object.keys(history)
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .filter(date => (!startDate || date >= startDate) && (!endDate || date <= endDate))
      .sort();
    const series = tickers.map(meta => {
      const output = { ticker: meta.ticker, label: meta.label, name: meta.name, error: null };
      for (const field of fields) output[field] = dates.map(date => history[date]?.[meta.ticker]?.[field] ?? null);
      return output;
    });
    return { start: dates[0] ?? startDate, end: dates[dates.length - 1] ?? endDate, dates, series };
  }

  return { assemble, merge };
}

function isoDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

module.exports = { createPersistedSeries, isoDaysAgo };
