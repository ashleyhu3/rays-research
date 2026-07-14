/**
 * Export the Alerts option-volume charts (TSM, SOXX, ASML — nearest expiration
 * only) and both leverage charts to one print PDF.
 *
 * The charts are the site's own: the option SVGs are lifted verbatim from the
 * stored daily report (the same markup the Alerts page injects), and the
 * leverage stacks are re-drawn from stored history with the page's Chart.js
 * config. Only the surface changes — the dark-theme CSS variables the SVG
 * classes resolve against are re-bound to a white page, and the leverage hues
 * are the print-validated variants already used by exportLeveragePdf.
 *
 * Usage: node --env-file=.env server/scripts/exportChartsPdf.js [out.pdf]
 */
const fs = require('fs');
const path = require('path');
const storage = require('../storage');
const {
  PRIOR_BLOB, buildStructuredReport, generateDailyOptionsReport, today,
} = require('./generateDailyOptionsReport');
const { renderPdf } = require('./renderPdf');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOBS = [
  PRIOR_BLOB,
  { name: 'koreaLeverageHistory',  file: path.join(DATA_DIR, 'koreaLeverageHistory.json') },
  { name: 'taiwanLeverageHistory', file: path.join(DATA_DIR, 'taiwanLeverageHistory.json') },
];

const OUT = process.argv[2] ?? path.join(process.cwd(), `charts-${new Date().toISOString().slice(0, 10)}.pdf`);

const TICKERS = ['TSM', 'SOXX', 'ASML'];

// Leverage: the page's hues, re-validated for a white surface, and its default
// window (12M). Fills stay translucent so the stacked bands read as layers.
const BLUE = '#4577b4', ORANGE = '#ad622d', PURPLE = '#7864b4';
const FILL = 0.38;
const WINDOW_DAYS = 366;

const MARKETS = [
  {
    id: 'korea',
    label: 'Korea',
    read: () => require('../scrapers/koreaLeverage').readKoreaLeverage(),
    unit: 'T', scale: 1,
    layers: [
      { key: 'collateral', label: 'Securities-collateral loans', color: BLUE },
      { key: 'margin',     label: 'Margin loans',                color: ORANGE },
      { key: 'etf',        label: '2× leveraged ETFs',           color: PURPLE },
    ],
  },
  {
    id: 'taiwan',
    label: 'Taiwan',
    read: () => require('../scrapers/taiwanLeverage').readTaiwanLeverage(),
    unit: 'B', scale: 0.1,
    layers: [
      { key: 'margin', label: 'Margin loans',      color: ORANGE },
      { key: 'etf',    label: '2× leveraged ETFs', color: PURPLE },
    ],
  },
];

const round1 = v => Math.round(v * 10) / 10;

function prepare(market) {
  const d = market.read();
  const k = market.scale;
  // Calendar cutoff, not a row count — the page's 12M window is 366 days back
  // from the last observation, and the two markets don't trade the same days.
  const last = d.dates[d.dates.length - 1];
  const cutoff = new Date(new Date(`${last}T00:00:00Z`).getTime() - WINDOW_DAYS * 86400000)
    .toISOString().slice(0, 10);
  const from = Math.max(0, d.dates.findIndex(x => x >= cutoff));
  const dates = d.dates.slice(from);
  const sc = a => (a ?? []).slice(from).map(v => (Number.isFinite(v) ? round1(v * k) : null));

  const series = Object.fromEntries(market.layers.map(l => [l.key, sc(d[l.key])]));
  const total = dates.map((_, i) => round1(market.layers.reduce((s, l) => s + (series[l.key][i] ?? 0), 0)));

  return {
    id: market.id,
    label: market.label,
    unit: market.unit,
    dates,
    total,
    layers: market.layers.map(l => ({ ...l, data: series[l.key] })),
    cards: [
      { label: 'Total firepower', value: total.at(-1), color: '#1f2328' },
      ...market.layers.map(layer => ({
        label: layer.label,
        value: series[layer.key].at(-1),
        color: layer.color,
      })),
    ],
  };
}

/**
 * Scrape the three tickers fresh rather than reusing the stored report.
 *
 * The stored report's bars are the summed volume of a day's top three contracts
 * — it was generated before the chart moved to the full chain, and its SVGs are
 * baked in, so nothing downstream can widen them after the fact. Regenerating
 * with the current code is what makes a bar the whole expiration's volume for
 * that session, which is what the chart claims to show.
 *
 * This writes no report to storage; it only leaves the prior-chain volume cache
 * warmer than it found it.
 */
async function optionTickers() {
  const { report } = await generateDailyOptionsReport({
    date: today(),
    tickers: TICKERS,
    out: path.join(require('os').tmpdir(), `options-${Date.now()}.html`),
  });
  const structured = buildStructuredReport(report);

  return TICKERS.map(name => {
    const t = structured.tickers.find(x => x.ticker === name);
    if (!t) throw new Error(`${name} is missing from the generated report`);
    // "Most recent expiration" — the nearest one, which is the first the page lists.
    const exp = [...(t.expirations ?? [])].sort((a, b) => a.selectedDate.localeCompare(b.selectedDate))[0];
    if (!exp) throw new Error(`${name} has no expirations`);
    return { ticker: name, exp };
  });
}

/**
 * The report's SVGs declare a viewBox but no width/height — in the app they get
 * their size from the flex column. Print layout has no such box to measure, and
 * a sizeless SVG letterboxes its marks inside whatever Chrome guesses. Give it
 * the viewBox's own dimensions so `width: 100%` scales it faithfully.
 */
function sized(svg) {
  return svg.replace(
    /<svg\b(?![^>]*\bwidth=)([^>]*viewBox="0 0 (\d+) (\d+)")/,
    (_, rest, w, h) => `<svg width="${w}" height="${h}"${rest}`);
}

