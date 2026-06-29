import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

// Distinct line colour per DRAM model (assigned by position within each chart)
const DRAM_PALETTE = [C.teal, C.openai, C.anthropic, C.google, C.minimax, C.kimi, C.deepseek, C.perplexity, C.red, C.slate];

const DRAM_METHOD = 'Per model: session average × (1 + session change), averaged across all listed variants (speed grades, eTT, organization). One point per scraped day.';

function dramDayLabel(isoDate) {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function monthYearLabel(isoDate) {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function historyLabel(isoDate, weeks) {
  return weeks <= 12 ? dramDayLabel(isoDate) : monthYearLabel(isoDate);
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

const dramLegend = models => models.map((m, i) => [m.model, DRAM_PALETTE[i % DRAM_PALETTE.length]]);

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
  A100_SXM: 'A100 SXM',
  A100_PCIe: 'A100 PCIe',
  RTX_5090: 'RTX 5090',
  RTX_4090: 'RTX 4090',
};

/* ── LLM API token pricing (LiteLLM cost map) ──────────────────────── */
// brand token → line colour (keys map to the C.* tokens in colors.js).
const LLM_COLOR = {
  openai: C.openai, anthropic: C.anthropic, google: C.google, xai: C.xai,
  deepseek: C.deepseek, zhipu: C.zhipu, kimi: C.kimi, minimax: C.minimax, qwen: C.qwen,
};

function windowHistory(history, weeks) {
  if (!history?.dates?.length) return null;
  const cutoff = Date.now() - weeks * 7 * 86400000;
  let start = history.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
  if (start < 0) start = 0;
  return { start, dates: history.dates.slice(start) };
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

export default function Pricing({ weeks: W = 52 }) {
  const { liveData } = useData();

  /* ── LLM API token pricing (LiteLLM) — official $/1M list prices ──── */
  // US models first, then Chinese, so the two blocks read left-to-right.
  const llmModels = useMemo(() => {
    const m = liveData?.litellm?.models ?? [];
    const rank = { US: 0, CN: 1 };
    return [...m].sort((a, b) => (rank[a.region] ?? 9) - (rank[b.region] ?? 9));
  }, [liveData]);
  // Price-over-time from the accumulated daily snapshots (history.litellm),
  // one line per model, for the given field ('input' | 'output').
  const llmTrend = (field) => {
    const hist = liveData?.metricsHistory?.litellm;
    if (!hist || llmModels.length === 0) return null;
    const dateSet = new Set();
    for (const m of llmModels) {
      const s = hist[`${m.label}.${field}`];
      if (s) Object.keys(s).forEach(d => dateSet.add(d));
    }
    const cutoff = Date.now() - W * 7 * 86400000;
    const dates = [...dateSet].sort().filter(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (dates.length === 0) return null;
    const datasets = llmModels.map(m => {
      const s = hist[`${m.label}.${field}`] ?? {};
      const data = dates.map(d => (d in s ? s[d] : null));
      if (!data.some(v => v != null)) return null;
      return { ...mkDs(m.label, LLM_COLOR[m.brand] ?? C.slate, data), spanGaps: true, pointRadius: dates.length === 1 ? 3 : 0 };
    }).filter(Boolean);
    if (datasets.length === 0) return null;
    return { labels: dates.map(d => historyLabel(d, W)), datasets };
  };

  const llmInputData  = useMemo(() => llmTrend('input'),  [liveData, llmModels, W]); // eslint-disable-line react-hooks/exhaustive-deps
  const llmOutputData = useMemo(() => llmTrend('output'), [liveData, llmModels, W]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── GPU spot pricing (moved from the GPU view) ──────────────────── */
  const gpu = liveData?.gpu;
  const gpuPrices = gpu?.prices ?? gpu; // tolerate the old flat shape from stale caches
  const hasLive = gpuPrices != null && Object.keys(gpuPrices).length > 0;

  const gpuHist = gpu?.history;
  const gpuWindow = useMemo(() => windowHistory(gpuHist, W), [gpuHist, W]);

  // Current marketplace snapshot: on-demand vs interruptible (spot) $/hr per GPU
  const spotPrices = gpu?.spot ?? {};
  const currentRateData = useMemo(() => {
    if (!hasLive) return null;
    const keys = Object.keys(gpuPrices)
      .filter(k => Number.isFinite(gpuPrices[k]))
      .sort((a, b) => gpuPrices[b] - gpuPrices[a]);
    if (keys.length === 0) return null;
    return {
      labels: keys.map(k => GPU_LABELS[k] ?? k.replace(/_/g, ' ')),
      datasets: [
        {
          label: 'On-demand',
          data: keys.map(k => gpuPrices[k]),
          backgroundColor: keys.map(k => fa(GPU_PALETTE[k] ?? C.openai, 0.85)),
          borderColor: keys.map(k => GPU_PALETTE[k] ?? C.openai),
          borderWidth: 1, borderRadius: 4,
        },
        {
          label: 'Spot (interruptible)',
          data: keys.map(k => spotPrices[k] ?? null),
          backgroundColor: keys.map(k => fa(GPU_PALETTE[k] ?? C.openai, 0.35)),
          borderColor: keys.map(k => GPU_PALETTE[k] ?? C.openai),
          borderWidth: 1, borderRadius: 4,
        },
      ],
    };
  }, [hasLive, gpuPrices, spotPrices]);

  const availData = useMemo(() => {
    const availability = gpu?.availability;
    if (!availability || Object.keys(availability).length === 0) return null;
    const entries = Object.entries(availability)
      .filter(([, count]) => Number.isFinite(count))
      .sort((a, b) => b[1] - a[1]);
    return {
      labels: entries.map(([key]) => GPU_LABELS[key] ?? key.replace(/_/g, ' ')),
      datasets: [{
        data: entries.map(([, count]) => count),
        backgroundColor: entries.map(([key]) => fa(GPU_PALETTE[key] ?? C.openai, 0.70)),
        borderColor: entries.map(([key]) => GPU_PALETTE[key] ?? C.openai),
        borderWidth: 1,
        borderRadius: 4,
      }],
    };
  }, [gpu]);

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
      labels: dates.map(d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })),
      datasets: [mkDs(dramIndex.name, C.teal, values, true)],
    };
  }, [dramIndex, W]);

  /* ── AWS accelerator spot pricing ─────────────────────────────────── */
  // Exact EC2 spot backfill (≤90d) continued forward via the free Spot Advisor.
  const aws = liveData?.aws;
  const AWS_COLOR = { H100: C.openai, H200: C.anthropic, A100: C.teal, Trainium: C.google, Inferentia2: C.minimax };
  const awsLegend = ds => (ds?.datasets ?? []).map(d => [d.label, d.borderColor]);

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

  /* ── Average GPU rental price across the major clouds ─────────────── */
  // One forward-filled line per GPU bucket (H100 pools H100 + H200), each the
  // mean on-demand $/GPU/hr across the platforms in server/scrapers/cloudGpu.js.
  const cloudGpu = liveData?.cloudGpu;
  const CLOUD_COLORS = { A100: C.teal, H100: C.anthropic, B200: C.google, R400: C.red };
  const CLOUD_LABELS = { A100: 'A100', H100: 'H100 / H200', B200: 'B200', R400: 'R400' };
  const cloudAvgData = useMemo(() => {
    if (!cloudGpu?.dates?.length) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    let start = cloudGpu.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    if (start < 0) start = 0;
    const dates = cloudGpu.dates.slice(start);
    const datasets = Object.entries(cloudGpu.series ?? {})
      .filter(([, arr]) => arr.slice(start).some(Number.isFinite))
      .map(([bucket, arr]) => ({
        ...mkDs(CLOUD_LABELS[bucket] ?? bucket, CLOUD_COLORS[bucket] ?? C.slate, arr.slice(start), true),
        spanGaps: true, pointRadius: 0,
      }));
    if (datasets.length === 0) return null;
    return { labels: dates.map(d => historyLabel(d, W)), datasets };
  }, [cloudGpu, W]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combined GPU spot line: vast.ai's actual price where it exists, with the
  // earlier period filled by AWS's spot SHAPE rebased ("indexed") to vast.ai's
  // level at the join point — a single continuous line per GPU. Different
  // markets, so the pre-vast.ai portion is an indexed estimate, not AWS prices.
  const GPU_PAIRS = [['H100_SXM', 'H100'], ['H200', 'H200'], ['A100_SXM', 'A100']];
  const combinedSpotData = useMemo(() => {
    const aH = aws?.history, gH = gpuHist;
    if (!aH?.dates?.length || !awsWindow) return null;
    const gIdx = gH?.dates ? Object.fromEntries(gH.dates.map((d, i) => [d, i])) : {};
    const vastVal = (vk, d) => {
      const i = gIdx[d]; if (i == null) return null;
      const sp = gH.spotSeries?.[vk]?.[i]; if (Number.isFinite(sp)) return sp;
      const od = gH.series?.[vk]?.[i]; return Number.isFinite(od) ? od : null;
    };
    const datasets = [];
    for (const [vk, ak] of GPU_PAIRS) {
      const awsArr = aH.spotSeries?.[ak];
      if (!awsArr) continue;
      // Scale = vast.ai ÷ AWS at the earliest day vast.ai has a real price.
      let scale = 1;
      for (let i = 0; i < aH.dates.length; i++) {
        const v = vastVal(vk, aH.dates[i]);
        if (Number.isFinite(v) && Number.isFinite(awsArr[i]) && awsArr[i] !== 0) { scale = v / awsArr[i]; break; }
      }
      const combined = aH.dates.map((d, i) => {
        const v = vastVal(vk, d);
        if (Number.isFinite(v)) return v;                          // vast.ai actual
        return Number.isFinite(awsArr[i]) ? +(awsArr[i] * scale).toFixed(2) : null; // indexed AWS
      }).slice(awsWindow.start);
      if (!combined.some(Number.isFinite)) continue;
      datasets.push({ ...mkDs(GPU_LABELS[vk] ?? vk, GPU_PALETTE[vk] ?? AWS_COLOR[ak], combined), spanGaps: true, pointRadius: 0 });
    }
    if (datasets.length === 0) return null;
    return { labels: awsWindow.dates.map(d => historyLabel(d, W)), datasets };
  }, [aws, gpuHist, awsWindow, W]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mainstream GPU rental benchmark — vast.ai's average $/hr index where it
  // exists, with the earlier period filled by AWS spot. We build an AWS
  // composite shape (the average of the H100/H200/A100 spot series, each
  // normalised to its level on the join day) and rebase it to the vast.ai
  // index level at the join, so the pre-vast.ai portion follows AWS's historical
  // SHAPE at vast.ai's level — an indexed estimate, not literal vast.ai prices.
  const AWS_GPU_KEYS = ['H100', 'H200', 'A100'];
  const gpuIndexData = useMemo(() => {
    if (!gpuHist?.dates?.length) return null;
    const vIdx = Object.fromEntries(gpuHist.dates.map((d, i) => [d, gpuHist.index?.[i]]));

    // Without an AWS axis, fall back to the plain vast.ai index window.
    if (!aws?.history?.dates?.length || !awsWindow) {
      if (!gpuWindow) return null;
      return {
        labels: gpuWindow.dates.map(d => historyLabel(d, W)),
        datasets: [{ ...mkDs('Mainstream GPU rental benchmark', C.openai, gpuHist.index.slice(gpuWindow.start), true), pointRadius: 0 }],
      };
    }

    const aH = aws.history;
    const present = AWS_GPU_KEYS.filter(k => aH.spotSeries?.[k]?.some(Number.isFinite));

    // Join day = earliest AWS date where vast.ai has a real index value AND we
    // can read every present AWS series, so the composite is rebased cleanly.
    let joinI = -1;
    for (let i = 0; i < aH.dates.length; i++) {
      const v = vIdx[aH.dates[i]];
      if (Number.isFinite(v) && present.every(k => Number.isFinite(aH.spotSeries[k][i]))) { joinI = i; break; }
    }

    // No usable overlap → just show the raw vast.ai index over the AWS window.
    if (joinI < 0 || present.length === 0) {
      const series = awsWindow.dates.map(d => (Number.isFinite(vIdx[d]) ? vIdx[d] : null));
      if (!series.some(Number.isFinite)) return null;
      return {
        labels: awsWindow.dates.map(d => historyLabel(d, W)),
        datasets: [{ ...mkDs('Mainstream GPU rental benchmark', C.openai, series, true), spanGaps: true, pointRadius: 0 }],
      };
    }

    const vAtJoin = vIdx[aH.dates[joinI]];
    const awsAtJoin = Object.fromEntries(present.map(k => [k, aH.spotSeries[k][joinI]]));

    const combined = aH.dates.map((d, i) => {
      const v = vIdx[d];
      if (Number.isFinite(v)) return v;                 // vast.ai actual
      // AWS composite: average of each present series indexed to its join value.
      const ratios = present
        .map(k => aH.spotSeries[k][i] / awsAtJoin[k])
        .filter(Number.isFinite);
      if (ratios.length === 0) return null;
      const rel = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      return +(vAtJoin * rel).toFixed(2);               // indexed AWS estimate
    }).slice(awsWindow.start);

    if (!combined.some(Number.isFinite)) return null;
    return {
      labels: awsWindow.dates.map(d => historyLabel(d, W)),
      datasets: [{ ...mkDs('Mainstream GPU rental benchmark', C.openai, combined, true), spanGaps: true, pointRadius: 0 }],
    };
  }, [aws, gpuHist, gpuWindow, awsWindow, W]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── CPU spot pricing (AWS Spot Advisor) ──────────────────────────── */
  const cpuData = liveData?.cpu;
  const cpuCurrent = cpuData?.current ?? {};
  const cpuOnDemand = cpuData?.onDemand ?? {};

  const cpuCurrentData = useMemo(() => {
    const keys = Object.keys(cpuCurrent).filter(k => Number.isFinite(cpuCurrent[k]?.spot));
    if (keys.length === 0) return null;
    const sorted = [...keys].sort((a, b) => (cpuCurrent[b]?.spot ?? 0) - (cpuCurrent[a]?.spot ?? 0));
    return {
      labels: sorted,
      datasets: [
        {
          label: 'On-demand',
          data: sorted.map(k => cpuOnDemand[k] ?? null),
          backgroundColor: sorted.map(k => fa(CPU_PALETTE[k] ?? C.slate, 0.85)),
          borderColor: sorted.map(k => CPU_PALETTE[k] ?? C.slate),
          borderWidth: 1, borderRadius: 4,
        },
        {
          label: 'Spot',
          data: sorted.map(k => cpuCurrent[k]?.spot ?? null),
          backgroundColor: sorted.map(k => fa(CPU_PALETTE[k] ?? C.slate, 0.35)),
          borderColor: sorted.map(k => CPU_PALETTE[k] ?? C.slate),
          borderWidth: 1, borderRadius: 4,
        },
      ],
    };
  }, [cpuCurrent, cpuOnDemand]);

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
  const tpuCurrent = tpuData?.current ?? {};
  const tpuOnDemand = tpuData?.onDemand ?? {};

  const tpuCurrentData = useMemo(() => {
    const keys = Object.keys(tpuCurrent).filter(k => Number.isFinite(tpuCurrent[k]?.spot));
    if (keys.length === 0) return null;
    const sorted = [...keys].sort((a, b) => (tpuCurrent[b]?.spot ?? 0) - (tpuCurrent[a]?.spot ?? 0));
    return {
      labels: sorted.map(k => `TPU ${k}`),
      datasets: [
        {
          label: 'On-demand',
          data: sorted.map(k => tpuOnDemand[k] ?? null),
          backgroundColor: sorted.map(k => fa(TPU_PALETTE[k] ?? C.slate, 0.85)),
          borderColor: sorted.map(k => TPU_PALETTE[k] ?? C.slate),
          borderWidth: 1, borderRadius: 4,
        },
        {
          label: 'Preemptible (spot)',
          data: sorted.map(k => tpuCurrent[k]?.spot ?? null),
          backgroundColor: sorted.map(k => fa(TPU_PALETTE[k] ?? C.slate, 0.35)),
          borderColor: sorted.map(k => TPU_PALETTE[k] ?? C.slate),
          borderWidth: 1, borderRadius: 4,
        },
      ],
    };
  }, [tpuCurrent, tpuOnDemand]);

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

  /* ── AI company revenue (Epoch AI) ────────────────────────────────── */
  const REVENUE_PALETTE = {
    OpenAI:      C.openai,
    Anthropic:   C.anthropic,
    Google:      C.google,
    xAI:         C.kimi,
    'Mistral AI': C.mistral,
    DeepSeek:    C.deepseek,
    Meta:        C.minimax,
  };

  const epochRevData = useMemo(() => {
    const epoch = liveData?.epochRevenue;
    if (!epoch?.series) return null;
    const companies = epoch.companies ?? Object.keys(epoch.series);
    // Collect all dates across all companies and sort.
    const dateSet = new Set();
    for (const co of companies) (epoch.series[co] ?? []).forEach(p => dateSet.add(p.date));
    const allDates = [...dateSet].sort();
    if (allDates.length === 0) return null;
    // For each company, align values to the shared date axis (null where no data).
    const dateIdx = Object.fromEntries(allDates.map((d, i) => [d, i]));
    const datasets = companies.map(co => {
      const pts = epoch.series[co] ?? [];
      const data = new Array(allDates.length).fill(null);
      pts.forEach(p => { if (dateIdx[p.date] != null) data[dateIdx[p.date]] = p.value; });
      const color = REVENUE_PALETTE[co] ?? C.slate;
      return {
        ...mkDs(co, color, data),
        spanGaps: false,
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.3,
        borderWidth: 2,
      };
    }).filter(ds => ds.data.some(v => v != null));
    if (datasets.length === 0) return null;
    const cutoff = Date.now() - W * 7 * 86400000;
    const visibleStart = allDates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
    const start = Math.max(0, visibleStart < 0 ? 0 : visibleStart);
    const visibleDates = allDates.slice(start);
    return {
      labels: visibleDates.map(d => historyLabel(d, W)),
      datasets: datasets.map(ds => ({ ...ds, data: ds.data.slice(start) })),
    };
  }, [liveData?.epochRevenue, W]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeData = useMemo(() => {
    if (models.length === 0) return null;
    const sorted = [...models].sort((a, b) => b.changePct - a.changePct);
    return {
      labels: sorted.map(m => m.model),
      datasets: [{
        data:            sorted.map(m => m.changePct),
        backgroundColor: sorted.map(m => fa(m.changePct >= 0 ? C.openai : C.red, 0.70)),
        borderColor:     sorted.map(m => (m.changePct >= 0 ? C.openai : C.red)),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [models]);

  const dramAsOf = dram?.asOf ? ` · as of ${dram.asOf}` : '';

  return (
    <EditableGrid viewId="pricing">
      {llmInputData && (
        <ChartCard
          chartId="llm-api-input"
          legend={llmInputData.datasets.map(d => [d.label, d.borderColor])}
          height={260} span2
        >
          <Line data={llmInputData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {llmOutputData && (
        <ChartCard
          chartId="llm-api-output"
          legend={llmOutputData.datasets.map(d => [d.label, d.borderColor])}
          height={260} span2
        >
          <Line data={llmOutputData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {dramIndexData && (
        <ChartCard
          chartId="dram-index"
          title={`${dramIndex.name} — monthly (${dramIndex.unit})`}
          height={240} span2
        >
          <Line data={dramIndexData} options={baseOpts(v => `$${v.toFixed(1)}`)} />
        </ChartCard>
      )}

      {chipData && (
        <ChartCard
          chartId="dram-chips"
          subtitle={`${DRAM_METHOD}${dramAsOf}`}
          legend={dramLegend(chips)}
          height={260} span2
        >
          <Line data={chipData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {moduleData && (
        <ChartCard
          chartId="dram-modules"
          subtitle={`SO-DIMM / UDIMM / RDIMM modules. ${DRAM_METHOD}${dramAsOf}`}
          legend={dramLegend(modules)}
          height={240}
        >
          <Line data={moduleData} options={baseOpts(v => `$${v.toFixed(0)}`)} />
        </ChartCard>
      )}

      {changeData && (
        <ChartCard
          chartId="dram-change"
          subtitle={`Average session change across each model's variants${dramAsOf}. Red = declining.`}
          height={240}
        >
          <Bar data={changeData} options={hBarOpts(v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {currentRateData && (
        <ChartCard
          chartId="gpu-current-rates"
          legend={[['On-demand', C.openai], ['Spot (interruptible)', fa(C.openai, 0.45)]]}
          height={240} span2
        >
          <Bar data={currentRateData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {availData && (
        <ChartCard
          chartId="gpu-avail"
          height={200}
        >
          <Bar data={availData} options={baseOpts(v => Math.round(v))} />
        </ChartCard>
      )}

      {gpuIndexData && (
        <ChartCard
          chartId="gpu-index"
          height={240} span2
        >
          <Line data={gpuIndexData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {combinedSpotData && (
        <ChartCard
          chartId="gpu-spot-combined"
          legend={awsLegend(combinedSpotData)}
          height={240} span2
        >
          <Line data={combinedSpotData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {awsChipData && (
        <ChartCard
          chartId="aws-chip-spot"
          legend={awsLegend(awsChipData)}
          height={220} span2
        >
          <Line data={awsChipData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {cloudAvgData && (
        <ChartCard
          chartId="gpu-cloud-avg"
          legend={cloudAvgData.datasets.map(d => [d.label, d.borderColor])}
          height={240} span2
        >
          <Line data={cloudAvgData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {cpuCurrentData && (
        <ChartCard
          chartId="cpu-spot-rates"
          legend={[['On-demand', C.slate], ['Spot', fa(C.slate, 0.45)]]}
          height={220} span2
        >
          <Bar data={cpuCurrentData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {cpuHistData && (
        <ChartCard
          chartId="cpu-spot-history"
          legend={cpuHistData.datasets.map(d => [d.label, d.borderColor])}
          height={220} span2
        >
          <Line data={cpuHistData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {tpuCurrentData && (
        <ChartCard
          chartId="tpu-spot-rates"
          legend={[['On-demand', C.google], ['Preemptible (spot)', fa(C.google, 0.45)]]}
          height={220} span2
        >
          <Bar data={tpuCurrentData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {tpuHistData && (
        <ChartCard
          chartId="tpu-spot-history"
          legend={tpuHistData.datasets.map(d => [d.label, d.borderColor])}
          height={220} span2
        >
          <Line data={tpuHistData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {epochRevData && (
        <ChartCard
          chartId="ai-company-revenue"
          legend={epochRevData.datasets.map(d => [d.label, d.borderColor])}
          height={280} span2
        >
          <Line data={epochRevData} options={baseOpts(v => `$${v.toFixed(0)}B`)} />
        </ChartCard>
      )}
    </EditableGrid>
  );
}
