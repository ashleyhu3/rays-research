'use strict';

/**
 * Print the requested Alerts and leverage charts as a minimal, white-background
 * report. The options SVGs are the exact structured charts used by Alerts; the
 * leverage charts use the page's default 12-month window and visible layers.
 *
 * Usage: node server/scripts/exportOptionsLeveragePdf.js [out.pdf]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderPdf } = require('./renderPdf');
const storage = require('../storage');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(
  ROOT,
  `options-leverage-report-${new Date().toISOString().slice(0, 10)}.pdf`,
));

// Freshly generated charts, not the stored daily report: that report's bars are
// the summed volume of each day's top three contracts, and its SVGs are baked in.
// A bar here is the whole expiration's volume for that session, which is what the
// chart says it is. Rebuild with `node server/scripts/fetchOptionsChartPayload.js`.
const OPTIONS_FILE = process.env.OPTIONS_PAYLOAD
  ?? path.join(ROOT, 'server', 'data', 'optionsChartPayload.json');
const TICKERS = ['TSM', 'SOXX', 'ASML'];
const LEVERAGE_BLOBS = [
  { name: 'koreaLeverageHistory', file: path.join(ROOT, 'server', 'data', 'koreaLeverageHistory.json') },
  { name: 'taiwanLeverageHistory', file: path.join(ROOT, 'server', 'data', 'taiwanLeverageHistory.json') },
];

const BLUE = '#4577b4';
const ORANGE = '#ad622d';
const PURPLE = '#7864b4';
const REVERSE = '#b24a2f';
const INK = '#1f2328';
const MUTED = '#5b6570';
const SURFACE = '#ffffff';

const MARKETS = [
  {
    id: 'korea',
    read: () => require('../scrapers/koreaLeverage').readKoreaLeverage(),
    title: 'Korean retail leverage',
    unit: 'T',
    scale: 1,
    layers: [
      { key: 'collateral', label: 'Securities-collateral loans', color: BLUE },
      { key: 'margin', label: 'Margin loans', color: ORANGE },
      { key: 'etf', label: '2× leveraged ETFs', color: PURPLE, table: 'long' },
      { key: 'reverseEtf', label: 'Reverse 2× ETFs', color: REVERSE, table: 'reverse' },
    ],
  },
  {
    id: 'taiwan',
    read: () => require('../scrapers/taiwanLeverage').readTaiwanLeverage(),
    title: 'Taiwan retail leverage',
    unit: 'B',
    scale: 0.1,
    layers: [
      { key: 'margin', label: 'Margin loans', color: ORANGE },
      { key: 'etf', label: '2× leveraged ETFs', color: PURPLE, table: 'long' },
      { key: 'reverseEtf', label: 'Reverse ETFs (-1×)', color: REVERSE, table: 'reverse' },
    ],
  },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function optionsCharts() {
  if (!fs.existsSync(OPTIONS_FILE)) {
    throw new Error(`No chart payload at ${OPTIONS_FILE} — run fetchOptionsChartPayload.js first`);
  }
  const tickers = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8')).tickers ?? [];

  return TICKERS.map(symbol => {
    const ticker = tickers.find(t => t.ticker === symbol);
    if (!ticker) throw new Error(`No Alerts chart found for ${symbol}`);
    const expiration = [...(ticker.expirations ?? [])]
      .sort((a, b) => a.selectedDate.localeCompare(b.selectedDate))[0];
    if (!expiration?.callChartSvg || !expiration?.putChartSvg) {
      throw new Error(`No nearest-expiration charts found for ${symbol}`);
    }
    return { ticker: symbol, ...expiration };
  });
}

// Each fund's first day of trading, resolved from its own price record — neither
// leverage feed carries an inception date, and a fund's first appearance in our
// history is only the day we started tracking it. Refresh with
// `node server/scripts/fetchFundLaunchDates.js`.
const LAUNCH_FILE = path.join(ROOT, 'server', 'data', 'fundLaunchDates.json');
const LAUNCHES = fs.existsSync(LAUNCH_FILE)
  ? JSON.parse(fs.readFileSync(LAUNCH_FILE, 'utf8')).launches ?? {}
  : {};

// Eighteen months, which is also what it takes for the two marked sessions below to
// both fall inside the window.
const WINDOW_DAYS = 548;

// Sessions called out on every leverage chart, alongside the latest one.
const MARKED_DATES = ['2025-04-07', '2026-03-30'];

function shortDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return `${date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
    + ` '${String(date.getUTCFullYear()).slice(-2)}`;
}

/**
 * The index of the session a marked date lands on.
 *
 * Neither market trades every calendar day, so an exact match can be absent — a
 * marked date that fell on a holiday resolves to the last session at or before it,
 * which is the figure that was standing on that date.
 */
