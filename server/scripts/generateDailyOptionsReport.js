'use strict';

const fs = require('fs');
const path = require('path');
const { getOptionsData } = require('../scrapers/options');

const DEFAULT_TICKERS = ['TSM', 'ASML'];
const BASE = 'https://api.massive.com';
const CALL_COLOR = '#059669';
const PUT_COLOR = '#dc2626';
const CALL_SOFT = '#bfe8d8';
const PUT_SOFT = '#f3c7c7';
const PRICE_COLOR = '#111827';

function getKey() {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new Error('MASSIVE_API_KEY is not set');
  return key;
}

async function massiveGet(pathname, params = {}) {
  const url = new URL(pathname, BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${getKey()}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Massive ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function parseArgs(argv) {
  const args = { tickers: DEFAULT_TICKERS, date: today(), out: null, format: null };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tickers' && argv[i + 1]) {
      args.tickers = argv[i + 1]
        .split(',')
        .map(t => t.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--date' && argv[i + 1]) {
      args.date = argv[i + 1];
      i += 1;
    } else if (arg === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if (arg === '--format' && argv[i + 1]) {
      args.format = argv[i + 1].trim().toLowerCase();
      i += 1;
    }
  }
  return args;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeMd(value) {
  return String(value ?? '-').replaceAll('|', '\\|');
}

function htmlAttr(value) {
  return escapeHtml(value).replaceAll('\n', ' ');
}

function fmtUsd(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `$${Number(value).toFixed(2)}`;
}

function fmtNum(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('en-US');
}

function fmtIv(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(1)}%`;
}

function fmtRatio(volume, openInterest) {
  if (!volume || !openInterest) return '-';
  return (volume / openInterest).toFixed(2);
}

function fmtX(value) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${value.toFixed(1)}x`;
}

function fmtDeltaPct(todayValue, priorValue) {
  if (!priorValue) return '-';
  const pct = ((todayValue - priorValue) / priorValue) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function fmtShort(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString('en-US');
}

function fmtChange(value, pct) {
  if (value == null || pct == null) return '';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}

function fmtExpiry(dateStr) {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${month}/${day}`;
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function topByVolume(contracts) {
  return [...(contracts ?? [])]
    .filter(contract => (contract.volume ?? 0) > 0)
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 3);
}

function contractLabel(row, side) {
  return `${side.toUpperCase()} ${fmtUsd(row.strike)}`;
}

function historyMap(history) {
  return new Map(history.map(day => [day.date, day.volume]));
}

async function fetchContractVolumeHistory(contractSymbol, reportDate) {
  if (!contractSymbol) return [];
  const start = addDays(reportDate, -45);
  const pathname = `/v2/aggs/ticker/${encodeURIComponent(contractSymbol)}/range/1/day/${start}/${reportDate}`;
  try {
    const resp = await massiveGet(pathname, {
      adjusted: 'true',
      sort: 'asc',
      limit: 5000,
    });
    return (resp.results ?? [])
      .map(row => ({
        date: new Date(row.t).toISOString().slice(0, 10),
        volume: row.v ?? 0,
      }))
      .filter(row => row.date < reportDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.warn(`[options-report] history unavailable for ${contractSymbol}: ${error.message}`);
    return [];
  }
}

async function enrichExpirationData(data, reportDate) {
  const topCalls = topByVolume(data.calls).map(row => ({ ...row, side: 'call' }));
  const topPuts = topByVolume(data.puts).map(row => ({ ...row, side: 'put' }));
  const rows = [...topCalls, ...topPuts];

  const histories = await Promise.all(rows.map(row => fetchContractVolumeHistory(row.contractSymbol, reportDate)));
  const historyBySymbol = new Map(rows.map((row, index) => [row.contractSymbol, histories[index]]));
  const historyMaps = new Map(rows.map(row => [row.contractSymbol, historyMap(historyBySymbol.get(row.contractSymbol) ?? [])]));
  const allHistoryDates = [...new Set(histories.flatMap(history => history.map(day => day.date)))].sort();
  const latestHistoryDate = allHistoryDates[allHistoryDates.length - 1] ?? null;
  const snapshotVolume = rows.reduce((sum, row) => sum + (row.volume ?? 0), 0);
  const latestHistoryVolume = latestHistoryDate
    ? rows.reduce((sum, row) => sum + (historyMaps.get(row.contractSymbol)?.get(latestHistoryDate) ?? 0), 0)
    : null;
  const effectiveDate = latestHistoryDate && latestHistoryVolume === snapshotVolume
    ? latestHistoryDate
    : reportDate;
  const allPriorDates = allHistoryDates
    .filter(date => date < effectiveDate)
    .slice(-9);
  const previousDate = allPriorDates[allPriorDates.length - 1] ?? null;
  const averageDates = allPriorDates.slice(-5);

  function rowWithHistory(row) {
    const hMap = historyMaps.get(row.contractSymbol) ?? new Map();
    const todayVolume = row.volume ?? 0;
    const yesterdayVolume = previousDate ? (hMap.get(previousDate) ?? 0) : null;
    const avgBase = averageDates.length
      ? averageDates.reduce((sum, date) => sum + (hMap.get(date) ?? 0), 0) / averageDates.length
      : null;
    return {
      ...row,
      todayVolume,
      yesterdayVolume,
      dodPct: yesterdayVolume ? ((todayVolume - yesterdayVolume) / yesterdayVolume) * 100 : null,
      fiveDayMultiple: avgBase ? todayVolume / avgBase : null,
      contractLabel: contractLabel(row, row.side),
    };
  }

  const tableCalls = topCalls.map(rowWithHistory);
  const tablePuts = topPuts.map(rowWithHistory);
  const chartDates = [...allPriorDates, effectiveDate];

  function chartFor(sideRows, color, softColor) {
    return {
      rows: chartDates.map(date => {
        const volume = sideRows.reduce((sum, row) => {
          if (date === effectiveDate) return sum + (row.volume ?? 0);
          const hMap = historyMaps.get(row.contractSymbol) ?? new Map();
          return sum + (hMap.get(date) ?? 0);
        }, 0);
        return { date, volume };
      }),
      color,
      softColor,
    };
  }

  return {
    ...data,
    tableCalls,
    tablePuts,
    volumeCharts: {
      call: chartFor(topCalls, CALL_COLOR, CALL_SOFT),
      put: chartFor(topPuts, PUT_COLOR, PUT_SOFT),
    },
  };
}

function buildOiPoints(data, side) {
  const price = data?.price;
  if (price == null) return [];
  const low = price * 0.7;
  const high = price * 1.3;
  return [...(data?.[side] ?? [])]
    .filter(contract => {
      const strike = contract.strike;
      return strike != null && strike >= low && strike <= high;
    })
    .map(contract => ({
      x: Number(contract.strike),
      y: Number(contract.openInterest ?? 0),
    }))
    .sort((a, b) => a.x - b.x);
}

function pathFrom(points, scaleX, scaleY) {
  if (!points.length) return '';
  return points.map((point, index) => {
    const command = index === 0 ? 'M' : 'L';
    return `${command}${scaleX(point.x).toFixed(2)},${scaleY(point.y).toFixed(2)}`;
  }).join(' ');
}

function tickValues(min, max, count) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min || 0];
  const values = [];
  for (let i = 0; i < count; i += 1) {
    values.push(min + ((max - min) * i) / (count - 1));
  }
  return values;
}

function buildChartSvg(data) {
  const calls = buildOiPoints(data, 'calls');
  const puts = buildOiPoints(data, 'puts');
  const points = [...calls, ...puts];

  if (!points.length) {
    return '<div class="empty-chart">No chart data</div>';
  }

  const width = 1000;
  const height = 360;
  const margin = { top: 22, right: 26, bottom: 46, left: 64 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const minX = Math.min(...points.map(point => point.x));
  const maxX = Math.max(...points.map(point => point.x));
  const maxY = Math.max(1, ...points.map(point => point.y));
  const xPad = minX === maxX ? Math.max(1, minX * 0.04) : (maxX - minX) * 0.03;
  const xMin = minX - xPad;
  const xMax = maxX + xPad;

  const scaleX = value => margin.left + ((value - xMin) / (xMax - xMin)) * chartWidth;
  const scaleY = value => margin.top + chartHeight - (value / maxY) * chartHeight;
  const xTicks = tickValues(xMin, xMax, 6);
  const yTicks = tickValues(0, maxY, 5);
  const priceX = data.price != null ? scaleX(data.price) : null;
  const callPath = pathFrom(calls, scaleX, scaleY);
  const putPath = pathFrom(puts, scaleX, scaleY);

  return `
    <svg class="oi-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(data.ticker)} open interest by strike">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${yTicks.map(value => {
        const y = scaleY(value);
        return `
          <line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width - margin.right}" y2="${y.toFixed(2)}" class="grid-line"></line>
          <text x="${margin.left - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end" class="axis-text">${fmtNum(Math.round(value))}</text>
        `;
      }).join('')}
      ${xTicks.map(value => {
        const x = scaleX(value);
        return `
          <line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${height - margin.bottom}" class="grid-line faint"></line>
          <text x="${x.toFixed(2)}" y="${height - 16}" text-anchor="middle" class="axis-text">${fmtUsd(value)}</text>
        `;
      }).join('')}
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="axis-line"></line>
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="axis-line"></line>
      ${priceX != null ? `
        <line x1="${priceX.toFixed(2)}" y1="${margin.top}" x2="${priceX.toFixed(2)}" y2="${height - margin.bottom}" class="price-line"></line>
      ` : ''}
      ${callPath ? `<path d="${callPath}" class="series calls"></path>` : ''}
      ${putPath ? `<path d="${putPath}" class="series puts"></path>` : ''}
      ${calls.map(point => `<circle cx="${scaleX(point.x).toFixed(2)}" cy="${scaleY(point.y).toFixed(2)}" r="2.2" class="dot call-dot"></circle>`).join('')}
      ${puts.map(point => `<circle cx="${scaleX(point.x).toFixed(2)}" cy="${scaleY(point.y).toFixed(2)}" r="2.2" class="dot put-dot"></circle>`).join('')}
    </svg>
  `;
}

function buildVolumeChartSvg(chart) {
  const rows = chart?.rows ?? [];
  if (!rows.length) return '<div class="empty-chart">No chart data</div>';

  const width = 860;
  const height = 190;
  const margin = { top: 30, right: 22, bottom: 38, left: 22 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...rows.map(row => row.volume ?? 0));
  const step = chartWidth / rows.length;
  const barWidth = Math.min(86, step * 0.86);
  const color = chart.color;
  const softColor = chart.softColor;

  const bars = rows.map((row, index) => {
    const value = row.volume ?? 0;
    const barHeight = value > 0 ? Math.max(5, (value / maxValue) * chartHeight) : 5;
    const x = margin.left + (step * index) + ((step - barWidth) / 2);
    const y = margin.top + chartHeight - barHeight;
    const isToday = index === rows.length - 1;
    const shouldLabel = true;
    return `
      <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="4" fill="${isToday ? color : softColor}"></rect>
      ${shouldLabel ? `<text x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 9).toFixed(2)}" text-anchor="middle" fill="${isToday ? color : '#6b7280'}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" font-weight="800">${fmtShort(value)}</text>` : ''}
      <text x="${(x + barWidth / 2).toFixed(2)}" y="${height - 16}" text-anchor="middle" fill="${isToday ? color : '#8b93a1'}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" font-weight="${isToday ? '700' : '500'}">${fmtDateShort(row.date)}</text>
    `;
  }).join('');

  return `
    <svg class="volume-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="daily contract volume">
      <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
      ${bars}
    </svg>
  `;
}

function buildVolumeChartLayer(chart, width, height) {
  const rows = chart?.rows ?? [];
  if (!rows.length) {
    return `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#6b7280" font-family="system-ui, sans-serif" font-size="14">No chart data</text>`;
  }

  const margin = { top: 30, right: 22, bottom: 38, left: 22 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...rows.map(row => row.volume ?? 0));
  const step = chartWidth / rows.length;
  const barWidth = Math.min(86, step * 0.86);

  return rows.map((row, index) => {
    const value = row.volume ?? 0;
    const barHeight = value > 0 ? Math.max(5, (value / maxValue) * chartHeight) : 5;
    const x = margin.left + (step * index) + ((step - barWidth) / 2);
    const y = margin.top + chartHeight - barHeight;
    const isToday = index === rows.length - 1;
    return `
      <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="4" fill="${isToday ? chart.color : chart.softColor}"></rect>
      <text x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 8).toFixed(2)}" text-anchor="middle" fill="${isToday ? chart.color : '#6b7280'}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" font-weight="700">${fmtShort(value)}</text>
      <text x="${(x + barWidth / 2).toFixed(2)}" y="${height - 16}" text-anchor="middle" fill="${isToday ? chart.color : '#8b93a1'}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" font-weight="${isToday ? '700' : '500'}">${fmtDateShort(row.date)}</text>
    `;
  }).join('');
}

function tableCellText(value, x, y, anchor = 'end', color = '#374151', weight = '500') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" font-weight="${weight}">${escapeHtml(value)}</text>`;
}

function buildPanelSvg(data, side) {
  const chart = data.volumeCharts?.[side];
  const rows = side === 'call' ? (data.tableCalls ?? []) : (data.tablePuts ?? []);
  const typeColor = side === 'call' ? CALL_COLOR : PUT_COLOR;
  const width = 900;
  const chartHeight = 190;
  const tableY = 208;
  const headerH = 32;
  const rowH = 34;
  const visibleRows = rows.length ? rows : [null];
  const tableHeight = headerH + (visibleRows.length * rowH);
  const height = tableY + tableHeight + 12;
  const columns = [
    { label: 'Type', width: 82, align: 'start' },
    { label: 'Strike', width: 110 },
    { label: 'Today', width: 112 },
    { label: 'Yest.', width: 112 },
    { label: 'Delta DoD', width: 105 },
    { label: 'x5D Avg', width: 105 },
    { label: 'Vol/OI', width: 105 },
    { label: 'IV', width: 85 },
    { label: 'Money', width: 84, align: 'middle' },
  ];

  let x = 0;
  const header = columns.map(col => {
    const textX = col.align === 'start' ? x + 10 : col.align === 'middle' ? x + (col.width / 2) : x + col.width - 10;
    const anchor = col.align === 'start' ? 'start' : col.align === 'middle' ? 'middle' : 'end';
    const out = tableCellText(col.label, textX.toFixed(2), tableY + 21, anchor, '#6b7280', '700');
    x += col.width;
    return out;
  }).join('');

  const body = visibleRows.map((row, rowIndex) => {
    const y = tableY + headerH + (rowIndex * rowH);
    const textY = y + 22;
    if (!row) {
      return `
        <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e5e7eb"></line>
        ${tableCellText('-', 10, textY, 'start', '#6b7280', '500')}
      `;
    }
    const values = [
      { value: row.side.toUpperCase(), color: typeColor, weight: '800', align: 'start' },
      { value: fmtUsd(row.strike) },
      { value: fmtNum(row.todayVolume) },
      { value: fmtNum(row.yesterdayVolume) },
      { value: fmtDeltaPct(row.todayVolume, row.yesterdayVolume) },
      { value: fmtX(row.fiveDayMultiple) },
      { value: fmtX(row.openInterest ? row.todayVolume / row.openInterest : null) },
      { value: fmtIv(row.impliedVolatility) },
      { value: row.inTheMoney ? 'ITM' : 'OTM', align: 'middle' },
    ];
    let cellX = 0;
    const cells = values.map((cell, index) => {
      const col = columns[index];
      const align = cell.align ?? col.align;
      const textX = align === 'start' ? cellX + 10 : align === 'middle' ? cellX + (col.width / 2) : cellX + col.width - 10;
      const anchor = align === 'start' ? 'start' : align === 'middle' ? 'middle' : 'end';
      const out = tableCellText(cell.value, textX.toFixed(2), textY, anchor, cell.color ?? '#374151', cell.weight ?? '500');
      cellX += col.width;
      return out;
    }).join('');
    return `
      <line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e5e7eb"></line>
      ${cells}
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(data.ticker)} ${side} option volume and table">
    <rect width="${width}" height="${height}" fill="#ffffff"></rect>
    ${buildVolumeChartLayer(chart, width, chartHeight)}
    <rect x="0" y="${tableY}" width="${width}" height="${tableHeight}" fill="#ffffff"></rect>
    <line x1="0" y1="${tableY}" x2="${width}" y2="${tableY}" stroke="#d1d5db"></line>
    ${header}
    ${body}
    <line x1="0" y1="${tableY + tableHeight}" x2="${width}" y2="${tableY + tableHeight}" stroke="#e5e7eb"></line>
  </svg>`;
}

function buildStandaloneChartSvg(data, side) {
  const chart = buildVolumeChartSvg(data.volumeCharts?.[side]).trim();

  if (!chart.startsWith('<svg')) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="190" viewBox="0 0 860 190" role="img" aria-label="${escapeHtml(data.ticker)} daily contract volume"><rect width="860" height="190" fill="#ffffff"/><text x="430" y="95" text-anchor="middle" fill="#6b7280" font-family="system-ui, sans-serif" font-size="14">No chart data</text></svg>`;
  }

  return chart
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="860" height="190" ');
}

function renderRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="8" class="empty-cell">-</td></tr>';
  }
  return rows.map(row => `
    <tr>
      <td><span class="contract-side ${row.side}">${row.side.toUpperCase()}</span> <strong>${fmtUsd(row.strike)}</strong></td>
      <td>${fmtNum(row.todayVolume)}</td>
      <td>${fmtNum(row.yesterdayVolume)}</td>
      <td>${fmtDeltaPct(row.todayVolume, row.yesterdayVolume)}</td>
      <td>${fmtX(row.fiveDayMultiple)}</td>
      <td>${fmtX(row.openInterest ? row.todayVolume / row.openInterest : null)}</td>
      <td>${fmtIv(row.impliedVolatility)}</td>
      <td>${row.inTheMoney ? 'ITM' : 'OTM'}</td>
    </tr>
  `).join('');
}

function renderContractTable(label, rows) {
  return `
    <div class="table-block ${label.toLowerCase()}">
      <h3>${escapeHtml(label)}</h3>
      <table>
        <thead>
          <tr>
            <th>Contract</th>
            <th>Today</th>
            <th>Yest.</th>
            <th>Δ DoD</th>
            <th>×5D Avg</th>
            <th>Vol/OI</th>
            <th>IV</th>
            <th>Money</th>
          </tr>
        </thead>
        <tbody>${renderRows(rows)}</tbody>
      </table>
    </div>
  `;
}

function renderExpirationBlock(data) {
  return `
    <div class="expiration-block">
      <h2>${escapeHtml(fmtExpiry(data.selectedDate))}</h2>
      <div class="tables">
        <div>
          ${buildVolumeChartSvg(data.volumeCharts?.call)}
          ${renderContractTable('Calls', data.tableCalls ?? [])}
        </div>
        <div>
          ${buildVolumeChartSvg(data.volumeCharts?.put)}
          ${renderContractTable('Puts', data.tablePuts ?? [])}
        </div>
      </div>
    </div>
  `;
}

function renderTickerSection(tickerReport) {
  const nearest = tickerReport.expirations[0];
  const change = fmtChange(nearest?.priceChange, nearest?.changePct);
  return `
    <section class="ticker-section">
      <header class="ticker-header">
        <div>
          <h1>${escapeHtml(tickerReport.ticker)}</h1>
          <div class="ticker-meta">
            <span>${fmtUsd(nearest?.price)}</span>
            ${change ? `<span class="${nearest.priceChange >= 0 ? 'up' : 'down'}">${escapeHtml(change)}</span>` : ''}
          </div>
        </div>
      </header>
      ${tickerReport.expirations.map(renderExpirationBlock).join('')}
    </section>
  `;
}

function renderHtml(report) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Daily Options Data</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --soft: #f9fafb;
      --calls: ${CALL_COLOR};
      --puts: ${PUT_COLOR};
      --price: ${PRICE_COLOR};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.35;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 28px 64px;
    }
    .report-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .report-header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 750;
      letter-spacing: 0;
    }
    .report-date {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .ticker-section {
      padding: 34px 0 42px;
      border-bottom: 1px solid var(--line);
      min-height: 100vh;
    }
    .ticker-section:last-child { border-bottom: 0; }
    .ticker-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 14px;
    }
    .ticker-header h1 {
      margin: 0;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .ticker-meta {
      display: flex;
      gap: 10px;
      color: var(--muted);
      font-size: 14px;
      margin-top: 2px;
    }
    .up { color: var(--calls); }
    .down { color: var(--puts); }
    .legend {
      display: flex;
      gap: 14px;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 5px;
      white-space: nowrap;
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .legend i {
      width: 20px;
      height: 3px;
      display: inline-block;
      border-radius: 999px;
    }
    .call-key { background: var(--calls); }
    .put-key { background: var(--puts); }
    .price-key { background: var(--price); }
    .oi-chart,
    .volume-chart {
      width: 100%;
      height: auto;
      display: block;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      margin-bottom: 26px;
    }
    .grid-line {
      stroke: #e5e7eb;
      stroke-width: 1;
    }
    .grid-line.faint { stroke: #f1f5f9; }
    .axis-line {
      stroke: #9ca3af;
      stroke-width: 1;
    }
    .axis-text {
      fill: #6b7280;
      font-size: 11px;
    }
    .series {
      fill: none;
      stroke-width: 2.6;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .series.calls { stroke: var(--calls); }
    .series.puts { stroke: var(--puts); }
    .dot { stroke: white; stroke-width: 1; }
    .call-dot { fill: var(--calls); }
    .put-dot { fill: var(--puts); }
    .price-line {
      stroke: var(--price);
      stroke-width: 1.4;
      stroke-dasharray: 5 5;
    }
    .expiration-block {
      padding: 16px 0 22px;
      border-bottom: 1px solid var(--line);
    }
    .expiration-block:last-child { border-bottom: 0; }
    .expiration-block h2 {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .tables {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }
    .table-block h3 {
      margin: 0 0 7px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .table-block.calls h3 { color: var(--calls); }
    .table-block.puts h3 { color: var(--puts); }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
      background: var(--soft);
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 8px 9px;
      text-align: right;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    th {
      color: var(--muted);
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
    }
    th:first-child, td:first-child { text-align: left; }
    tr:last-child td { border-bottom: 0; }
    .empty-cell { color: var(--muted); text-align: center; }
    .contract-side {
      font-weight: 800;
      margin-right: 5px;
    }
    .contract-side.call { color: var(--calls); }
    .contract-side.put { color: var(--puts); }
    .empty-chart {
      padding: 120px 0;
      border-top: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      color: var(--muted);
      text-align: center;
      margin-bottom: 26px;
    }
    @media (max-width: 860px) {
      main { padding: 20px 16px 48px; }
      .ticker-section { min-height: auto; }
      .report-header, .ticker-header {
        align-items: flex-start;
        flex-direction: column;
      }
      .tables { grid-template-columns: 1fr; }
      .legend { flex-wrap: wrap; }
    }
    @media print {
      main { max-width: none; padding: 18px; }
      .ticker-section {
        min-height: auto;
        page-break-before: always;
      }
      .ticker-section:first-of-type { page-break-before: auto; }
    }
  </style>
</head>
<body>
  <main>
    <header class="report-header">
      <h1>Daily Options Data</h1>
      <div class="report-date">${escapeHtml(report.date)}</div>
    </header>
    ${report.tickers.map(renderTickerSection).join('')}
  </main>
</body>
</html>
`;
}

function mdTable(rows) {
  const header = '| Type | Strike | Today | Yest. | Δ DoD | ×5D Avg | Vol/OI | IV | Money |';
  const rule = '|:---|---:|---:|---:|---:|---:|---:|---:|:---|';
  if (!rows.length) return `${header}\n${rule}\n| - | - | - | - | - | - | - | - | - |`;

  const body = rows.map(row => {
    const color = row.side === 'call' ? CALL_COLOR : PUT_COLOR;
    return [
      `<span style="color:${color};font-weight:700">${row.side.toUpperCase()}</span>`,
      fmtUsd(row.strike),
      fmtNum(row.todayVolume),
      fmtNum(row.yesterdayVolume),
      fmtDeltaPct(row.todayVolume, row.yesterdayVolume),
      fmtX(row.fiveDayMultiple),
      fmtX(row.openInterest ? row.todayVolume / row.openInterest : null),
      fmtIv(row.impliedVolatility),
      row.inTheMoney ? 'ITM' : 'OTM',
    ].map(escapeMd).join(' | ');
  });

  return `${header}\n${rule}\n${body.map(row => `| ${row} |`).join('\n')}`;
}

function chartAndTableBlock(ticker, expiration, side, assetsDirName, chartName, rows) {
  const sideName = side === 'call' ? 'calls' : 'puts';
  return `![${ticker} ${expiration.selectedDate} ${sideName} volume and table](${assetsDirName}/${chartName})\n`;
}

function renderMarkdown(report, outPath) {
  const baseName = path.basename(outPath, path.extname(outPath));
  const assetsDirName = `${baseName}-assets`;
  const assetsDir = path.join(path.dirname(outPath), assetsDirName);
  fs.mkdirSync(assetsDir, { recursive: true });

  const lines = [`# Daily Options Data ${report.date}`, ''];

  for (const tickerReport of report.tickers) {
    const nearest = tickerReport.expirations[0];
    const change = fmtChange(nearest?.priceChange, nearest?.changePct);
    const tickerTitle = [`## ${tickerReport.ticker}`, fmtUsd(nearest?.price), change].filter(Boolean).join(' ');

    lines.push(tickerTitle);
    lines.push('');

    for (const expiration of tickerReport.expirations) {
      const callChartName = `${tickerReport.ticker.toLowerCase()}-${expiration.selectedDate}-calls-volume.svg`;
      const putChartName = `${tickerReport.ticker.toLowerCase()}-${expiration.selectedDate}-puts-volume.svg`;
      const callChartPath = path.join(assetsDir, callChartName);
      const putChartPath = path.join(assetsDir, putChartName);
      fs.writeFileSync(callChartPath, buildPanelSvg(expiration, 'call'));
      fs.writeFileSync(putChartPath, buildPanelSvg(expiration, 'put'));

      lines.push(`### ${fmtExpiry(expiration.selectedDate)}`);
      lines.push('');
      lines.push(chartAndTableBlock(tickerReport.ticker, expiration, 'call', assetsDirName, callChartName, expiration.tableCalls ?? []));
      lines.push(chartAndTableBlock(tickerReport.ticker, expiration, 'put', assetsDirName, putChartName, expiration.tablePuts ?? []));
      lines.push('');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

async function fetchTickerReport(ticker, reportDate) {
  const first = await getOptionsData(ticker);
  const expirations = (first.expirations ?? []).slice(0, 3);
  const byDate = [];

  for (const expiration of expirations) {
    let data;
    if (expiration === first.selectedDate) {
      data = first;
    } else {
      data = await getOptionsData(ticker, expiration);
    }
    byDate.push(await enrichExpirationData(data, reportDate));
  }

  return {
    ticker: first.ticker,
    expirations: byDate,
  };
}

async function generateDailyOptionsReport({ date = today(), tickers = DEFAULT_TICKERS, out = null, format = null } = {}) {
  const outPath = path.resolve(out ?? `daily-options-data-${date}.html`);
  const outputFormat = format ?? (path.extname(outPath).toLowerCase() === '.md' ? 'md' : 'html');
  const tickerReports = [];

  for (const ticker of tickers) {
    tickerReports.push(await fetchTickerReport(ticker, date));
  }

  const report = { date, tickers: tickerReports };
  const content = outputFormat === 'md'
    ? renderMarkdown(report, outPath)
    : renderHtml(report);
  fs.writeFileSync(outPath, content);

  return { outPath, format: outputFormat, report, content };
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await generateDailyOptionsReport(args);
  console.log(result.outPath);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

// One contract row as pre-formatted display strings (the web app renders these
// verbatim, mirroring the PDF/email table exactly — no client-side math).
function structuredContractRow(row) {
  return {
    side: row.side,
    strike: fmtUsd(row.strike),
    today: fmtNum(row.todayVolume),
    yesterday: fmtNum(row.yesterdayVolume),
    dod: fmtDeltaPct(row.todayVolume, row.yesterdayVolume),
    fiveDay: fmtX(row.fiveDayMultiple),
    volOi: fmtX(row.openInterest ? row.todayVolume / row.openInterest : null),
    iv: fmtIv(row.impliedVolatility),
    money: row.inTheMoney ? 'ITM' : 'OTM',
  };
}

// Build a self-contained JSON payload (titles + embedded SVG charts + formatted
// table cells) so the web app can render the report natively — no PDF, no
// external asset files — and it persists cheaply in Mongo, keyed by date.
function buildStructuredReport(report, { generatedAt = new Date().toISOString(), timeZone = null } = {}) {
  return {
    date: report.date,
    generatedAt,
    timeZone,
    tickers: (report.tickers ?? []).map(tickerReport => {
      const nearest = tickerReport.expirations?.[0];
      return {
        ticker: tickerReport.ticker,
        priceText: fmtUsd(nearest?.price),
        change: fmtChange(nearest?.priceChange, nearest?.changePct),
        priceChange: nearest?.priceChange ?? null,
        expirations: (tickerReport.expirations ?? []).map(exp => ({
          selectedDate: exp.selectedDate,
          expiryLabel: fmtExpiry(exp.selectedDate),
          callChartSvg: buildVolumeChartSvg(exp.volumeCharts?.call).trim(),
          putChartSvg: buildVolumeChartSvg(exp.volumeCharts?.put).trim(),
          tableCalls: (exp.tableCalls ?? []).map(structuredContractRow),
          tablePuts: (exp.tablePuts ?? []).map(structuredContractRow),
        })),
      };
    }),
  };
}

module.exports = {
  DEFAULT_TICKERS,
  buildStructuredReport,
  generateDailyOptionsReport,
  renderHtml,
  renderMarkdown,
  today,
};
