import { useEffect, useMemo, useState } from 'react';
import { Bar, Bubble } from 'react-chartjs-2';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-50m.json';
import { C, fa } from '../../config/colors';
import { stackedOpts, hBarOpts, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { CompanySupplyTable } from './SupplyChainMatrix';

const worldCountries = feature(worldData, worldData.objects.countries);

/* ─── Constants ──────────────────────────────────────────────────── */
const YEARS = ['2022F', '2023F', '2024F', '2025F', '2026F', '2027F', '2028F', '2029F', '2030F'];
const YEARS_NUM = YEARS.map(y => parseInt(y));

// Uniform height for every company buildout-timeline chart.
const TIMELINE_H = 480;

// Map company key → brand color
const CO_COLOR = {
  aws:       C.anthropic,
  google:    C.google,
  microsoft: C.deepseek,
  oracle:    C.red,
  openai:    '#e5e7eb',
  nebius:    '#a3e635',
  meta:      C.meta,
};

// Colors for operator ranking bars (top 19)
const OP_COLORS = [
  '#e5e7eb', C.teal,  C.orange, C.google, C.meta,
  C.anthropic, C.perplexity, '#a3e635', C.mistral, C.red,
  C.slate, C.kimi, C.minimax, C.qwen, C.deepseek,
  C.xiaomi, C.baidu, '#a3a3a3', C.zhipu,
];

function companyColor(name) {
  const map = {
    OpenAI: '#e5e7eb', SoftBank: C.teal, Nscale: C.orange,
    Google: C.google, Meta: C.meta, AWS: C.anthropic,
    Microsoft: C.deepseek, CoreWeave: C.perplexity, Nebius: '#a3e635',
    Oracle: '#f87171', HUMAIN: C.mistral, IREN: C.red, 'Hut 8': C.slate,
    Reliance: C.kimi, Adani: C.qwen, xAI: '#a3a3a3',
    'Fir Hills': C.minimax, Crusoe: C.xiaomi, 'Lodha Developers': C.baidu,
    'Galaxy Digital': '#fbbf24', Fluidstack: '#818cf8', Pooleide: '#34d399',
    'SK Group': '#fb923c', 'SK Telecom': '#f472b6',
    Tata: '#a78bfa', 'du UAE': '#67e8f9', 'France/UAE': '#e879f9',
    'MGX/': '#84cc16', 'Thinking Machines': '#f9a8d4', 'Applied Digital': '#6ee7b7',
    'GMI Cloud': '#fde68a', NAVER: '#c4b5fd',
  };
  for (const [k, v] of Object.entries(map)) if (name.startsWith(k)) return v;
  return C.slate;
}

/* ─── Per-operator stacked chart config ──────────────────────────── */
const CC_MAP = { openai: 'OpenAI', google: 'Google', meta: 'Meta', aws: 'AWS', microsoft: 'Microsoft', oracle: 'Oracle', nebius: 'Nebius' };
const CC_NAMES = new Set(Object.values(CC_MAP));

function isKnownOp(company) {
  for (const n of CC_NAMES) if (company.startsWith(n)) return true;
  return false;
}

/* ─── Tooltip helpers ─────────────────────────────────────────────── */
const TTP_BASE = {
  backgroundColor: '#1a1f2a',
  borderColor: 'rgba(255,255,255,.12)',
  borderWidth: 1,
  titleFont: { family: "'Inter',sans-serif", size: 11 },
  bodyFont:  { family: "'Inter',sans-serif", size: 11 },
  padding: 10,
};

function gwToR(gw) { return Math.max(4, Math.sqrt(gw) * 9); }

/* ─── Geocoding for buildout-timeline locations ───────────────────────
   The buildout-timeline projects (companyCharts) carry a location string but
   no coordinates, so the company map plots the *same* projects as the timeline
   by looking their location up here ([lat, lon]). Parentheticals like
   "(Stargate)" / "(x AMD)" are stripped before lookup. Non-geographic entries
   ("Worldwide", "Space") are intentionally absent → not plotted. */
const GEO_LOOKUP = {
  'Abu Dhabi, UAE': [24.45, 54.38], 'Across US': [39.5, -98.35], 'Argentina': [-38.4, -63.6],
  'Australia': [-25.3, 133.8], 'Belgium': [50.5, 4.47], 'Bethune, Lille, France': [50.53, 2.64],
  'Canada': [56.13, -106.35], 'Chile': [-35.68, -71.54], 'Dammam, Saudi Arabia': [26.43, 50.10],
  'Dietzenbach, Germany': [50.01, 8.78], 'El Paso, Texas': [31.76, -106.49], 'France': [46.6, 2.35],
  'Georgia, US': [32.9, -83.6], 'Germany': [51.16, 10.45], 'Hermantown, Minnesota': [46.80, -92.24],
  'Horndal, Sweden': [60.29, 16.42], 'India': [20.59, 78.96], 'Indonesia': [-0.79, 113.92],
  'Israel': [31.05, 34.85], 'Kansas City, US': [39.10, -94.58], 'Keflavik, Iceland': [64.00, -22.56],
  'Kronstorf, Austria': [48.13, 14.44], 'Lappeenranta, Finland': [61.06, 28.19],
  'Lebanon, Indiana': [40.05, -86.47], 'Lenoir, North Carolina': [35.91, -81.54],
  'Lima, Ohio': [40.74, -84.11], 'Loughton, UK': [51.65, 0.06], 'Louisiana': [30.98, -91.96],
  'Malaysia': [4.21, 101.98], 'Medina County, Texas': [29.36, -99.11], 'Mississippi': [32.35, -89.40],
  'Missouri': [38.46, -92.29], 'Missouri/Kansas City': [39.10, -94.58], 'Mäntsälä, Finland': [60.63, 25.32],
  'Netherlands': [52.13, 5.29], 'New Albany, Ohio': [40.08, -82.80], 'Northern Indiana': [41.2, -86.3],
  'Northwest Louisiana': [32.5, -93.75], 'Norway': [60.47, 8.47], 'Oklahoma, US': [35.47, -97.52],
  'Paris, France': [48.86, 2.35], 'Pennsylvania, US': [41.20, -77.19], 'Pine Island, MN': [44.20, -92.66],
  'Richmond County, NC': [34.96, -79.75], 'Saudi Arabia': [23.89, 45.08], 'Sines, Portugal': [37.96, -8.87],
  'Singapore': [1.35, 103.82], 'South Carolina, US': [33.84, -80.95], 'South Korea': [36.5, 127.85],
  'Spain': [40.46, -3.75], 'St. Joseph Co., Indiana': [41.62, -86.29], 'Sweden': [60.13, 18.64],
  'Sydney, Australia': [-33.87, 151.21], 'Taiwan': [23.70, 120.96], 'Texas': [31.0, -99.0],
  'Thailand': [15.87, 100.99], 'UAE': [23.42, 53.85], 'UK': [54.0, -2.0], 'US': [39.5, -98.35],
  'Van Buren Twp., MI': [42.20, -83.56], 'Varde/Esbjerg, Denmark': [55.62, 8.48],
  'Vineland, New Jersey': [39.49, -75.03], 'Virginia, US': [37.43, -78.66],
  'Visakhapatnam, India': [17.69, 83.22], 'Waltham Cross, UK': [51.69, -0.03],
  'Warren County, Mississippi': [32.36, -90.85], 'Wisconsin, US': [44.5, -89.5],
};

function geocode(location) {
  const key = (location ?? '').replace(/\s*\([^)]*\)/g, '').trim();
  return GEO_LOOKUP[key] ?? null;
}

