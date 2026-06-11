import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

function findPrice(gpu, ...keys) {
  if (!gpu) return null;
  for (const key of keys) {
    if (gpu[key] != null) return gpu[key];
  }
  return null;
}

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
  H200: C.anthropic,
  B200: C.google,
  A100_SXM: C.teal,
  A100_PCIe: C.perplexity,
  RTX_4090: C.minimax,
};

const GPU_LABELS = {
  H100_SXM: 'H100 SXM',
  H100_PCIe: 'H100 PCIe',
  H200: 'H200',
  B200: 'B200',
  A100_SXM: 'A100 SXM',
  A100_PCIe: 'A100 PCIe',
  RTX_4090: 'RTX 4090',
};

const GPU_HISTORY_KEYS = ['H100_SXM', 'H200', 'B200', 'A100_SXM', 'A100_PCIe', 'RTX_4090'];

const countPoints = values => values.filter(v => v != null && Number.isFinite(v)).length;

function windowHistory(history, weeks) {
  if (!history?.dates?.length) return null;
  const cutoff = Date.now() - weeks * 7 * 86400000;
  let start = history.dates.findIndex(d => new Date(d + 'T00:00:00Z').getTime() >= cutoff);
  if (start < 0) start = 0;
  return { start, dates: history.dates.slice(start) };
}