function sessionIndex(dates, target) {
  let found = -1;
  for (let i = 0; i < dates.length; i += 1) {
    if (dates[i] <= target) found = i; else break;
  }
  return found;
}

function leverageCharts() {
  return MARKETS.map(market => {
    const raw = market.read();
    const lastDate = raw.dates.at(-1);
    const cutoff = new Date(new Date(`${lastDate}T00:00:00Z`).getTime() - WINDOW_DAYS * 86400000)
      .toISOString().slice(0, 10);
    let from = raw.dates.findIndex(date => date >= cutoff);
    if (from < 0) from = 0;

    const dates = raw.dates.slice(from);
    const layers = market.layers
      .filter(layer => (raw[layer.key] ?? []).filter(Number.isFinite).length >= 20)
      .map(layer => ({
        ...layer,
        data: (raw[layer.key] ?? []).slice(from).map(value => (
          Number.isFinite(value) ? value * market.scale : null
        )),
    }));
    const fmt = value => (Number.isFinite(value) ? `${value.toFixed(1)}${market.unit}` : '—');
    const fmtFund = value => {
      if (!Number.isFinite(value)) return '—';
      return `${value < 0.1 ? value.toFixed(2) : value.toFixed(1)}${market.unit}`;
    };

    // Both ETF charts carry a fund table. Each share is calculated against the
    // aggregate line immediately above it, so the graph and table use one total.
    const etfLatest = layers.find(layer => layer.key === 'etf')?.data.at(-1) ?? null;
    const reverseEtfLatest = layers.find(layer => layer.key === 'reverseEtf')?.data.at(-1) ?? null;
    const describeFunds = (rows, latest) => rows.map(fund => ({
      code: fund.code,
      name: fund.name,
      kind: fund.kind ?? null,
      launched: LAUNCHES[fund.code] ? shortDate(LAUNCHES[fund.code]) : '—',
      aum: fmtFund(fund.aum * market.scale),
      share: latest ? `${(((fund.aum * market.scale) / latest) * 100).toFixed(1)}%` : '—',
    }));
    const funds = describeFunds(raw.funds ?? [], etfLatest);
    const reverseFunds = describeFunds(raw.reverseFunds ?? [], reverseEtfLatest);

    return {
      ...market,
      dates,
      fundsDate: raw.fundsDate ?? null,
      funds,
      reverseFundsDate: raw.reverseFundsDate ?? null,
      reverseFunds,
      // One chart per layer, each carrying its own labelled sessions rather than a
      // row of cards above the section: the two marked dates and the latest point,
      // labelled with the date and the figure standing on it.
      layers: layers.map(layer => ({
        ...layer,
        marks: [
          ...MARKED_DATES.map(target => {
            const index = sessionIndex(dates, target);
            if (index < 0 || !Number.isFinite(layer.data[index])) return null;
            return {
              index,
              date: shortDate(dates[index]),
              value: fmt(layer.data[index]),
              anchor: 'center',
            };
          }).filter(Boolean),
          {
            index: dates.length - 1,
            date: shortDate(lastDate),
            value: fmt(layer.data.at(-1)),
            anchor: 'right',
          },
        ],
        latest: fmt(layer.data.at(-1)),
      })),
    };
  });
}

