/**
 * Export both leverage charts — five full years, print formatting — to one PDF.
 *
 * Reads the assembled series straight from the scrapers' stored history (the
 * same payload the page draws), renders a self-contained light-theme HTML with
 * Chart.js inlined from node_modules, then prints it through the project's CDP
 * renderer. Landscape, one market per page.
 *
 * Usage: node --env-file=.env server/scripts/exportLeveragePdf.js [out.pdf]
 */
const fs = require('fs');
const path = require('path');
const storage = require('../storage');
const { renderPdf } = require('./renderPdf');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOBS = [
  { name: 'koreaLeverageHistory',  file: path.join(DATA_DIR, 'koreaLeverageHistory.json') },
  { name: 'taiwanLeverageHistory', file: path.join(DATA_DIR, 'taiwanLeverageHistory.json') },
];

const OUT = process.argv[2] ?? path.join(process.cwd(), `asia-leverage-${new Date().toISOString().slice(0, 10)}.pdf`);

// Same hues as the dashboard, re-validated against a white surface: OKLCH
// lightness band, chroma floor, adjacent-pair CVD separation and ≥3:1 contrast
// all pass. Fills are translucent so the stacked bands stay legible on paper and
// the boundary lines read as edges rather than blocks.
const BLUE = '#4577b4', ORANGE = '#ad622d', PURPLE = '#7864b4', RATIO = '#238f80';
const FILL = 0.38;

const MARKETS = [
  {
    id: 'korea',
    blob: 'koreaLeverageHistory',
    read: () => require('../scrapers/koreaLeverage').readKoreaLeverage(),
    title: 'Korean retail leverage',
    subtitle: 'Margin loans, securities-collateral loans and 2× leveraged ETF net assets — daily, five years',
    unit: 'T', unitLong: 'trillions of won (KRW tn)', scale: 1,
    layers: [
      { key: 'collateral', label: 'Securities-collateral loans (예탁증권 담보융자)', color: BLUE },
      { key: 'margin',     label: 'Margin loans (신용거래융자)',                    color: ORANGE },
      { key: 'etf',        label: '2× leveraged ETFs',                            color: PURPLE },
    ],
    source: 'KOFIA FreeSIS (신용공여 잔고 추이) · Daum Finance ETF net assets (close × shares outstanding)',
  },
  {
    id: 'taiwan',
    blob: 'taiwanLeverageHistory',
    read: () => require('../scrapers/taiwanLeverage').readTaiwanLeverage(),
    title: 'Taiwan retail leverage',
    subtitle: 'Margin loans, Yuanta 2× ETF net assets and leverage / market cap — five years',
    unit: 'B', unitLong: 'billions of NT$ (NT$ bn)', scale: 0.1,
    layers: [
      { key: 'margin', label: 'Margin loans — TWSE listed + TPEx OTC (融資餘額)', color: ORANGE },
      { key: 'etf',    label: '2× leveraged ETFs (Yuanta, FUND_SIZE)',           color: PURPLE },
    ],
    ratio: { key: 'leverageRatio', label: 'Margin + Yuanta 2× / market cap', color: RATIO },
    source: 'TWSE MI_MARGN · TPEx 融資餘額 summary · Yuanta fund-size API · TWSE weekly market cap · TPEx OTC market value',
  },
];

const round1 = v => Math.round(v * 10) / 10;

function prepare(market) {
  const d = market.read();
  const k = market.scale;
  const sc = a => (a ?? []).map(v => (Number.isFinite(v) ? round1(v * k) : null));

  const series = Object.fromEntries(market.layers.map(l => [l.key, sc(d[l.key])]));
  const total = d.dates.map((_, i) => round1(market.layers.reduce((s, l) => s + (series[l.key][i] ?? 0), 0)));
  const latest = Object.fromEntries(market.layers.map(l => [l.key, series[l.key][d.dates.length - 1]]));

  return {
    ...market,
    dates: d.dates,
    series,
    total,
    ratio: market.ratio
      ? { ...market.ratio, data: (d[market.ratio.key] ?? []).map(v => (Number.isFinite(v) ? v : null)) }
      : null,
    marketSizeDate: d.marketSizeDate ?? null,
    latest,
    latestDate: d.dates[d.dates.length - 1],
    latestTotal: total[total.length - 1],
    firstTotal: total[0],
    funds: (d.funds ?? []).map(f => ({ ...f, aum: round1(f.aum * k) })),
    fundsDate: d.fundsDate,
  };
}