export default function Pricing({ weeks: W = 52 }) {
  const { liveData } = useData();

  /* ── GPU spot pricing (moved from the GPU view) ──────────────────── */
  const gpu = liveData?.gpu;
  const gpuPrices = gpu?.prices ?? gpu; // tolerate the old flat shape from stale caches
  const hasLive = gpuPrices != null && Object.keys(gpuPrices).length > 0;

  const h100Current = findPrice(gpuPrices, 'H100_SXM', 'H100_SXM4', 'H100_SXM_New') ?? 2.53;
  const h200Current = findPrice(gpuPrices, 'H200', 'H200_SXM5') ?? 3.69;
  const b200Current = findPrice(gpuPrices, 'B200') ?? 4.38;

  const gpuHist = gpu?.history;
  const gpuWindow = useMemo(() => windowHistory(gpuHist, W), [gpuHist, W]);

  const priceData = useMemo(() => {
    if (!gpuHist?.dates?.length || !gpuWindow) {
      return {
        labels: ['Current'],
        datasets: [
          mkDs('H100 SXM', C.openai, [h100Current]),
          mkDs('H200', C.anthropic, [h200Current]),
          mkDs('B200', C.google, [b200Current]),
        ],
      };
    }
    const labels = gpuWindow.dates.map(d => historyLabel(d, W));
    return {
      labels,
      datasets: GPU_HISTORY_KEYS
        .filter(key => countPoints(gpuHist.series?.[key]?.slice(gpuWindow.start) ?? []) >= 2)
        .map(key => ({
          ...mkDs(GPU_LABELS[key] ?? key.replace(/_/g, ' '), GPU_PALETTE[key] ?? C.openai, gpuHist.series[key].slice(gpuWindow.start)),
          spanGaps: true,
          pointRadius: 2,
        })),
    };
  }, [gpuHist, gpuWindow, W, h100Current, h200Current, b200Current]);

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

  const spreadData = useMemo(() => {
    if (!gpuHist?.dates?.length || !gpuWindow) return null;
    const h100 = gpuHist.series?.H100_SXM ?? [];
    const h200 = gpuHist.series?.H200 ?? [];
    const spread = gpuHist.dates.map((_, i) => (
      Number.isFinite(h100[i]) && Number.isFinite(h200[i])
        ? +(h200[i] - h100[i]).toFixed(2)
        : null
    )).slice(gpuWindow.start);
    if (!spread.some(v => v != null)) return null;
    return {
      labels: gpuWindow.dates.map(d => historyLabel(d, W)),
      datasets: [{ ...mkDs('H200 minus H100', C.anthropic, spread, true), spanGaps: true, pointRadius: 2 }],
    };
  }, [gpuHist, gpuWindow, W]);

  const liveNote = hasLive
    ? `Current vast.ai market medians: H100 $${h100Current}/hr · H200 $${h200Current}/hr · B200 $${b200Current}/hr.`
    : 'Waiting on live GPU pricing; chart uses stored historical snapshots.';

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

  // Mainstream GPU rental benchmark — average $/hr across tracked GPUs
  const gpuIndexData = useMemo(() => {
    if (!gpuHist?.dates?.length || !gpuWindow) return null;
    return {
      labels: gpuWindow.dates.map(d => historyLabel(d, W)),
      datasets: [mkDs('Mainstream GPU rental benchmark', C.openai, gpuHist.index.slice(gpuWindow.start), true)],
    };
  }, [gpuHist, gpuWindow, W]);

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
      <ChartCard
        chartId="gpu-prices"
        title="GPU rental price $/hr — mainstream accelerators"
        src="vast.ai API · Lambda Labs archive"
        srcUrl="https://vast.ai/pricing"
        freq="snapshot"
        subtitle={liveNote}
        legend={[['H100 SXM', C.openai], ['H200', C.anthropic], ['B200', C.google], ['A100 SXM', C.teal], ['RTX 4090', C.minimax]]}
        insight="Recent vast.ai market medians sit well below hyperscaler H100 rates, while B200 still carries a clear premium over H100/H200 capacity."
        height={250} span2
      >
        <Line data={priceData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      {availData && (
        <ChartCard
          chartId="gpu-avail"
          title="GPU availability — rentable vast.ai offers"
          src="vast.ai API"
          srcUrl="https://vast.ai/pricing"
          freq="live"
          subtitle="Count of verified, unrented, rentable one-GPU offers returned by the vast.ai market API."
          height={200}
        >
          <Bar data={availData} options={baseOpts(v => Math.round(v))} />
        </ChartCard>
      )}

      {spreadData && (
        <ChartCard
          chartId="gpu-spread"
          title="H200 – H100 price spread"
          src="vast.ai API · Lambda Labs archive"
          srcUrl="https://vast.ai/pricing"
          freq="snapshot"
          subtitle="Positive values mean H200 priced above H100 in the same source snapshot."
          height={200}
        >
          <Line data={spreadData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {gpuIndexData && (
        <ChartCard
          chartId="gpu-index"
          title="Mainstream GPU rental benchmark — three-year view ($/hr)"
          src="vast.ai API · Lambda Labs archive · AWS CLI reference"
          srcUrl="https://vast.ai/pricing"
          freq="snapshot"
          subtitle="Average $/hr across comparable mainstream AI GPUs in stored snapshots. Recent points are vast.ai market medians; older backfill uses archived Lambda Labs per-GPU rental prices because AWS official spot history is limited to the past 90 days."
          height={240} span2
        >
          <Line data={gpuIndexData} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        </ChartCard>
      )}

      {dramIndexData && (
        <ChartCard
          chartId="dram-index"
          title={`${dramIndex.name} — monthly (${dramIndex.unit})`}
          src="datatrack.trendforce.com"
          srcUrl="https://datatrack.trendforce.com/Chart/content/4694/mainstream-dram-spot-price"
          freq="monthly"
          subtitle="TrendForce's official mainstream DRAM spot price index. Monthly resolution, published on DataTrack."
          height={240} span2
        >
          <Line data={dramIndexData} options={baseOpts(v => `$${v.toFixed(1)}`)} />
        </ChartCard>
      )}

      {chipData && (
        <ChartCard
          chartId="dram-chips"
          title="DRAM chip & GDDR spot price over time — average per model ($)"
          src="trendforce.com/price/dram/dram_spot"
          srcUrl="https://www.trendforce.com/price/dram/dram_spot"
          freq="daily"
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
          title="Memory module spot price over time — average per model ($)"
          src="trendforce.com/price/dram/dram_spot"
          srcUrl="https://www.trendforce.com/price/dram/dram_spot"
          freq="daily"
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
          title="DRAM spot — session change by model (%)"
          src="trendforce.com/price/dram/dram_spot"
          srcUrl="https://www.trendforce.com/price/dram/dram_spot"
          freq="daily"
          subtitle={`Average session change across each model's variants${dramAsOf}. Red = declining.`}
          height={240}
        >
          <Bar data={changeData} options={hBarOpts(v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)} />
        </ChartCard>
      )}
    </EditableGrid>
  );
}