// Korea's ETF layer mixes index, single-stock and Hong Kong-listed funds; Taiwan's
// does not, so only Korea's table carries the column.
function fundKind(kind) {
  if (kind === 'hk') return 'Single-stock 2× (HK)';
  if (kind === 'single') return 'Single-stock 2×';
  if (kind === 'reverse-index') return 'Index -2×';
  return 'Index 2×';
}

// A pair of charts spans the full content width; three pairs then set how tall
// the sheet has to be. A4 landscape is about 100px short of that, so the page is
// a touch taller than A4 rather than the charts a third smaller than the page.
const OPTION_CHART_WIDTH = 498;
const CHART_GAP = 32;

/**
 * Size an SVG from its own viewBox.
 *
 * The report's charts declare a viewBox and no width/height — in the app they
 * take their size from the flex column. Print layout has no such box to measure,
 * so a sizeless SVG gets a guessed one, and the marks either stretch or letterbox
 * inside it. Reading the ratio here (rather than hardcoding it) also means a
 * change to the chart's dimensions upstream can't silently mis-size this page:
 * the SVGs were 860 × 280 before the full-chain bars, and 860 × 460 after.
 */
function sizeSvg(svg, width) {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!box) throw new Error('chart SVG has no viewBox to size from');
  const height = Math.round((width * Number(box[2])) / Number(box[1]));
  return svg.replace(/<svg\b/, `<svg width="${width}" height="${height}"`);
}

function optionPage(charts) {
  return `
    <section class="page option-page">
      <header class="page-head"><h1>Options</h1></header>
      ${charts.map(chart => `
        <div class="option-block">
          <h2>${escapeHtml(chart.ticker)} · ${escapeHtml(chart.expiryLabel)}</h2>
          <div class="option-pair">
            <div class="option-chart">${sizeSvg(chart.callChartSvg, OPTION_CHART_WIDTH)}</div>
            <div class="option-chart">${sizeSvg(chart.putChartSvg, OPTION_CHART_WIDTH)}</div>
          </div>
        </div>`).join('')}
    </section>`;
}