// Bubble radius from whichever metric the timeline project carries.
function projectRadius(p) {
  if (p.gw)    return gwToR(p.gw);
  if (p.usdBn) return Math.max(4, Math.sqrt(p.usdBn) * 3);
  return 5;
}

/* ─── Company geo data — the SAME projects as the buildout timeline ──── */
function companyTimelineGeoData(projects, color) {
  const pts = [];
  for (const p of (projects ?? [])) {
    const coord = geocode(p.location);
    if (!coord) continue;
    pts.push({
      x: coord[1], y: coord[0], r: projectRadius(p),
      gw: p.gw, usdBn: p.usdBn, location: p.location, partners: p.partners, notes: p.notes, label: p.location,
    });
  }
  return {
    datasets: [{
      label: 'Datacenters', data: pts,
      backgroundColor: fa(color, 0.55), borderColor: color, borderWidth: 1.5,
    }],
  };
}

/* ─── Auto-fit map bounds to a company's points ───────────────────────
   Zoom to the smallest box enclosing every plotted datacenter (+ padding),
   nudged toward the card's ~2:1 aspect so a US-only footprint fills the frame
   as "just America" rather than a stretched world strip. */
const GEO_ASPECT = 2.0; // lon-span : lat-span
const GEO_PAD    = 0.18; // fraction of span added as breathing room

function geoBounds(points) {
  if (!points.length) return { xMin: -170, xMax: 180, yMin: -55, yMax: 80 };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
  }
  const xc = (xMin + xMax) / 2, yc = (yMin + yMax) / 2;
  let xSpan = Math.max(xMax - xMin, 12) * (1 + GEO_PAD);
  let ySpan = Math.max(yMax - yMin, 8)  * (1 + GEO_PAD);
  if (xSpan / ySpan < GEO_ASPECT) xSpan = ySpan * GEO_ASPECT;
  else                            ySpan = xSpan / GEO_ASPECT;
  return {
    xMin: Math.max(xc - xSpan / 2, -180), xMax: Math.min(xc + xSpan / 2, 180),
    yMin: Math.max(yc - ySpan / 2, -60),  yMax: Math.min(yc + ySpan / 2, 84),
  };
}

function companyBubbleOpts(bounds) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...TTP_BASE,
        callbacks: {
          title: () => '',
          label: c => {
            const p = c.raw;
            const head = p.gw ? `${p.gw} GW` : p.usdBn ? `$${p.usdBn}bn` : '';
            const lines = [` ${p.location ?? p.label}${head ? `: ${head}` : ''}`];
            if (p.gw && p.usdBn) lines.push(` $${p.usdBn}bn`);
            if (p.partners)      lines.push(` Partners: ${p.partners}`);
            if (p.notes)         lines.push(` ${p.notes}`);
            return lines;
          },
        },
      },
    },
    scales: {
      x: {
        min: bounds.xMin, max: bounds.xMax, grid: GRID, border: BORD,
        ticks: { ...TICK, callback: v => `${v > 0 ? '+' : ''}${Math.round(v)}°` },
      },
      y: {
        min: bounds.yMin, max: bounds.yMax, grid: GRID, border: BORD,
        ticks: { ...TICK, callback: v => `${Math.round(v)}°N` },
      },
    },
  };
}

