import { useEffect, useMemo, useState } from 'react';
import { Bar, Bubble } from 'react-chartjs-2';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-50m.json';
import { C, fa } from '../../config/colors';
import { stackedOpts, hBarOpts, GRID, TICK, BORD } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';

const worldCountries = feature(worldData, worldData.objects.countries);

/* ─── Constants ──────────────────────────────────────────────────── */
const YEARS = ['2022F', '2023F', '2024F', '2025F', '2026F', '2027F', '2028F', '2029F', '2030F'];
const YEARS_NUM = YEARS.map(y => parseInt(y));

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

/* ─── Stacked-bar options ─────────────────────────────────────────── */
function buildStackedOpts(totalByYear) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...TTP_BASE,
        callbacks: {
          label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)} GW`,
          footer: items => {
            const t = totalByYear[items[0]?.label];
            return t != null ? `  Total: ${t.toFixed(2)} GW` : '';
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

function companyBarOpts() {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...TTP_BASE,
        filter: item => item.raw > 0,
        callbacks: {
          title: items => items[0]?.label ?? '',
          label: ctx => {
            const pd = ctx.dataset.pdata ?? {};
            const cost = ctx.dataset.hasCost
              ? (pd.eurBn && !pd.usdBn ? `€${pd.eurBn}bn` : `$${ctx.raw.toFixed(1)}bn`)
              : 'cost N/A';
            const lines = [`  ${ctx.dataset.label}: ${cost}`];
            if (pd.gw)       lines.push(`  Capacity: ${pd.gw} GW`);
            if (pd.partners) lines.push(`  Partners: ${pd.partners}`);
            if (pd.notes)    lines.push(`  ${pd.notes}`);
            return lines;
          },
        },
      },
    },
    scales: {
      x: { grid: GRID, ticks: TICK, border: BORD, stacked: true },
      y: { grid: GRID, ticks: { ...TICK, callback: v => `$${v}bn` }, border: BORD, stacked: true, beginAtZero: true },
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
      labels: { color: '#c8c8c0', font: { size: 10, family: "'Inter',sans-serif" }, padding: 8, boxWidth: 10 },
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

/* ─── Component ─────────────────────────────────────────────────── */
export default function DcBuildouts() {
  const [raw, setRaw] = useState(STATIC);

  useEffect(() => {
    fetch('/api/dc-buildouts')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setRaw(d))
      .catch(() => {});
  }, []);

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

  const totalByYear = useMemo(() => {
    const t = {};
    YEARS.forEach((yr, i) => {
      t[yr] = Object.values(opByYear).reduce((s, arr) => s + (arr[i] ?? 0), 0);
    });
    return t;
  }, [opByYear]);

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

  const stackedOptsM = useMemo(() => buildStackedOpts(totalByYear), [totalByYear]);

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


  /* ── Per-company investment bar charts ───────────────────────── */
  const cc = raw.companyCharts ?? {};

  const companyBars = useMemo(() => ({
    aws:       companyBarData(cc.aws?.projects,       CO_COLOR.aws),
    google:    companyBarData(cc.google?.projects,    CO_COLOR.google),
    microsoft: companyBarData(cc.microsoft?.projects, CO_COLOR.microsoft),
    oracle:    companyBarData(cc.oracle?.projects,    CO_COLOR.oracle),
    openai:    companyBarData(cc.openai?.projects,    CO_COLOR.openai),
    nebius:    companyBarData(cc.nebius?.projects,    CO_COLOR.nebius),
    meta:      companyBarData(cc.meta?.projects,      CO_COLOR.meta),
  }), [raw.companyCharts]);

  const coBarOpts = useMemo(() => companyBarOpts(), []);

  const hBarOptsGW = hBarOpts(v => `${v} GW`);

  return (
    <EditableGrid viewId="dc-buildouts">

      {/* ── 1. Annual GW deployment (stacked) ─────────────────── */}
      <ChartCard chartId="dc-gw-annual"
        legend={stackedData.datasets.map(ds => [ds.label, ds.borderColor])}
        height={280} span2 defaultFull isNew>
        <Bar data={stackedData} options={stackedOptsM} />
      </ChartCard>

      {/* ── 2. Geographic bubble map ──────────────────────────── */}
      <ChartCard chartId="dc-geo" height={480} span2 defaultFull isNew
        subtitle="Bubble size = planned GW. X = longitude, Y = latitude.">
        <Bubble data={bubbleData} options={bubbleOpts} plugins={[worldMapPlugin]} />
      </ChartCard>

      {/* ── 3. Total planned GW by operator ──────────────────── */}
      <ChartCard chartId="dc-operators" height={420} span2 isNew>
        <Bar data={opData} options={hBarOptsGW} />
      </ChartCard>

      {/* ── 5. AWS investment by year ─────────────────────────── */}
      <ChartCard chartId="dc-aws-gantt" span2 isNew height={280}>
        <Bar data={companyBars.aws} options={coBarOpts} />
      </ChartCard>

      {/* ── 6. Google investment by year ──────────────────────── */}
      <ChartCard chartId="dc-google-gantt" span2 isNew height={280}>
        <Bar data={companyBars.google} options={coBarOpts} />
      </ChartCard>

      {/* ── 7. Microsoft investment by year ───────────────────── */}
      <ChartCard chartId="dc-msft-gantt" span2 isNew height={280}>
        <Bar data={companyBars.microsoft} options={coBarOpts} />
      </ChartCard>

      {/* ── 8. Oracle investment by year ──────────────────────── */}
      <ChartCard chartId="dc-oracle-gantt" span2 isNew height={280}>
        <Bar data={companyBars.oracle} options={coBarOpts} />
      </ChartCard>

      {/* ── 9. OpenAI investment by year ──────────────────────── */}
      <ChartCard chartId="dc-openai-gantt" span2 isNew height={280}>
        <Bar data={companyBars.openai} options={coBarOpts} />
      </ChartCard>

      {/* ── 10. Nebius investment by year ─────────────────────── */}
      <ChartCard chartId="dc-nebius-gantt" span2 isNew height={280}>
        <Bar data={companyBars.nebius} options={coBarOpts} />
      </ChartCard>

      {/* ── 11. Meta investment by year ───────────────────────── */}
      <ChartCard chartId="dc-meta-gantt" span2 isNew height={280}>
        <Bar data={companyBars.meta} options={coBarOpts} />
      </ChartCard>

    </EditableGrid>
  );
}