function fundsTable(market, layer) {
  const showKind = market.id === 'korea';
  const reverse = layer.table === 'reverse';
  const funds = reverse ? market.reverseFunds : market.funds;
  const date = reverse ? market.reverseFundsDate : market.fundsDate;
  return `
    <table class="funds">
      <caption>${escapeHtml(layer.label)}, by fund · ${escapeHtml(date ?? '—')}</caption>
      <thead>
        <tr>
          <th>Fund</th>
          <th>Code</th>
          ${showKind ? '<th>Type</th>' : ''}
          <th>Launched</th>
          <th class="n">Net assets</th>
          <th class="n">Share of layer</th>
        </tr>
      </thead>
      <tbody>
        ${funds.map(fund => `
          <tr>
            <td>${escapeHtml(fund.name)}</td>
            <td class="code">${escapeHtml(fund.code)}</td>
            ${showKind ? `<td class="kind">${escapeHtml(fundKind(fund.kind))}</td>` : ''}
            <td class="kind">${escapeHtml(fund.launched)}</td>
            <td class="n">${escapeHtml(fund.aum)}</td>
            <td class="n">${escapeHtml(fund.share)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// One page per market, one chart per borrowed layer. Each chart is labelled with
// its own latest value at the final point, and the ETF chart carries the table of
// the funds that make it up.
function leveragePage(market, index) {
  // Korea has one additional credit layer and a longer long-ETF table. Give its
  // four plots a little less height while retaining the same chart treatment.
  const height = market.layers.length > 3 ? 140 : 220;
  return `
    <section class="page leverage-page">
      <header class="page-head">
        ${index === 0 ? '<h1>Leverage</h1>' : '<h1 class="continued">Leverage</h1>'}
        <h2>${escapeHtml(market.title)}</h2>
      </header>
      ${market.layers.map(layer => `
        <div class="leverage-chart-block">
          <h3><span class="lev-dot" style="background:${layer.color}"></span>${escapeHtml(layer.label)}</h3>
          <canvas
            id="leverage-${market.id}-${layer.key}"
            width="1032"
            height="${height}"
            style="height:${height}px"
          ></canvas>
          ${layer.table ? fundsTable(market, layer) : ''}
        </div>`).join('')}
    </section>`;
}

function buildHtml(options, markets) {
  const chartJs = fs.readFileSync(
    path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'),
    'utf8',
  );
  const leveragePayload = markets.flatMap(market => market.layers.map(layer => ({
    canvasId: `leverage-${market.id}-${layer.key}`,
    dates: market.dates,
    unit: market.unit,
    color: layer.color,
    data: layer.data,
    marks: layer.marks,
  })));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Options and Leverage</title>
  <style>
    @page { size: 297mm 280mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fefefe; color: ${INK}; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      position: relative;
      isolation: isolate;
      width: 297mm;
      height: 280mm;
      padding: 6mm 12mm;
      overflow: hidden;
      page-break-after: always;
      background: #fefefe;
      background-image: linear-gradient(#fefefe, #fefefe);
    }
    .page::before {
      content: "";
      position: absolute;
      inset: -6mm -12mm;
      z-index: 0;
      background: #fefefe;
      box-shadow: inset 0 0 0 220mm #fefefe;
    }
    .page > * { position: relative; z-index: 1; }
    .page:last-child { page-break-after: auto; }
    .page-head {
      min-height: 34px;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 7px;
    }
    h1, h2 { margin: 0; }
    h1 { font-size: 23px; font-weight: 650; letter-spacing: -.02em; }
    h2 { font-size: 15px; font-weight: 620; letter-spacing: -.01em; }

    .option-block + .option-block { margin-top: 6px; }
    .option-block h2 { font-size: 14px; margin-bottom: 2px; }
    .option-pair {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: ${CHART_GAP}px;
    }
    .option-chart svg { display: block; }
    .option-chart .vc-muted { fill: #6b7280; }
    .option-chart .vc-faint { fill: #8b93a1; }
    .option-chart .vc-ring { stroke: #fff; }
    .option-chart .vc-seam { stroke: #e5e7eb; }

    .leverage-page .page-head { margin-bottom: 8px; }
    .leverage-chart-block + .leverage-chart-block { margin-top: 14px; }
    .leverage-chart-block h3 {
      display: flex;
      align-items: center;
      gap: 7px;
      margin: 0 0 3px;
      font-size: 13px;
      font-weight: 620;
    }
    .lev-dot { width: 9px; height: 9px; border-radius: 2px; flex: none; }
    canvas { display: block; width: 1032px; }

    /* The funds behind the 2× ETF band, as the page lists them. */
    table.funds { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 8px; }
    table.funds caption {
      text-align: left;
      font-weight: 620;
      font-size: 11.5px;
      padding-bottom: 4px;
    }
    table.funds th {
      text-align: left;
      font-weight: 550;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: .05em;
      color: ${MUTED};
      border-bottom: 1px solid ${INK};
      padding: 4px 8px;
    }
    table.funds td { padding: 3px 8px; border-bottom: 1px solid #eceef1; }
    table.funds .n { text-align: right; font-variant-numeric: tabular-nums; }
    table.funds .code, table.funds .kind { color: ${MUTED}; }
  </style>
</head>
<body>
  ${optionPage(options)}
  ${markets.map(leveragePage).join('')}
  <script>${chartJs}</script>
  <script>
    const SURFACE = ${JSON.stringify(SURFACE)};
    const INK = ${JSON.stringify(INK)};
    const MUTED = ${JSON.stringify(MUTED)};
    const alpha = (hex, opacity) => {
      const value = parseInt(hex.slice(1), 16);
      return 'rgba(' + ((value >> 16) & 255) + ',' + ((value >> 8) & 255) + ','
        + (value & 255) + ',' + opacity + ')';
    };
    const monthLabel = iso => {
      const date = new Date(iso + 'T00:00:00Z');
      return date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
        + " '" + String(date.getUTCFullYear()).slice(-2);
    };

    // The called-out sessions: a dotted rule down to the axis, the figure on the point
    // it describes, and the date under the axis with the month ticks. This replaces the
    // row of stat cards — with one series per chart, the numbers belong on the points.
    const markedPoints = {
      id: 'markedPoints',
      afterDatasetsDraw(chart, args, options) {
        const { ctx, chartArea } = chart;
        const points = chart.getDatasetMeta(0).data;

        ctx.save();
        for (const mark of options.marks) {
          const point = points[mark.index];
          if (!point) continue;

          // Dropped from the plot's top to the axis, so the reader can carry the point
          // down to the date without counting gridlines.
          ctx.save();
          ctx.strokeStyle = options.color;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(point.x, chartArea.top);
          ctx.lineTo(point.x, chartArea.bottom);
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = options.color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
          ctx.fill();

          // Knocked out of whatever it sits on, so the digits never read as struck
          // through by the line or the band beneath them.
          ctx.lineWidth = 3.5;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = SURFACE;

          // The last point's label would run off the right edge if it were centred.
          ctx.textAlign = mark.anchor === 'right' ? 'right' : 'center';
          const x = mark.anchor === 'right' ? point.x - 2 : point.x;

          ctx.font = '700 12px Inter, system-ui, sans-serif';
          ctx.textBaseline = 'bottom';
          ctx.strokeText(mark.value, x, point.y - 8);
          ctx.fillStyle = options.color;
          ctx.fillText(mark.value, x, point.y - 8);

          // Under the month ticks, on the rule's own x — the axis row stays readable
          // and the marked dates sit a line below it. The last one keeps the right
          // anchor, or it runs off the edge and loses its year.
          ctx.font = '700 11px Inter, system-ui, sans-serif';
          ctx.textBaseline = 'top';
          const dateY = chartArea.bottom + 20;
          ctx.strokeText(mark.date, x, dateY);
          ctx.fillStyle = options.color;
          ctx.fillText(mark.date, x, dateY);
        }
        ctx.restore();
      },
    };

    for (const chart of ${JSON.stringify(leveragePayload)}) {
      new Chart(document.getElementById(chart.canvasId), {
        type: 'line',
        plugins: [markedPoints],
        data: {
          labels: chart.dates.map(monthLabel),
          datasets: [{
            data: chart.data,
            backgroundColor: alpha(chart.color, 0.42),
            borderColor: chart.color,
            borderWidth: 1.6,
            pointRadius: 0,
            tension: 0.25,
            fill: true,
          }],
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          animation: false,
          devicePixelRatio: 2,
          // Room above for the value labels, and below for the marked-date row that
          // sits under the axis ticks.
          layout: { padding: { top: 18, right: 10, bottom: 16 } },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
            markedPoints: { marks: chart.marks, color: chart.color },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: MUTED, maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } },
            },
            y: {
              // A filled area encodes value as height, so the baseline stays at zero.
              beginAtZero: true,
              grid: { color: '#e5e7eb' },
              ticks: { color: MUTED, font: { size: 10 }, callback: value => value + chart.unit },
            },
          },
        },
      });
    }
  </script>
</body>
</html>`;
}

async function main() {
  await storage.init(LEVERAGE_BLOBS);
  let htmlPath = null;
  try {
    const options = optionsCharts();
    const markets = leverageCharts();
    htmlPath = path.join(os.tmpdir(), `options-leverage-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, buildHtml(options, markets));
    await renderPdf({
      htmlPath,
      pdfPath: OUT,
      landscape: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    if (htmlPath) fs.rmSync(htmlPath, { force: true });
    await storage.close();
  }
  console.log(OUT);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