function page(m) {
  const chg = m.firstTotal ? ((m.latestTotal - m.firstTotal) / m.firstTotal) * 100 : 0;
  const tiles = [
    { label: 'Total borrowed', value: `${m.latestTotal.toFixed(1)}${m.unit}`, sub: `5Y ${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`, color: '#1f2328' },
    ...m.layers.map(l => ({
      label: l.label.replace(/\s*\(.*\)\s*/, ''),
      value: `${(m.latest[l.key] ?? 0).toFixed(1)}${m.unit}`,
      sub: `${(((m.latest[l.key] ?? 0) / m.latestTotal) * 100).toFixed(0)}% of stack`,
      color: l.color,
    })),
  ];

  return `
  <section class="page">
    <header>
      <h1>${m.title}</h1>
      <p class="sub">${m.subtitle}</p>
    </header>

    <div class="tiles">
      ${tiles.map(t => `
        <div class="tile">
          <div class="t-label"><span class="dot" style="background:${t.color}"></span>${t.label}</div>
          <div class="t-value">${t.value}</div>
          <div class="t-sub">${t.sub}</div>
        </div>`).join('')}
    </div>

    <div class="chart"><canvas id="c-${m.id}" width="1055" height="255"></canvas></div>

    <div class="legend">
      ${m.layers.map(l => `<span><i style="background:${l.color}"></i>${l.label}</span>`).join('')}
      <span><i class="line"></i>Total</span>
      ${m.ratio ? `<span><i class="ratio-line" style="background:${m.ratio.color}"></i>${m.ratio.label}</span>` : ''}
    </div>

    <table class="funds">
      <caption>2× leveraged ETF layer, by fund · ${m.fundsDate ?? '—'}</caption>
      <thead><tr><th>Fund</th><th>Code</th><th class="n">Net assets</th><th class="n">Share of layer</th></tr></thead>
      <tbody>
        ${m.funds.map(f => `<tr>
          <td>${f.name}</td><td class="code">${f.code}</td>
          <td class="n">${f.aum.toFixed(1)}${m.unit}</td>
          <td class="n">${m.latest.etf ? ((f.aum / m.latest.etf) * 100).toFixed(1) : '—'}%</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <p class="note">
      In ${m.unitLong}, one point per trading day, ${m.dates[0]} → ${m.latestDate} (${m.dates.length} trading days).
      Source: ${m.source}. Every layer is a measured figure, not an estimate. Cash balances are excluded — they are dry powder, not leverage.
      ${m.ratio ? `The ratio denominator is combined TWSE + TPEx equity market capitalization, observed weekly and carried forward; latest observation ${m.marketSizeDate ?? '—'}.` : ''}
    </p>
  </section>`;
}

function html(markets) {
  const chartjs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), 'utf8');
  const payload = markets.map(m => ({
    id: m.id, dates: m.dates, total: m.total, unit: m.unit,
    layers: m.layers.map(l => ({ key: l.key, label: l.label, color: l.color, data: m.series[l.key] })),
    ratio: m.ratio,
  }));

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Asia retail leverage — five years</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #fff; color: #1f2328;
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { padding: 22px 34px 16px; page-break-after: always; height: 794px; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  header { border-bottom: 1.5px solid #1f2328; padding-bottom: 6px; margin-bottom: 10px; }
  h1 { margin: 0; font-size: 21px; font-weight: 650; letter-spacing: -.01em; }
  .sub { margin: 3px 0 0; font-size: 12px; color: #5b6570; }

  .tiles { display: flex; gap: 10px; margin-bottom: 10px; }
  .tile { flex: 1; border: 1px solid #d9dde2; border-radius: 5px; padding: 6px 10px; }
  .t-label { display: flex; align-items: center; gap: 6px; font-size: 9.5px; letter-spacing: .05em;
             text-transform: uppercase; color: #5b6570; }
  .dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .t-value { font-size: 18px; font-weight: 640; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .t-sub { font-size: 10.5px; color: #5b6570; font-variant-numeric: tabular-nums; }

  /* Sized in the canvas attributes, not by the layout: Chart.js measures its box
     on construction, and in print that happens before the page box is final —
     responsive sizing left the plot at two-thirds width. */
  .chart { width: 1055px; height: 255px; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 10.5px; color: #3d444d; margin: 6px 0 10px; }
  .legend span { display: flex; align-items: center; gap: 6px; }
  .legend i { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  .legend i.line { height: 2px; width: 14px; border-radius: 0; background: #1f2328; }
  .legend i.ratio-line { height: 2px; width: 14px; border-radius: 0; }

  table.funds { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  table.funds caption { text-align: left; font-weight: 620; font-size: 11px; padding-bottom: 4px; }
  table.funds th { text-align: left; font-weight: 550; font-size: 9.5px; text-transform: uppercase;
                   letter-spacing: .05em; color: #5b6570; border-bottom: 1px solid #1f2328; padding: 4px 8px; }
  table.funds td { padding: 2px 8px; border-bottom: 1px solid #eceef1; }
  table.funds .n { text-align: right; font-variant-numeric: tabular-nums; }
  table.funds .code { color: #5b6570; font-variant-numeric: tabular-nums; }

  .note { margin-top: 8px; font-size: 9px; line-height: 1.45; color: #5b6570; max-width: 100%; }
</style></head>
<body>
${markets.map(page).join('\n')}
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
for (const m of ${JSON.stringify(payload)}) {
  new Chart(document.getElementById('c-' + m.id), {
    type: 'line',
    data: {
      labels: m.dates.map(monthLabel),
      datasets: [
        ...m.layers.map(l => ({
          label: l.label,
          data: l.data,
          // Translucent fill, solid edge: the bands stay distinguishable where
          // they overlap on paper and each boundary still reads as a line.
          backgroundColor: hexToRgba(l.color, FILL),
          borderColor: l.color,
          borderWidth: 1.2,
          pointRadius: 0,
          tension: 0.2,
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
          tension: 0.2,
          fill: false,
        },
        ...(m.ratio ? [{
          label: m.ratio.label,
          data: m.ratio.data,
          yAxisID: 'ratio',
          borderColor: m.ratio.color,
          borderWidth: 1.6,
          pointRadius: 0,
          tension: 0,
          fill: false,
          order: -1,
        }] : []),
      ],
    },
    options: {
      responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 2,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5b6570', maxTicksLimit: 16, maxRotation: 0, font: { size: 9 } } },
        y: {
          stacked: true, beginAtZero: true,
          grid: { color: '#eceef1' },
          ticks: { color: '#5b6570', font: { size: 9 }, callback: v => v + m.unit },
        },
        ...(m.ratio ? {
          ratio: {
            position: 'right', beginAtZero: false,
            grid: { drawOnChartArea: false },
            ticks: { color: m.ratio.color, font: { size: 9 }, callback: v => Number(v).toFixed(2) + '%' },
          },
        } : {}),
      },
    },
  });
}
</script>
</body></html>`;
}

async function main() {
  await storage.init(BLOBS);
  const markets = MARKETS.map(prepare);
  await storage.close();

  const htmlPath = path.join(require('os').tmpdir(), `leverage-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, html(markets));

  await renderPdf({ htmlPath, pdfPath: OUT, landscape: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  fs.unlinkSync(htmlPath);

  for (const m of markets) {
    console.log(`[leverage-pdf] ${m.title}: ${m.dates.length} days ${m.dates[0]} → ${m.latestDate}, total ${m.latestTotal}${m.unit}`);
  }
  console.log(`[leverage-pdf] wrote ${OUT}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('[leverage-pdf] failed:', e); process.exit(1); });
