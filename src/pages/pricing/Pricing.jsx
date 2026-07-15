import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { baseOpts, mkDs } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import PriceModelTiles from '../../components/chart/PriceModelTiles';
import { useData } from '../../context/DataContext';

// Distinct line colour per DRAM model (assigned by position within each chart)
const DRAM_PALETTE = [C.teal, C.openai, C.anthropic, C.google, C.minimax, C.kimi, C.deepseek, C.perplexity, C.red, C.slate];

const DRAM_METHOD = 'Per model: session average × (1 + session change), averaged across all listed variants (speed grades, eTT, organization). One point per scraped day.';
const NAND_METHOD = 'TrendForce NAND flash + wafer spot tables, grouped by cell type (SLC / MLC / TLC). Each row uses session average × (1 + session change), converted to $/Gb (spot price ÷ capacity) and averaged across variants — e.g. SLC = (2Gb ÷ 2 + 1Gb ÷ 1) / 2. Memory cards are excluded; gaps are forward-filled.';

function dramDayLabel(isoDate) {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function monthYearLabel(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = String(d.getUTCFullYear()).slice(-2);
  return `${month} '${year}`;
}

function historyLabel(isoDate, weeks) {
  return weeks <= 52 ? dramDayLabel(isoDate) : monthYearLabel(isoDate);
}

function dramLineData(models, history) {
  return {
    labels: history.dates.map(dramDayLabel),
    datasets: models.map((m, i) => ({
      ...mkDs(m.model, DRAM_PALETTE[i % DRAM_PALETTE.length], history.series[m.model] ?? []),
      spanGaps: true,   // connect across dates where a model wasn't listed
      pointRadius: 2,
    })),
  };
}

// Latest plotted value of a model's series — identical to where the chart line
// ends, so the tile above the chart and the line below it can never disagree.
function latestFinite(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) if (Number.isFinite(series[i])) return series[i];
  return null;
}

// Percent change of a model's price vs the most recent point at least `days`
// old. Uses the full (unwindowed) history so the tile's 7d/30d figures don't
// move when the chart's time range changes. null when no point is old enough
// yet (e.g. a freshly-listed model) → the tile renders a neutral "—".
function pctChangeOverDays(dates, series, days) {
  if (!Array.isArray(series) || !dates?.length) return null;
  let last = -1;
  for (let i = series.length - 1; i >= 0; i--) if (Number.isFinite(series[i])) { last = i; break; }
  if (last <= 0) return null;
  const targetMs = new Date(dates[last] + 'T00:00:00Z').getTime() - days * 86400000;
  let ref = -1;
  for (let i = last - 1; i >= 0; i--) {
    if (!Number.isFinite(series[i])) continue;
    if (new Date(dates[i] + 'T00:00:00Z').getTime() <= targetMs) { ref = i; break; }
  }
  if (ref < 0) return null;
  const prev = series[ref], cur = series[last];
  if (!(prev > 0)) return null;
  return ((cur - prev) / prev) * 100;
}

// Reference-style tiles for a set of models. Index-aligned with dramLineData so
// each tile's colour matches its line. `history` is the full dram history.
function dramTiles(models, history) {
  if (!history?.series || !models.length) return [];
  return models
    .map((m, i) => {
      const series = history.series[m.model] ?? [];
      return {
        model:    m.model,
        color:    DRAM_PALETTE[i % DRAM_PALETTE.length],
        price:    latestFinite(series),
        chg7d:    pctChangeOverDays(history.dates, series, 7),
        chg30d:   pctChangeOverDays(history.dates, series, 30),
        variants: m.variants,
      };
    })
    .filter(t => t.price != null);
}

// ── NAND spot price by cell type (SLC / MLC / TLC) ──────────────────────────
// Flash + wafer rows are grouped by cell type and averaged on a $/Gb basis,
// e.g. SLC = (2Gb price / 2 + 1Gb price / 1) / 2.
const NAND_MODELS = ['SLC', 'MLC', 'TLC'];
const NAND_MODEL_COLORS = { SLC: C.openai, MLC: C.anthropic, TLC: C.teal };