/* ─── Stacked-bar options ─────────────────────────────────────────── */
function buildStackedOpts() {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: dcStackedTooltip },
    },
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v} GW` }, border: BORD, stacked: true, beginAtZero: true },
    },
  };
}

/* ─── Deployment-mix chart: incremental GW by buyer (OpenAI/CSP/Other) ─── */
// The source data only gives "Top 4 CSPs" as a single aggregate per year. We
// split it across the four hyperscaler CSPs by their share of announced project
// capacity (GW sums: Oracle 10.0, Google 9.6, AWS 8.9, Microsoft 2.4 = 30.9).
// The first (largest) company takes the remainder so the four always sum to the
// aggregate exactly — no rounding drift vs the original "Top 4 CSPs" values.
const CSP_SPLIT = [
  { label: 'Oracle',     color: C.red,       share: 10.0 / 30.9 },
  { label: 'Google',     color: C.google,    share:  9.6 / 30.9 },
  { label: 'Amazon AWS', color: C.anthropic, share:  8.9 / 30.9 },
  { label: 'Microsoft',  color: C.deepseek,  share:  2.4 / 30.9 },
];

function deployTrendData(dt) {
  const years = dt?.years ?? [];
  const csp   = dt?.csp ?? [];

  // Per-company series that sum to the aggregate CSP value each year.
  const cspSeries = CSP_SPLIT.map(() => Array(years.length).fill(0));
  csp.forEach((v, yi) => {
    let allocated = 0;
    for (let i = CSP_SPLIT.length - 1; i >= 1; i--) {
      const val = +(v * CSP_SPLIT[i].share).toFixed(4);
      cspSeries[i][yi] = val;
      allocated += val;
    }
    cspSeries[0][yi] = +(v - allocated).toFixed(4); // remainder → exact match
  });

  const mk = (label, arr, color) => ({
    label, data: arr ?? [],
    backgroundColor: fa(color, 0.8), borderColor: color, borderWidth: 1, borderRadius: 3,
  });

  return {
    labels: years,
    datasets: [
      mk('OpenAI', dt?.openai, '#e5e7eb'),
      ...CSP_SPLIT.map((c, i) => mk(c.label, cspSeries[i], c.color)),
      mk('Others', dt?.others, C.slate),
    ],
  };
}

function deployTrendOpts() {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...TTP_BASE,
        callbacks: {
          label: c => {
            const total = c.chart.data.datasets.reduce((s, ds) => s + (ds.data[c.dataIndex] ?? 0), 0);
            const pct = total ? Math.round((c.parsed.y / total) * 100) : 0;
            return ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)} GW (${pct}%)`;
          },
          footer: items => {
            const total = items.reduce((s, it) => s + (it.parsed.y ?? 0), 0);
            return `  Total: ${total.toFixed(2)} GW`;
          },
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v} GW` }, border: BORD, stacked: true, beginAtZero: true },
    },
  };
}

/* ─── Per-company stacked investment chart ────────────────────────── */
const PLACEHOLDER_BN = 5; // fixed $bn height for projects with no cost data

function companyBarData(projects, color) {
  const all = projects ?? [];

  const makeDs = (p, hasCost) => {
    const val   = hasCost ? +(p.usdBn ?? (p.eurBn * 1.08)).toFixed(1) : PLACEHOLDER_BN;
    const start = Math.floor(p.startYear ?? 2022);
    const end   = Math.floor(p.endYear   ?? start);
    const data  = Array(YEARS_NUM.length).fill(0);
    for (let yr = start; yr <= end; yr++) {
      const idx = YEARS_NUM.indexOf(yr);
      if (idx >= 0) data[idx] = val;
    }
    return {
      label: p.location,
      data,
      pdata: p,
      hasCost,
      backgroundColor: fa(color, hasCost ? 0.78 : 0.2),
      borderColor:     fa(color, hasCost ? 1.0  : 0.4),
      borderWidth: 1,
      borderRadius: 2,
    };
  };

  // Cost projects rendered first (bottom of stack), no-cost on top (translucent)
  const costDs   = all.filter(p =>  p.usdBn || p.eurBn).map(p => makeDs(p, true));
  const noCostDs = all.filter(p => !p.usdBn && !p.eurBn).map(p => makeDs(p, false));

  return { labels: YEARS, datasets: [...costDs, ...noCostDs] };
}

/* ─── External HTML tooltip for timeline charts ───────────────────────
   Rendered as an absolutely-positioned DOM node inside the chart body (not
   on the canvas), so it can grow past the chart-card bounds and sit right
   next to the hovered bar. */
function fmtYear(y) {
  if (y == null) return '';
  const whole = Math.floor(y);
  const q = Math.round((y - whole) * 4); // 0,.25,.5,.75 → quarter
  return q > 0 && q < 4 ? `${whole} Q${q + 1}` : `${whole}`;
}

// Shared DOM node for the external tooltips (one per chart, cached on its parent).
function getDcTooltipEl(chart) {
  const parent = chart.canvas.parentNode;
  let el = parent.querySelector(':scope > .dc-tt');
  if (!el) {
    el = document.createElement('div');
    el.className = 'dc-tt';
    parent.appendChild(el);
  }
  return el;
}

// Place the tooltip beside the hovered bar. It is allowed to overflow the card
// (top clamped to the card, horizontal flip near the right edge) so it never
// gets clipped by the canvas the way an on-canvas tooltip would.
function positionDcTooltip(el, chart, tooltip) {
  const cx = chart.canvas.offsetLeft + tooltip.caretX;
  const cy = chart.canvas.offsetTop  + tooltip.caretY;
  const w  = el.offsetWidth;
  const GAP = 14;

  let left = cx + GAP;
  if (tooltip.caretX + GAP + w > chart.width) left = cx - w - GAP;
  if (left < 0) left = 0;

  let top = cy - el.offsetHeight / 2;
  if (top < 0) top = 0;

  el.style.left = `${left}px`;
  el.style.top  = `${top}px`;
}

function dcTimelineTooltip(context) {
  const { chart, tooltip } = context;
  const el = getDcTooltipEl(chart);

  if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

  // Index-mode: list every project that is active (bar > 0) in this year.
  const points = (tooltip.dataPoints ?? []).filter(dp => dp.raw > 0);
  if (!points.length) { el.style.opacity = '0'; return; }

  const year = String(tooltip.title?.[0] ?? points[0].label ?? '').replace('F', '');

  const item = dp => {
    const pd  = dp.dataset.pdata ?? {};
    const loc = dp.dataset.label ?? '';
    const cost = pd.usdBn ? `$${pd.usdBn}bn` : pd.eurBn ? `€${pd.eurBn}bn` : null;
    const facts = [];
    if (cost)         facts.push(cost);
    if (pd.gw)        facts.push(`${pd.gw} GW`);
    if (pd.startYear) facts.push(`${fmtYear(pd.startYear)} – ${fmtYear(pd.endYear ?? pd.startYear)}`);
    return (
      `<div class="dc-tt-item">` +
        `<span class="dc-tt-dot" style="background:${dp.dataset.borderColor}"></span>` +
        `<div class="dc-tt-item-body">` +
          `<div class="dc-tt-loc">${loc}</div>` +
          (facts.length ? `<div class="dc-tt-facts">${facts.join(' · ')}</div>` : '') +
          (pd.partners ? `<div class="dc-tt-facts">Partners: ${pd.partners}</div>` : '') +
          (pd.notes ? `<div class="dc-tt-notes">${pd.notes}</div>` : '') +
        `</div>` +
      `</div>`
    );
  };

  // Long lists flow into two columns so the card stays a reasonable height.
  el.classList.toggle('dc-tt--2col', points.length > 5);

  el.innerHTML =
    `<div class="dc-tt-title">${year} — ${points.length} project${points.length > 1 ? 's' : ''}</div>` +
    `<div class="dc-tt-items">${points.map(item).join('')}</div>`;

  el.style.opacity = '1';
  positionDcTooltip(el, chart, tooltip);
}

// External tooltip for the annual stacked-capacity bar: lists each operator's
// GW for the hovered year plus the year total. Rendered as a DOM node so it can
// overflow the (half-width) card instead of being clipped by the canvas.
function dcStackedTooltip(context) {
  const { chart, tooltip } = context;
  const el = getDcTooltipEl(chart);

  if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }

  const points = (tooltip.dataPoints ?? []).filter(dp => dp.raw > 0);
  if (!points.length) { el.style.opacity = '0'; return; }

  const year  = String(tooltip.title?.[0] ?? points[0].label ?? '').replace('F', '');
  const total = points.reduce((s, dp) => s + dp.raw, 0);

  const item = dp =>
    `<div class="dc-tt-item">` +
      `<span class="dc-tt-dot" style="background:${dp.dataset.borderColor}"></span>` +
      `<div class="dc-tt-item-body">` +
        `<div class="dc-tt-loc">${dp.dataset.label ?? ''}` +
          `<span class="dc-tt-val">${dp.raw.toFixed(2)} GW</span></div>` +
      `</div>` +
    `</div>`;

  el.classList.toggle('dc-tt--2col', points.length > 8);

  el.innerHTML =
    `<div class="dc-tt-title">${year} — ${total.toFixed(2)} GW total</div>` +
    `<div class="dc-tt-items">${points.map(item).join('')}</div>`;

  el.style.opacity = '1';
  positionDcTooltip(el, chart, tooltip);
}

function companyBarOpts() {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: dcTimelineTooltip },
    },
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `$${v}bn` }, border: BORD, stacked: true, beginAtZero: true },
    },
  };
}

/* ─── Per-company GW capacity chart (solid stacked, GW y-axis) ────── */
function companyGwBarData(projects, color) {
  const withGw = (projects ?? []).filter(p => p.gw);
  return {
    labels: YEARS,
    datasets: withGw.map(p => {
      const start = Math.floor(p.startYear ?? 2022);
      const end   = Math.floor(p.endYear   ?? start);
      const data  = Array(YEARS_NUM.length).fill(0);
      for (let yr = start; yr <= end; yr++) {
        const idx = YEARS_NUM.indexOf(yr);
        if (idx >= 0) data[idx] = p.gw;
      }
      return {
        label: p.location,
        data,
        pdata: p,
        backgroundColor: fa(color, 0.85),
        borderColor:     color,
        borderWidth: 1,
        borderRadius: 2,
      };
    }),
  };
}

function companyGwBarOpts() {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false, external: dcTimelineTooltip },
    },
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `${v} GW` }, border: BORD, stacked: true, beginAtZero: true },
    },
  };
}

/* ─── World map background plugin ────────────────────────────────── */
const worldMapPlugin = {
  id: 'worldMapBg',
  beforeDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const { x: xS, y: yS } = scales;
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    ctx.clip();
    // Ocean
    ctx.fillStyle = '#0c1c2e';
    ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    // Countries
    ctx.fillStyle = '#1e3248';
    ctx.strokeStyle = '#2d4a62';
    ctx.lineWidth = 0.5;
    const drawRing = ring => {
      ring.forEach(([lon, lat], i) => {
        const px = xS.getPixelForValue(lon);
        const py = yS.getPixelForValue(lat);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
    };
    for (const f of worldCountries.features) {
      ctx.beginPath();
      const { type, coordinates } = f.geometry;
      if (type === 'Polygon')      coordinates.forEach(drawRing);
      else if (type === 'MultiPolygon') coordinates.forEach(p => p.forEach(drawRing));
      ctx.fill('evenodd');
      ctx.stroke();
    }
    ctx.restore();
  },
};

/* ─── Bubble chart options ────────────────────────────────────────── */
const bubbleOpts = {
  responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
  plugins: {
    legend: {
      display: true, position: 'bottom',
      // Datasets are sorted by total GW desc, so only the first 5 (top contributors) show.
      labels: {
        color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10,
        filter: item => item.datasetIndex < 5,
      },
    },
    tooltip: {
      ...TTP_BASE,
      callbacks: {
        title: () => '',
        label: c => {
          const p = c.raw;
          const lines = [` ${p.label ?? c.dataset.label}: ${p.gw} GW`, ` ${p.location ?? ''}`];
          if (p.usdBn)    lines.push(` $${p.usdBn}bn`);
          if (p.partners) lines.push(` Partners: ${p.partners}`);
          if (p.notes)    lines.push(` ${p.notes}`);
          return lines;
        },
      },
    },
  },
  scales: {
    x: {
      min: -130, max: 145,
      grid: GRID, border: BORD,
      ticks: { ...TICK, callback: v => `${v > 0 ? '+' : ''}${v}°` },
      title: { display: true, text: 'Longitude', color: '#6b7280', font: { size: 10 } },
    },
    y: {
      min: 10, max: 68,
      grid: GRID, border: BORD,
      ticks: { ...TICK, callback: v => `${v}°N` },
      title: { display: true, text: 'Latitude', color: '#6b7280', font: { size: 10 } },
    },
  },
};

/* ─── Static fallback ─────────────────────────────────────────────── */
const STATIC = {
  deploymentTrends: { years: YEARS, openai: [0,3.5,7.5,8.5,6.5,0], csp: [2.35,8.58,6.97,1.56,0.93,0.93], others: [3.63,14.61,17.83,12.78,9.43,5.83] },
  operators: [
    { name:'OpenAI', totalGW:26 }, { name:'SoftBank', totalGW:13.1 }, { name:'Nscale', totalGW:9.2 },
    { name:'Google', totalGW:9.1 }, { name:'Meta', totalGW:8 }, { name:'AWS', totalGW:5.9 },
    { name:'CoreWeave', totalGW:5 }, { name:'Nebius', totalGW:5 }, { name:'HUMAIN', totalGW:4 },
    { name:'IREN', totalGW:3.6 }, { name:'Hut 8', totalGW:3.3 }, { name:'Reliance', totalGW:3 },
    { name:'Fir Hills', totalGW:3 }, { name:'Adani', totalGW:3 }, { name:'Crusoe', totalGW:2.7 },
    { name:'Lodha', totalGW:2.5 }, { name:'xAI', totalGW:2 }, { name:'Microsoft', totalGW:2.2 },
  ],
  projects: [],
  companyCharts: {},
};

/* ─── Shared data hook ──────────────────────────────────────────── */
function useDcBuildouts() {
  const [raw, setRaw] = useState(STATIC);

  useEffect(() => {
    fetch('/api/dc-buildouts')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setRaw(d))
      .catch(() => {});
  }, []);

  return raw;
}

/* ─── Capacity operators (no Fig. 70 column) — combined sourcing table ───
   Operators that have a buildout timeline but no column in the server
   supply-chain matrix: they buy compute & capacity rather than build servers.
   Summarised together on the Overview by their disclosed silicon suppliers
   and ecosystem partners (parsed from their buildout projects). */
const CAPACITY_OPERATORS = [
  { key: 'oracle', name: 'Oracle', color: CO_COLOR.oracle },
  { key: 'openai', name: 'OpenAI', color: CO_COLOR.openai },
  { key: 'nebius', name: 'Nebius', color: CO_COLOR.nebius },
];

// Silicon / compute suppliers surfaced from the "(x Vendor …)" location tags.
const COMPUTE_VENDORS = [
  { re: /nvidia/i,   label: 'NVIDIA' },
  { re: /\bAMD\b/,   label: 'AMD' },
  { re: /broadcom/i, label: 'Broadcom' },
  { re: /cerebras/i, label: 'Cerebras' },
  { re: /\bAWS\b/,   label: 'AWS Trainium' },
];

const OP_CELL = { padding: '6px 8px', fontSize: 12, lineHeight: 1.5, verticalAlign: 'top' };

function operatorSourcing(projects) {
  const compute = new Set();
  const partners = new Set();
  for (const p of (projects ?? [])) {
    const loc = p.location ?? '';
    for (const v of COMPUTE_VENDORS) if (v.re.test(loc)) compute.add(v.label);
    for (const s of (p.partners ?? '').split(/;\s*/)) {
      const t = s.trim();
      if (t) partners.add(t);
    }
  }
  return { compute: [...compute], partners: [...partners] };
}

function CapacityOperatorsTable({ raw }) {
  const cc = raw.companyCharts ?? {};
  const rows = CAPACITY_OPERATORS.map(o => ({ ...o, ...operatorSourcing(cc[o.key]?.projects) }));
  const dash = <span style={{ color: 'var(--ter)', opacity: 0.5 }}>—</span>;

  return (
    <div className="cbox span2">
      <div className="ch-head">
        <div className="ch-title">Capacity operators — compute sourcing &amp; partners</div>
        <div className="ch-meta"><span className="ch-src">Company data, Nomura research</span></div>
      </div>
      <div className="ch-sub">
        Operators with a buildout timeline but <b>no column in the Fig. 70 server supply chain</b> —
        they procure compute and capacity through GPU vendors and ecosystem partners rather than
        designing servers in-house. Shown together by their disclosed sourcing relationships.
      </div>

      <div className="scm-wrap">
        <table className="scm-table">
          <thead>
            <tr>
              <th className="scm-th">Operator</th>
              <th className="scm-th">Silicon / compute</th>
              <th className="scm-th">Ecosystem &amp; capacity partners</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <td className="scm-td scm-rowlabel" style={{ borderLeft: `4px solid ${r.color}` }}>
                  <div className="scm-group" style={{ color: r.color }}>{r.name}</div>
                </td>
                <td className="scm-td" style={OP_CELL}>
                  {r.compute.length ? r.compute.join(', ') : dash}
                </td>
                <td className="scm-td" style={OP_CELL}>
                  {r.partners.length ? r.partners.join(', ') : dash}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="src-note">Source: Company data, Nomura research · derived from disclosed buildout projects</div>
    </div>
  );
}

/* ─── Page: AI capacity (annual · geographic · total planned) ────── */
export function DcCapacity() {
  const raw = useDcBuildouts();

  /* ── Chart 1: Stacked bar — annual GW by operator ───────────── */
  const opByYear = useMemo(() => {
    const acc = {};
    for (const p of (raw.projects ?? [])) {
      if (!p.gw || !p.startYear || !p.endYear) continue;
      const name = p.company;
      if (!acc[name]) acc[name] = Array(YEARS_NUM.length).fill(0);
      const start = Math.floor(p.startYear);
      const end   = Math.floor(p.endYear);
      for (let yr = start; yr <= end; yr++) {
        const idx = YEARS_NUM.indexOf(yr);
        if (idx >= 0) acc[name][idx] += p.gw;
      }
    }
    return acc;
  }, [raw.projects]);

  const stackedData = useMemo(() => {
    const sorted = Object.keys(opByYear).sort(
      (a, b) => opByYear[b].reduce((s, v) => s + v, 0) - opByYear[a].reduce((s, v) => s + v, 0)
    );
    return {
      labels: YEARS,
      datasets: sorted.map(name => {
        const color = companyColor(name);
        return { label: name, data: opByYear[name], backgroundColor: fa(color, 0.75), borderColor: color, borderWidth: 1, borderRadius: 3 };
      }),
    };
  }, [opByYear]);

  const stackedOptsM = useMemo(() => buildStackedOpts(), []);

  /* ── Chart 2: Horizontal bar — total GW by operator ──────────── */
  const ops = useMemo(() => [...(raw.operators ?? [])].sort((a, b) => b.totalGW - a.totalGW), [raw.operators]);

  const opData = useMemo(() => ({
    labels: ops.map(o => o.name),
    datasets: [{
      data:            ops.map(o => o.totalGW),
      backgroundColor: ops.map((_, i) => fa(OP_COLORS[i % OP_COLORS.length], 0.75)),
      borderColor:     ops.map((_, i) => OP_COLORS[i % OP_COLORS.length]),
      borderWidth: 1, borderRadius: 4,
    }],
  }), [ops]);

  /* ── Chart 3: Geo bubble ─────────────────────────────────────── */
  const bubbleData = useMemo(() => {
    const byCompany = {};
    for (const p of (raw.projects ?? [])) {
      if (!p.gw) continue;
      if (!byCompany[p.company]) byCompany[p.company] = [];
      byCompany[p.company].push({ x: p.lon, y: p.lat, r: gwToR(p.gw), gw: p.gw, location: p.location, usdBn: p.usdBn, partners: p.partners, notes: p.notes, label: p.company });
    }
    const sorted = Object.entries(byCompany).sort((a, b) =>
      b[1].reduce((s, p) => s + p.gw, 0) - a[1].reduce((s, p) => s + p.gw, 0)
    );
    return {
      datasets: sorted.map(([company, pts]) => ({
        label: company, data: pts,
        backgroundColor: fa(companyColor(company), 0.55),
        borderColor:     companyColor(company),
        borderWidth: 1.5,
      })),
    };
  }, [raw.projects]);

  const hBarOptsGW = hBarOpts(v => `${v} GW`);

  /* ── Chart 4: Incremental deployment mix (OpenAI / CSPs / Others) ── */
  const deployData = useMemo(
    () => deployTrendData(raw.deploymentTrends ?? STATIC.deploymentTrends),
    [raw.deploymentTrends],
  );
  const deployOpts = useMemo(() => deployTrendOpts(), []);

  return (
    <>
    <EditableGrid viewId="dc-capacity">

      {/* ── 1 & 2 sit side by side, each half the page width (no defaultFull). ── */}
      {/* Datasets are sorted by total GW desc, so slice(0,5) = top contributors.
         subtitle="" suppresses the meta subtitle to give the chart more room. */}
      <ChartCard chartId="dc-gw-annual" subtitle=""
        legend={stackedData.datasets.slice(0, 5).map(ds => [ds.label, ds.borderColor])}
        height="calc(50vh - 104px)" span2 isNew>
        <Bar data={stackedData} options={stackedOptsM} />
      </ChartCard>

      {/* ── 2. Geographic bubble map ──────────────────────────── */}
      <ChartCard chartId="dc-geo" subtitle="" height="calc(50vh - 104px)" span2 isNew>
        <Bubble data={bubbleData} options={bubbleOpts} plugins={[worldMapPlugin]} />
      </ChartCard>

      {/* ── 3. Incremental deployment mix (OpenAI / CSPs / Others) ─── */}
      <ChartCard chartId="dc-deploy-mix"
        legend={deployData.datasets.map(ds => [ds.label, ds.borderColor])}
        height={420} span2 isNew>
        <Bar data={deployData} options={deployOpts} />
      </ChartCard>

      {/* ── 4. Total planned GW by operator ──────────────────── */}
      <ChartCard chartId="dc-operators" height={420} span2 isNew>
        <Bar data={opData} options={hBarOptsGW} />
      </ChartCard>

    </EditableGrid>

    {/* Operators without a Fig. 70 server supply-chain column, grouped. */}
    <div className="cgrid">
      <CapacityOperatorsTable raw={raw} />
    </div>
    </>
  );
}

/* ─── Page: Company buildout timelines ──────────────────────────── */
export default function DcTimelines() {
  const raw = useDcBuildouts();

  /* ── Per-company investment bar charts ───────────────────────── */
  const cc = raw.companyCharts ?? {};

  const companyBars = useMemo(() => ({
    aws:       companyBarData(cc.aws?.projects,       CO_COLOR.aws),
    google:    companyBarData(cc.google?.projects,    CO_COLOR.google),
    microsoft: companyBarData(cc.microsoft?.projects, CO_COLOR.microsoft),
    oracle:    companyBarData(cc.oracle?.projects,    CO_COLOR.oracle),
    openai:    companyBarData(cc.openai?.projects,    CO_COLOR.openai),
    nebius:    companyGwBarData(cc.nebius?.projects,   CO_COLOR.nebius),
    meta:      companyGwBarData(cc.meta?.projects,     CO_COLOR.meta),
  }), [raw.companyCharts]);

  const coBarOpts   = useMemo(() => companyBarOpts(), []);
  const coGwBarOpts = useMemo(() => companyGwBarOpts(), []);

  return (
    <>
      {/* ── Cost on the y-axis ($bn invested) ─────────────────── */}
      <div className="dc-section-label">Investment ($bn)</div>
      <EditableGrid viewId="dc-timelines-cost">

        <ChartCard chartId="dc-aws-gantt" title="Amazon AWS" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.aws} options={coBarOpts} />
        </ChartCard>

        <ChartCard chartId="dc-google-gantt" title="Google" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.google} options={coBarOpts} />
        </ChartCard>

        <ChartCard chartId="dc-msft-gantt" title="Microsoft" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.microsoft} options={coBarOpts} />
        </ChartCard>

        <ChartCard chartId="dc-oracle-gantt" title="Oracle" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.oracle} options={coBarOpts} />
        </ChartCard>

        <ChartCard chartId="dc-openai-gantt" title="OpenAI" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.openai} options={coBarOpts} />
        </ChartCard>

      </EditableGrid>

      {/* ── Power on the y-axis (GW capacity) ─────────────────── */}
      <div className="dc-section-label">Power capacity (GW)</div>
      <EditableGrid viewId="dc-timelines-power">

        <ChartCard chartId="dc-nebius-gantt" title="Nebius" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.nebius} options={coGwBarOpts} />
        </ChartCard>

        <ChartCard chartId="dc-meta-gantt" title="Meta" clean span2 isNew height={TIMELINE_H}>
          <Bar data={companyBars.meta} options={coGwBarOpts} />
        </ChartCard>

      </EditableGrid>
    </>
  );
}

/* ─── Per-company pages ──────────────────────────────────────────────
   One page per operator that has a buildout timeline: the buildout
   timeline, that company's slice of the server supply-chain matrix, and
   its geographic footprint (subset of the aggregate map).

   axis: 'cost' → $bn-invested timeline · 'gw' → power-capacity timeline.
   matrixCol: key in the Fig. 70 matrix, or null if the company has no
   disclosed in-house supply chain (buys capacity/GPUs instead).
   projectName: how the operator appears in the geo project list.        */
const DC_COMPANIES = {
  aws:       { key: 'aws',       name: 'Amazon AWS', color: CO_COLOR.aws,       gantt: 'dc-aws-gantt',    axis: 'cost', matrixCol: 'amazon',    projectName: 'AWS'       },
  google:    { key: 'google',    name: 'Google',     color: CO_COLOR.google,    gantt: 'dc-google-gantt', axis: 'cost', matrixCol: 'google',    projectName: 'Google'    },
  microsoft: { key: 'microsoft', name: 'Microsoft',  color: CO_COLOR.microsoft, gantt: 'dc-msft-gantt',   axis: 'cost', matrixCol: 'microsoft', projectName: 'Microsoft' },
  oracle:    { key: 'oracle',    name: 'Oracle',     color: CO_COLOR.oracle,    gantt: 'dc-oracle-gantt', axis: 'cost', matrixCol: null,        projectName: 'Oracle'    },
  openai:    { key: 'openai',    name: 'OpenAI',     color: CO_COLOR.openai,    gantt: 'dc-openai-gantt', axis: 'cost', matrixCol: null,        projectName: 'OpenAI'    },
  nebius:    { key: 'nebius',    name: 'Nebius',     color: CO_COLOR.nebius,    gantt: 'dc-nebius-gantt', axis: 'gw',   matrixCol: null,        projectName: 'Nebius'    },
  meta:      { key: 'meta',      name: 'Meta',       color: CO_COLOR.meta,      gantt: 'dc-meta-gantt',   axis: 'gw',   matrixCol: 'meta',      projectName: 'Meta'      },
};

function DcCompanyPage({ cfg }) {
  const raw = useDcBuildouts();
  const projects = (raw.companyCharts ?? {})[cfg.key]?.projects;

  const barData = useMemo(
    () => cfg.axis === 'gw'
      ? companyGwBarData(projects, cfg.color)
      : companyBarData(projects, cfg.color),
    [projects, cfg],
  );
  const barOpts = useMemo(
    () => (cfg.axis === 'gw' ? companyGwBarOpts() : companyBarOpts()),
    [cfg.axis],
  );

  // Geo map plots the same projects as the timeline, auto-fitted to their extent.
  const geoData = useMemo(() => companyTimelineGeoData(projects, cfg.color), [projects, cfg]);
  const geoOpts = useMemo(() => companyBubbleOpts(geoBounds(geoData.datasets[0].data)), [geoData]);
  const hasGeo = geoData.datasets[0].data.length > 0;

  const timelineTitle = `${cfg.name} — buildout timeline (${cfg.axis === 'gw' ? 'GW' : '$bn'})`;

  return (
    <>
      <EditableGrid viewId={`dc-co-${cfg.key}`}>
        <ChartCard chartId={cfg.gantt} title={timelineTitle} clean span2 isNew height={TIMELINE_H}>
          <Bar data={barData} options={barOpts} />
        </ChartCard>

        {hasGeo && (
          <ChartCard chartId={`dc-geo-${cfg.key}`} title={`${cfg.name} — geographic distribution`}
            clean span2 isNew height={TIMELINE_H}>
            <Bubble data={geoData} options={geoOpts} plugins={[worldMapPlugin]} />
          </ChartCard>
        )}
      </EditableGrid>

      {/* Only operators with a column in the Fig. 70 matrix get a supply-chain
          table here; the rest are summarised together on the Overview page. */}
      {cfg.matrixCol && (
        <div className="cgrid">
          <CompanySupplyTable column={cfg.matrixCol} label={cfg.name} />
        </div>
      )}
    </>
  );
}

export const DcCoAWS       = () => <DcCompanyPage cfg={DC_COMPANIES.aws} />;
export const DcCoGoogle    = () => <DcCompanyPage cfg={DC_COMPANIES.google} />;
export const DcCoMicrosoft = () => <DcCompanyPage cfg={DC_COMPANIES.microsoft} />;
export const DcCoOracle    = () => <DcCompanyPage cfg={DC_COMPANIES.oracle} />;
export const DcCoOpenAI    = () => <DcCompanyPage cfg={DC_COMPANIES.openai} />;
export const DcCoNebius    = () => <DcCompanyPage cfg={DC_COMPANIES.nebius} />;
export const DcCoMeta      = () => <DcCompanyPage cfg={DC_COMPANIES.meta} />;