function html(options, markets) {
  const chartjs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), 'utf8');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Options · Leverage</title>
<style>
  @page options { size: A4 portrait; margin: 0; }
  @page leverage { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #fefefe; color: #1f2328;
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    position: relative; isolation: isolate; padding: 26px 34px;
    page-break-after: always; overflow: hidden;
    background: #fefefe; background-image: linear-gradient(#fefefe, #fefefe);
  }
  .page::before {
    content: ""; position: absolute; inset: -26px -34px; z-index: 0;
    background: #fefefe; box-shadow: inset 0 0 0 300mm #fefefe;
  }
  .page > * { position: relative; z-index: 1; }
  .page:last-child { page-break-after: auto; }
  .option-page { page: options; height: 1123px; }
  .leverage-page { page: leverage; height: 794px; }
  h1 { margin: 0 0 14px; font-size: 22px; font-weight: 650; letter-spacing: -.01em;
       border-bottom: 1.5px solid #1f2328; padding-bottom: 6px; }

  .row-label { font-size: 13px; font-weight: 650; letter-spacing: .02em; margin-bottom: 7px; }
  .option-stack { display: grid; gap: 12px; }
  .option-stack svg { width: 100%; height: auto; display: block; }

  /* The report's SVGs paint their text through CSS classes that resolve against
     the app's dark card. Re-bind them to the white page: same marks, readable ink,
     and the label halo knocked out in the paper colour rather than in card grey. */
  .volume-chart .vc-muted { fill: #4b5563; }
  .volume-chart .vc-faint { fill: #6b7280; }
  .volume-chart .vc-ring  { stroke: #ffffff; }
  .volume-chart .vc-seam  { stroke: #cbd1d8; }

  .lev { height: 337px; }
  .lev + .lev { margin-top: 3px; }
  .lev-title { margin: 0 0 5px; font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
  .cards { display: flex; gap: 9px; margin-bottom: 6px; }
  .card { flex: 1; min-width: 0; border: 1px solid #d9dde2; border-radius: 6px; padding: 6px 10px; }
  .card-label {
    display: flex; align-items: center; gap: 6px; color: #5b6570;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
  }
  .card-label i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .card-value { margin-top: 2px; color: #1f2328; font-size: 17px; font-weight: 620; font-variant-numeric: tabular-nums; }
  .chart { width: 1055px; height: 238px; }
</style></head>
<body>
  ${options.map(o => `
    <section class="page option-page">
      <h1>Options</h1>
      <div>
        <div class="row-label">${o.ticker} · ${o.exp.expiryLabel}</div>
        <div class="option-stack">
          <div>${sized(o.exp.callChartSvg)}</div>
          <div>${sized(o.exp.putChartSvg)}</div>
        </div>
      </div>
    </section>`).join('')}

  <section class="page leverage-page">
    <h1>Leverage</h1>
    ${markets.map(m => `
      <div class="lev">
        <h2 class="lev-title">${m.label}</h2>
        <div class="cards">
          ${m.cards.map(card => `
            <div class="card">
              <div class="card-label"><i style="background:${card.color}"></i>${card.label}</div>
              <div class="card-value">${Number(card.value).toFixed(1)}${m.unit}</div>
            </div>`).join('')}
        </div>
        <div class="chart"><canvas id="c-${m.id}" width="1055" height="238"></canvas></div>
      </div>`).join('')}
  </section>

<script>${chartjs}</script>
<script>
const FILL = ${FILL};
const hexToRgba = (h, a) => {
  const n = parseInt(h.slice(1), 16);
  return \`rgba(\${(n >> 16) & 255},\${(n >> 8) & 255},\${n & 255},\${a})\`;
};
const monthLabel = iso => {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + " '" + String(d.getUTCFullYear()).slice(-2);
};
for (const m of ${JSON.stringify(markets)}) {
  new Chart(document.getElementById('c-' + m.id), {
    type: 'line',
    data: {
      labels: m.dates.map(monthLabel),
      datasets: [
        ...m.layers.map(l => ({
          label: l.label,
          data: l.data,
          backgroundColor: hexToRgba(l.color, FILL),
          borderColor: l.color,
          borderWidth: 1.2,
          pointRadius: 0,
          tension: 0.25,
          fill: true,
          stack: 's',
        })),
        {
          label: 'Total',
          data: m.total,
          stack: 't',
          borderColor: '#1f2328',
          borderWidth: 1.6,
          pointRadius: 0,
          tension: 0.25,
          fill: false,
        },
      ],
    },
    options: {
      responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 2,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5b6570', maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } } },
        y: {
          stacked: true, beginAtZero: true,
          grid: { color: '#eceef1' },
          ticks: { color: '#5b6570', font: { size: 10 }, callback: v => v + m.unit },
        },
      },
    },
  });
}
</script>
</body></html>`;
}

async function main() {
  await storage.init(BLOBS);
  const options = await optionTickers();
  const markets = MARKETS.map(prepare);
  await storage.close();

  const htmlPath = path.join(require('os').tmpdir(), `charts-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html(options, markets));

  await renderPdf({ htmlPath, pdfPath: OUT, landscape: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  fs.unlinkSync(htmlPath);

  for (const o of options) console.log(`[charts-pdf] ${o.ticker} — ${o.exp.expiryLabel}`);
  for (const m of markets) console.log(`[charts-pdf] ${m.id} leverage: ${m.dates[0]} → ${m.dates[m.dates.length - 1]}`);
  console.log(`[charts-pdf] wrote ${OUT}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[charts-pdf] failed:', e); process.exit(1); });