function nandCapacityGb(product) {
  const m = product.match(/(\d+(?:\.\d+)?)\s*Gb\b/i);
  return m ? Number(m[1]) : NaN;
}

function nandCellType(product) {
  const m = product.match(/\b(SLC|MLC|TLC)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function nandModelData(products, history) {
  const groups = new Map();
  for (const p of products) {
    const model = nandCellType(p.product);
    const gb = nandCapacityGb(p.product);
    if (!model || !Number.isFinite(gb) || gb <= 0) continue;
    if (!groups.has(model)) groups.set(model, []);
    groups.get(model).push({ product: p.product, gb });
  }
  const models = NAND_MODELS.filter(m => groups.has(m));
  return {
    labels: history.dates.map(dramDayLabel),
    datasets: models.map(model => {
      const members = groups.get(model);
      const series = history.dates.map((_, i) => {
        const perGb = members
          .map(({ product, gb }) => {
            const v = history.series[product]?.[i];
            return Number.isFinite(v) ? v / gb : null;
          })
          .filter(v => v != null);
        return perGb.length ? perGb.reduce((a, b) => a + b, 0) / perGb.length : null;
      });
      return { ...mkDs(model, NAND_MODEL_COLORS[model], series), spanGaps: true, pointRadius: 0 };
    }),
  };
}

function lineDataTiles(data, dates) {
  if (!data?.datasets?.length || !dates?.length) return [];
  return data.datasets
    .map(ds => ({
      model: ds.label,
      color: ds.borderColor,
      price: latestFinite(ds.data),
      chg7d: pctChangeOverDays(dates, ds.data, 7),
      chg30d: pctChangeOverDays(dates, ds.data, 30),
    }))
    .filter(t => t.price != null);
}

const awsLegend = ds => (ds?.datasets ?? []).map(d => [d.label, d.borderColor]);

const GPU_PALETTE = {
  H100_SXM: C.openai,
  H100_PCIe: C.deepseek,
  H100_NVL: C.kimi,
  H200: C.anthropic,
  B200: C.google,
  A100_SXM: C.teal,
  A100_PCIe: C.perplexity,
  RTX_5090: C.red,
  RTX_4090: C.minimax,
};

const GPU_LABELS = {
  H100_SXM: 'H100 SXM',
  H100_PCIe: 'H100 PCIe',
  H100_NVL: 'H100 NVL',
  H200: 'H200',
  B200: 'B200',
  A100_SXM: 'A100 SXM4',
  A100_PCIe: 'A100 PCIe',
  RTX_5090: 'RTX 5090',
  RTX_4090: 'RTX 4090',
};

const GPU_SPOT_MODEL_KEYS = ['H100_SXM', 'H200', 'B200', 'A100_SXM', 'RTX_5090'];
const GPU_AWS_SPOT_KEYS = { H100_SXM: 'H100', H200: 'H200', A100_SXM: 'A100' };
const GPU_SPOT_AVG_LABEL = 'Five-model GPU spot average';

// ── GPU rental price by model (vast.ai on-demand $/hr) ──────────────────────
// Same treatment as the DRAM by-model charts: tiles + one line per GPU. Driven
// by the scraper's RAW (non-forward-filled) series so a tile's price and 7d/30d
// reflect real quotes — vast.ai supply is intermittent, so a model that hasn't
// been quoted for a few days is flagged stale rather than shown as a fresh 0% move.
const GPU_STALE_DAYS = 3;

function shortDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function latestFiniteDate(dates, series) {
  if (!Array.isArray(series) || !dates) return null;
  for (let i = series.length - 1; i >= 0; i--) if (Number.isFinite(series[i])) return dates[i] ?? null;
  return null;
}

function gpuTilesOf(rawSeries, dates, keys, freshnessSeries = rawSeries) {
  if (!rawSeries || !dates) return [];
  return keys.map(k => {
    const s = rawSeries[k] ?? [];
    const freshness = freshnessSeries[k] ?? s;
    const lastDate = latestFiniteDate(dates, freshness);
    const ageDays = lastDate ? Math.round((Date.now() - new Date(lastDate + 'T00:00:00Z').getTime()) / 86400000) : null;
    return {
      model:  GPU_LABELS[k] ?? k,
      color:  GPU_PALETTE[k] ?? C.slate,
      price:  latestFinite(s),
      chg7d:  pctChangeOverDays(dates, s, 7),
      chg30d: pctChangeOverDays(dates, s, 30),
      stale:  ageDays != null && ageDays > GPU_STALE_DAYS ? shortDate(lastDate) : null,
    };
  }).filter(t => t.price != null);
}

function gpuModelLineData(series, dates, keys, W) {
  return {
    labels: dates.map(d => historyLabel(d, W)),
    datasets: keys.map(k => ({
      ...mkDs(GPU_LABELS[k] ?? k, GPU_PALETTE[k] ?? C.slate, series[k] ?? []),
      spanGaps: true,
      pointRadius: 0,
    })),
  };
}

function averageAlignedSeries(seriesMap, keys, length, requireAll = false) {
  return Array.from({ length }, (_, i) => {
    const vals = keys.map(k => seriesMap?.[k]?.[i]).filter(Number.isFinite);
    if (requireAll && vals.length !== keys.length) return null;
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3) : null;
  });
}

// Fill only the LEADING nulls of a windowed series with its first real value, so
// a model first quoted partway through the window still draws a full-width line
// (assumed ~flat before its first quote — GPU rental rates move slowly). Interior
// gaps are already interpolated and the tail forward-filled in `history.series`.
function backfillLeading(arr) {
  const first = arr.findIndex(Number.isFinite);
  if (first <= 0) return arr;
  const fv = arr[first];
  return arr.map((v, i) => (i < first ? fv : v));
}


function windowHistory(history, weeks) {
  if (!history?.dates?.length) return null;
  const cutoff = Date.now() - weeks * 7 * 86400000;
  let start = history.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
  if (start < 0) start = 0;
  return { start, dates: history.dates.slice(start) };
}

function windowTrendforceHistory(history, weeks) {
  if (!history?.dates?.length) return null;
  const cutoff = Date.now() - weeks * 7 * 86400000;
  const start = Math.max(0, history.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff));
  return {
    dates: history.dates.slice(start),
    series: Object.fromEntries(Object.entries(history.series ?? {}).map(([k, arr]) => [k, arr.slice(start)])),
  };
}

const CPU_PALETTE = {
  'C5 (Xeon)':      C.openai,
  'C6i (Ice Lake)': C.anthropic,
  'C7i (Sapphire)': C.google,
  'M6i (General)':  C.teal,
  'C7g (Graviton)': C.minimax,
};

const TPU_PALETTE = {
  v4:  C.google,
  v5e: C.teal,
  v5p: C.openai,
  v6e: C.anthropic,
};

// Shared computation for every pricing page. Each page below renders one slice
// of the returned object; the maths stays here because the GPU charts depend on
// both the vast.ai and AWS histories together.
function usePricingCharts(W) {
  const { liveData } = useData();

    /* ── GPU spot pricing (moved from the GPU view) ──────────────────── */
  const gpu = liveData?.gpu;
  const gpuHist = gpu?.history;
  const gpuWindow = useMemo(() => windowHistory(gpuHist, W), [gpuHist, W]);

  /* ── Memory (DRAM) spot pricing — TrendForce ─────────────────────── */
  const dram    = liveData?.dram;
  const models  = dram?.models ?? [];
  const history = dram?.history;

  const chips   = useMemo(() => models.filter(m => m.category !== 'module').sort((a, b) => b.price - a.price), [models]);
  const modules = useMemo(() => models.filter(m => m.category === 'module').sort((a, b) => b.price - a.price), [models]);

  // Window the history to the selected time range (W weeks back from today)
  const windowedHistory = useMemo(() => {
    if (!history?.dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    const start  = history.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start <= 0) return history; // everything is inside the window
    return {
      dates:  history.dates.slice(start),
      series: Object.fromEntries(Object.entries(history.series).map(([m, arr]) => [m, arr.slice(start)])),
    };
  }, [history, W]);

  const chipData   = useMemo(() => chips.length   > 0 && windowedHistory ? dramLineData(chips, windowedHistory)   : null, [chips, windowedHistory]);
  const moduleData = useMemo(() => modules.length > 0 && windowedHistory ? dramLineData(modules, windowedHistory) : null, [modules, windowedHistory]);

  // Per-model tiles (latest price + 7d/30d) shown above each by-model chart.
  // Built from the full history (not the windowed copy) so the change figures
  // are stable across the time toggle.
  const chipTiles   = useMemo(() => dramTiles(chips, history),   [chips, history]);
  const moduleTiles = useMemo(() => dramTiles(modules, history), [modules, history]);

  const nand = liveData?.nand;
  const nandProducts = useMemo(() => nand?.products ?? [], [nand]);
  const nandHistory = useMemo(() => windowTrendforceHistory(nand?.history, W), [nand, W]);
  const nandData = useMemo(() => nandProducts.length > 0 && nandHistory ? nandModelData(nandProducts, nandHistory) : null, [nandProducts, nandHistory]);
  const nandFullData = useMemo(() => nandProducts.length > 0 && nand?.history ? nandModelData(nandProducts, nand.history) : null, [nandProducts, nand]);
  const nandTiles = useMemo(() => lineDataTiles(nandFullData, nand?.history?.dates), [nandFullData, nand]);

  // TrendForce "Mainstream DRAM Spot Price" monthly index, windowed to W weeks
  const dramIndex = dram?.index;
  const dramIndexData = useMemo(() => {
    if (!dramIndex?.dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    let start = dramIndex.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start < 0) start = 0;
    const dates  = dramIndex.dates.slice(start);
    const values = dramIndex.values.slice(start);
    return {
      labels: dates.map(monthYearLabel),
      datasets: [mkDs(dramIndex.name, C.teal, values, true)],
    };
  }, [dramIndex, W]);

  /* ── AWS accelerator spot pricing ─────────────────────────────────── */
  // Exact EC2 spot backfill (≤90d) continued forward via the free Spot Advisor.
  const aws = liveData?.aws;
  const AWS_COLOR = { H100: C.openai, H200: C.anthropic, A100: C.teal, Trainium: C.google, Inferentia2: C.minimax };

  // Master time axis = AWS history (reaches furthest back), windowed to W weeks.
  const awsWindow = useMemo(() => {
    const dates = aws?.history?.dates;
    if (!dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    let start = dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start < 0) start = 0;
    return { start, dates: dates.slice(start) };
  }, [aws, W]);

  function awsLineChart(series, keys) {
    if (!series || !awsWindow) return null;
    const present = keys.filter(k => (series[k]?.slice(awsWindow.start) ?? []).some(Number.isFinite));
    if (present.length === 0) return null;
    return {
      labels: awsWindow.dates.map(d => historyLabel(d, W)),
      datasets: present.map(k => ({ ...mkDs(k, AWS_COLOR[k], series[k].slice(awsWindow.start)), spanGaps: true, pointRadius: 0 })),
    };
  }
  // AWS-exclusive AI chips (no vast.ai equivalent) — shown as raw AWS spot.
  const awsChipData = useMemo(() => awsLineChart(aws?.history?.spotSeries, ['Trainium', 'Inferentia2']), [aws, awsWindow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combined GPU spot line: AWS exact/public spot prices win for H100/H200/A100
  // where EC2 has the accelerator. Missing days fall back to the marketplace /
  // OCPI chart history in gpuHistory. B200 / RTX 5090 have no AWS equivalent, so
  // they remain marketplace / OCPI-backed until a better public source exists.
  const combinedSpot = useMemo(() => {
    const aH = aws?.history, gH = gpuHist;
    const allDates = [...new Set([...(aH?.dates ?? []), ...(gH?.dates ?? [])])].sort();
    if (!allDates.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    let start = allDates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start < 0) start = 0;
    const gIdx = gH?.dates ? Object.fromEntries(gH.dates.map((d, i) => [d, i])) : {};
    const aIdx = aH?.dates ? Object.fromEntries(aH.dates.map((d, i) => [d, i])) : {};
    const vastVal = (vk, d) => {
      const i = gIdx[d]; if (i == null) return null;
      const sp = gH?.spotSeries?.[vk]?.[i]; if (Number.isFinite(sp)) return sp;
      const od = gH?.series?.[vk]?.[i]; return Number.isFinite(od) ? od : null;
    };
    const rawVastVal = (vk, d) => {
      const i = gIdx[d]; if (i == null) return null;
      const sp = gH?.rawSpotSeries?.[vk]?.[i]; if (Number.isFinite(sp)) return sp;
      const od = gH?.rawSeries?.[vk]?.[i]; return Number.isFinite(od) ? od : null;
    };
    const awsVal = (ak, d) => {
      const i = aIdx[d];
      return i == null ? null : aH?.spotSeries?.[ak]?.[i];
    };

    const fullSeries = {};
    const freshnessSeries = {};
    for (const vk of GPU_SPOT_MODEL_KEYS) {
      const ak = GPU_AWS_SPOT_KEYS[vk];
      const combined = allDates.map(d => {
        if (ak) {
          const av = awsVal(ak, d);
          if (Number.isFinite(av)) return av;
        }
        const v = vastVal(vk, d);
        return Number.isFinite(v) ? v : null;
      });
      if (combined.some(Number.isFinite)) fullSeries[vk] = combined;
      freshnessSeries[vk] = ak ? combined : allDates.map(d => rawVastVal(vk, d));
    }
    const present = GPU_SPOT_MODEL_KEYS.filter(k => fullSeries[k]?.some(Number.isFinite));
    if (present.length === 0) return null;
    const dates = allDates.slice(start);
    const windowed = Object.fromEntries(present.map(k => [
      k,
      GPU_AWS_SPOT_KEYS[k] ? backfillLeading(fullSeries[k].slice(start)) : fullSeries[k].slice(start),
    ]));
    const avgFull = averageAlignedSeries(fullSeries, GPU_SPOT_MODEL_KEYS, allDates.length, true);
    const avgWindowed = avgFull.slice(start);
    const avgData = avgWindowed.some(Number.isFinite)
      ? {
          labels: dates.map(d => historyLabel(d, W)),
          datasets: [{ ...mkDs(GPU_SPOT_AVG_LABEL, C.slate, avgWindowed, true), spanGaps: true, pointRadius: 0 }],
        }
      : null;
    return {
      data: gpuModelLineData(windowed, dates, present, W),
      tiles: gpuTilesOf(fullSeries, allDates, present, freshnessSeries),
      averageData: avgData,
    };
  }, [aws, gpuHist, W]); // eslint-disable-line react-hooks/exhaustive-deps
  const combinedSpotData = combinedSpot?.data;
  const combinedSpotTiles = combinedSpot?.tiles ?? [];
  const spotAverageData = combinedSpot?.averageData;

  // Mainstream GPU rental benchmark — actual vast.ai on-demand medians only.
  // It intentionally does not use AWS or OCPI spot data; those feed the spot
  // charts below. The scraper's history.index is the smoothed average of the
  // tracked GPU rental medians.
  const gpuIndexData = useMemo(() => {
    if (!gpuHist?.dates?.length) return null;
    if (!gpuWindow) return null;
    const values = (gpuHist.index ?? []).slice(gpuWindow.start);
    if (!values.some(Number.isFinite)) return null;
    return {
      labels: gpuWindow.dates.map(d => historyLabel(d, W)),
      datasets: [{ ...mkDs('Mainstream GPU rental benchmark', C.openai, values, true), spanGaps: true, pointRadius: 0 }],
    };
  }, [gpuHist, gpuWindow, W]);

  /* ── CPU spot pricing (AWS Spot Advisor) ──────────────────────────── */
  const cpuData = liveData?.cpu;

  const cpuWindow = useMemo(() => windowHistory(cpuData?.history, W), [cpuData, W]);
  const cpuHistData = useMemo(() => {
    const hist = cpuData?.history;
    if (!hist?.dates?.length || !cpuWindow) return null;
    const keys = Object.keys(hist.spotSeries ?? {});
    const present = keys.filter(k => hist.spotSeries[k].slice(cpuWindow.start).some(Number.isFinite));
    if (present.length === 0) return null;
    return {
      labels: cpuWindow.dates.map(d => historyLabel(d, W)),
      datasets: present.map(k => ({
        ...mkDs(k, CPU_PALETTE[k] ?? C.slate, hist.spotSeries[k].slice(cpuWindow.start)),
        spanGaps: true, pointRadius: 0,
      })),
    };
  }, [cpuData, cpuWindow, W]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── TPU preemptible pricing (GCP) ────────────────────────────────── */
  const tpuData = liveData?.tpu;

  const tpuWindow = useMemo(() => windowHistory(tpuData?.history, W), [tpuData, W]);
  const tpuHistData = useMemo(() => {
    const hist = tpuData?.history;
    if (!hist?.dates?.length || !tpuWindow) return null;
    const keys = Object.keys(hist.spotSeries ?? {});
    const present = keys.filter(k => hist.spotSeries[k].slice(tpuWindow.start).some(Number.isFinite));
    if (present.length === 0) return null;
    return {
      labels: tpuWindow.dates.map(d => historyLabel(d, W)),
      datasets: present.map(k => ({
        ...mkDs(`TPU ${k}`, TPU_PALETTE[k] ?? C.slate, hist.spotSeries[k].slice(tpuWindow.start)),
        spanGaps: true, pointRadius: 0,
      })),
    };
  }, [tpuData, tpuWindow, W]); // eslint-disable-line react-hooks/exhaustive-deps

  const dramAsOf = dram?.asOf ? ` · as of ${dram.asOf}` : '';
  const nandAsOf = nand?.asOf ? ` · as of ${nand.asOf}` : '';

  return {
    dramIndex, dramIndexData, chipData, chips, chipTiles, moduleData, modules, moduleTiles, dramAsOf,
    nandData, nandTiles, nandAsOf,
    gpuIndexData, combinedSpotData, combinedSpotTiles, spotAverageData, awsChipData,
    cpuHistData, tpuHistData,
  };
}

function NoData({ label }) {
  return (
    <div style={{ color: 'var(--ter)', fontSize: 12, padding: '16px 0' }}>
      No {label} pricing data yet — hit <b style={{ color: 'var(--sec)' }}>Refresh Data</b> to fetch the latest spot prices.
    </div>
  );
}

// ── Page: Memory ──────────────────────────────────────────────────────────
export function PricingMemory({ weeks: W = 52 }) {
  const {
    dramIndex, dramIndexData, chipData, chipTiles, moduleData, moduleTiles, dramAsOf,
    nandData, nandTiles, nandAsOf,
  } = usePricingCharts(W);
  const anyData = dramIndexData || chipData || moduleData || nandData;

  return (
    <EditableGrid viewId="pricing-memory">
      {dramIndexData && (
        <ChartCard
          chartId="dram-index"
          title={`${dramIndex.name} — monthly (${dramIndex.unit})`}
          height={360} span2
        >
          <Line data={dramIndexData} options={baseOpts(v => `$${v.toFixed(1)}`)} />
        </ChartCard>
      )}

      {chipData && (
        <ChartCard
          chartId="dram-chips"
          subtitle={`${DRAM_METHOD}${dramAsOf}`}
          preface={<PriceModelTiles tiles={chipTiles} fmt={v => `$${v.toFixed(2)}`} />}
          height={260} span2
        >
          <Line data={chipData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {moduleData && (
        <ChartCard
          chartId="dram-modules"
          subtitle={`SO-DIMM / UDIMM / RDIMM modules. ${DRAM_METHOD}${dramAsOf}`}
          preface={<PriceModelTiles tiles={moduleTiles} fmt={v => `$${v.toFixed(0)}`} />}
          height={240} span2
        >
          <Line data={moduleData} options={baseOpts(v => `$${v.toFixed(0)}`)} />
        </ChartCard>
      )}

      {nandData && (
        <ChartCard
          chartId="nand-spot"
          subtitle={`${NAND_METHOD}${nandAsOf}`}
          preface={<PriceModelTiles tiles={nandTiles} fmt={v => `$${v.toFixed(3)}`} unit="/Gb" />}
          height={260} span2
        >
          <Line data={nandData} options={baseOpts(v => `$${v.toFixed(3)}/Gb`)} />
        </ChartCard>
      )}

      {!anyData && <ChartCard chartId="dram-index" title="Memory spot pricing" height={200} span2><NoData label="memory" /></ChartCard>}
    </EditableGrid>
  );
}

// ── Page: GPU ─────────────────────────────────────────────────────────────
export function PricingGPU({ weeks: W = 52 }) {
  const { gpuIndexData, combinedSpotData, combinedSpotTiles, spotAverageData } = usePricingCharts(W);
  const anyData = gpuIndexData || combinedSpotData || spotAverageData;

  return (
    <EditableGrid viewId="pricing-gpu">
      {gpuIndexData && (
        <ChartCard chartId="gpu-index" height={360} span2>
          <Line data={gpuIndexData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {combinedSpotData && (
        <ChartCard
          chartId="gpu-spot-combined"
          preface={<PriceModelTiles tiles={combinedSpotTiles} fmt={v => `$${v.toFixed(2)}`} unit="/hr" />}
          height={260} span2
        >
          <Line data={combinedSpotData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {spotAverageData && (
        <ChartCard chartId="gpu-spot-average" height={260} span2>
          <Line data={spotAverageData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {!anyData && <ChartCard chartId="gpu-index" title="GPU spot pricing" height={200} span2><NoData label="GPU" /></ChartCard>}
    </EditableGrid>
  );
}

// ── Page: AWS AI Chips ──────────────────────────────────────────────────────
export function PricingAWS({ weeks: W = 52 }) {
  const { awsChipData } = usePricingCharts(W);

  return (
    <EditableGrid viewId="pricing-aws">
      {awsChipData ? (
        <ChartCard chartId="aws-chip-spot" legend={awsLegend(awsChipData)} height={220} span2>
          <Line data={awsChipData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      ) : (
        <ChartCard chartId="aws-chip-spot" title="AWS AI-chip spot pricing" height={200} span2><NoData label="AWS AI-chip" /></ChartCard>
      )}
    </EditableGrid>
  );
}

// ── Page: CPU ─────────────────────────────────────────────────────────────
export function PricingCPU({ weeks: W = 52 }) {
  const { cpuHistData } = usePricingCharts(W);

  return (
    <EditableGrid viewId="pricing-cpu">
      {cpuHistData ? (
        <ChartCard
          chartId="cpu-spot-history"
          legend={cpuHistData.datasets.map(d => [d.label, d.borderColor])}
          height={220} span2
        >
          <Line data={cpuHistData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      ) : (
        <ChartCard chartId="cpu-spot-history" title="CPU spot pricing" height={200} span2><NoData label="CPU" /></ChartCard>
      )}
    </EditableGrid>
  );
}

// ── Page: TPU ─────────────────────────────────────────────────────────────
export function PricingTPU({ weeks: W = 52 }) {
  const { tpuHistData } = usePricingCharts(W);

  return (
    <EditableGrid viewId="pricing-tpu">
      {tpuHistData ? (
        <ChartCard
          chartId="tpu-spot-history"
          legend={tpuHistData.datasets.map(d => [d.label, d.borderColor])}
          height={220} span2
        >
          <Line data={tpuHistData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      ) : (
        <ChartCard chartId="tpu-spot-history" title="TPU preemptible pricing" height={200} span2><NoData label="TPU" /></ChartCard>
      )}
    </EditableGrid>
  );
}
